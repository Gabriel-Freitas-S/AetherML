# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — health and environment professionals.** Environmental control technicians (IEMA), municipal and civil-defense staff, and researchers who need an auditable, station-level air-quality forecast for the Grande Vitória metropolitan area (Vitória, Vila Velha, Serra, Cariacica). Their job is to decide and justify: whether an alert threshold has been crossed, which population group is exposed, and whether a forecast is trustworthy enough to act on. They arrive with a professional obligation behind them, so they need provenance, version, and measured error — not reassurance.

**Secondary — the RMGV population and risk groups.** Residents checking what the air will do in the coming days, and at-risk groups (children, elderly, pregnant people, asthmatics, cardiac patients) who need a plain-language health instruction. `specs/00-visao-geral.md:28-33` names both audiences as deliberate stakeholders. The same surface serves them, which is why the docs split into "Comece por aqui" (jargon-free) and "Documentação técnica" (`apps/web/src/lib/guides.ts:12-121`, `apps/web/src/pages/docs/index.astro:25-45`).

## Product Purpose

Hourly air-quality prediction for Grande Vitória, classified on Brazil's official CONAMA 491/2018 index (IQAr), for a 5-day (120h) horizon.

It exists to replace four things the architecture doc names as the status quo: dependence on expensive server inference clusters, modelling of particulate matter only, no offline resilience, and no proactive alerting (`AetherML_Instrucoes_Arquitetura.md:9-15`).

Success is measured and gated, not asserted. A release ships only if it clears the deploy gates in `specs/08-pipeline-ml-roadmap.md:16`: R² ≥ 0.65 (PM), ≥ 0.55 (O₃/NO₂), per-station MAE, and IQAr classification accuracy ≥ 0.75 — *"sem gate, sem deploy"*. Each model stays under 1.5 MB with a SHA-256 on record. Non-functional targets: p95 inference < 5 ms desktop / < 15 ms mobile, XAI < 2 ms, full offline operation after first visit, geolocation never leaving the device. Honest negative results count as success: retired experiments and known limits are published (`apps/web/public/../src/pages/docs` → `09-dados-reais-backtest.md:38,51-56`).

## Positioning

**CONAMA 491/2018 is the scoring standard, not a feature bolted on.** Every number the product shows resolves to the official Brazilian index through one canonical interpolation — `I_p = I_ini + (I_fim−I_ini)/(C_fim−C_ini)·(C_p−C_ini)`, `IQAr_global = max_p{I_p}` — implemented once in `packages/core-iqar/src/iqar.ts` and shared verbatim by client and server. A neighbouring product could not truthfully copy this: the classification is the regulatory one, per station, per hour, in Brazilian air.

Three further mechanisms a competitor could not copy without rebuilding:

- **Explainability that runs on-device.** Saabas tree attribution (O(K·D)) instead of TreeSHAP (O(K·L·D²)), chosen specifically so a sub-millisecond attribution can render a diverging waterfall in the browser (`AetherML_Instrucoes_Arquitetura.md:111-116`; `apps/web/src/components/Waterfall.svelte`).
- **Region-specific physics of Grande Vitória.** The Tubarão industrial plume advected by NNE winds onto Camburi and Enseada do Suá; SSW incursions trapping pollution in the Cariacica and Vila Velha valleys; photochemical NO + O₃ → NO₂ + O₂ titration along traffic corridors; afternoon O₃ peak 14–17h (`AetherML_Instrucoes_Arquitetura.md:26-28,66-76`). These are encoded as features, not generic meteorology.
- **A stated provenance posture.** *"Zero `random` no pipeline: todo o resto é medido ou derivado"*, and a published FAQ entry explaining why a station's number can differ from another source so users do not file it as a bug (`docs/09-dados-reais-backtest.md:12`; `docs/faq.md:9-10`).

## Operating Context

Field use by IEMA technicians and access from residents in port and industrial zones subject to network instability require the app to work 100% offline-first (`docs/05-pwa-resiliencia-offline.md:3`). The product is consulted in two registers: a glanceable read for the public, and an audit trail for professionals.

Deployment: Cloudflare Pages (static web) + Workers (REST API, ingestion cron, push alerts) + D1 (Drizzle) + R2 (models). Offline assets are self-hosted — ONNX Runtime WASM (`apps/web/public/wasm/`), Leaflet (`apps/web/public/leaflet/`), models, and data — so no third-party origin is required at runtime.

Repository workflows that are part of operating the product: TDD is mandatory (Red → Green → Refactor), feature order is immutable without a version bump, and `biome check --write` gates `./apps ./packages ./workers`.

## Capabilities and Constraints

**Capabilities confirmed by shipped code**

- 5 modelled pollutants — `pm25, pm10, o3, no2, so2` (`apps/web/public/models/registry.json:37-42`). **CO is observational only** and has no model, no forecast, and no UI surface, despite a `co` column in `db/schema.ts:21`.
- 9 RAMQAr stations, ids `ramqar_*`, across 4 municipalities (`db/seed.sql:3-11`).
- Model versioning `vAAAA.SS.N`; active release `v2026.38.5`, `feature_order_version: "v2"`; 5 archived releases (`apps/web/public/models/registry.json`).
- Immutable feature order: `FEATURE_ORDER_V1` (25 features) in `db/schema.ts:105-112`; V2 = V1 + five 1h lags (30). Never reorder, only append with a version bump.
- Routes: `/` (dashboard), `/mapa` (9-station map), `/precisao` (backtest), `/estacao/[id]` (9 pre-rendered station pages), `/docs` + 12 slugs, `offline.html`.

**Constraints future work must preserve**

- **The forecast horizon is 5 days / 120h.** Specs and the architecture doc still say 48h; that is legacy text and is superseded. The shipped worker caps at 120h and every UI string says "5 dias (120h)".
- **Accuracy figures are never hardcoded in copy.** Accuracy moves as days pass and as the model retrains, so it must be read from the evaluation artifact, never transcribed. `/precisao` already renders `apps/web/public/data/model-eval.json` directly; any surface quoting a number must source it the same way. The pt-BR copy currently hardcodes a stale 91,9% / ±2,8 and is wrong.
- **Geolocation stays on the device.** GPS is used only to resolve the nearest station and is never transmitted (`docs/faq.md:19`).
- **DB-First quota guard.** A D1 lookup precedes any Open-Meteo call, 3h TTL, upsert on miss; the UI reports remaining quota (`docs/06-api-rest-schema-d1.md:9-35`).
- **Monotonic constraints** hold on emission/traffic/AOD (≥ 0), wind speed and PBLH (≤ 0), so counterfactual controls cannot produce physically impossible inversions.
- **WebGPU is reserved** for a future AOD CNN/GNN and is not used for tree inference; SIMD divergence and shader overhead are the documented reasons (`AetherML_Instrucoes_Arquitetura.md:80-94`).
- **SharedArrayBuffer requires COOP + COEP headers**, which constrains which third-party origins may be embedded.
- **Haversine R = 6371 km** in `packages/geo/src/geo.ts` is the one distance implementation.

**Undecided — do not resolve by guessing**

- Automated refresh of accuracy figures: what produces the evaluation artifact, on what cadence, and who triggers it.
- Push alerts (Web Push + VAPID) and the counterfactual simulator are specified in `specs/07-alertas-simulador.md` but are TODO stubs (`workers/api/src/index.ts:70-74`); no `/simular` route exists.
- The inference worker exists and is claimed in UI copy ("calculada no seu dispositivo via WebAssembly SIMD-128", `apps/web/src/components/Dashboard.svelte:457`, plus a "WASM SIMD" badge in `Layout.astro:151-157`), but no page instantiates it — the UI renders precomputed `public/data/stations-data.json` and hardcoded Saabas values. Whether on-device inference becomes a live headline claim or the claim is withdrawn is unresolved.
- `public/_headers:3` ships `Cross-Origin-Embedder-Policy: credentialless` while `specs/06-pwa-offline.md:20` mandates `require-corp`; `_headers:4` allows `'unsafe-eval'` while `specs/01-arquitetura.md:68` states CSP without it. Reconcile spec and reality.
- No production domain is committed. `api.aetherml.pages.dev` appears only in `specs/04-contratos-api.md:3`.

## Brand Commitments

**Name:** AetherML. Wordmark: `Aether` in slate-900 extrabold + `ML` in a sky-600 → emerald-500 gradient (`apps/web/src/layouts/Layout.astro:126-129`). Lockup subtitle `RMGV • 5 Dias ML`.

**Voice (pt-BR):** direct, plain, second person, imperative health guidance. No marketing register, no jargon in the lay track — "Entenda o ar que você respira" (`docs/index.astro:18`), "sem jargão" (`guides.ts:19`). Professional track stays factual and cites the artifact.

**Canonical strings** (do not paraphrase without cause):
- Meta description — "Previsão inteligente horária de 5 dias e classificação regulatória CONAMA 491/2018 para a Grande Vitória via WebAssembly na borda." (`Layout.astro:11`)
- Footer — "AetherML — Previsão de Qualidade do Ar da Grande Vitória (ES)." + "Resolução CONAMA 491/2018 • IEMA / RAMQAr" (`Layout.astro:204-209`)
- PWA manifest name — "AetherML — Qualidade do Ar RMGV" (`public/manifest.webmanifest:4`)

**Identity constraints:** the app is the product — there is no marketing site. Locale is pinned: `<html lang="pt-BR">` and every `Intl.DateTimeFormat` call uses `pt-BR` / `America/Sao_Paulo`.

**Assets:** `apps/web/public/favicon.svg` (gauge glyph, multi-stop IQAr arc) and the PWA icon set, generated by `scripts/generate_pwa_icons.py`. No brand guide exists.

## Evidence on Hand

- **Live model artifacts** — `apps/web/public/models/{pm25,pm10,o3,no2,so2}.onnx` (590–631 KB each) plus per-target `.topology.json` (1.2–1.3 MB), `calibration.json`, and `registry.json` with SHA-256 and in-sample metrics. Archived releases `v2026.38.1`–`v2026.38.4`.
- **Backtest artifact** — `apps/web/public/data/model-eval.json` (82 KB): holdout 2026-09-20 → 2026-09-27, 168h × 9 stations = 1512 points; per-pollutant MAE/RMSE/R²/MAPE/bias; persistence baseline; per-class accuracy; degradation table at +24/+48/+72/+120h; full real-vs-pred series.
- **Forecast data** — `apps/web/public/data/stations-data.json` (385 KB): 9 stations × 120 hourly points with 30-value feature vectors and observed blocks, 2026-09-27 → 2026-10-02. This is what the UI actually renders.
- **Schema and seed** — `db/schema.sql`, `db/migrations/0001_init.sql` (7 tables), `db/schema.ts` (Drizzle), `db/seed.sql` (9 stations).
- **Training pipeline** — `ml/data/` (Open-Meteo raw, train/holdout datasets), `ml/training/` (fetch, dataset build, retrain, LightGBM, calibration, ONNX + Saabas export, registry, predict) with tests, `ml/evaluation/` (holdout eval, weekly eval) with tests.
- **Runtime binaries** — self-hosted `ort-wasm-simd-threaded.wasm` (14.2 MB) and `.jspi.wasm` (16.8 MB) in `apps/web/public/wasm/`.
- **Unreferenced** — `tour/aetherml-tour.webm` (4.9 MB screen recording) is not linked from `src/`. Its intended use is undetermined.

**Absent — future work must not fabricate:** no testimonials, user quotes, reviews, or case studies. No press, awards, or citations. No user research, surveys, or personas. No screenshots. No analytics or telemetry SDK, no consent banner, no privacy policy, no terms page, no LICENSE. No CI config. The product has no landing page.

## Product Principles

1. **The regulation is the contract.** CONAMA 491/2018 defines what a number means. Never reword a band name, never re-map a classification, never soften a Péssima reading.
2. **Never state a number the artifact does not support.** Accuracy, drift, and limits are read from the evaluation artifact at render time. Stale prose is a defect, not a simplification.
3. **Say what the model cannot do.** Known limits and retired experiments stay published. The user is often a professional who will be held to the answer.
4. **Offline is the default condition, not a fallback.** Coastal industrial zones lose connectivity; anything that only works online is broken for the people who most need it.
5. **Explain, do not just score.** A forecast without a reason is unusable by an auditor and useless to a resident. Attribution ships with the prediction.
6. **The device is the privacy boundary.** Nothing about a person's location leaves it.

## Accessibility & Inclusion

**WCAG AA is a commitment.** All text and meaningful UI must meet AA contrast.

**Air-quality category must never be conveyed by color alone.** This is a health decision read under stress, and the CONAMA ramp runs green → amber → orange → red → purple — the exact axis a red/green colorblind reader cannot separate. Future work must add shape, icon, and text redundancy to every band, and tune saturation/lightness so adjacent bands clear AA against their surfaces. Band color stays a supporting cue; the label and glyph carry the meaning.

**Reduced motion must be honored.** `prefers-reduced-motion` is currently absent, and `.anim-pulse-iqar` (`Layout.astro:113-115`) runs an infinite 3s scale animation with no opt-out. That is a known gap, not a sanctioned pattern.

**Touch targets** stay at ≥ 44px (`StationPicker.svelte:89`, `LocationBar.svelte:91`).

**Plain language is an inclusion requirement.** The lay track must stay readable by a non-specialist, and health guidance must carry the existing disclaimer that it does not replace medical advice (`docs/saude-por-faixa.md:17`).
