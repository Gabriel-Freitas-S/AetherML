"""
ml/training/retrain_real.py — Retreino em dados REAIS (D1 / Open-Meteo) com Champion vs Challenger pareado.

BUG-03: Suporta `--source d1|local` (default `d1`, com fallback local explícito e aviso).
BUG-04: Reserva 168h (7 dias) de holdout comum, avalia Champion e Challenger na mesma
janela temporal e promove por poluente (não-degradação: rmse_challenger <= rmse_champion).
Ordem transacional: apps/web/public/models só é tocado na promoção.

Uso:
  python ml/training/retrain_real.py [versao] [dataset] [compact]
  python ml/training/retrain_real.py --version v2026.39.1 --source d1 --epsilon 0.0
"""

import os
import sys
import json
import argparse
from typing import Dict, Any, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.train_lightgbm import train_models, TARGETS
from ml.training.calibrate import save_calibration
from ml.training.export_onnx import export_to_onnx
from ml.training.export_saabas import export_saabas_topologies
from ml.training.registry import load_registry, update_registry_paired
from ml.training.fetch_from_d1 import resolve_training_data
from ml.training.build_real_dataset import build_real_dataset
from ml.training.evaluate_champion import (
    extract_holdout_from_raw,
    load_champion_boosters,
    compare_champion_challenger,
    apply_promotion,
    HOLDOUT_DEFAULT_HOURS,
)

PUBLIC_MODELS = os.path.join("apps", "web", "public", "models")


def parse_args():
    parser = argparse.ArgumentParser(description="Retreino de modelos AetherML com Champion vs Challenger pareado.")
    parser.add_argument("pos_version", nargs="?", default=None, help="Versão do modelo (ex: v2026.39.1)")
    parser.add_argument("pos_dataset", nargs="?", default=None, help="Caminho do dataset de treino")
    parser.add_argument("pos_compact", nargs="?", default=None, help="'compact' para modo rápido")

    parser.add_argument("--version", "-v", dest="flag_version", default=None, help="Versão do modelo")
    parser.add_argument("--source", "-s", dest="source", choices=["d1", "local"], default="d1", help="Fonte dos poluentes: d1 ou local")
    parser.add_argument("--epsilon", "-e", dest="epsilon", type=float, default=None, help="Margem de não-degradação")
    parser.add_argument("--compact", action="store_true", help="Modo compacto (árvores menores)")
    parser.add_argument("--dry-run", action="store_true", help="Executa avaliação pareada sem tocar em public/models")
    parser.add_argument("--raw", default="ml/data/openmeteo_raw.json", help="Arquivo de meteorologia bruta")
    parser.add_argument("--d1-file", default="ml/data/d1_observed.json", help="Arquivo cache D1")
    parser.add_argument("--order", default=None, choices=["v1", "v2"], help="Versão das features")

    args = parser.parse_args()

    version = args.flag_version or args.pos_version or "v2026.38.2"
    dataset = args.pos_dataset or "ml/data/train_dataset_real.json"
    compact = args.compact or (args.pos_compact == "compact")
    epsilon_env = float(os.environ.get("CHALLENGER_EPSILON", "0.0"))
    epsilon = args.epsilon if args.epsilon is not None else epsilon_env

    reg = load_registry("models/registry.json")
    default_order = reg.get("feature_order_version", "v1")
    order = args.order or default_order

    return {
        "version": version,
        "dataset": dataset,
        "compact": compact,
        "source": args.source,
        "epsilon": epsilon,
        "dry_run": args.dry_run,
        "raw": args.raw,
        "d1_file": args.d1_file,
        "order": order,
    }


def main() -> None:
    cfg = parse_args()
    version = cfg["version"]
    dataset_path = cfg["dataset"]
    compact = cfg["compact"]
    source_mode = cfg["source"]
    epsilon = cfg["epsilon"]
    dry_run = cfg["dry_run"]
    raw_path = cfg["raw"]
    d1_file = cfg["d1_file"]
    order = cfg["order"]

    print("=" * 70)
    print(f"[AetherML] RETREINO EM DADOS REAIS ({version}) | Fonte: {source_mode.upper()} | Epsilon: {epsilon}")
    print("=" * 70)

    # 1. Resolução da fonte de dados (D1 com fallback explícito para local)
    resolved_source, raw_dict = resolve_training_data(
        source_mode=source_mode,
        local_raw_path=raw_path,
        d1_file=d1_file,
    )
    print(f"[AetherML ML] Fonte efetiva utilizada: {resolved_source.upper()}")

    # Salva raw resolvido para geração do dataset se veio do D1
    raw_for_train_path = raw_path
    if resolved_source == "d1":
        raw_for_train_path = "ml/data/d1_merged_raw.json"
        with open(raw_for_train_path, "w", encoding="utf-8") as f:
            json.dump(raw_dict, f)

    # 2. Extração do Holdout Comum de 168h (7 dias)
    print(f"[AetherML ML] Extraindo holdout comum de {HOLDOUT_DEFAULT_HOURS}h...")
    X_holdout, y_holdout, holdout_start, holdout_end = extract_holdout_from_raw(
        raw=raw_dict,
        holdout_hours=HOLDOUT_DEFAULT_HOURS,
        order=order,
    )
    print(
        f"[AetherML ML] Holdout comum reservado: {holdout_start} até {holdout_end} "
        f"({len(X_holdout)} amostras)."
    )

    # 3. Geração do Dataset de Treino (exclui o holdout para evitar data leakage)
    print(f"[AetherML ML] Gerando dataset de treino sem o holdout (end_cutoff={holdout_start[:13]})...")
    build_real_dataset(
        raw_path=raw_for_train_path,
        out_path=dataset_path,
        end_cutoff=holdout_start[:13],
        order=order,
    )

    # 4. Treinamento do Challenger
    print(f"[AetherML ML] Treinando regressores Challenger ({version})...")
    res = train_models(dataset_path, compact=compact)
    models = res["models"]
    challenger_metrics = res["metrics"]
    feature_names = res["feature_names"]

    # 5. Salva artefatos do Challenger EXCLUSIVAMENTE em models/<versao>/
    out_dir = os.path.join("models", version)
    os.makedirs(out_dir, exist_ok=True)
    for target, booster in models.items():
        booster.save_model(os.path.join(out_dir, f"{target}.txt"))

    full_cal = {"bias": res["bias"], "isotonic": res.get("isotonic", {})}
    with open(os.path.join(out_dir, "calibration.json"), "w", encoding="utf-8") as f:
        json.dump(full_cal, f)

    # Exporta ONNX e Saabas apenas para out_dir (não toca em public/ durante treino)
    onnx_res = export_to_onnx(models, output_dir=out_dir, public_dir=out_dir)
    export_saabas_topologies(
        models, list(feature_names), output_dir=out_dir, public_dir=out_dir
    )

    # 6. Carrega Champion ativo para avaliação pareada
    registry = load_registry("models/registry.json")
    champ_version = registry.get("active_version", "desconhecida")
    try:
        champion_boosters = load_champion_boosters(registry, models_dir="models")
    except Exception as e:
        print(f"[AVISO AetherML] Não foi possível carregar boosters do Champion ({e}). Promovendo Challenger integralmente.")
        champion_boosters = None

    # 7. Comparação Pareada Champion vs Challenger na MESMA janela
    if champion_boosters is not None:
        decisions = compare_champion_challenger(
            champion_models=champion_boosters,
            challenger_models=models,
            X_holdout=X_holdout,
            y_holdout=y_holdout,
            epsilon=epsilon,
        )

        print("\n" + "=" * 78)
        print(f"[AetherML ML] AVALIAÇÃO PAREADA: CHAMPION ({champ_version}) vs CHALLENGER ({version})")
        print(f"Janela de holdout: {holdout_start} até {holdout_end} ({HOLDOUT_DEFAULT_HOURS}h)")
        print(f"Critério: RMSE(Challenger) <= RMSE(Champion) * (1.0 - {epsilon})")
        print("-" * 78)
        print(f"{'ALVO':<6} | {'CHAMP RMSE':<10} | {'CHALL RMSE':<10} | {'DELTA':<8} | {'DECISÃO'}")
        print("-" * 78)
        for t in TARGETS:
            dec = decisions[t]
            c_rmse = dec["champion"]["rmse"]
            ch_rmse = dec["challenger"]["rmse"]
            diff = dec["rmse_diff"]
            status = "PROMOVIDO (Challenger)" if dec["promote"] else "MANTIDO (Champion)"
            print(f"{t.upper():<6} | {c_rmse:<10.2f} | {ch_rmse:<10.2f} | {diff:<+8.2f} | {status}")
        print("=" * 78 + "\n")
    else:
        # Sem champion prévio: promove todos
        decisions = {
            t: {"promote": True, "champion": challenger_metrics[t], "challenger": challenger_metrics[t]}
            for t in TARGETS
        }

    # 8. Ordem Transacional de Promoção
    if dry_run:
        print("[DRY-RUN] Modo de teste ativo: nenhum arquivo em apps/web/public/models/ ou registry foi modificado.")
    else:
        promoted = apply_promotion(
            decisions=decisions,
            challenger_version=version,
            challenger_dir=out_dir,
            onnx_meta=onnx_res,
            public_models_dir=PUBLIC_MODELS,
            registry_file="models/registry.json",
        )
        print(f"[AetherML ML] Promoção transacional concluída.")
        print(f"  Poluentes promovidos para {version}: {promoted}")
        retained = [t for t in TARGETS if t not in promoted]
        if retained:
            print(f"  Poluentes retidos no Champion: {retained}")

    print(f"[AetherML] RETREINO {version} FINALIZADO COM SUCESSO.\n")


if __name__ == "__main__":
    main()
