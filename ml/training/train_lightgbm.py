"""
ml/training/train_lightgbm.py — Treinamento dos 5 Regressores LightGBM com Restrições Monotônicas
Treina modelos para pm25, pm10, o3, no2, so2 respeitando física de dispersão e gates de validação.
"""

import os
import sys
import json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import numpy as np
import lightgbm as lgb
from typing import Dict, Any, Tuple
from ml.training.calibrate import (
    apply_isotonic,
    compute_bias,
    fit_isotonic,
    target_weights,
)

MONOTONE_CONSTRAINTS = [
    1,  # 0: temperature (+1)
    0,  # 1: relative_humidity
    -1,  # 2: wind_speed (-1)
    0,  # 3: wind_direction
    0,  # 4: wind_u
    0,  # 5: wind_v
    -1,  # 6: boundary_layer_height (-1)
    0,  # 7: surface_pressure
    1,  # 8: solar_radiation (+1)
    0,  # 9: hour_sin
    0,  # 10: hour_cos
    0,  # 11: dow_sin
    0,  # 12: dow_cos
    0,  # 13: is_weekend
    -1,  # 14: traffic_speed_avg (-1)
    1,  # 15: traffic_delay_ratio (+1)
    1,  # 16: traffic_congestion_index (+1)
    1,  # 17: satellite_aod (+1)
    1,  # 18: satellite_tropomi_no2 (+1)
    1,  # 19: satellite_uvai (+1)
    1,  # 20: pm25_lag24 (+1)
    1,  # 21: pm10_lag24 (+1)
    1,  # 22: no2_lag24 (+1)
    1,  # 23: o3_lag24 (+1)
    -1,  # 24: pblh_rolling6 (-1)
]

TARGETS = ["pm25", "pm10", "o3", "no2", "so2"]


def train_models(
    dataset_path: str = "ml/data/train_dataset.json",
    quantile_alpha: Dict[str, float] | None = None,
    use_isotonic: bool = True,
    compact: bool = False,
) -> Dict[str, Any]:
    with open(dataset_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    X = np.array(data["features"], dtype=np.float32)
    target_data = data["target_values"]

    n_samples = len(X)
    split_idx = int(n_samples * 0.8)
    X_train, X_val = X[:split_idx], X[split_idx:]

    models: Dict[str, lgb.Booster] = {}
    metrics: Dict[str, Dict[str, float]] = {}
    biases: Dict[str, float] = {}
    isotonics: Dict[str, Dict[str, list]] = {}

    print(
        f"[AetherML ML] Treinando 5 regressores LightGBM em {split_idx} amostras (validação: {n_samples - split_idx})..."
    )

    for target in TARGETS:
        y = np.array(target_data[target], dtype=np.float32)
        y_train, y_val = y[:split_idx], y[split_idx:]

        # Ajuste de restrições monotônicas específicas por alvo:
        # Para O3: radiação e temperatura têm forte efeito positivo; vento dispersa (-1)
        # Para PM25/PM10: AOD e tráfego têm forte efeito positivo
        target_constraints = list(MONOTONE_CONSTRAINTS)
        if target not in ["o3"]:
            target_constraints[8] = 0  # radiação solar direta só é monotônica em O3
        if len(data["feature_names"]) == 30:
            # FEATURE_ORDER_V2: +1 (persistência) nos 5 lags de 1h anexados
            target_constraints += [1, 1, 1, 1, 1]

        params = {
            "objective": "regression",
            "metric": "l1",
            "boosting_type": "gbdt",
            "num_leaves": 31 if compact else 63,
            "max_depth": 6 if compact else 8,
            "learning_rate": 0.05 if compact else 0.03,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.9,
            "bagging_freq": 5,
            "monotone_constraints": target_constraints,
            "min_data_in_leaf": 10,
            "verbose": -1,
            "seed": 42,
        }
        alpha = (quantile_alpha or {}).get(target)
        if alpha:
            # Regressão quantílica: prevê o percentil alpha (ex. 0.65) em vez da
            # média — recupera excursões (picos) que a média suaviza. Alvo das
            # faixas de fronteira (Moderada).
            params["objective"] = "quantile"
            params["metric"] = "quantile"
            params["alpha"] = alpha
            # LightGBM não aceita monotone_constraints com quantil: trade-off
            # consciente (capacidade de pico > garantia monotônica nesses alvos)
            params.pop("monotone_constraints", None)

        weights = target_weights(target, list(y_train))
        train_data = lgb.Dataset(X_train, label=y_train, weight=weights)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        booster = lgb.train(
            params,
            train_data,
            num_boost_round=300 if compact else 500,
            valid_sets=[val_data],
            callbacks=[
                lgb.early_stopping(stopping_rounds=30 if compact else 50, verbose=False)
            ],
        )

        y_pred_raw = booster.predict(X_val, num_iteration=booster.best_iteration)
        bias = compute_bias({target: list(y_val)}, {target: list(y_pred_raw)})
        if use_isotonic and not alpha:
            iso_map: Dict[str, list] = fit_isotonic(list(y_val), list(y_pred_raw))
            y_pred = np.array(apply_isotonic(list(y_pred_raw), iso_map))
        else:
            # Quantil já é a estimativa final (isotonic a recentralizaria na média)
            iso_map = {"x": [], "y": []}
            y_pred = y_pred_raw
        mae = float(np.mean(np.abs(y_val - y_pred)))
        rmse = float(np.sqrt(np.mean((y_val - y_pred) ** 2)))
        r2 = float(
            1.0
            - (np.sum((y_val - y_pred) ** 2) / np.sum((y_val - np.mean(y_val)) ** 2))
        )

        models[target] = booster
        biases[target] = bias[target]
        isotonics[target] = iso_map
        metrics[target] = {
            "mae": round(mae, 2),
            "rmse": round(rmse, 2),
            "r2": round(r2, 4),
        }
        print(
            f"  - [{target.upper()}] R2: {metrics[target]['r2']} | MAE: {metrics[target]['mae']} | RMSE: {metrics[target]['rmse']}"
        )

    return {
        "models": models,
        "metrics": metrics,
        "bias": biases,
        "isotonic": isotonics,
        "feature_names": data["feature_names"],
    }


if __name__ == "__main__":
    train_models()
