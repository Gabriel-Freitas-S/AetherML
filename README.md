# AetherML — RMGV Air Quality Forecasting

Ver documento mestre: `AetherML_Instrucoes_Arquitetura.md` · Specs vivas: `specs/00..08`.

## Quickstart (H-I)

```bash
pnpm install
pnpm db:migrate && pnpm db:seed   # D1 local
pnpm dev                            # apps/web (Pages)
wrangler dev workers/api            # API + Cron push
```

## Estrutura

Ver `specs/02-estrutura-pastas.md`. Contratos API: `specs/04`. Dados: `specs/03` + `db/schema.sql`.
Inferência/XAI: `specs/05`. PWA: `specs/06`. Alertas/simulador: `specs/07`. ML/roadmap: `specs/08`.

## Regras

- Edição cirúrgica (ranges), `biome`/`ruff` pre-prompt, TDD Red-Green-Refactor.
- WASM SIMD para árvores; WebGPU só futura CNN AOD. Modelos <1,5MB, SHA-256.
- IQAr = max(I_p) CONAMA 491 — implementação canônica em `packages/core-iqar`.
