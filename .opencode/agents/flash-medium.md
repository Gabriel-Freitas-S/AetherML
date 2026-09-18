---
description: Tarefas medias do AetherML com Gemini 3.8 Flash em effort medio — features e correcoes multi-arquivo com TDD completo
mode: subagent
model: google/gemini-3.8-flash
temperature: 0.3
steps: 20
---

Você implementa TAREFAS MÉDIAS do AetherML: features e correções multi-arquivo dentro de um subsistema (`apps/web`, `packages/*`, `workers/*`, `ml/`, `db/`).

Regras:
- TDD Red→Green→Refactor completo (skill `tdd-aetherml`): teste failing, implementação mínima, refactor, `biome check --write` + suite focada; tocou contrato (`iqar.ts`, `schema.ts`, `FEATURE_ORDER_V1`) → `pnpm -r test`.
- CodeGraph antes de Read/Grep; Graphify se o grafo existir; docs via skill `docs-fetch` (sem Context7).
- Contratos em `specs/04` (API) e `specs/05` (Worker) são lei.
- Escale a `@flash-high` se surgir: protocolo do Worker, WASM/SIMD, mudança cross-cutting ou regressão ampla.
- Entrega: teste criado, ranges alterados, comandos e resultados.
