"""
ml/training/registry.py — Registro e Manifesto dos Modelos Ativos
Atualiza models/registry.json e espelha em public/models/registry.json para consumo do Web Worker.
"""

import os
import json
from typing import Dict, Any


def update_registry(
    version: str,
    feature_names: list,
    targets: list,
    onnx_results: Dict[str, Dict[str, Any]],
    metrics: Dict[str, Dict[str, float]],
    registry_file: str = "models/registry.json",
    public_file: str = "public/models/registry.json"
):
    os.makedirs(os.path.dirname(registry_file), exist_ok=True)
    os.makedirs(os.path.dirname(public_file), exist_ok=True)

    models_meta = {}
    for target in targets:
        models_meta[target] = {
            "onnx_file": f"{target}.onnx",
            "sha256": onnx_results[target]["sha256"],
            "size_kb": onnx_results[target]["size_kb"],
            "topology_file": f"{target}.topology.json",
            "metrics": metrics[target]
        }

    payload = {
        "_comment": "Espelho de model_registry gerado pelo pipeline AetherML",
        "active_version": version,
        "iqar_table_version": "CONAMA-491/2018",
        "feature_names_v1": feature_names,
        "targets": targets,
        "models": models_meta
    }

    with open(registry_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    with open(public_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"[AetherML ML] Manifesto de modelos atualizado com sucesso em {registry_file} e {public_file}.")
