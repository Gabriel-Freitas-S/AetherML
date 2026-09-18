"""
ml/training/pipeline.py — Pipeline Unificado de Machine Learning do AetherML
Executa ponta a ponta: geração de dataset -> treino LightGBM -> exportação ONNX -> Saabas XAI -> registro.
"""

import sys
import os

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from ml.training.build_dataset import build_synthetic_dataset
from ml.training.train_lightgbm import train_models
from ml.training.export_onnx import export_to_onnx
from ml.training.export_saabas import export_saabas_topologies
from ml.training.registry import update_registry


def run_pipeline(version: str = "v2026.38.1", days: int = 40):
    print("=" * 70)
    print(f"[AetherML] INICIANDO PIPELINE DE MACHINE LEARNING ({version})")
    print("=" * 70)

    # 1. Dataset
    dataset_info = build_synthetic_dataset(days=days)

    # 2. Treino
    train_res = train_models(dataset_info["dataset_path"])
    models = train_res["models"]
    metrics = train_res["metrics"]
    feature_names = train_res["feature_names"]

    # 3. Export ONNX
    onnx_res = export_to_onnx(models, output_dir=f"models/{version}", public_dir="public/models")

    # 4. Export Saabas
    export_saabas_topologies(models, feature_names, output_dir=f"models/{version}", public_dir="public/models")

    # 5. Registry
    update_registry(
        version=version,
        feature_names=feature_names,
        targets=dataset_info["targets"],
        onnx_results=onnx_res,
        metrics=metrics
    )

    print("=" * 70)
    print("[AetherML] PIPELINE CONCLUIDO COM SUCESSO! Artefatos prontos em public/models/")
    print("=" * 70)


if __name__ == "__main__":
    version = sys.argv[1] if len(sys.argv) > 1 else "v2026.38.1"
    run_pipeline(version=version)
