---
description: Implementa uma feature AetherML completa pelo ciclo TDD Red-Green-Refactor, do teste failing ao biome mais suite focada.
---

# /tdd-feature

Workflow TDD p/ features (usa skill `tdd-aetherml` + `.agents/rules/tdd.md`).

## Passos
1. **Escopo**: listar comportamento esperado, arquivos (`apps/`/`packages/`/`workers/`/`ml/`/`db/`) e o teste colocated a criar. Confirmar com o usuário se o escopo tocar `iqar.ts`, `schema.ts` ou `FEATURE_ORDER_V1` (contrato).
2. **Red**: escrever o teste failing mínimo, rodar a suite focada, mostrar o vermelho.
3. **Green**: implementação mínima até o verde. Sem extras.
4. **Refactor**: limpar com verde, rodar `biome check --write` (TS) / `ruff check --fix` (`ml/`), re-rodar suite focada.
5. **Contrato?** Se sim, `pnpm -r test` + checar `specs/` impactadas (`04` p/ API, `03` p/ dados, `05` p/ Worker).
6. **Entrega**: teste criado, ranges alterados, comandos e resultados. Sem teste, sem merge.
