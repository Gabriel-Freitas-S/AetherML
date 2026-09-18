# AetherML — AGENTS.md

Previsão de qualidade do ar RMGV (48h, 5 poluentes + CO). Fonte normativa: `AetherML_Instrucoes_Arquitetura.md`. Specs vivas: `specs/00..08`.

## Stack
- `apps/web`: Astro + Svelte 5 + UnoCSS + Starlight (PWA offline-first).
- `packages/core-iqar`: IQAr CONAMA 491/2018 puro (cliente + server). `packages/geo`: Haversine.
- `packages/inference-client`: ONNX Runtime Web `ort.wasm` em Web Worker (WASM SIMD-128 + SharedArrayBuffer, <2ms/48h).
- `workers/api` (REST + Cron push), `workers/ingestion` (Cron :30), D1 (Drizzle) + R2 (modelos `.onnx` <1,5MB, SHA-256).
- pnpm workspaces. Comandos: `pnpm dev` · `pnpm -r test` · `pnpm -r build` · `biome check --write ./apps ./packages ./workers` · `wrangler d1 migrations apply aetherml-db --local`.

## TDD (obrigatório)
- Red → Green → Refactor em todo código: teste failing primeiro, implementação mínima, refactor, `biome` + suite focada.
- Detalhe em `.agents/rules/tdd.md`. Skill: `tdd-aetherml`. Workflow Antigravity: `/tdd-feature`.

## Convenções AetherML
- `station.id` = `ramqar_*` (9 estações, `db/seed.sql`). Versão modelo `vAAAA.SS.N`.
- IQAr: `I_p = I_ini + (I_fim-I_ini)/(C_fim-C_ini)*(C_p-C_ini)`; `IQAr_global = max_p{I_p}`. Canônico em `packages/core-iqar/src/iqar.ts`.
- Ordem canônica 25 features `FEATURE_ORDER_V1` (`db/schema.ts`) — nunca reordenar sem bump de versão.
- Haversine `R=6371km` em `packages/geo/src/geo.ts`. WebGPU só p/ futura CNN AOD. Detalhe: `.agents/rules/aetherml-conventions.md`.

## Roteamento de ferramentas (nesta ordem)
1. **CodeGraph**: `codegraph_explore` ANTES de Read/Grep p/ qualquer pergunta arquitetural — `.agents/rules/codegraph.md`.
2. **Graphify**: se `graphify-out/graph.json` existe, `graphify query "<pergunta>"` primeiro — `.agents/rules/graphify.md`.
3. **Docs** (sem Context7 — removido do projeto): nunca adivinhar API de lib — `cloudflare-docs` p/ plataforma, subagente de pesquisa + `webfetch` p/ docs oficiais — `.agents/rules/docs-fetch.md`.
4. Edição cirúrgica: alterar só o range pedido, preservar o resto.

## Subagentes por dificuldade (`.opencode/agents/`, `.agents/agents/`)
- Tarefa simples → `@flash-low` · média → `@flash-medium` · difícil → `@flash-high`.
- Detalhe em `.agents/rules/subagents.md`.

## Setup de skills/MCP (uma vez por máquina)
- `graphify opencode install` e `graphify antigravity install` (gera plugin/rules/workflows always-on).
- MCPs em `opencode.json` (OpenCode) e `.agents/mcp_config.json` (Antigravity): `cloudflare-docs`, `codegraph`.
