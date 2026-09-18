"""
ml/training/export_onnx.py — Exportação de Modelos LightGBM para ONNX (TreeEnsembleRegressor)
Converte os modelos treinados para o formato ONNX, valida limite de 1,5 MB e gera SHA-256.
"""

import os
import sys
import hashlib

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import lightgbm as lgb
from typing import Dict, Any
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

MAX_MODEL_BYTES = 1.5 * 1024 * 1024  # 1.5 MB


def export_to_onnx(
    models: Dict[str, lgb.Booster],
    output_dir: str = "models/v2026.38.1",
    public_dir: str = "public/models",
) -> Dict[str, Dict[str, Any]]:
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(public_dir, exist_ok=True)

    results: Dict[str, Dict[str, Any]] = {}

    print(
        f"[AetherML ML] Exportando 5 modelos para ONNX (ai.onnx.ml:TreeEnsembleRegressor)..."
    )

    for target, booster in models.items():
        n_features = booster.num_feature()
        initial_type = [("input", FloatTensorType([None, n_features]))]
        onnx_model = convert_lightgbm(
            booster, initial_types=initial_type, target_opset=15
        )

        model_path = os.path.join(output_dir, f"{target}.onnx")
        with open(model_path, "wb") as f:
            f.write(onnx_model.SerializeToString())

        # Cópia para public/models/
        public_path = os.path.join(public_dir, f"{target}.onnx")
        with open(public_path, "wb") as f:
            f.write(onnx_model.SerializeToString())

        size_bytes = os.path.getsize(model_path)
        with open(model_path, "rb") as f:
            sha256 = hashlib.sha256(f.read()).hexdigest()

        assert size_bytes < MAX_MODEL_BYTES, (
            f"Modelo {target}.onnx excedeu 1.5MB ({size_bytes} bytes)"
        )

        results[target] = {
            "path": model_path,
            "public_path": public_path,
            "size_kb": round(size_bytes / 1024, 2),
            "sha256": sha256,
        }
        print(
            f"  - [{target.upper()}] Tamanho: {results[target]['size_kb']} KB (<1.5MB) | SHA-256: {sha256[:12]}..."
        )

    return results
