"""
ml/training/export_saabas.py — Exportação de Topologia de Árvores para Explicabilidade Saabas (XAI)
Serializa as árvores LightGBM em formato JSON otimizado para decomposição aditiva O(K·D) no Web Worker.
"""

import os
import sys
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import lightgbm as lgb
from typing import Dict, Any, List


def parse_tree_node(node: Dict[str, Any], feature_names: List[str]) -> Dict[str, Any]:
    """Converte recursivamente um nó da árvore LightGBM para a estrutura compacta Saabas."""
    if "leaf_value" in node:
        return {
            "leaf": True,
            "value": round(float(node["leaf_value"]), 4)
        }

    feat_idx = int(node["split_feature"])
    feat_name = feature_names[feat_idx] if feat_idx < len(feature_names) else f"f_{feat_idx}"

    return {
        "leaf": False,
        "feature": feat_name,
        "feature_index": feat_idx,
        "threshold": round(float(node["threshold"]), 4),
        "value": round(float(node.get("internal_value", 0.0)), 4),
        "left": parse_tree_node(node["left_child"], feature_names),
        "right": parse_tree_node(node["right_child"], feature_names)
    }


def export_saabas_topologies(
    models: Dict[str, lgb.Booster],
    feature_names: List[str],
    output_dir: str = "models/v2026.38.1",
    public_dir: str = "public/models"
) -> Dict[str, str]:
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(public_dir, exist_ok=True)

    paths: Dict[str, str] = {}
    print(f"[AetherML ML] Exportando topologias Saabas para XAI no navegador...")

    for target, booster in models.items():
        dump = booster.dump_model()
        tree_infos = dump.get("tree_info", [])

        # Valor base basal Phi_0 (média da raiz)
        base_value = float(tree_infos[0]["tree_structure"].get("internal_value", 0.0)) if tree_infos else 0.0

        trees = []
        for t in tree_infos:
            trees.append({
                "tree_index": t["tree_index"],
                "root": parse_tree_node(t["tree_structure"], feature_names)
            })

        payload = {
            "target": target,
            "base_value": round(base_value, 4),
            "tree_count": len(trees),
            "feature_names": feature_names,
            "trees": trees
        }

        path = os.path.join(output_dir, f"{target}.topology.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

        public_path = os.path.join(public_dir, f"{target}.topology.json")
        with open(public_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

        paths[target] = path
        print(f"  - [{target.upper()}] Topologia Saabas com {len(trees)} arvores gravada em {path}")

    return paths
