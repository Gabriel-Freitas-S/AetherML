"""
ml/training/evaluate_champion.py — Avaliação pareada Champion vs Challenger (BUG-04).

Implementa:
- Reserva das últimas 168h (7 dias) como holdout comum
- Avaliação pareada na MESMA janela temporal por poluente (RMSE + MAE)
- Decisão de promoção por poluente com epsilon configurável
- Ordem transacional: arquivos em apps/web/public/models só são tocados
  para os alvos promovidos
"""

import os
import sys
import json
import shutil
from datetime import datetime, timezone
from typing import Dict, Any, List, Tuple, Optional
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import lightgbm as lgb
from ml.training.build_real_dataset import (
    AQ_KEYS,
    TARGETS,
    LAG1_TARGETS,
    row_to_features,
    _series,
)
from ml.training.registry import update_registry_paired

HOLDOUT_DEFAULT_HOURS = 168
BUFFER_LAG_HOURS = 30  # 24h lag + 6h pblh


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Calcula MAE, RMSE e R2 pareados."""
    yt = np.array(y_true, dtype=np.float64)
    yp = np.array(y_pred, dtype=np.float64)
    mae = float(np.mean(np.abs(yt - yp)))
    rmse = float(np.sqrt(np.mean((yt - yp) ** 2)))
    denom = float(np.sum((yt - np.mean(yt)) ** 2))
    r2 = float(1.0 - np.sum((yt - yp) ** 2) / denom) if denom > 0 else 0.0
    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "r2": round(r2, 4),
    }


def _meteo_row(met: Dict[str, Any], gi: int) -> Dict[str, Any]:
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


def extract_holdout_from_raw(
    raw: Dict[str, Any],
    holdout_hours: int = HOLDOUT_DEFAULT_HOURS,
    order: str = "v1",
) -> Tuple[np.ndarray, Dict[str, np.ndarray], str, str]:
    """
    Extrai as últimas `holdout_hours` (default 168h = 7 dias) de dados do raw
    como holdout comum de validação.
    Lança ValueError caso os dados sejam insuficientes (janela não existe).
    """
    stations = raw.get("stations", {})
    if not stations:
        raise ValueError("Conjunto de estações vazio: impossível extrair holdout.")

    cutoff = (raw.get("fetched_at") or "")[:13]
    required_min = holdout_hours + BUFFER_LAG_HOURS

    # Verifica se todas as estações têm dados suficientes
    for st_id, entry in stations.items():
        aq_times = entry.get("aq_hourly", {}).get("time", [])
        if len(aq_times) < required_min:
            raise ValueError(
                f"Janela de holdout de {holdout_hours}h não existe nos dados fornecidos: "
                f"estação '{st_id}' possui apenas {len(aq_times)}h de dados (mínimo necessário: {required_min}h)."
            )

    all_features: List[List[float]] = []
    all_targets: Dict[str, List[float]] = {t: [] for t in TARGETS}
    holdout_start_ts = ""
    holdout_end_ts = ""

    for st_id, entry in stations.items():
        flags = entry.get("meta", {})
        aq = entry.get("aq_hourly", {})
        met = entry.get("meteo_hourly", {})
        times = aq.get("time", [])

        valid_indices = [
            i for i, ts in enumerate(times) if not cutoff or ts[:13] <= cutoff
        ]
        if not valid_indices:
            raise ValueError(f"Estação {st_id} não possui horários anteriores ao cutoff {cutoff}")

        end_idx = max(valid_indices)
        if end_idx - BUFFER_LAG_HOURS < holdout_hours:
            raise ValueError(
                f"Janela de holdout de {holdout_hours}h não existe para estação {st_id}: "
                f"apenas {end_idx - BUFFER_LAG_HOURS}h válidas antes do cutoff."
            )

        h_idx = list(range(end_idx - holdout_hours + 1, end_idx + 1))
        if not holdout_start_ts or times[h_idx[0]] < holdout_start_ts:
            holdout_start_ts = times[h_idx[0]]
        if not holdout_end_ts or times[h_idx[-1]] > holdout_end_ts:
            holdout_end_ts = times[h_idx[-1]]

        for gi in h_idx:
            ts = times[gi]
            aq_now = {t: float(aq[AQ_KEYS[t]][gi]) for t in TARGETS}
            lags = {
                "pm25": float(aq["pm2_5"][gi - 24]),
                "pm10": float(aq["pm10"][gi - 24]),
                "no2": float(aq["nitrogen_dioxide"][gi - 24]),
                "o3": float(aq["ozone"][gi - 24]),
                "pblh6": float(sum(met["boundary_layer_height"][gi - 6 : gi]) / 6.0),
            }
            lags1 = None
            if order == "v2":
                lags1 = {t: float(aq[AQ_KEYS[t]][gi - 1]) for t in LAG1_TARGETS}

            feats = row_to_features(
                _meteo_row(met, gi),
                aq_now,
                ts,
                lags,
                flags,
                order=order,
                lags1=lags1,
            )
            all_features.append(feats)
            for t in TARGETS:
                all_targets[t].append(aq_now[t])

    X_holdout = np.array(all_features, dtype=np.float32)
    y_holdout = {t: np.array(all_targets[t], dtype=np.float32) for t in TARGETS}
    return X_holdout, y_holdout, holdout_start_ts, holdout_end_ts


def load_champion_boosters(
    registry: Dict[str, Any],
    models_dir: str = "models",
) -> Dict[str, lgb.Booster]:
    """Carrega os boosters LightGBM (.txt) da versão Champion ativa para cada alvo."""
    active_version = registry.get("active_version", "")
    models_meta = registry.get("models", {})
    boosters: Dict[str, lgb.Booster] = {}

    for t in TARGETS:
        t_meta = models_meta.get(t, {})
        version = t_meta.get("version") or active_version
        txt_path = os.path.join(models_dir, version, f"{t}.txt")
        if not os.path.exists(txt_path):
            # Fallback para active_version
            txt_path = os.path.join(models_dir, active_version, f"{t}.txt")
        if not os.path.exists(txt_path):
            raise FileNotFoundError(
                f"Booster Champion para alvo '{t}' não encontrado em {txt_path} "
                f"(versão ativa: {active_version})"
            )
        boosters[t] = lgb.Booster(model_file=txt_path)

    return boosters


def compare_champion_challenger(
    champion_models: Dict[str, Any],
    challenger_models: Dict[str, Any],
    X_holdout: np.ndarray,
    y_holdout: Dict[str, np.ndarray],
    epsilon: float = 0.0,
    targets: Optional[List[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Avalia Champion e Challenger na MESMA janela de holdout.
    Decide promoção por poluente:
      promote(p) = (rmse_challenger <= rmse_champion * (1.0 - epsilon))
    """
    eval_targets = targets or TARGETS
    decisions: Dict[str, Dict[str, Any]] = {}

    for t in eval_targets:
        yt = y_holdout[t]

        # Predições Champion (adapta número de features caso v1=25 vs v2=30)
        champ_m = champion_models[t]
        n_feat_c = getattr(champ_m, "num_feature", lambda: X_holdout.shape[1])()
        X_c = X_holdout[:, :n_feat_c] if X_holdout.shape[1] >= n_feat_c else X_holdout
        y_champ = champ_m.predict(X_c)

        # Predições Challenger
        chall_m = challenger_models[t]
        n_feat_ch = getattr(chall_m, "num_feature", lambda: X_holdout.shape[1])()
        X_ch = X_holdout[:, :n_feat_ch] if X_holdout.shape[1] >= n_feat_ch else X_holdout
        y_chall = chall_m.predict(X_ch)

        m_champ = compute_metrics(yt, y_champ)
        m_chall = compute_metrics(yt, y_chall)

        # Critério de não-degradação com epsilon configurável
        # Se epsilon = 0.0, rmse_challenger <= rmse_champion
        threshold = m_champ["rmse"] * (1.0 - epsilon)
        promote = bool(m_chall["rmse"] <= threshold)

        decisions[t] = {
            "promote": promote,
            "champion": m_champ,
            "challenger": m_chall,
            "rmse_diff": round(m_chall["rmse"] - m_champ["rmse"], 4),
            "mae_diff": round(m_chall["mae"] - m_champ["mae"], 4),
            "threshold": round(threshold, 4),
        }

    return decisions


def apply_promotion(
    decisions: Dict[str, Dict[str, Any]],
    challenger_version: str,
    challenger_dir: str,
    onnx_meta: Dict[str, Dict[str, Any]],
    public_models_dir: str = os.path.join("apps", "web", "public", "models"),
    registry_file: str = os.path.join("models", "registry.json"),
    public_registry_file: Optional[str] = None,
) -> List[str]:
    """
    Aplica ordem transacional de promoção:
    - Artefatos do Challenger já vivem em challenger_dir (`models/<versao>/`)
    - `apps/web/public/models/<t>.onnx` + `<t>.topology.json` SÓ são sobrescritos
      se o poluente foi promovido (decisions[t]['promote'] == True).
    - Poluente que piora permanece intacto como Champion.
    - Atualiza registry.json registrando version e promoted_at por alvo.
    """
    os.makedirs(public_models_dir, exist_ok=True)
    promoted_targets: List[str] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for t, dec in decisions.items():
        if dec.get("promote"):
            promoted_targets.append(t)
            # Copia ONNX e Topology para public_models_dir
            src_onnx = os.path.join(challenger_dir, f"{t}.onnx")
            dst_onnx = os.path.join(public_models_dir, f"{t}.onnx")
            if os.path.exists(src_onnx):
                shutil.copy2(src_onnx, dst_onnx)

            src_topo = os.path.join(challenger_dir, f"{t}.topology.json")
            dst_topo = os.path.join(public_models_dir, f"{t}.topology.json")
            if os.path.exists(src_topo):
                shutil.copy2(src_topo, dst_topo)

    # Se ao menos um alvo foi promovido, copia também calibration.json do challenger
    if promoted_targets:
        src_cal = os.path.join(challenger_dir, "calibration.json")
        dst_cal = os.path.join(public_models_dir, "calibration.json")
        if os.path.exists(src_cal):
            shutil.copy2(src_cal, dst_cal)

    # Atualiza registries
    challenger_metrics = {t: dec["challenger"] for t, dec in decisions.items()}
    pub_reg = public_registry_file or os.path.join(public_models_dir, "registry.json")

    update_registry_paired(
        challenger_version=challenger_version,
        promoted_targets=promoted_targets,
        onnx_results=onnx_meta,
        challenger_metrics=challenger_metrics,
        promoted_at=now_iso,
        registry_file=registry_file,
        public_file=pub_reg,
    )

    return promoted_targets
