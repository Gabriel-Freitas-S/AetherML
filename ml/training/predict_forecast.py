"""
ml/training/predict_forecast.py — Previsão 120h com os modelos retreinados.

Para cada estação: monta as 120h futuras com meteorologia REAL de forecast
(Open-Meteo), lags recursivos (semeados com as últimas 24h reais) e prevê os
5 poluentes com os boosters de models/<versao>/*.txt.

Saída: apps/web/public/data/stations-data.json no MESMO formato de antes
(station + points[{hour, day, timestamp, features[25], observed}]), de modo
que hero, cards, mapa e gráfico passam a exibir a saída do modelo real.

Uso: `python ml/training/predict_forecast.py [versao]`
"""

import json
import os
import sys
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import lightgbm as lgb
from ml.training.build_real_dataset import (
    AQ_KEYS,
    TARGETS,
    row_to_features,
)
from ml.training.calibrate import calibrate_value, load_full

HOURS = 120
CLAMPS = {"pm25": 1.0, "pm10": 2.0, "o3": 2.0, "no2": 3.0, "so2": 0.5}


def load_boosters(version: str) -> dict:
    boosters = {}
    for t in TARGETS:
        path = os.path.join("models", version, f"{t}.txt")
        boosters[t] = lgb.Booster(model_file=path)
    return boosters


def predict_all(
    raw_path: str = "ml/data/openmeteo_raw.json",
    version: str = "v2026.38.2",
    out_path: str = os.path.join("apps", "web", "public", "data", "stations-data.json"),
    order: str = "v1",
) -> dict:
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    boosters = load_boosters(version)
    cal = load_full(os.path.join("models", version, "calibration.json"))
    cutoff = (raw.get("fetched_at") or "")[:13]

    bundle = {}
    for station_id, entry in raw["stations"].items():
        flags = entry["meta"]
        aq, met = entry["aq_hourly"], entry["meteo_hourly"]
        times = aq["time"]
        # última hora de passado/análise
        now_idx = max(
            i for i, ts in enumerate(times) if not cutoff or ts[:13] <= cutoff
        )
        fut_idx = list(range(now_idx + 1, now_idx + 1 + HOURS))

        # sementes reais: últimas 24h de AQ + pblh
        hist_aq = {
            t: [aq[AQ_KEYS[t]][now_idx - 23 + k] for k in range(24)] for t in TARGETS
        }
        hist_pblh = list(met["boundary_layer_height"][now_idx - 5 : now_idx + 1])
        preds: dict = {t: [] for t in TARGETS}

        points = []
        for step, gi in enumerate(fut_idx):
            ts = times[gi] if gi < len(times) else None
            if ts is None:
                break
            m_now = {
                k: met[k][gi]
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
            # lag24 na hora futura (now+1+step) = valor em (now-23+step):
            # hist[step] nos primeiros 24 passos, depois a própria previsão.
            lags = {
                t: (hist_aq[t][step] if step < 24 else preds[t][step - 24])
                for t in ("pm25", "pm10", "no2", "o3")
            }
            lags["pblh6"] = (
                sum((hist_pblh + [m_now["boundary_layer_height"]])[-7:-1]) / 6.0
            )
            aq_est = {
                t: preds[t][-1] if preds[t] else hist_aq[t][-1]
                for t in ("pm25", "pm10", "o3", "no2", "so2")
            }
            lags1 = None
            if order == "v2":
                # lag1: última hora real no passo 0, depois a própria previsão
                lags1 = {
                    t: (hist_aq[t][-1] if step == 0 else preds[t][-1])
                    for t in ("pm25", "pm10", "no2", "o3", "so2")
                }
            feats = row_to_features(
                m_now, aq_est, ts, lags, flags, order=order, lags1=lags1
            )
            raw_pred = {t: float(boosters[t].predict([feats])[0]) for t in TARGETS}
            calibrated = {t: calibrate_value(t, v, cal) for t, v in raw_pred.items()}
            observed = {}
            for t in TARGETS:
                val = max(CLAMPS[t], round(calibrated[t], 2))
                preds[t].append(val)
                observed[t] = val
            points.append(
                {
                    "hour": step,
                    "day": step // 24 + 1,
                    "timestamp": ts + "Z" if not ts.endswith("Z") else ts,
                    "features": feats,
                    "observed": observed,
                }
            )

        st = dict(flags)
        st["latitude"] = st["lat"]
        st["longitude"] = st["lon"]
        bundle[station_id] = {"station": st, "points": points}
        print(f"  [{station_id}] {len(points)}h previstas")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(bundle, f)
    print(f"[predict] {out_path} ({version})")
    return bundle


if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 else "v2026.38.2"
    order = sys.argv[2] if len(sys.argv) > 2 else "v1"
    predict_all(version=ver, order=order)
