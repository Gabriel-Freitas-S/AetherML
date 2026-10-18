"""
ml/training/test_retrain_workflow.py — Testes TDD do workflow de retreino semanal (.github/workflows/retrain.yml).

Roda: `python ml/training/test_retrain_workflow.py` (exit 0 = verde).
Valida:
1. Existência de `.github/workflows/retrain.yml`
2. Triggers obrigatórios: `schedule` com cron semanal seg 06:00 UTC (`0 6 * * 1`) e `workflow_dispatch`
3. Variáveis e secrets Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `D1_DATABASE_ID` (`55d25065-ebc2-47a4-9fc3-16bbb96ef4ac`)
4. Cadeia completa do pipeline:
   - `fetch_from_d1.py`
   - `evaluate_weekly.py`
   - `retrain_real.py` (Champion vs Challenger pareado)
   - Upload R2 (`ml.training.upload_r2`) condicionado à promoção
   - Regeneração dos 4 artefatos (`predict_forecast.py`, `eval_holdout.py`, `build_comparison.py`, `build_forecast_compare.py`)
   - Commit + build web (`pnpm -r build`) + deploy Cloudflare Pages (`npx -y wrangler@4 pages deploy apps/web/dist --project-name=aetherml --branch=main --commit-dirty=true`)
5. Proteção de branch/dry-run para não tocar na `main` nem no modelo ativo em execuções fora da `main`.
"""

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORKFLOW_PATH = os.path.join(ROOT, ".github", "workflows", "retrain.yml")


def _strip_yaml_comments(content: str) -> str:
    return "\n".join(
        line for line in content.splitlines() if not line.strip().startswith("#")
    )


def test_retrain_workflow_exists_and_has_triggers():
    assert os.path.exists(WORKFLOW_PATH), f"Workflow ausente: {WORKFLOW_PATH}"
    with open(WORKFLOW_PATH, "r", encoding="utf-8") as f:
        raw_content = f.read()
    content = _strip_yaml_comments(raw_content)

    assert "schedule:" in content, "retrain.yml deve ter trigger schedule"
    assert "0 6 * * 1" in content, "retrain.yml deve rodar toda segunda às 06:00 UTC ('0 6 * * 1')"
    assert "workflow_dispatch:" in content, "retrain.yml deve ter trigger workflow_dispatch"
    assert "\n  push:" not in content, "retrain.yml não deve ter trigger push de branch de floor"


def test_retrain_workflow_has_cloudflare_env_and_d1_id():
    with open(WORKFLOW_PATH, "r", encoding="utf-8") as f:
        content = _strip_yaml_comments(f.read())

    assert "secrets.CLOUDFLARE_API_TOKEN" in content
    assert "vars.CLOUDFLARE_ACCOUNT_ID" in content
    assert "55d25065-ebc2-47a4-9fc3-16bbb96ef4ac" in content, (
        "D1_DATABASE_ID canônico deve estar configurado no workflow"
    )


def test_retrain_workflow_pipeline_steps_order():
    with open(WORKFLOW_PATH, "r", encoding="utf-8") as f:
        content = _strip_yaml_comments(f.read())

    required_commands = [
        "python3 ml/training/fetch_openmeteo.py",
        "python3 ml/evaluation/evaluate_weekly.py --fetch-d1-only --d1-file ml/data/d1_observed.json",
        "python3 ml/evaluation/evaluate_weekly.py \\",
        "python3 ml/evaluation/evaluate_weekly.py --retrain \\",
        "python3 -m ml.training.upload_r2 upload",
        "python3 ml/training/predict_forecast.py",
        "python3 ml/evaluation/eval_holdout.py",
        "python3 ml/evaluation/build_comparison.py",
        "python3 ml/evaluation/build_forecast_compare.py",
        "actions/upload-artifact@v4",
        "pnpm -r build",
        "npx -y wrangler@4 pages deploy apps/web/dist --project-name=aetherml --branch=main --commit-dirty=true",
    ]
    for cmd in required_commands:
        assert cmd in content, f"Comando real obrigatório ausente (fora de comentários) em retrain.yml: {cmd}"

    # Verifica ordem estrita nos comandos reais (sem comentários)
    idx_fetch = content.index("python3 ml/evaluation/evaluate_weekly.py --fetch-d1-only")
    idx_eval = content.index("python3 ml/evaluation/evaluate_weekly.py \\")
    idx_retrain = content.index("python3 ml/evaluation/evaluate_weekly.py --retrain \\")
    idx_upload = content.index("python3 -m ml.training.upload_r2 upload")
    idx_predict = content.index("python3 ml/training/predict_forecast.py")
    idx_artifact = content.index("actions/upload-artifact@v4")
    idx_build = content.index("pnpm -r build")
    idx_deploy = content.index("wrangler@4 pages deploy")

    assert idx_fetch < idx_eval < idx_retrain < idx_upload < idx_predict < idx_artifact < idx_build < idx_deploy


def test_retrain_workflow_protects_main_and_active_model_on_branches():
    with open(WORKFLOW_PATH, "r", encoding="utf-8") as f:
        raw_content = f.read()
    content = _strip_yaml_comments(raw_content)

    assert "Política de promoção" in raw_content, "Comentário documentando política dry_run/schedule deve existir"
    assert "default: true" in content, "workflow_dispatch deve ter dry_run com default: true"
    assert "refs/heads/main" in content, (
        "retrain.yml deve proteger upload R2 / commit / deploy Pages contra branches que não sejam refs/heads/main"
    )
    assert "steps.retrain.outputs.promoted == 'true'" in content, (
        "Upload R2 e regeneração/deploy pós-promoção devem depender de steps.retrain.outputs.promoted == 'true'"
    )


if __name__ == "__main__":
    test_retrain_workflow_exists_and_has_triggers()
    test_retrain_workflow_has_cloudflare_env_and_d1_id()
    test_retrain_workflow_pipeline_steps_order()
    test_retrain_workflow_protects_main_and_active_model_on_branches()
    print("[OK] test_retrain_workflow: 4/4 verdes")

