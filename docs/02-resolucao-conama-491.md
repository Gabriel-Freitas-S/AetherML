# AetherML — 02 Resolução CONAMA 491/2018 e Cálculo do IQAr

O cálculo do Índice de Qualidade do Ar (IQAr) no AetherML segue rigorosamente a **Resolução CONAMA nº 491, de 19 de novembro de 2018**, que estabelece os padrões nacionais de qualidade do ar no Brasil e as diretrizes adotadas pelo IEMA/ES na Região Metropolitana da Grande Vitória.

---

## 1. Formulação Matemática do Índice Individual

Para cada poluente (PM2.5, PM10, O3, NO2, SO2), a pontuação individual é calculada por interpolação linear dentro da faixa de concentração em que a concentração observada ou prevista se enquadra:

`I = I_ini + (I_fim - I_ini) / (C_fim - C_ini) * (C - C_ini)`

Onde:

- `C`: concentração média do poluente (em µg/m³).
- `C_ini, C_fim`: limites inferior e superior da faixa de concentração.
- `I_ini, I_fim`: pontuações regulatórias inicial e final da faixa.

---

## 2. Determinação do IQAr Consolidado Global

O índice consolidado da estação ou região é determinado pelo **pior caso** entre todos os poluentes avaliados:

`IQAr_global = max(I_p)`

O poluente associado ao maior valor é o **Poluente Crítico Primário**.

---

## 3. Tabela Regulamentar de Faixas e Limiares

| Faixa Qualitativa | Pontuação | PM2.5 (24h) | PM10 (24h) | O3 (8h) | NO2 (1h) | SO2 (24h) | Unidade |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Boa** | 0 a 40 | 0 a 15 | 0 a 50 | 0 a 100 | 0 a 200 | 0 a 20 | µg/m³ |
| **Moderada** | 41 a 80 | 15 a 25 | 50 a 100 | 100 a 130 | 200 a 240 | 20 a 40 | µg/m³ |
| **Ruim** | 81 a 120 | 25 a 50 | 100 a 150 | 130 a 160 | 240 a 320 | 40 a 365 | µg/m³ |
| **Muito Ruim** | 121 a 200 | 50 a 75 | 150 a 250 | 160 a 200 | 320 a 1130 | 365 a 800 | µg/m³ |
| **Péssima** | acima de 200 | acima de 75 | acima de 250 | acima de 200 | acima de 1130 | acima de 800 | µg/m³ |

---

## 4. Prescrições de Saúde Pública por Faixa

- **Faixa Boa (0 a 40)**:
  - *Recomendação*: A qualidade do ar é considerada ideal para todas as atividades humanas e recreativas ao ar livre.
- **Faixa Moderada (41 a 80)**:
  - *Recomendação*: Pessoas de grupos de sensibilidade respiratória ou cardiovascular aguda (crianças, idosos, asmáticos) podem apresentar sintomas leves como tosse seca e cansaço.
- **Faixa Ruim (81 a 120)**:
  - *Alerta Proativo*: Grupos de risco devem evitar atividades físicas intensas ao ar livre. População geral pode apresentar leve irritação nos olhos e garganta.
- **Faixa Muito Ruim (121 a 200) e Péssima (> 200)**:
  - *Alerta Sanitário Crítico*: Toda a população deve reduzir drasticamente atividades externas, manter ambientes fechados e ventilados com filtros de ar e evitar a exposição em horários de pico.
