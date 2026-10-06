"""
ml/refresh_all.py — Refresh único da cadeia de artefatos servidos pelo site.

Por que existe: os artefatos em apps/web/public/data/ são build artifacts
committados. Cada um era gerado por uma invocação Python ad-hoc separada
(fetch → predict → eval), então nada os mantinha atualizados e as datas da
página /precisao congelavam no último deploy que o gerador rodou.

Ordem (cada etapa aborta a cadeia se falhar):
  1. fetch_openmeteo.fetch_all   → ml/data/openmeteo_raw.json
  2. predict_forecast.predict_all→ apps/web/public/data/stations-data.json
  3. eval_holdout.run_backtest   → apps/web/public/data/model-eval.json
  4. build_forecast_compare       → apps/web/public/data/forecast-compare.json

Os caminhos de saída são passados EXPLICITAMENTE nas quatro etapas: fetch,
predict, eval e a comparação de forecast têm defaults CWD-relatives e
escreveriam no lugar certo por acaso, não por contrato.

Uso:
  python ml/refresh_all.py                  # cadeia completa (inclui rede)
  python ml/refresh_all.py --skip-fetch     # só recalcula, reaproveita raw
"""

import json
import os
import sys
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

# Contrato de caminhos: é isto que o site lê (apps/web/public/data/*).
RAW_PATH = os.path.join("ml", "data", "openmeteo_raw.json")
FORECAST_PATH = os.path.join("apps", "web", "public", "data", "stations-data.json")
EVAL_PATH = os.path.join("apps", "web", "public", "data", "model-eval.json")
FORECAST_COMPARE_PATH = os.path.join(
    "apps", "web", "public", "data", "forecast-compare.json"
)

# O holdout tem que terminar junto com o dado bruto mais recente; se divergir,
# algum artefato do meio ficou velho.
MAX_STALENESS_H = 24.0

STEPS = 4


def _step(n: int, title: str) -> None:
    print("=" * 72)
    print(f"[refresh] ETAPA {n}/{STEPS} — {title}")
    print("=" * 72, flush=True)


def _read(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def summarize(version: str, order: str, now: datetime) -> None:
    raw = _read(RAW_PATH)
    cutoff = (raw.get("fetched_at") or "")[:13]
    raw_start = raw_end = ""
    for entry in raw["stations"].values():
        times = entry["aq_hourly"]["time"]
        past = [t for t in times if not cutoff or t[:13] <= cutoff]
        if past:
            raw_start = min(raw_start or past[0], past[0])
            raw_end = max(raw_end, past[-1])

    fc = _read(FORECAST_PATH)
    fc_start = fc_end = ""
    for st in fc.values():
        stamps = [p["timestamp"] for p in st["points"]]
        if stamps:
            fc_start = min(fc_start or stamps[0], stamps[0])
            fc_end = max(fc_end, stamps[-1])

    ev = _read(EVAL_PATH)
    holdout = ev["holdout"]

    fc_cmp = _read(FORECAST_COMPARE_PATH)

    def parse(ts: str) -> datetime:
        ts = ts[:-1] if ts.endswith("Z") else ts  # raw não tem "Z", holdout tem
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)

    lag_h = (parse(raw_end) - parse(holdout["end"])).total_seconds() / 3600.0
    print("=" * 72)
    print(f"[refresh] RESUMO — modelo {version} / features {order}")
    print("-" * 72)
    print(f"  raw        {RAW_PATH}")
    print(
        f"             passado {raw_start} → {raw_end} (fetched_at={raw['fetched_at']})"
    )
    print(f"  forecast   {FORECAST_PATH}")
    print(f"             janela  {fc_start} → {fc_end}  ({len(fc)} estações)")
    print(f"  avaliação  {EVAL_PATH}")
    print(f"             holdout {holdout['start']} → {holdout['end']}")
    print(
        f"             {holdout['points']} pontos / {holdout['stations']} estações"
        f" | versão={ev['model_version']} ordem={ev.get('feature_order')}"
    )
    print(
        f"             IQAr classe={ev['iqar']['class_accuracy']:.1%}"
        f" MAE idx={ev['iqar']['mae_index']}"
        f" | gerado em {ev.get('generated_at')}"
    )
    print(f"  forecast×API  {FORECAST_COMPARE_PATH}")
    print(
        f"             janela {fc_cmp['window']['from']} → {fc_cmp['window']['to']} "
        f"({fc_cmp['window']['hours']}h) | is_validation={fc_cmp['is_validation']} "
        f"(CAMS é insumo das features, não referência)"
    )
    for p, m in fc_cmp["summary"]["by_pollutant"].items():
        print(
            f"             {p:5s} n_paired={m['n_paired']:5d} "
            f"cobertura={m['coverage_pct']:6.2f}%"
        )
    print(f"  agora      {now.strftime('%Y-%m-%dT%H:%M:%SZ')}")
    print("-" * 72)
    if abs(lag_h) > MAX_STALENESS_H:
        raise SystemExit(
            f"[refresh] FALHA: holdout termina {lag_h:+.1f}h em relação ao fim do "
            f"dado bruto (limite {MAX_STALENESS_H}h). Artefato defasado — a página "
            f"/precisao mostraria datas velhas."
        )
    print(f"[refresh] OK — holdout alinhado com o dado bruto ({lag_h:+.1f}h).")


def refresh(skip_fetch: bool = False) -> None:
    try:
        _refresh(skip_fetch=skip_fetch)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — o orquestrador é a única fronteira
        print(f"[refresh] FALHOU: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)


def _refresh(skip_fetch: bool = False) -> None:
    os.chdir(ROOT)  # as três etapas leem models/ e gravam por caminho relativo
    started = datetime.now(timezone.utc)

    from ml.training.predict_forecast import active_model

    version, order = active_model()
    print("=" * 72)
    print(f"[refresh] REFRESH DE DADOS — modelo {version} / features {order}")
    print("=" * 72, flush=True)

    if skip_fetch:
        _step(1, f"fetch_openmeteo (IGNORADO — {RAW_PATH} reaproveitado)")
        print(f"[refresh] fetched_at={_read(RAW_PATH).get('fetched_at')}", flush=True)
    else:
        _step(1, "fetch_openmeteo (CAMS/Open-Meteo, rede)")
        from ml.training.fetch_openmeteo import fetch_all

        fetch_all(output_path=RAW_PATH)

    _step(2, f"predict_forecast ({version}, {order})")
    from ml.training.predict_forecast import predict_all

    predict_all(raw_path=RAW_PATH, version=version, order=order, out_path=FORECAST_PATH)

    _step(3, f"eval_holdout ({version}, {order})")
    from ml.evaluation.eval_holdout import run_backtest

    run_backtest(version, raw_path=RAW_PATH, out_path=EVAL_PATH, order=order)

    _step(4, f"build_forecast_compare ({version}, {order})")
    from ml.evaluation.build_forecast_compare import build_forecast_compare

    build_forecast_compare(
        raw_path=RAW_PATH,
        forecast_path=FORECAST_PATH,
        out_path=FORECAST_COMPARE_PATH,
        version=version,
        order=order,
    )

    summarize(version, order, started)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] not in ("--skip-fetch",):
        print(f"Uso: {sys.argv[0]} [--skip-fetch]")
        sys.exit(2)
    refresh(skip_fetch="--skip-fetch" in sys.argv[1:])
