"""
ml/training/registry.py — Registro e Manifesto dos Modelos Ativos

BUG-04: Suporta promoção granular por poluente (Champion vs Challenger pareado).
Mantém o formato consumido pelo frontend (apps/web/src/workers/inference.worker.ts):
- active_version
- feature_names_v1
- targets
- models.<t>.onnx_file
- models.<t>.sha256
- models.<t>.size_kb
- models.<t>.topology_file
- models.<t>.metrics
E adiciona por poluente:
- models.<t>.version (versão de onde veio o artefato ativo do poluente)
- models.<t>.promoted_at (data/hora de promoção)
"""

import os
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional


DEFAULT_TARGETS = ["pm25", "pm10", "o3", "no2", "so2"]


def load_registry(registry_file: str = "models/registry.json") -> Dict[str, Any]:
    """Carrega o arquivo de manifesto dos modelos."""
    if os.path.exists(registry_file):
        with open(registry_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "_comment": "Espelho de model_registry gerado pelo pipeline AetherML",
        "active_version": "v2026.38.1",
        "iqar_table_version": "CONAMA-491/2018",
        "feature_names_v1": [],
        "targets": DEFAULT_TARGETS,
        "models": {},
    }


def update_registry_paired(
    challenger_version: str,
    promoted_targets: List[str],
    onnx_results: Dict[str, Dict[str, Any]],
    challenger_metrics: Dict[str, Dict[str, float]],
    promoted_at: Optional[str] = None,
    registry_file: str = "models/registry.json",
    public_file: str = "apps/web/public/models/registry.json",
) -> Dict[str, Any]:
    """
    Atualiza o registry por poluente: apenas os alvos em `promoted_targets` são
    atualizados com os artefatos e métricas do Challenger. Poluentes não promovidos
    permanecem intactos como Champion.
    """
    os.makedirs(os.path.dirname(registry_file), exist_ok=True)
    os.makedirs(os.path.dirname(public_file), exist_ok=True)

    current = load_registry(registry_file)
    active_version = current.get("active_version", challenger_version)
    targets = current.get("targets", DEFAULT_TARGETS)
    models_meta = current.get("models", {})
    ts_now = promoted_at or datetime.now(timezone.utc).isoformat()

    for target in targets:
        if target in promoted_targets:
            models_meta[target] = {
                "onnx_file": f"{target}.onnx",
                "sha256": onnx_results[target]["sha256"],
                "size_kb": onnx_results[target]["size_kb"],
                "topology_file": f"{target}.topology.json",
                "metrics": challenger_metrics[target],
                "version": challenger_version,
                "promoted_at": ts_now,
            }
        else:
            # Mantém Champion intacto, garantindo que version e promoted_at existam
            if target not in models_meta:
                models_meta[target] = {
                    "onnx_file": f"{target}.onnx",
                    "sha256": None,
                    "size_kb": None,
                    "topology_file": f"{target}.topology.json",
                    "metrics": challenger_metrics.get(target, {}),
                    "version": active_version,
                    "promoted_at": ts_now,
                }
            else:
                if "version" not in models_meta[target]:
                    models_meta[target]["version"] = active_version
                if "promoted_at" not in models_meta[target]:
                    models_meta[target]["promoted_at"] = ts_now

    # Se ao menos um alvo foi promovido, avança active_version
    new_active_version = challenger_version if promoted_targets else active_version

    payload = {
        "_comment": current.get(
            "_comment", "Espelho de model_registry gerado pelo pipeline AetherML"
        ),
        "active_version": new_active_version,
        "iqar_table_version": current.get("iqar_table_version", "CONAMA-491/2018"),
        "feature_names_v1": current.get("feature_names_v1", []),
        "targets": targets,
        "models": models_meta,
    }
    if "feature_order_version" in current:
        payload["feature_order_version"] = current["feature_order_version"]

    target_files = [registry_file, public_file]
    # Espelho em public/models/registry.json se a pasta existir
    alt_public = "public/models/registry.json"
    if (
        public_file.startswith("apps/web/public/models")
        and os.path.exists("public/models")
        and alt_public not in target_files
    ):
        target_files.append(alt_public)

    for target_path in target_files:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    print(
        f"[AetherML ML] Manifesto de modelos atualizado com sucesso (promovidos: {promoted_targets}) "
        f"em {registry_file} e {public_file}."
    )
    return payload


def update_registry(
    version: str,
    feature_names: list,
    targets: list,
    onnx_results: Dict[str, Dict[str, Any]],
    metrics: Dict[str, Dict[str, float]],
    registry_file: str = "models/registry.json",
    public_file: str = "apps/web/public/models/registry.json",
):
    """Atualização padrão retrocompatível (promove todos os alvos)."""
    os.makedirs(os.path.dirname(registry_file), exist_ok=True)
    os.makedirs(os.path.dirname(public_file), exist_ok=True)

    now_iso = datetime.now(timezone.utc).isoformat()
    models_meta = {}
    for target in targets:
        models_meta[target] = {
            "onnx_file": f"{target}.onnx",
            "sha256": onnx_results[target]["sha256"],
            "size_kb": onnx_results[target]["size_kb"],
            "topology_file": f"{target}.topology.json",
            "metrics": metrics[target],
            "version": version,
            "promoted_at": now_iso,
        }

    payload = {
        "_comment": "Espelho de model_registry gerado pelo pipeline AetherML",
        "active_version": version,
        "iqar_table_version": "CONAMA-491/2018",
        "feature_names_v1": feature_names,
        "targets": targets,
        "models": models_meta,
    }

    target_files = [registry_file, public_file]
    alt_public = "public/models/registry.json"
    if (
        public_file.startswith("apps/web/public/models")
        and os.path.exists("public/models")
        and alt_public not in target_files
    ):
        target_files.append(alt_public)

    for target_path in target_files:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    print(
        f"[AetherML ML] Manifesto de modelos atualizado com sucesso em {registry_file} e {public_file}."
    )
