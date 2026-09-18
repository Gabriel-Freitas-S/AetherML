"""
ml/training/retrain_real.py — Retreino em dados REAIS Open-Meteo.

Uso: `python ml/training/retrain_real.py [versao]`
Gera: models/<versao>/*.onnx + *.topology.json + *.txt, espelha em
apps/web/public/models/, atualiza models/registry.json (active_version).
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.train_lightgbm import train_models
from ml.training.calibrate import save_calibration
from ml.training.export_onnx import export_to_onnx
import json
from ml.training.export_saabas import export_saabas_topologies
from ml.training.registry import update_registry

VERSION = sys.argv[1] if len(sys.argv) > 1 else "v2026.38.2"
DATASET = sys.argv[2] if len(sys.argv) > 2 else "ml/data/train_dataset_real.json"
COMPACT = len(sys.argv) > 3 and sys.argv[3] == "compact"
PUBLIC_MODELS = os.path.join("apps", "web", "public", "models")


def main() -> None:
    print("=" * 70)
    print(f"[AetherML] RETREINO EM DADOS REAIS ({VERSION}) <- {DATASET}")
    print("=" * 70)
    res = train_models(DATASET, compact=COMPACT)
    models, metrics, feature_names = res["models"], res["metrics"], res["feature_names"]

    out_dir = os.path.join("models", VERSION)
    os.makedirs(out_dir, exist_ok=True)
    for target, booster in models.items():
        booster.save_model(os.path.join(out_dir, f"{target}.txt"))
    full = {"bias": res["bias"], "isotonic": res.get("isotonic", {})}
    for _dir in (out_dir, PUBLIC_MODELS):
        with open(os.path.join(_dir, "calibration.json"), "w", encoding="utf-8") as f:
            json.dump(full, f)

    onnx_res = export_to_onnx(models, output_dir=out_dir, public_dir=PUBLIC_MODELS)
    export_saabas_topologies(
        models, list(feature_names), output_dir=out_dir, public_dir=PUBLIC_MODELS
    )
    update_registry(
        version=VERSION,
        feature_names=list(feature_names),
        targets=["pm25", "pm10", "o3", "no2", "so2"],
        onnx_results=onnx_res,
        metrics=metrics,
        registry_file=os.path.join("models", "registry.json"),
        public_file=os.path.join(PUBLIC_MODELS, "registry.json"),
    )
    print(f"[AetherML] RETREINO {VERSION} CONCLUIDO")


if __name__ == "__main__":
    main()
