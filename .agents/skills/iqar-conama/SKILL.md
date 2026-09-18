---
name: iqar-conama
description: Calcula e valida o IQAr CONAMA 491/2018 do AetherML, indice individual por poluente e global maximo com classificacao e poluente primario.
---

# IQAr CONAMA 491/2018

Implementação canônica: `packages/core-iqar/src/iqar.ts`. Tabela de faixas: `specs/03-modelo-dados.md`.

## Fórmulas (nunca trocar)
- Individual: `I_p = I_ini + (I_fim-I_ini)/(C_fim-C_ini) * (C_p-C_ini)`, arredondar p/ inteiro.
- Global: `IQAr_global = max_p{I_p}`; classificação e `primary_pollutant` vêm do poluente vencedor.
- `c < 0` → clamp p/ 0. Faixa Péssima satura em 300 (UI).

## Quando usar
- Qualquer cálculo, exibição, teste ou log de IQAr (cliente, Worker, API, `prediction_logs`, `weekly_evaluations`).
- Proibido reimplementar a tabela em outro arquivo — importar de `core-iqar`.

## Checklist TDD
- Casos de borda por poluente: `c=0`, limites `cIni/cFim` de cada faixa, saturação.
- Global: empate e vitória por poluente diferente (ex.: `pm25=20→~60` perde p/ `o3=140→~94`).
- `db/seed.sql` nunca carrega IQAr calculado no seed — só estações.
