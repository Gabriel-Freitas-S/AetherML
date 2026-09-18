---
name: tdd-aetherml
description: Aplica o ciclo TDD Red-Green-Refactor do AetherML a qualquer change em apps, packages, workers, ml ou db, com suites focadas e gates por area.
---

# TDD AetherML

Staging: esta skill complementa `.agents/rules/tdd.md` (obrigatório). Quando o pedido for implementar/corrigir algo, executar nesta ordem e parar se um passo falhar.

## 1. Escopo (2 min)
- Identificar arquivos e o teste colocated a criar (`*.test.ts`, `test_*.py`).
- Se tocar `iqar.ts`, `schema.ts` ou `FEATURE_ORDER_V1`, marcar como change de contrato (exige suite ampla no fim).

## 2. Red
- Escrever o teste failing mínimo (1 asserção do comportamento pedido).
- Rodar a suite focada (`pnpm --filter <pkg> test <arquivo>`) e mostrar o vermelho. Sem vermelho confirmado, não avançar.

## 3. Green
- Implementação mínima p/ passar. Nada de refactor, nada de extra.
- Re-rodar a suite focada → verde.

## 4. Refactor + lint
- Limpar só com verde. `biome check --write` (TS) / `ruff check --fix` (`ml/`).
- Re-rodar suite focada. Change de contrato → `pnpm -r test`.

## 5. Entrega
- Resumir: teste criado, arquivos alterados (ranges), comandos rodados e resultado. Sem teste, sem entrega.
