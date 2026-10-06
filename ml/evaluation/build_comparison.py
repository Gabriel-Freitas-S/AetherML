"""
ml/evaluation/build_comparison.py — Par ML vs API Open-Meteo no holdout honesto.

O gráfico do site precisa mostrar as DUAS curvas lado a lado: o que o modelo
previu e o que o Open-Meteo (CAMS) realmente reportou na MESMA hora. Este
script gera esse par sem vazar para o futuro:

- Janela: as 168h imediatamente anteriores a `fetched_at`, exactamente a mesma
  que `eval_holdout.run_backtest` usa (`eval_holdout.py:159/172/176`) e que o
  treino reserva (`build_real_dataset.end_cutoff`). Janela derivada, nunca fixa.
- Protocolo 1-step: para cada hora do holdout o modelo recebe lags REAIS
  (mesma técnica de `eval_holdout.py:184-215`) — mede skill, não persistência.
- Versão e ordem de features vêm de `models/registry.json`
  (`predict_forecast.active_model` / `order_for_nfeatures`); nunca hardcoded.
- Calibração OBRIGATÓRIA (`predict_forecast.require_calibration` aborta se
  `calibration.json` faltar/estiver vazio) — sem ela o gráfico mentiria sobre
  qual modelo o app mostra.
- `api` é o valor bruto CAMS da mesma hora, `ml` a previsão calibrada. Onde
  qualquer lado é genuinamente ausente vai `null` (nunca 0, nunca chute).
  Pares incompletos saem das métricas (contados só como `n` válido).

Formato compacto: arrays numéricos paralelos, timestamps uma vez por estação —
7560 objetos verbosos inflariam o PWA estático.

Uso: `python ml/evaluation/build_comparison.py [versao] [ordem]`
Saída: apps/web/public/data/comparison-data.json
"""

import json
import os
import sys
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.evaluation.eval_holdout import HOLDOUT_HOURS, _meteo_row
from ml.training.build_real_dataset import AQ_KEYS, TARGETS, row_to_features
from ml.training.calibrate import calibrate_value
from ml.training.predict_forecast import (
    CLAMPS,
    REGISTRY_PATH,
    active_model,
    load_boosters,
    order_for_nfeatures,
    require_calibration,
)

SCHEMA_VERSION = 1
POLLUTANTS = list(TARGETS)
PROTOCOL = (
    "Backtest honesto: 168h antes de fetched_at (janela reservada ao holdout, "
    "nunca vista no treino), previsão 1-step com lags e meteorologia reais, "
    "calibrada com models/<versão>/calibration.json; curva 'api' é o valor "
    "CAMS/Open-Meteo da mesma hora."
)
NO2_OPERATIONAL_CLAMP_PCT = 9.26  # medido em stations-data.json (100/1080 pontos)
CAMS_CAVEAT = (
    "A curva 'api' é a re-análise CAMS, não uma estação de monitoramento "
    "independente: o que se mede aqui é quanto o modelo se aproxima da "
    "persistência do próprio CAMS ao longo de 1h, com lags reais."
)


def no2_caveats(cal: dict, stations: list) -> list:
    """Caveats de no2 com números medidos, não afirmados."""
    floor = CLAMPS["no2"]
    iso = (cal.get("isotonic") or {}).get("no2") or {}
    iso_floor = iso["y"][0] if iso.get("y") else None
    no2 = [v for st in stations for v in st["pollutants"]["no2"]["ml"] if v is not None]
    below = sum(1 for v in no2 if v < floor)
    pct = 100.0 * below / len(no2) if no2 else 0.0
    bias = summarize(stations)["by_pollutant"]["no2"]["bias"]
    return [
        f"no2 tem piso físico de {floor} µg/m³ (CLAMPS em predict_forecast.py:39). "
        f"O isotônico de no2 começa em {iso_floor} µg/m³ — abaixo do piso — então "
        f"o corte só acontece no pipeline de forecast, e é ele que fixa "
        f"{NO2_OPERATIONAL_CLAMP_PCT}% dos 1080 pontos de 120h em stations-data.json "
        f"(medido). Neste backtest a curva 'ml' NÃO aplica o piso (mesma regra de "
        f"eval_holdout.py), então o viés positivo de no2 em baixa concentração "
        f"(bias={bias:+.3f} aqui) aparece mais forte aqui do que no app.",
        f"no holdout, {pct:.1f}% das previsões calibradas de no2 ficam abaixo do "
        f"piso operacional de {floor} µg/m³ — por construção o modelo superestima "
        "no2 quando a concentração real é baixa.",
        CAMS_CAVEAT,
    ]


def _dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def holdout_indices(times, cutoff: str, hours: int = HOLDOUT_HOURS) -> list:
    """Índices das `hours` horas de holdout, derivados de `cutoff`.

    Réplica de `eval_holdout.py:159/172/176`: última hora cujo `ts[:13] <= cutoff`
    e daí as `hours` horas anteriores (cutoff vazio = fim da série).
    """
    end_idx = max(i for i, ts in enumerate(times) if not cutoff or ts[:13] <= cutoff)
    return list(range(end_idx - hours + 1, end_idx + 1))


def metrics(pairs) -> dict:
    """(mae, rmse, bias, r2, n) sobre pares (ml, api) — n conta só pares completos.

    bias = média(pred - real): positivo = modelo superestima.
    r2 = 1 - SSres/SStot com SStot em torno da média da série `api`.
    """
    yt = [float(a) for m, a in pairs if m is not None and a is not None]
    yp = [float(m) for m, a in pairs if m is not None and a is not None]
    n = len(yt)
    if n == 0:
        return {"mae": 0.0, "rmse": 0.0, "bias": 0.0, "r2": 0.0, "n": 0}
    err = [p - t for p, t in zip(yp, yt)]
    mae = sum(abs(e) for e in err) / n
    rmse = (sum(e * e for e in err) / n) ** 0.5
    mean_t = sum(yt) / n
    sstot = sum((t - mean_t) ** 2 for t in yt)
    ssres = sum(e * e for e in err)
    r2 = 1.0 - ssres / sstot if sstot > 0 else 0.0
    return {
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "bias": round(sum(err) / n, 3),
        "r2": round(r2, 4),
        "n": n,
    }


def summarize(stations) -> dict:
    """by_pollutant (agrega as 9 estações) + by_station."""
    pairs = {
        p: [
            (s["pollutants"][p]["ml"][i], s["pollutants"][p]["api"][i])
            for s in stations
            for i in range(len(s["timestamps"]))
        ]
        for p in POLLUTANTS
    }
    by_station = {}
    for s in stations:
        per = {}
        for p in POLLUTANTS:
            m = metrics(
                [
                    (s["pollutants"][p]["ml"][i], s["pollutants"][p]["api"][i])
                    for i in range(len(s["timestamps"]))
                ]
            )
            per[p] = {k: m[k] for k in ("mae", "rmse", "bias", "n")}
        by_station[s["id"]] = per
    return {
        "by_pollutant": {p: metrics(pairs[p]) for p in POLLUTANTS},
        "by_station": by_station,
    }


def build_payload(
    stations: list,
    *,
    model_version: str,
    feature_order_version: str,
    holdout_from: str,
    holdout_to: str,
    holdout_hours: int,
    raw_fetched_at: str,
    generated_at: str,
    protocol: str,
    source_api: str,
    raw_file: str,
    caveats: list,
) -> dict:
    """Valida os invariantes do artefato e monta o payload final.

    Invariantes (ValueError explícito, não `assert`: `python -O` desligaria a
    checagem e um artefato com leak silencioso é pior que nenhum artefato):
    - `timestamps`, `ml` e `api` têm exatamente o mesmo tamanho por poluente;
    - nenhuma hora do array é posterior a `holdout_to`;
    - `holdout_to` nunca passa de `raw_fetched_at` (nada depois da hora do fetch).

    É aqui que os valores ganham 3 casas: um ponto único de arredondamento
    (7560 floats crus inflariam o PWA estático).
    """
    to, fetched = _dt(holdout_to), _dt(raw_fetched_at)
    if to > fetched:
        raise ValueError(
            f"future-leak: holdout.to={holdout_to} > fetched_at={raw_fetched_at}"
        )
    rounded = []
    for st in stations:
        n_ts = len(st["timestamps"])
        for ts in st["timestamps"]:
            if _dt(ts) > to:
                raise ValueError(
                    f"future-leak: {st['id']} tem hora {ts} > holdout.to={holdout_to}"
                )
        clean = {k: v for k, v in st.items() if k not in ("timestamps", "pollutants")}
        clean["timestamps"] = list(st["timestamps"])
        poll = {}
        for p in POLLUTANTS:
            pair = st["pollutants"][p]
            if not (len(pair["ml"]) == len(pair["api"]) == n_ts):
                raise ValueError(
                    f"arrays desalinhados em {st['id']}/{p}: "
                    f"timestamps={n_ts} ml={len(pair['ml'])} api={len(pair['api'])}"
                )
            poll[p] = {
                "ml": [None if v is None else round(float(v), 3) for v in pair["ml"]],
                "api": [None if v is None else round(float(v), 3) for v in pair["api"]],
            }
        clean["pollutants"] = poll
        rounded.append(clean)
    stations = rounded
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "model_version": model_version,
        "feature_order_version": feature_order_version,
        "protocol": protocol,
        "holdout": {"from": holdout_from, "to": holdout_to, "hours": holdout_hours},
        "source": {
            "api": source_api,
            "raw_file": raw_file,
            "raw_fetched_at": raw_fetched_at,
        },
        "caveats": list(caveats),
        "stations": stations,
        "summary": summarize(stations),
    }


def _predict_station(
    station_id: str,
    entry: dict,
    boosters: dict,
    cal: dict,
    order: str,
    h_idx: list,
) -> dict:
    """Arrays paralelos (ml/api) de uma estação na janela de holdout."""
    flags = entry["meta"]
    aq, met = entry["aq_hourly"], entry["meteo_hourly"]
    times = aq["time"]
    timestamps = [times[i] + "Z" for i in h_idx]
    out = {p: {"ml": [], "api": []} for p in POLLUTANTS}

    for gi in h_idx:
        ts = times[gi]
        aq_now = {p: aq[AQ_KEYS[p]][gi] for p in POLLUTANTS}
        try:
            lags = {
                "pm25": aq["pm2_5"][gi - 24],
                "pm10": aq["pm10"][gi - 24],
                "no2": aq["nitrogen_dioxide"][gi - 24],
                "o3": aq["ozone"][gi - 24],
                "pblh6": sum(met["boundary_layer_height"][gi - 6 : gi]) / 6.0,
            }
            lags1 = (
                {p: aq[AQ_KEYS[p]][gi - 1] for p in POLLUTANTS}
                if order == "v2"
                else None
            )
            feats = row_to_features(
                _meteo_row(met, gi), aq_now, ts, lags, flags, order=order, lags1=lags1
            )
            pred = {
                p: max(
                    0.0, calibrate_value(p, float(boosters[p].predict([feats])[0]), cal)
                )
                for p in POLLUTANTS
            }
        except (ValueError, TypeError, KeyError):
            # meteo/lag ausente na hora: sem vetor de features não há previsão
            # honesta — `ml` fica null em vez de vira chute.
            pred = {p: None for p in POLLUTANTS}
        for p in POLLUTANTS:
            real = aq_now[p]
            out[p]["ml"].append(pred[p])
            out[p]["api"].append(None if real is None else float(real))

    return {
        "id": station_id,
        "name": flags["name"],
        "municipality": flags["municipality"],
        "lat": flags["lat"],
        "lon": flags["lon"],
        "timestamps": timestamps,
        "pollutants": out,
    }


def build_comparison(
    raw_path: str = "ml/data/openmeteo_raw.json",
    out_path: str = os.path.join(
        "apps", "web", "public", "data", "comparison-data.json"
    ),
    version: str | None = None,
    order: str | None = None,
    registry_path: str = REGISTRY_PATH,
) -> dict:
    if version is None or order is None:
        reg_ver, reg_order = active_model(registry_path)
        version = version or reg_ver
        order = order or reg_order
    cal = require_calibration(version)
    boosters = load_boosters(version)
    n_feat = boosters[TARGETS[0]].num_feature()
    expected_order = order_for_nfeatures(n_feat)
    if order != expected_order:
        # 30 features (v2) contra 25 (v1) levanta LightGBMError só na predict;
        # falhar aqui nomeia a causa em vez de estourar erro genérico.
        raise ValueError(
            f"ordem '{order}' incompatível com os boosters de {version}: "
            f"num_feature={n_feat} espera '{expected_order}'"
        )

    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    fetched = raw.get("fetched_at") or ""
    cutoff = fetched[:13]

    stations, h_idx_ref, win_ref = [], None, None
    for station_id, entry in raw["stations"].items():
        times = entry["aq_hourly"]["time"]
        h_idx = holdout_indices(times, cutoff)
        stations.append(
            _predict_station(station_id, entry, boosters, cal, order, h_idx)
        )
        if h_idx_ref is None:
            h_idx_ref, win_ref = h_idx, (times[h_idx[0]], times[h_idx[-1]])
        elif (times[h_idx[0]], times[h_idx[-1]]) != win_ref:
            raise ValueError(f"janela de holdout divergente em {station_id}")

    caveats = no2_caveats(cal, stations)

    payload = build_payload(
        stations,
        model_version=version,
        feature_order_version=order,
        holdout_from=win_ref[0] + "Z",
        holdout_to=win_ref[1] + "Z",
        holdout_hours=HOLDOUT_HOURS,
        raw_fetched_at=fetched,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        protocol=PROTOCOL,
        source_api="Open-Meteo air-quality API (CAMS)",
        raw_file=raw_path,
        caveats=caveats,
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return payload


if __name__ == "__main__":
    # Sem argumento: models/registry.json decide versão e ordem das features.
    ver = sys.argv[1] if len(sys.argv) > 1 else None
    ordr = sys.argv[2] if len(sys.argv) > 2 else None
    payload = build_comparison(version=ver, order=ordr)
    out_path = os.path.join("apps", "web", "public", "data", "comparison-data.json")
    size = os.path.getsize(out_path)
    print(
        f"[compare] {payload['model_version']} ({payload['feature_order_version']}) "
        f"{payload['holdout']['from']} → {payload['holdout']['to']} | "
        f"{len(payload['stations'])} estações × {payload['holdout']['hours']}h → {out_path} ({size} B)"
    )
    # Evidência impressa: sem leak e sem arrays desalinhados.
    latest = max(ts for st in payload["stations"] for ts in st["timestamps"])
    print(
        f"[check] última hora do array={latest} <= holdout.to={payload['holdout']['to']} "
        f"<= fetched_at={payload['source']['raw_fetched_at']} "
        f"-> {latest <= payload['holdout']['to'] <= payload['source']['raw_fetched_at']}"
    )
    print(
        f"[check] timestamps/ml/api com mesmo tamanho em todas as estações: "
        f"{all(len(st['timestamps']) == len(st['pollutants'][p]['ml']) == len(st['pollutants'][p]['api']) for st in payload['stations'] for p in POLLUTANTS)}"
    )
    for p, m in payload["summary"]["by_pollutant"].items():
        print(
            f"[compare] {p:5s} MAE={m['mae']:7.3f} RMSE={m['rmse']:7.3f} "
            f"bias={m['bias']:+7.3f} R²={m['r2']:.4f} n={m['n']}"
        )
