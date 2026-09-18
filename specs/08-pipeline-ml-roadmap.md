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

## 2. Avaliação semanal (`ml/evaluation/` + Cron seg 06h)

- Join `observed × prediction_logs` da semana → MAE_pm25/o3/no2, `iqar_accuracy`, `false_alarm_rate` (previu Ruim+, ficou Boa/Moderada), `missed_event_rate` (ficou Ruim+, previu abaixo), drift PSI/KS nas features.
- Grava `weekly_evaluations`; se `drift=1` ou `missed>0.15`, abre `evaluation_report_md` + flag p/ retreino.
- Fontes fotoquímicas H-II: treino O3 usa `no2_lag, radiação, temp, vento` (titulação + advecção); validação estratificada por quadrante de vento (NNE vs SSW).

## 3. Roadmap executável

**H-I (1-3m) — Borda+PWA+XAI [dono: frontend/edge]**
- [ ] Scaffold Astro+Svelte+Uno+Starlight+PWA + headers COOP/COEP
- [ ] Worker ort.wasm SIMD + IQAr + Saabas + Waterfall
- [ ] D1 init + seed 9 estações + API stations/history/features/manifest
- [ ] Aceite: <2ms/48h, Lighthouse PWA 100, offline total

**H-II (3-6m) — Fotoquímica+mobilidade [dono: ML+ingestão]**
- [ ] Modelos o3_8h/no2_1h + interpolação multipoluente
- [ ] Ingestão tráfego contínuo (Terceira/Segunda/Cinco Pontes/Florentino Avidos)
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
