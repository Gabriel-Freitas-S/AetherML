"""
ml/evaluation/build_forecast_compare.py — Par ML vs API Open-Meteo na janela de
FORECAST (as 120h futuras), distinto do artefato de holdout.

O dashboard precisa das DUAS curvas lado a lado também para a janela que o app
mesmo prevê. Este script monta esse par sem recalcular nada:

- `ml` é lido DIRETO de `points[].observed` em stations-data.json — exatamente
  o número que o site já renderiza (bias + isotônico + CLAMPS aplicados em
  `predict_forecast.predict_all`). Nenhum booster é carregado aqui: se este
  script re-previsse, o gráfico compararia o modelo com uma segunda rodada dele.
- `api` é o valor bruto CAMS da MESMA hora, em `ml/data/openmeteo_raw.json`.
- Toda hora do array tem que existir nos DOIS arquivos, senão `ValueError`.

O QUE ESTE ARTEFATO NÃO É: validação de acerto. Nesta janela o valor CAMS entra
como FEATURE do próprio modelo (`build_real_dataset.row_to_features` consome as
horas de forecast), então a concordância entre `ml` e `api` é verdadeira por
construção. A validação de verdade é `comparison-data.json`, onde a hora
avaliada é anterior ao fetch e o CAMS ainda não tinha entrado em nenhum treino.
Por isso `is_validation: false` e `validation_note` são obrigatórios.

Formato compacto: arrays numéricos paralelos, timestamps uma vez por estação —
mesmo formato de `stations[]` de comparison-data.json, para o ComparisonChart
desenhar sem mudança.

Uso: `python ml/evaluation/build_forecast_compare.py [versao] [ordem]`
Saída: apps/web/public/data/forecast-compare.json
"""

import json
import os
import sys
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.evaluation.build_comparison import metrics
from ml.training.build_real_dataset import AQ_KEYS, TARGETS
from ml.training.predict_forecast import (
    CLAMPS,
    REGISTRY_PATH,
    active_model,
    order_for_nfeatures,
    require_calibration,
)

SCHEMA_VERSION = 1
POLLUTANTS = list(TARGETS)
IS_VALIDATION = False
VALIDATION_NOTE = (
    "Isto NÃO é validação de precisão do modelo. Na janela de forecast o valor "
    "do Open-Meteo (CAMS) é insumo das features do próprio modelo — as horas "
    "previstas entram em row_to_features — então a curva 'api' não é uma "
    "referência independente e a proximidade alta entre 'ml' e 'api' é "
    "esperada por construção, não um acerto medido. Para medir erro de verdade "
    "veja comparison-data.json (holdout), onde a hora avaliada é anterior ao "
    "fetch e o valor CAMS dela nunca entrou em nenhum treino."
)
CAMS_NOT_REFERENCE_CAVEAT = (
    "NÃO é validação: o CAMS de cada hora forecast é uma das entradas do modelo "
    "que produziu a curva 'ml' na mesma hora. Ler esta sobreposição como 'o "
    "modelo acerta' seria tautologia — o modelo está comparando a si próprio com "
    "a própria entrada. O que dá para dizer aqui é o quanto o par diverge por "
    "efeito do piso de no2 e da calibração, nada sobre erro de previsão. O "
    "erro honesto está no holdout (comparison-data.json)."
)


def _dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _norm(ts: str) -> str:
    """Chave de hora comparável entre os dois arquivos (o raw não tem 'Z')."""
    return ts[:-1] if ts.endswith("Z") else ts


def no2_caveats(cal: dict, stations: list) -> list:
    """Duas ressalvas de no2 com DOIS números medidos em runtime, não afirmados."""
    floor = CLAMPS["no2"]
    iso = (cal.get("isotonic") or {}).get("no2") or {}
    iso_floor = iso["y"][0] if iso.get("y") else None
    ml = [v for st in stations for v in st["pollutants"]["no2"]["ml"] if v is not None]
    pinned = sum(1 for v in ml if v == floor)
    pct_ml = 100.0 * pinned / len(ml) if ml else 0.0
    api = [
        v for st in stations for v in st["pollutants"]["no2"]["api"] if v is not None
    ]
    below = sum(1 for v in api if v < floor)
    pct_api = 100.0 * below / len(api) if api else 0.0
    return [
        f"no2 tem piso operacional de {floor} µg/m³ (CLAMPS em predict_forecast.py:39). "
        f"O isotônico de no2 em calibration.json começa em {iso_floor} µg/m³ — abaixo do "
        f"piso — então o corte é artefato do modelo, não limite físico: {pct_ml:.2f}% dos "
        f"{len(ml)} pontos de forecast em stations-data.json saem cravados exatamente em "
        f"{floor} (medido nesta janela).",
        f"No mesmo par, {pct_api:.2f}% dos {len(api)} valores de no2 do Open-Meteo estão "
        f"abaixo do piso de {floor} µg/m³ (medido): o corte esconde massa de concentração "
        f"que a fonte reporta, não só ruído numérico.",
        CAMS_NOT_REFERENCE_CAVEAT,
    ]


def coverage_gap_caveat(stations: list) -> str:
    """Horas sem valor CAMS em TODAS as estações — `null`, nunca 0/chute."""
    gaps = None
    for st in stations:
        miss = {
            st["timestamps"][i]
            for i in range(len(st["timestamps"]))
            if all(st["pollutants"][p]["api"][i] is None for p in POLLUTANTS)
        }
        gaps = miss if gaps is None else (gaps & miss)
    if not gaps:
        return (
            "O CAMS cobriu todas as horas da janela nos dois lados; não há buraco de "
            "cobertura para descer."
        )
    ok = [ts for ts in stations[0]["timestamps"] if ts not in gaps]
    return (
        f"O CAMS não cobre as últimas {len(gaps)}h da janela (a partir de "
        f"{min(gaps)}; último valor pareado {ok[-1] if ok else '—'}). Essas horas ficam "
        f"null no array 'api' e saem de n_paired/coverage_pct — nunca 0, nunca "
        f"interpolação. A curva 'ml' continua completa nestas horas: foi prevista sem "
        f"o dado de referência, que é exatamente o caso de uso do forecast."
    )


def pair_stations(forecast: dict, raw: dict) -> list:
    """Estações com `ml` (de stations-data.json) e `api` (do raw) pareados.

    Invariante central: toda hora emitida pelo forecast tem que existir no
    arquivo bruto (ValueError). A janela NÃO é encurtada para caber na cobertura
    da API — hora sem CAMS vira `null` e aparece em coverage_pct.
    """
    stations, win_ref = [], None
    for sid, entry in forecast.items():
        if sid not in raw["stations"]:
            raise ValueError(
                f"estação '{sid}' não existe em ml/data/openmeteo_raw.json — os dois "
                f"arquivos precisam cobrir as mesmas estações"
            )
        aq = raw["stations"][sid]["aq_hourly"]
        raw_idx = {_norm(t): i for i, t in enumerate(aq["time"])}
        stamps = [p["timestamp"] for p in entry["points"]]
        if not stamps:
            raise ValueError(f"estação '{sid}' sem pontos de forecast")
        win = (stamps[0], stamps[-1], len(stamps))
        if win_ref is None:
            win_ref = win
        elif win != win_ref:
            raise ValueError(
                f"janela de forecast divergente em '{sid}': {win} != {win_ref} — o "
                f"gráfico sobrepõe as estações na mesma janela de horas"
            )
        poll = {p: {"ml": [], "api": []} for p in POLLUTANTS}
        for i, pt in enumerate(entry["points"]):
            gi = raw_idx.get(_norm(pt["timestamp"]))
            if gi is None:
                raise ValueError(
                    f"hora {pt['timestamp']} de '{sid}' (ponto {i}) não existe em "
                    f"ml/data/openmeteo_raw.json — par impossível"
                )
            for p in POLLUTANTS:
                poll[p]["ml"].append(pt["observed"].get(p))
                v = aq[AQ_KEYS[p]][gi]
                poll[p]["api"].append(None if v is None else float(v))
        meta = entry["station"]
        stations.append(
            {
                "id": sid,
                "name": meta["name"],
                "municipality": meta["municipality"],
                "lat": meta["lat"],
                "lon": meta["lon"],
                "timestamps": stamps,
                "pollutants": poll,
            }
        )
    if not stations:
        raise ValueError("stations-data.json sem estações")
    return stations


def summarize(stations: list) -> dict:
    """by_pollutant + by_station, com n_paired e a cobertura real da API."""
    n_total = len(stations) * len(stations[0]["timestamps"])

    def _block(sts: list) -> dict:
        n_pts = len(sts) * len(sts[0]["timestamps"])
        pairs = {
            p: [
                (s["pollutants"][p]["ml"][i], s["pollutants"][p]["api"][i])
                for s in sts
                for i in range(len(s["timestamps"]))
            ]
            for p in POLLUTANTS
        }
        out = {}
        for p in POLLUTANTS:
            m = metrics(pairs[p])
            out[p] = {
                "n_paired": m["n"],
                "coverage_pct": round(100.0 * m["n"] / n_pts, 2) if n_pts else 0.0,
                "mae": m["mae"],
                "rmse": m["rmse"],
                "bias": m["bias"],
                "r2": m["r2"],
            }
        return out

    return {
        "by_pollutant": _block(stations),
        "by_station": {
            s["id"]: {
                p: {k: v for k, v in _block([s])[p].items() if k != "r2"}
                for p in POLLUTANTS
            }
            for s in stations
        },
        "points_total": n_total,
    }


def build_payload(
    stations: list,
    *,
    model_version: str,
    feature_order_version: str,
    window_from: str,
    window_to: str,
    window_hours: int,
    raw_fetched_at: str,
    generated_at: str,
    source_ml: str,
    source_api: str,
    raw_file: str,
    validation_note: str,
    caveats: list,
) -> dict:
    """Valida os invariantes do artefato e monta o payload final.

    Invariantes (ValueError explícito, não `assert`: `python -O` desligaria a
    checagem e um artefato desalinhado quebra o gráfico em silêncio):
    - `timestamps`, `ml` e `api` têm exatamente o mesmo tamanho por poluente;
    - `window.hours` é o número de pontos (a janela não encolhe por causa de
      buraco de cobertura);
    - as horas do array são estritamente crescentes (par index-for-index).

    O holdout rejeita hora futura; aqui a janela É o futuro, e o que se rejeita
    é o contrário: hora que não existe em nenhum dos arquivos de origem.

    É aqui que os valores ganham 3 casas: um ponto único de arredondamento
    (arrays crus inflariam o PWA estático).
    """
    rounded = []
    for st in stations:
        n_ts = len(st["timestamps"])
        if window_hours != n_ts:
            raise ValueError(
                f"janela encolheu em '{st['id']}': window.hours={window_hours} != "
                f"timestamps={n_ts} — a janela do forecast é derivada, não ajustada"
            )
        if list(st["timestamps"]) != sorted(st["timestamps"]):
            raise ValueError(f"timestamps fora de ordem em '{st['id']}'")
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
        "is_validation": IS_VALIDATION,
        "validation_note": validation_note,
        "window": {"from": window_from, "to": window_to, "hours": window_hours},
        "source": {
            "ml": source_ml,
            "api": source_api,
            "raw_file": raw_file,
            "raw_fetched_at": raw_fetched_at,
        },
        "caveats": list(caveats),
        "stations": stations,
        "summary": summarize(stations),
    }


def build_forecast_compare(
    raw_path: str = "ml/data/openmeteo_raw.json",
    forecast_path: str = os.path.join(
        "apps", "web", "public", "data", "stations-data.json"
    ),
    out_path: str = os.path.join(
        "apps", "web", "public", "data", "forecast-compare.json"
    ),
    version: str | None = None,
    order: str | None = None,
    registry_path: str = REGISTRY_PATH,
) -> dict:
    if version is None or order is None:
        reg_ver, reg_order = active_model(registry_path)
        version = version or reg_ver
        order = order or reg_order
    # calibração só para LER o iso_floor do no2 na caveat; `ml` não é recalculado.
    cal = require_calibration(version)

    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    with open(forecast_path, "r", encoding="utf-8") as f:
        forecast = json.load(f)

    for sid, entry in forecast.items():
        if not entry["points"]:
            raise ValueError(
                f"estação '{sid}' sem pontos de forecast em {forecast_path}"
            )
        expected = order_for_nfeatures(len(entry["points"][0]["features"]))
        if expected != order:
            raise ValueError(
                f"ordem '{order}' declarada no registry não bate com as features de "
                f"{sid} em {forecast_path}: {len(entry['points'][0]['features'])} "
                f"features espera '{expected}'"
            )

    stations = pair_stations(forecast, raw)
    payload = build_payload(
        stations,
        model_version=version,
        feature_order_version=order,
        window_from=stations[0]["timestamps"][0],
        window_to=stations[0]["timestamps"][-1],
        window_hours=len(stations[0]["timestamps"]),
        raw_fetched_at=raw.get("fetched_at") or "",
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        source_ml=f"{forecast_path} (LightGBM, calibrado)",
        source_api="Open-Meteo air-quality API (CAMS)",
        raw_file=raw_path,
        validation_note=VALIDATION_NOTE,
        caveats=no2_caveats(cal, stations) + [coverage_gap_caveat(stations)],
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return payload


if __name__ == "__main__":
    # Sem argumento: models/registry.json decide versão e ordem das features.
    ver = sys.argv[1] if len(sys.argv) > 1 else None
    ordr = sys.argv[2] if len(sys.argv) > 2 else None
    payload = build_forecast_compare(version=ver, order=ordr)
    out_path = os.path.join("apps", "web", "public", "data", "forecast-compare.json")
    win = payload["window"]
    print(
        f"[fc-compare] {payload['model_version']} ({payload['feature_order_version']}) "
        f"{win['from']} → {win['to']} | {len(payload['stations'])} estações × "
        f"{win['hours']}h | is_validation={payload['is_validation']} → {out_path} "
        f"({os.path.getsize(out_path)} B)"
    )
    for st in payload["stations"]:
        n_ts = len(st["timestamps"])
        nulls_ml = sum(
            1 for p in POLLUTANTS for v in st["pollutants"][p]["ml"] if v is None
        )
        nulls_api = sum(
            1 for p in POLLUTANTS for v in st["pollutants"][p]["api"] if v is None
        )
        print(
            f"[check] {st['id']:18s} timestamps={n_ts} "
            f"ml/api alinhados={all(len(st['pollutants'][p]['ml']) == len(st['pollutants'][p]['api']) == n_ts for p in POLLUTANTS)} "
            f"nulls ml={nulls_ml} api={nulls_api}"
        )
    for p, m in payload["summary"]["by_pollutant"].items():
        print(
            f"[fc-compare] {p:5s} n_paired={m['n_paired']:5d} "
            f"cobertura={m['coverage_pct']:6.2f}%  (desvio vs CAMS, não erro: "
            f"MAE={m['mae']:7.3f} bias={m['bias']:+7.3f})"
        )
    for c in payload["caveats"][:2]:
        print(f"[fc-compare] ressalva no2: {c}")
