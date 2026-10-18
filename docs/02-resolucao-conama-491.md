# AetherML — 02 Resolução CONAMA 491/2018 e Cálculo do IQAr

O cálculo do Índice de Qualidade do Ar (IQAr) no AetherML segue rigorosamente a **Resolução CONAMA nº 491, de 19 de novembro de 2018**, que estabelece os padrões nacionais de qualidade do ar no Brasil e as diretrizes adotadas pelo IEMA/ES na Região Metropolitana da Grande Vitória.

---

## 1. Formulação Matemática do Índice Individual

Para cada poluente ($PM_{2.5}, PM_{10}, O_3, NO_2, SO_2$), a pontuação individual $I_p$ é calculada por interpolação linear dentro da faixa de concentração em que a concentração observada ou prevista se enquadra:

$$I_p = I_{ini} + \frac{I_{fim} - I_{ini}}{C_{fim} - C_{ini}} \cdot (C_p - C_{ini})$$

Onde:

- $C_p$: concentração média do poluente (em µg/m³).
- $C_{ini}, C_{fim}$: limites inferior e superior da faixa de concentração.
- $I_{ini}, I_{fim}$: pontuações regulatórias inicial e final da faixa.

---

## 2. Determinação do IQAr Consolidado Global

O índice consolidado da estação ou região é determinado pelo **pior caso** (maior valor) entre todos os poluentes avaliados:

$$IQAr_{global} = \max_{p} \{ I_p \}$$

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

---

## 5. Médias Móveis Regulatórias vs. Estimativa Horária Pontual

A Resolução CONAMA 491/2018 estipula que as concentrações de referência não são valores instantâneos isolados, mas médias temporais móveis padronizadas:

- **24 horas móveis**: $PM_{2.5}$, $PM_{10}$, $SO_2$
- **8 horas móveis**: $O_3$ (e $CO$)
- **1 hora**: $NO_2$

### 5.1 Implementação Canônica (`@aetherml/core-iqar`)

O pacote `@aetherml/core-iqar` fornece as funções canônicas para o cálculo regulatório estrito:

- `REGULATORY_WINDOWS`: dicionário de janelas temporais regulamentares (`pm25: 24`, `pm10: 24`, `so2: 24`, `o3: 8`, `no2: 1`).
- `calculateRegulatoryMovingAverage(series, windowHours)`: calcula a média móvel estrita sobre série horária contígua e válida. Se a série contiver menos horas do que a janela regulatória ou apresentar lacunas temporais, retorna `null` para evitar subestimação ou cálculo espúrio.
- `calculatePollutantMovingAverages(hourlySeries)`: computa a média móvel regulatória para cada poluente suportado.
- `calculateRegulatoryIQAr(hourlySeries)`: avalia o IQAr regulatório a partir das concentrações médias móveis e determina o poluente crítico.

### 5.2 Estimativa Horária Pontual na Interface

Quando um bundle de inferência futura é carregado sem a série observada contígua das 24 horas antecedentes, a interface do usuário exibe uma **estimativa a partir de valores horários do modelo**, com aviso explícito de transparência metodológica:
> *"Estimativa a partir de valores horários do modelo; a CONAMA 491 exige médias móveis (24h/8h)"*

Essa diferenciação protege a integridade científica da plataforma, diferenciando medições regulamentares de previsões pontuais horárias de Machine Learning.

### 5.3 Próxima Etapa de Integração

A evolução planejada para o pipeline de dados consiste em injetar a série histórica recente observada (via banco D1 / rede RAMQAr ou fallback Open-Meteo com `past_days=1`) diretamente no bundle de previsão, permitindo que as funções de média móvel de `@aetherml/core-iqar` calculem o IQAr estritamente regulatório desde a primeira hora do horizonte previsto.
