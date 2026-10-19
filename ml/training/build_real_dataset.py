"""
ml/training/build_real_dataset.py — Dataset REAL a partir do Open-Meteo.

Mapeia séries horárias reais (CAMS + meteorologia) para as 25 features
canônicas (FEATURE_ORDER_V1, ordem imutável) e os 5 alvos reais.

Proxies determinísticos (documentados, zero random):
- tráfego: curva dia/noite + pico útil (boost em pontes/centro)
- satélite: aod ~ pm10 real, tropomi_no2 = no2 real, uvai ~ aod
- lags: valores reais de 24h atrás; pblh_rolling6 = média real das 6h anteriores

Uso:
  python ml/training/fetch_openmeteo.py            # baixa o raw
  python ml/training/build_real_dataset.py         # gera ml/data/train_dataset_real.json
"""

import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FEATURE_NAMES = [
    "temperature",
    "relative_humidity",
    "wind_speed",
    "wind_direction",
    "wind_u",
    "wind_v",
    "boundary_layer_height",
    "surface_pressure",
    "solar_radiation",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "is_weekend",
    "traffic_speed_avg",
    "traffic_delay_ratio",
    "traffic_congestion_index",
    "satellite_aod",
    "satellite_tropomi_no2",
    "satellite_uvai",
    "pm25_lag24",
    "pm10_lag24",
    "no2_lag24",
    "o3_lag24",
    "pblh_rolling6",
]

TARGETS = ["pm25", "pm10", "o3", "no2", "so2"]
AQ_KEYS = {
    "pm25": "pm2_5",
    "pm10": "pm10",
    "o3": "ozone",
    "no2": "nitrogen_dioxide",
    "so2": "sulphur_dioxide",
}

# V2 = V1 intacta (mesma ordem) + 5 lags autoregressivos de 1h (episódios
# evoluem em horas; lag24 sozinho é cego à escalada intradiária).
FEATURE_NAMES_V2 = FEATURE_NAMES + [
    "pm25_lag1",
    "pm10_lag1",
    "no2_lag1",
    "o3_lag1",
    "so2_lag1",
]
LAG1_TARGETS = ["pm25", "pm10", "no2", "o3", "so2"]


def traffic_proxy(
    hour: int, is_weekend: bool, flags: Dict[str, Any]
) -> Tuple[float, float, float]:
    """(speed_kmh, delay_ratio, congestion_idx) determinísticos por horário."""
    is_peak = (7 <= hour <= 9) or (17 <= hour <= 19)
    is_night = hour < 5 or hour >= 23
    if is_weekend:
        idx, spd, delay = 0.18, 52.0, 1.08
    elif is_peak:
        idx, spd, delay = 0.82, 22.0, 1.9
    elif is_night:
        idx, spd, delay = 0.08, 58.0, 1.02
    else:
        idx, spd, delay = 0.32, 44.0, 1.22
    if flags.get("bridge_proximity") or flags.get("traffic_heavy"):
        idx = min(1.0, idx * 1.3)
        delay *= 1.25
    return spd, delay, idx


def satellite_proxy(aq_lag24: Dict[str, float]) -> Tuple[float, float, float]:
    """Proxies de satélite a partir dos valores de 24h ATRÁS (nunca da hora
    atual — usar a hora atual seria vazar o alvo para dentro da feature)."""
    aod = round(0.08 + (aq_lag24.get("pm10", 20.0) or 0.0) / 400.0, 3)
    tropomi = round(aq_lag24.get("no2", 8.0) or 0.0, 2)
    uvai = round(0.4 + aod * 1.5, 3)
    return aod, tropomi, uvai


def row_to_features(
    meteo: Dict[str, Any],
    aq: Dict[str, float],
    iso_ts: str,
    lags: Dict[str, float],
    flags: Dict[str, Any],
    order: str = "v1",
    lags1: Dict[str, float] | None = None,
) -> List[float]:
    dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    h, dow = dt.hour, dt.weekday()
    is_weekend = dow >= 5

    temp = float(meteo["temperature_2m"])
    rh = float(meteo["relative_humidity_2m"])
    spd_ms = float(meteo["wind_speed_10m"]) / 3.6
    wdir = float(meteo["wind_direction_10m"]) % 360.0
    rad = math.radians(wdir)
    wind_u = -spd_ms * math.sin(rad)
    wind_v = -spd_ms * math.cos(rad)
    pblh = float(meteo["boundary_layer_height"])
    press = float(meteo["pressure_msl"])
    solar = max(0.0, float(meteo["shortwave_radiation"]))

    spd, delay, idx = traffic_proxy(h, is_weekend, flags)
    aod, tropomi, uvai = satellite_proxy({"pm10": lags["pm10"], "no2": lags["no2"]})
    if order == "v2" and lags1 is None:
        raise ValueError("order='v2' exige lags1")

    return [
        temp,
        rh,
        round(spd_ms, 2),
        round(wdir, 2),
        round(wind_u, 2),
        round(wind_v, 2),
        round(pblh, 2),
        round(press, 2),
        round(solar, 2),
        round(math.sin(2 * math.pi * h / 24), 4),
        round(math.cos(2 * math.pi * h / 24), 4),
        round(math.sin(2 * math.pi * dow / 7), 4),
        round(math.cos(2 * math.pi * dow / 7), 4),
        1.0 if is_weekend else 0.0,
        round(spd, 2),
        round(delay, 2),
        round(idx, 3),
        aod,
        tropomi,
        uvai,
        round(float(lags["pm25"]), 2),
        round(float(lags["pm10"]), 2),
        round(float(lags["no2"]), 2),
        round(float(lags["o3"]), 2),
        round(float(lags["pblh6"]), 2),
    ] + ([round(float(lags1[t]), 2) for t in LAG1_TARGETS] if order == "v2" else [])


def _series(hourly: Dict[str, Any]) -> Dict[str, List[Optional[float]]]:
    times: List[str] = hourly.get("time", [])
    out: Dict[str, List[Optional[float]]] = {"time": times}  # type: ignore[dict-item]
    for k, v in hourly.items():
        if k != "time":
            out[k] = list(v)
    return out


def _norm_ts(ts: str) -> str:
    """Normaliza timestamp ISO para 'YYYY-MM-DDTHH:MM' para junção exata."""
    return ts.replace("Z", "").replace(" ", "T")[:16]


def build_real_dataset(
    raw_path: str = "ml/data/openmeteo_raw.json",
    out_path: str = "ml/data/train_dataset_real.json",
    end_cutoff: str | None = None,
    order: str = "v1",
    insitu_path: str | None = None,
) -> Dict[str, Any]:
    """end_cutoff (ISO 'YYYY-MM-DDTHH'): ignora horas de treino após esse
    instante — usado para reservar o holdout fora do treino.
    order 'v2': 30 features (V1 + 5 lags de 1h).
    Modo MOS (`target_mode='mos_insitu'`): quando `insitu_hourly` (ou `insitu_path`)
    está presente, treina com Y=IEMA e X=CAMS+meteo (`cams_aq_hourly` + `cams_meteo_hourly`).
    Caso contrário (`target_mode='cams_fallback'`), mantém o comportamento atual (Y=CAMS, X=CAMS+meteo).
    """
    names = FEATURE_NAMES_V2 if order == "v2" else FEATURE_NAMES
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if insitu_path and os.path.exists(insitu_path):
        with open(insitu_path, "r", encoding="utf-8") as f_insitu:
            insitu_payload = json.load(f_insitu)
        insitu_stations = insitu_payload.get("stations", {})
        for st_id, st_info in insitu_stations.items():
            if st_id in raw.get("stations", {}):
                raw["stations"][st_id]["insitu_hourly"] = st_info.get("hourly") or {}
        raw["provenance"] = raw.get("provenance", {})
        raw["provenance"]["target_mode"] = "mos_insitu"

    all_features: List[List[float]] = []
    all_targets: Dict[str, List[float]] = {t: [] for t in TARGETS}
    skipped = 0
    # Treina só no passado/análise (ts <= fetched_at); o forecast (futuro) é
    # reservado para a previsão 120h — treinar no futuro seria data leakage.
    cutoff = (raw.get("fetched_at") or "")[:13]

    provenance = raw.get("provenance", {})
    has_insitu = bool(
        provenance.get("target_mode") == "mos_insitu"
        or any(entry.get("insitu_hourly") for entry in raw.get("stations", {}).values())
    )
    target_mode = "mos_insitu" if has_insitu else "cams_fallback"

    for station_id, entry in raw["stations"].items():
        flags = entry["meta"]
        insitu_map: Dict[str, Dict[str, Any]] = entry.get("insitu_hourly") or {}

        if target_mode == "mos_insitu":
            if not insitu_map:
                # No modo MOS, não mistura alvos CAMS puros em Y
                continue
            aq_x = _series(entry.get("cams_aq_hourly") or entry["aq_hourly"])
            met_x = _series(entry.get("cams_meteo_hourly") or entry["meteo_hourly"])
            aq_y = None
        else:
            aq_d1 = entry["aq_hourly"]
            met_d1 = entry["meteo_hourly"]
            # Se o D1 contém apenas uma janela curta (ex.: 168h de backfill) que
            # ficaria sem horas válidas antes do end_cutoff (holdout), usa a grade
            # CAMS completa preservada em cams_aq_hourly / cams_meteo_hourly.
            valid_d1_before_cutoff = [
                ts
                for ts in aq_d1.get("time", [])
                if (not cutoff or ts[:13] <= cutoff)
                and (not end_cutoff or ts[:13] <= end_cutoff)
            ]
            if len(valid_d1_before_cutoff) <= 30 and entry.get("cams_aq_hourly"):
                aq_x = _series(entry["cams_aq_hourly"])
                met_x = _series(entry["cams_meteo_hourly"])
            else:
                aq_x = _series(aq_d1)
                met_x = _series(met_d1)
            aq_y = aq_x

        n = min(len(aq_x["time"]), len(met_x["time"]))
        # buffers p/ forward-fill de lags
        for i in range(n):
            if i < 30:  # precisa de 24h de lag + 6h de pblh
                continue
            ts = aq_x["time"][i]
            if cutoff and ts[:13] > cutoff:
                continue  # hora de forecast: fora do treino
            if end_cutoff and ts[:13] > end_cutoff:
                continue  # reservado ao holdout honesto

            if target_mode == "mos_insitu":
                norm_k = _norm_ts(ts)
                if norm_k not in insitu_map:
                    continue
                obs_y = insitu_map[norm_k]
                norm_k24 = _norm_ts(aq_x["time"][i - 24])
                norm_k1 = _norm_ts(aq_x["time"][i - 1])
                obs_lag24 = insitu_map.get(norm_k24) or {}
                obs_lag1 = insitu_map.get(norm_k1) or {}

            try:
                if target_mode == "mos_insitu":
                    aq_now = {t: obs_y.get(t) for t in TARGETS}
                    if not any(v is not None and math.isfinite(v) for v in aq_now.values()):
                        raise ValueError("alvo None (todos nulos)")
                else:
                    assert aq_y is not None
                    aq_now = {t: aq_y[AQ_KEYS[t]][i] for t in TARGETS}
                    if any(v is None or not math.isfinite(v) for v in aq_now.values()):
                        raise ValueError("alvo None")

                m_now = {
                    k: (
                        obs_y.get(k)
                        if (target_mode == "mos_insitu" and obs_y.get(k) is not None)
                        else met_x[k][i]
                    )
                    for k in (
                        "temperature_2m",
                        "relative_humidity_2m",
                        "wind_speed_10m",
                        "wind_direction_10m",
                        "pressure_msl",
                        "shortwave_radiation",
                        "boundary_layer_height",
                    )
                }
                if any(v is None or not math.isfinite(v) for v in m_now.values()):
                    raise ValueError("meteo None")
                if target_mode == "mos_insitu":
                    lags = {
                        "pm25": obs_lag24.get("pm25") if obs_lag24.get("pm25") is not None else aq_x["pm2_5"][i - 24],
                        "pm10": obs_lag24.get("pm10") if obs_lag24.get("pm10") is not None else aq_x["pm10"][i - 24],
                        "no2": obs_lag24.get("no2") if obs_lag24.get("no2") is not None else aq_x["nitrogen_dioxide"][i - 24],
                        "o3": obs_lag24.get("o3") if obs_lag24.get("o3") is not None else aq_x["ozone"][i - 24],
                        "pblh6": sum(met_x["boundary_layer_height"][i - 6 : i]) / 6.0,
                    }
                else:
                    lags = {
                        "pm25": aq_x["pm2_5"][i - 24],
                        "pm10": aq_x["pm10"][i - 24],
                        "no2": aq_x["nitrogen_dioxide"][i - 24],
                        "o3": aq_x["ozone"][i - 24],
                        "pblh6": sum(met_x["boundary_layer_height"][i - 6 : i]) / 6.0,
                    }
                if any(v is None or not math.isfinite(v) for v in lags.values()):
                    raise ValueError("lag None")
                lags1 = None
                if order == "v2":
                    if target_mode == "mos_insitu":
                        lags1 = {
                            t: (
                                obs_lag1.get(t)
                                if obs_lag1.get(t) is not None
                                else aq_x[AQ_KEYS[t]][i - 1]
                            )
                            for t in LAG1_TARGETS
                        }
                    else:
                        lags1 = {t: aq_x[AQ_KEYS[t]][i - 1] for t in LAG1_TARGETS}
                    if any(v is None or not math.isfinite(v) for v in lags1.values()):
                        raise ValueError("lag1 None")
                feats = row_to_features(
                    m_now, aq_now, ts, lags, flags, order=order, lags1=lags1
                )
                all_features.append(feats)
                for t in TARGETS:
                    val = aq_now[t]
                    all_targets[t].append(
                        round(float(val), 2)
                        if (val is not None and math.isfinite(val))
                        else None
                    )
            except (ValueError, TypeError, KeyError):
                skipped += 1
                continue

    source_desc = (
        "MOS real: Y=IEMA in-situ (D1 observed_pollutants), X=open-meteo (CAMS + meteorologia)"
        if target_mode == "mos_insitu"
        else "open-meteo real (CAMS + meteorologia), proxies determinísticos p/ tráfego/satélite"
    )
    payload = {
        "source": source_desc,
        "target_mode": target_mode,
        "fetched_at": raw.get("fetched_at"),
        "feature_order": order,
        "feature_names": names,
        "targets": TARGETS,
        "count": len(all_features),
        "skipped": skipped,
        "features": all_features,
        "target_values": all_targets,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(
        f"[real:{order}:{target_mode}] {len(all_features)} amostras reais ({skipped} puladas) → {out_path}"
    )
    return {
        "dataset_path": out_path,
        "sample_count": len(all_features),
        "target_mode": target_mode,
        "feature_names": names,
        "targets": TARGETS,
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Construtor de Dataset Real (Open-Meteo / MOS In-Situ)")
    parser.add_argument("--raw", default="ml/data/openmeteo_raw.json", help="Arquivo raw do Open-Meteo")
    parser.add_argument("--out", default="ml/data/train_dataset_real.json", help="Arquivo JSON de saída")
    parser.add_argument("--order", default="v1", choices=["v1", "v2"], help="Ordem canônica das features (v1 ou v2)")
    parser.add_argument("--end-cutoff", default=None, help="Cutoff temporal para holdout (YYYY-MM-DDTHH)")
    parser.add_argument(
        "--insitu",
        default=None,
        help="Arquivo JSON com medições horárias in-situ do IEMA (ativa modo MOS de forma explícita)",
    )
    args = parser.parse_args()

    build_real_dataset(
        raw_path=args.raw,
        out_path=args.out,
        end_cutoff=args.end_cutoff,
        order=args.order,
        insitu_path=args.insitu,
    )
