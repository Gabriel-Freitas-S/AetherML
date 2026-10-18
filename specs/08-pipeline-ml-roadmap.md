# AetherML — 08 Pipeline ML, Avaliação e Roadmap

## 1. Pipeline de treino (`ml/training/`)

```
RAMQAr CSV + Open-Meteo archive + INMET + tráfego + MODIS/TROPOMI
 → build_dataset.py (join station×timestamp, lags 24h, médias móveis O3_8h, cíclicas sin-cos)
 → train_lightgbm.py (5 alvos, monotone_constraints, early stopping, optuna leve)
 → export_onnx.py (onnxmltools, opset ml, quantize se >1.5MB, sha256)
 → export_saabas.py (topology.json com valores de nó)
 → registry.py (insere model_registry + manifest.json + upload R2)
```

Constraints exemplo LightGBM: `monotone_constraints = [+1,-1,-1, ...]` alinhado à ordem canônica (§05.4).

Métricas gate: `R²≥0.65 (PM), ≥0.55 (O3/NO2)`, `MAE` por estação, `iqar_accuracy≥0.75`. Sem gate, sem deploy.

## 2. Avaliação e Retreino Semanal (`ml/evaluation/` + `.github/workflows/retrain.yml` — seg 06:00 UTC)

- **Gatilhos (`.github/workflows/retrain.yml`):** Cron semanal toda segunda-feira às `06:00 UTC` (`0 6 * * 1`) + `workflow_dispatch` (parâmetros `source=d1|local`, `dry_run`, `version`, `epsilon`).
- **Fluxo ponta-a-ponta:**
  1. **Ingestão e Extração (`fetch_openmeteo.py` → `fetch_from_d1.py`):** Atualiza a grade meteorológica/CAMS (`ml/data/openmeteo_raw.json`) e extrai `observed_pollutants` do Cloudflare D1 (`D1_DATABASE_ID=55d25065-ebc2-47a4-9fc3-16bbb96ef4ac`) com paginação keyset composta (`timestamp, station_id`). Quando a série na D1 ainda tem menos de `360h` (ex.: backfill inicial de 7 dias = `168h`), os registros da D1 são sobrepostos na janela correspondente sobre a série histórica para garantir as `30h` de buffer de lags e o conjunto de treino anterior ao holdout.
  2. **Auditoria Semanal (`ml/evaluation/evaluate_weekly.py`):** Avalia o modelo ativo nas últimas `168h` por estação e globalmente (`mae_pm25`, `mae_o3`, `mae_no2`, `iqar_accuracy_pct`, `false_alarm_rate`, `missed_event_rate` e drift de features via `PSI`). Grava registros compatíveis com `weekly_evaluations` (D1 + JSON) e publica `evaluation_report_md` no Step Summary; sinaliza `retrain_recommended=true` se `drift_detected=1`, `missed_event_rate > 0.15` ou `PSI > 0.25`.
  3. **Retreino Pareado Champion vs Challenger (`ml/training/retrain_real.py`):** Gera versão `vAAAA.SS.N` automática (`next_model_version`), reserva as últimas `168h` como holdout comum (excluindo-as do treino via `end_cutoff = holdout_start - 1h`), treina os 5 regressores LightGBM Challenger (`models/<versao>/`) e compara RMSE pareado na mesma janela.
  4. **Promoção Transacional, R2, Artefatos e Deploy (somente se houve promoção e `ref == refs/heads/main`):**
     - Promove granularmente apenas os poluentes com não-degradação (`RMSE_challenger <= RMSE_champion * (1 - epsilon)`), atualizando `models/registry.json` e `apps/web/public/models/`.
     - Publica `.onnx` (`<1,5 MB`, SHA-256), `.topology.json`, `calibration.json` e `manifest.json` no bucket R2 `aetherml-models` (`python3 -m ml.training.upload_r2 upload && verify`).
     - Regenera os 4 artefatos estáticos consumidos pelo frontend: `predict_forecast.py` (`stations-data.json`), `eval_holdout.py` (`model-eval.json`), `build_comparison.py` (`comparison-data.json`) e `build_forecast_compare.py` (`forecast-compare.json`).
     - Commita os artefatos atualizados, executa `pnpm -r build` e publica no Cloudflare Pages (`npx -y wrangler@4 pages deploy apps/web/dist --project-name=aetherml --branch=main --commit-dirty=true`).
- Fontes fotoquímicas H-II: treino O3 usa `no2_lag, radiação, temp, vento` (titulação + advecção); validação estratificada por quadrante de vento (NNE vs SSW).
- **Estado da avaliação (BUG-05):** Entregues no artefato `model-eval.json` baselines de persistência (`lag1` e `lag24`) para todos os 5 alvos + IQAr, `skill_vs_persistence` e declaração de proveniência (`provenance`, CAMS regional ≠ medição in-situ).
- **Próximo passo metodológico (MOS):** Com a disponibilização de medições físicas de estação (coluna `source`, migration `0002_observed_source.sql`, sentinela `IEMA`), transição do modelo para corretor de viés MOS (*Model Output Statistics*), onde $X$ = CAMS e $Y$ = ground truth *in-situ*.

## 3. Roadmap executável

**H-I (1-3m) — Borda+PWA+XAI [dono: frontend/edge]**
- [ ] Scaffold Astro+Svelte+Uno+Starlight+PWA + headers COOP/COEP
- [ ] Worker ort.wasm SIMD + IQAr + Saabas + Waterfall
- [ ] D1 init + seed 9 estações + API stations/history/features/manifest
- [ ] Aceite: <2ms/48h, Lighthouse PWA 100, offline total

**H-II (3-6m) — Fotoquímica+mobilidade [dono: ML+ingestão]**
- [ ] Modelos o3_8h/no2_1h + interpolação multipoluente
- [ ] Ingestão tráfego contínuo (Terceira/Segunda/Cinco Pontes/Florentino Avidos)
- [ ] Modelo MOS (CAMS = X, IEMA in-situ = Y) para correção de viés local
- [ ] Aceite: picos NO2 Centro/Suá capturados; O3 vespertino interior

**H-III (6-12m) — Orbital+simulação+push [dono: full]**
- [ ] MODIS AOD 1km + TROPOMI NO2 + constraints monotônicas formais
- [ ] Simulator.svelte 4 cenários + push geoespacial VAPID
- [ ] Aceite: cenário Tubarão −50% → Camburi Boa sob NNE; push transição Ruim+

## 4. MCPs / Skills / regras (Antigravity + OpenCode)

- `mcp/docker-fetch`: docs Open-Meteo/Astro/Svelte5/ORT-Web
- `mcp/docker-cloudflare`: wrangler deploy + D1 migrations
- `mcp/docker-sqlite`: valida `db/*.sql` local
- `mcp/docker-ast-grep`: busca sintática (economia de tokens)
- Regras: contexto cirúrgico (ranges), `biome/ruff` pre-prompt, TDD Red-Green-Refactor mínimo.
