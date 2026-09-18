"""
ml/evaluation/eval_holdout.py — Backtest honesto do AetherML.

Protocolo:
- Treino: passado até (fetched_at - 7d) | Holdout: últimos 7d (168h) NUNCA vistos
- 1-step: prevê cada hora do holdout com lags REAIS (mede skill do modelo)
- rollout 120h: a partir da última hora de treino, recursivo com meteo real
  futura (mede degradação multi-step do pipeline operacional)
- IQAr espelha packages/core-iqar (Math.round half-up, primeira faixa c<=cFim)

Uso: `python ml/evaluation/eval_holdout.py [versao]`
Saída: apps/web/public/data/model-eval.json
"""

import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import lightgbm as lgb
import numpy as np
from ml.training.build_real_dataset import AQ_KEYS, TARGETS, row_to_features
from ml.training.calibrate import calibrate_value, load_full

HOLDOUT_HOURS = 168  # 7 dias
ROLLOUT_HOURS = 120
HORIZONS = [24, 48, 72, 120]
CLASSES = ["Boa", "Moderada", "Ruim", "Muito Ruim", "Péssima"]

BANDS = {
    "pm25": [
        (0, 40, 0, 15),
        (41, 80, 15, 25),
        (81, 120, 25, 50),
        (121, 200, 50, 75),
        (201, 300, 75, 150),
    ],
    "pm10": [
        (0, 40, 0, 50),
        (41, 80, 50, 100),
        (81, 120, 100, 150),
        (121, 200, 150, 250),
        (201, 300, 250, 500),
    ],
    "o3": [
        (0, 40, 0, 100),
        (41, 80, 100, 130),
        (81, 120, 130, 160),
        (121, 200, 160, 200),
        (201, 300, 200, 400),
    ],
    "no2": [
        (0, 40, 0, 200),
        (41, 80, 200, 240),
        (81, 120, 240, 320),
        (121, 200, 320, 1130),
        (201, 300, 1130, 2260),
    ],
    "so2": [
        (0, 40, 0, 20),
        (41, 80, 20, 40),
        (81, 120, 40, 365),
        (121, 200, 365, 800),
        (201, 300, 800, 1600),
    ],
}
CLASS_OF = {
    (0, 40): "Boa",
    (41, 80): "Moderada",
    (81, 120): "Ruim",
    (121, 200): "Muito Ruim",
}


def band_index(p: str, conc: float) -> int:
    c = max(0.0, float(conc))
    band = next((b for b in BANDS[p] if c <= b[3]), BANDS[p][-1])
    i_ini, i_fim, c_ini, c_fim = band
    return int(
        math.floor(i_ini + (i_fim - i_ini) / (c_fim - c_ini) * (c - c_ini) + 0.5)
    )


def band_class(p: str, conc: float) -> str:
    c = max(0.0, float(conc))
    band = next((b for b in BANDS[p] if c <= b[3]), BANDS[p][-1])
    for (lo, hi), cls in CLASS_OF.items():
        if lo <= band[0] and band[1] <= hi:
            return cls
    return "Péssima"


def global_iqar(obs: dict):
    best = (-1, "pm25", "Boa")
    for p in ("pm25", "pm10", "o3", "no2", "so2"):
        idx = band_index(p, obs[p])
        if idx > best[0]:
            best = (idx, p, band_class(p, obs[p]))
    return best  # (iqar, primary, classification)


def regression_metrics(y_true, y_pred) -> dict:
    yt = np.array(y_true, dtype=float)
    yp = np.array(y_pred, dtype=float)
    mae = float(np.mean(np.abs(yt - yp)))
    rmse = float(np.sqrt(np.mean((yt - yp) ** 2)))
    denom = float(np.sum((yt - np.mean(yt)) ** 2))
    r2 = float(1.0 - np.sum((yt - yp) ** 2) / denom) if denom > 0 else 0.0
    mask = yt != 0
    mape = (
        float(np.mean(np.abs((yt[mask] - yp[mask]) / yt[mask])) * 100.0)
        if mask.any()
        else 0.0
    )
    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "r2": round(r2, 4),
        "mape": round(mape, 1),
        "bias": round(float(np.mean(yp - yt)), 2),
        "n": len(yt),
    }


def _meteo_row(met, gi):
    return {
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


def run_backtest(
    version: str,
    raw_path="ml/data/openmeteo_raw.json",
    out_path=os.path.join("apps", "web", "public", "data", "model-eval.json"),
    order: str = "v1",
) -> dict:
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    boosters = {
        t: lgb.Booster(model_file=os.path.join("models", version, f"{t}.txt"))
        for t in TARGETS
    }
    cal = load_full(os.path.join("models", version, "calibration.json"))
    cutoff = (raw.get("fetched_at") or "")[:13]

    y_true = {t: [] for t in TARGETS}
    y_pred = {t: [] for t in TARGETS}
    iqar_true, iqar_pred, cls_true, cls_pred = [], [], [], []
    horizon_abs = {h: {"pm25": [], "o3": [], "iqar": []} for h in HORIZONS}
    series = {}
    holdout_start = holdout_end = ""

    for station_id, entry in raw["stations"].items():
        flags = entry["meta"]
        aq, met = entry["aq_hourly"], entry["meteo_hourly"]
        times = aq["time"]
        end_idx = max(
            i for i, ts in enumerate(times) if not cutoff or ts[:13] <= cutoff
        )
        # últimas 168h de passado = holdout (fora do treino honestamente)
        h_idx = list(range(end_idx - HOLDOUT_HOURS + 1, end_idx + 1))
        holdout_start = times[h_idx[0]]
        holdout_end = times[h_idx[-1]]

        st_yt = {t: [] for t in TARGETS}
        st_yp = {t: [] for t in TARGETS}
        st_iqar_t, st_iqar_p = [], []

        for gi in h_idx:
            ts = times[gi]
            aq_now = {t: aq[AQ_KEYS[t]][gi] for t in TARGETS}
            lags = {
                "pm25": aq["pm2_5"][gi - 24],
                "pm10": aq["pm10"][gi - 24],
                "no2": aq["nitrogen_dioxide"][gi - 24],
                "o3": aq["ozone"][gi - 24],
                "pblh6": sum(met["boundary_layer_height"][gi - 6 : gi]) / 6.0,
            }
            feats = row_to_features(
                _meteo_row(met, gi),
                aq_now,
                ts,
                lags,
                flags,
                order=order,
                lags1=(
                    {t: aq[AQ_KEYS[t]][gi - 1] for t in TARGETS}
                    if order == "v2"
                    else None
                ),
            )
            raw_pred = {t: float(boosters[t].predict([feats])[0]) for t in TARGETS}
            pred = {
                t: max(0.0, calibrate_value(t, v, cal)) for t, v in raw_pred.items()
            }
            for t in TARGETS:
                y_true[t].append(aq_now[t])
                y_pred[t].append(pred[t])
                st_yt[t].append(round(aq_now[t], 2))
                st_yp[t].append(round(pred[t], 2))
            it, _, ct = global_iqar(aq_now)
            ip, _, cp = global_iqar(pred)
            iqar_true.append(it)
            iqar_pred.append(ip)
            cls_true.append(ct)
            cls_pred.append(cp)
            st_iqar_t.append(it)
            st_iqar_p.append(ip)

        series[station_id] = {
            "name": flags["name"],
            "time": [times[i] for i in h_idx],
            "pm25_real": st_yt["pm25"],
            "pm25_pred": st_yp["pm25"],
            "o3_real": st_yt["o3"],
            "o3_pred": st_yp["o3"],
            "iqar_real": st_iqar_t,
            "iqar_pred": st_iqar_p,
        }

        # rollout 120h recursivo a partir da última hora de treino
        t0 = h_idx[0] - 1
        hist = {t: [aq[AQ_KEYS[t]][t0 - 23 + k] for k in range(24)] for t in TARGETS}
        hist_pblh = list(met["boundary_layer_height"][t0 - 5 : t0 + 1])
        rec = {t: [] for t in TARGETS}
        for step in range(ROLLOUT_HOURS):
            gi = t0 + 1 + step
            m_now = _meteo_row(met, gi)
            lags = {
                t: (hist[t][step] if step < 24 else rec[t][step - 24])
                for t in ("pm25", "pm10", "no2", "o3")
            }
            lags["pblh6"] = (
                sum((hist_pblh + [m_now["boundary_layer_height"]])[-7:-1]) / 6.0
            )
            feats = row_to_features(
                m_now,
                {t: rec[t][-1] if rec[t] else hist[t][-1] for t in TARGETS},
                times[gi],
                lags,
                flags,
                order=order,
                lags1=(
                    {t: (hist[t][-1] if step == 0 else rec[t][-1]) for t in TARGETS}
                    if order == "v2"
                    else None
                ),
            )
            for t in TARGETS:
                raw_v = float(boosters[t].predict([feats])[0])
                rec[t].append(max(0.0, calibrate_value(t, raw_v, cal)))
        for h in HORIZONS:
            i = h - 1
            truth = {t: aq[AQ_KEYS[t]][t0 + 1 + i] for t in TARGETS}
            it, _, _ = global_iqar(truth)
            ip, _, _ = global_iqar({t: rec[t][i] for t in TARGETS})
            horizon_abs[h]["pm25"].append(abs(truth["pm25"] - rec["pm25"][i]))
            horizon_abs[h]["o3"].append(abs(truth["o3"] - rec["o3"][i]))
            horizon_abs[h]["iqar"].append(abs(it - ip))

    metrics = {t: regression_metrics(y_true[t], y_pred[t]) for t in TARGETS}
    n = len(iqar_true)
    idx_diff = np.abs(np.array(iqar_true) - np.array(iqar_pred))
    class_acc = sum(1 for a, b in zip(cls_true, cls_pred) if a == b) / n
    by_class = {}
    for c in CLASSES:
        idx = [i for i, x in enumerate(cls_true) if x == c]
        by_class[c] = {
            "n": len(idx),
            "acc": round(sum(1 for i in idx if cls_pred[i] == c) / len(idx), 4)
            if idx
            else None,
        }
    horizons = {
        str(h): {k: round(float(np.mean(v)), 2) for k, v in d.items()}
        for h, d in horizon_abs.items()
    }

    # Baseline persistência (lag24): o modelo precisa bater o "ontem = hoje"
    persist_true, persist_pred = [], []
    for _sid, entry in raw["stations"].items():
        aq = entry["aq_hourly"]
        times = aq["time"]
        e_idx = max(i for i, ts in enumerate(times) if not cutoff or ts[:13] <= cutoff)
        for gi in range(e_idx - HOLDOUT_HOURS + 1, e_idx + 1):
            persist_true.append(aq["pm2_5"][gi])
            persist_pred.append(aq["pm2_5"][gi - 24])
    persistence = regression_metrics(persist_true, persist_pred)

    payload = {
        "model_version": version,
        "feature_order": order,
        "protocol": "holdout 7d fora do treino + rollout 120h recursivo; referência CAMS/Open-Meteo",
        "holdout": {
            "start": holdout_start + "Z",
            "end": holdout_end + "Z",
            "hours": HOLDOUT_HOURS,
            "stations": len(series),
            "points": n,
        },
        "metrics": metrics,
        "persistence_baseline_pm25": persistence,
        "iqar": {
            "class_accuracy": round(class_acc, 4),
            "mae_index": round(float(np.mean(idx_diff)), 2),
            "within_5pts": round(float(np.mean(idx_diff <= 5)), 4),
            "within_10pts": round(float(np.mean(idx_diff <= 10)), 4),
            "by_class": by_class,
        },
        "horizons_mae": horizons,
        "series": series,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(
        f"[eval] classe IQAr={class_acc:.1%} | MAE idx={payload['iqar']['mae_index']} → {out_path}"
    )
    return payload


if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 else "v2026.38.2"
    order = sys.argv[2] if len(sys.argv) > 2 else "v1"
    run_backtest(ver, order=order)
