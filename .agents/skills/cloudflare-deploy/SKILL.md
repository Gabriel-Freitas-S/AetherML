---
name: cloudflare-deploy
description: Opera o deploy e a persistencia Cloudflare do AetherML com Wrangler, bindings D1 e R2, Cron Triggers e Web Push VAPID.
---

# Cloudflare AetherML

Código: `workers/api/src/index.ts`, `workers/ingestion/src/index.ts`. Contratos: `specs/04-contratos-api.md`.

## Comandos (nesta ordem)
1. `wrangler d1 migrations apply aetherml-db --local` → depois `--remote` (nunca seed antes de migrar).
2. `wrangler d1 execute aetherml-db --local --file=./db/seed.sql` (9 `ramqar_*`).
3. `wrangler dev workers/api` / `wrangler dev workers/ingestion` p/ loop local.
4. `wrangler deploy` por worker; Pages via `pnpm --filter web build` + output `dist/`.

## Bindings e crons
- API: `DB` (D1), `MODELS` (R2), secrets `VAPID_PUBLIC/PRIVATE_KEY` (só via `wrangler secret put`, nunca em código).
- Ingestion Cron `:30` (RAMQAr/Open-Meteo/INMET); API Cron hora cheia (varredura push 6–24h) e `seg 06h` (avaliações semanais).
- Push só em transição p/ `Ruim+` na janela 6–24h (`specs/07`).

## TDD e docs
- Testar handlers com D1/R2 mockados; checar códigos de erro do contrato (`BAD_STATION`, `STALE_MODEL`...).
- Dúvida de API Wrangler/Workers → Cloudflare-docs MCP primeiro (skill `docs-fetch`).
