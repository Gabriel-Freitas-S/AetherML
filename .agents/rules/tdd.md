# TDD — regra obrigatória AetherML

Vale para OpenCode e Antigravity, todo código (`apps/`, `packages/`, `workers/`, `ml/`, `db/`).

## Ciclo Red → Green → Refactor
1. **Red**: escrever o teste failing primeiro, colocated (`*.test.ts` p/ TS, `test_*.py` p/ `ml/`). Rodar a suite focada e CONFIRMAR o vermelho.
2. **Green**: implementação mínima p/ passar. Sem refactor junto.
3. **Refactor**: limpar duplicação, mantendo verde. Rodar `biome check --write` (TS) ou `ruff check --fix` (`ml/`) + suite focada.
4. Só então rodar a suite ampla (`pnpm -r test`) se o change tocou contrato compartilhado (`iqar.ts`, `schema.ts`, `FEATURE_ORDER_V1`).

## Comandos
- Focado: `pnpm --filter <pkg> test <arquivo>` · Amplo: `pnpm -r test` · Lint: `biome check --write ./apps ./packages ./workers`
- DB: validar migração em D1 local — `wrangler d1 migrations apply aetherml-db --local` antes de qualquer seed/query nova.

## Gates por área
- `core-iqar`: casos de borda CONAMA (limites de faixa, `c=0`, saturação Péssima) + `global = max(I_p)` com primário correto.
- `geo`: Haversine contra distância conhecida (ex.: Camburi↔Enseada do Suá), `R=6371km`.
- Worker/WASM: contrato de mensagens (`init/predict/simulate`, `result/error`) com sessão mockada — nunca exigir GPU/R2 real no teste.
- API: códigos de erro do contrato (`BAD_STATION`, `STALE_MODEL`, etc. em `specs/04`).
- Nenhum teste pode depender de rede (RAMQAr, Open-Meteo, R2) — usar fixtures em `specs/`/`db/seed.sql`.

## Skill e workflow
- Skill `tdd-aetherml`: checklist executável do ciclo. Workflow Antigravity `/tdd-feature`: aplica este ciclo a uma feature inteira.
