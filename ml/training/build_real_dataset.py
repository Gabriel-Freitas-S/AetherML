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


def build_real_dataset(
    raw_path: str = "ml/data/openmeteo_raw.json",
    out_path: str = "ml/data/train_dataset_real.json",
    end_cutoff: str | None = None,
    order: str = "v1",
) -> Dict[str, Any]:
    """end_cutoff (ISO 'YYYY-MM-DDTHH'): ignora horas de treino após esse
    instante — usado para reservar o holdout fora do treino.
    order 'v2': 30 features (V1 + 5 lags de 1h)."""
    names = FEATURE_NAMES_V2 if order == "v2" else FEATURE_NAMES
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    all_features: List[List[float]] = []
    all_targets: Dict[str, List[float]] = {t: [] for t in TARGETS}
    skipped = 0
    # Treina só no passado/análise (ts <= fetched_at); o forecast (futuro) é
    # reservado para a previsão 120h — treinar no futuro seria data leakage.
    cutoff = (raw.get("fetched_at") or "")[:13]

    for station_id, entry in raw["stations"].items():
        flags = entry["meta"]
        aq = _series(entry["aq_hourly"])
        met = _series(entry["meteo_hourly"])
        n = min(len(aq["time"]), len(met["time"]))
        # buffers p/ forward-fill de lags
        for i in range(n):
            if i < 30:  # precisa de 24h de lag + 6h de pblh
                continue
            ts = aq["time"][i]
            if cutoff and ts[:13] > cutoff:
                continue  # hora de forecast: fora do treino
            if end_cutoff and ts[:13] > end_cutoff:
                continue  # reservado ao holdout honesto
            try:
                aq_now = {t: aq[AQ_KEYS[t]][i] for t in TARGETS}
                if any(v is None for v in aq_now.values()):
                    raise ValueError("alvo None")
                m_now = {
                    k: met[k][i]
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
                if any(v is None for v in m_now.values()):
                    raise ValueError("meteo None")
                lags = {
                    "pm25": aq["pm2_5"][i - 24],
                    "pm10": aq["pm10"][i - 24],
                    "no2": aq["nitrogen_dioxide"][i - 24],
                    "o3": aq["ozone"][i - 24],
                    "pblh6": sum(met["boundary_layer_height"][i - 6 : i]) / 6.0,
                }
                if any(v is None for v in lags.values()):
                    raise ValueError("lag None")
                lags1 = None
                if order == "v2":
                    lags1 = {t: aq[AQ_KEYS[t]][i - 1] for t in LAG1_TARGETS}
                    if any(v is None for v in lags1.values()):
                        raise ValueError("lag1 None")
                feats = row_to_features(
                    m_now, aq_now, ts, lags, flags, order=order, lags1=lags1
                )
                all_features.append(feats)
                for t in TARGETS:
                    all_targets[t].append(round(float(aq_now[t]), 2))
            except (ValueError, TypeError, KeyError):
                skipped += 1
                continue

    payload = {
        "source": "open-meteo real (CAMS + meteorologia), proxies determinísticos p/ tráfego/satélite",
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
        f"[real:{order}] {len(all_features)} amostras reais ({skipped} puladas) → {out_path}"
    )
    return {
        "dataset_path": out_path,
        "sample_count": len(all_features),
        "feature_names": names,
        "targets": TARGETS,
    }


if __name__ == "__main__":
    build_real_dataset()
