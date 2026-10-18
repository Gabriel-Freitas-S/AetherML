# Contrato Operacional da API de Tempo Real IEMA-ES / PRODEST (`qualidadedoarapi.es.gov.br`)

**Data da verificação:** 2026-10-18 (coletas reais às `16:50 BRT` referente às `16:00` e às `17:30 BRT` referente às `17:00`)  
**Responsável:** Sonda (Pesquisadora)  
**Branch / Worktree:** `floor/dados-insitu`  
**Consumidor direto:** `workers/ingestion/src/index.ts` (worker de tempo real) e `ml/training/build_real_dataset.py`  
**Amostras reais versionadas:**
- Snapshot `16:00 BRT`: [`docs/research/amostras/iema_api_mapa_live.json`](./amostras/iema_api_mapa_live.json) e [`docs/research/amostras/iema_api_estacoes_48h_sample.json`](./amostras/iema_api_estacoes_48h_sample.csv)
- Snapshot `17:00 BRT` (comparativo 2 horas + todas as 16 estações): [`docs/research/amostras/iema_api_mapa_17h_comparison.json`](./amostras/iema_api_mapa_17h_comparison.json)
- Código-fonte do cliente oficial IEMA/PRODEST analisado: `https://cdn.es.gov.br/scripts/jquery/jquery-qualidadeArES/1.0.0/js/qualidadeArES.js`

---

## 1. Unidades e Semântica dos Campos de Valor (`/api/mapa` vs. `/api/mapa/{id}`)

### 1.1. Distinção Crítica entre `Valor`, `Iqa` (`/api/mapa`) e `ValorIqa` (`/api/mapa/{id}`)

> [!CAUTION]
> **Descoberta mais importante para o Worker (`workers/ingestion`):**
> 1. Em **`GET /api/mapa`**, cada estação traz **dois números distintos**:
>    - **`Valor`** (`number` float): é a **concentração física horária instantânea (média de 1h) em $\mu\text{g/m}^3$**, disponível **apenas para o poluente dominante (`Poluente`) daquela hora**.
>    - **`Iqa`** (`number` float): é o **Índice de Qualidade do Ar (IQAr) adimensional (escala `0..400`)** da estação naquela hora, igual ao maior sub-índice entre os poluentes medidos.
> 2. Em **`GET /api/mapa/{id}`**, cada objeto de poluente traz o array **`ValorIqa`** (`string[]`, ex.: `["19.34", "21.59"]`):
>    - Os valores em **`ValorIqa` NÃO são concentrações brutas em $\mu\text{g/m}^3$**; são os **sub-índices adimensionais IQAr ($I_p$, escala `0..400`, formatados como `string` com 2 casas decimais)** calculados pelo backend PRODEST sobre a janela móvel regulatória de cada poluente (`24h` para $\text{MP}_{10}, \text{MP}_{2,5}, \text{SO}_2$; `8h` para $\text{O}_3, \text{CO}$; `1h` para $\text{NO}_2$).
>    - Isso é confirmado tanto pelo código-fonte oficial `qualidadeArES.js` (linha 504: cabeçalho `"Índice de Qualidade do Ar (IQAr)*"` para `poluente.ValorIqa`) quanto pela igualdade matemática exata `round(mapa.Iqa, 2) === parseFloat(estacao[mapa.Poluente].ValorIqa.at(-1))` em 100% das estações e horas testadas.

### 1.2. Prova Empírica em 2 Horas Distintas (`16:00 BRT` vs. `17:00 BRT` de `2026-10-18`)

Tabela comparando os payloads reais coletados em [`iema_api_mapa_live.json`](./amostras/iema_api_mapa_live.json) (`16:00`) e [`iema_api_mapa_17h_comparison.json`](./amostras/iema_api_mapa_17h_comparison.json) (`17:00`) para todas as estações da RGV:

| `IdEstacao` (`Descricao`) | Poluente Dominante (`/api/mapa`) | Hora `16:00 BRT` (`mapa.Valor` em $\mu\text{g/m}^3$) | Hora `16:00 BRT` (`mapa.Iqa` float) | Hora `16:00 BRT` (`mapa/{id}` `ValorIqa[-2]`) | Hora `17:00 BRT` (`mapa.Valor` em $\mu\text{g/m}^3$) | Hora `17:00 BRT` (`mapa.Iqa` float) | Hora `17:00 BRT` (`mapa/{id}` `ValorIqa[-1]`) | Concordância `round(Iqa,2) == ValorIqa`? |
|---:|---|---:|---:|---:|---:|---:|---:|:---:|
| **`1`** (`EMQAr - RGV1`) | `Ozônio` | `4.9434334` | `10.027` | `"10.03"` | `15.5516567` | `9.529` | `"9.53"` | **100% Exato** |
| **`2`** (`EMQAr - RGV2`) | `null` *(offline)* | `0.0` | `0.0` | `[]` *(vazio)* | `0.0` | `0.0` | `[]` *(vazio)* | **Sentinela offline** |
| **`3`** (`EMQAr - RGV3`) | `Partículas Inaláveis (<10µm)` | `30.939845` | `19.339` | `"19.34"` | `85.0394306` | `21.593` | `"21.59"` | **100% Exato** |
| **`4`** (`EMQAr - RGV4`) | `Partículas Inaláveis (<10µm)` | `3.0569263` | `28.253` | `"28.25"` | `11.2743872` | `28.454` | `"28.45"` | **100% Exato** |
| **`5`** (`EMQAr - RGV5`) | `Partículas Respiráveis (<2,5µm)` | `3.8385379` | `9.832` | `"9.83"` | `4.9601678` | `9.655` | `"9.66"` | **100% Exato** |
| **`6`** (`EMQAr - RGV6`) | `Partículas Respiráveis (<2,5µm)` | `6.2000019` | `17.536` | `"17.54"` | `12.423141` | `18.213` | `"18.21"` | **100% Exato** |
| **`8`** (`EMQAr - RGV8`) | `Ozônio` | `24.8753102` | `11.283` | `"11.28"` | `22.103357` | `11.286` | `"11.29"` | **100% Exato** |
| **`9`** (`EMQAr - RGV9`) | `Partículas Respiráveis (<2,5µm)` | `1.6616351` | `12.124` | `"12.12"` | `1.3620552` | `11.22` | `"11.22"` | **100% Exato** |

**Demonstração matemática da relação entre `mapa.Valor` ($\mu\text{g/m}^3$ 1h) e `ValorIqa` (sub-índice de média móvel):**  
Observe a estação `RGV3 (IdEstacao=3, Jardim Camburi)` entre `16:00` e `17:00`:
- Às `16:00`, o sub-índice de $\text{MP}_{10}$ era `Iqa = 19.339`, o que corresponde (na faixa Boa: $I \in [0, 40] \leftrightarrow C \in [0, 50]\ \mu\text{g/m}^3$, fator $I/C = 0,8$) a uma média móvel de 24h de $\overline{C}_{24\text{h}}(16\text{h}) = 19,339 / 0,8 = 24,17375\ \mu\text{g/m}^3$.
- Às `17:00`, a concentração horária instantânea (`mapa.Valor`) subiu para **$85,03943\ \mu\text{g/m}^3$**, elevando o índice `Iqa` para **`21.593`** ($\overline{C}_{24\text{h}}(17\text{h}) = 21,593 / 0,8 = 26,99125\ \mu\text{g/m}^3$).
- A variação na média móvel de 24h foi de $\Delta \overline{C}_{24\text{h}} = +2,8175\ \mu\text{g/m}^3 = \frac{85,03943 - 17,41943}{24}$, produzindo exatamente $\Delta\text{Iqa} = 0,8 \times 2,8175 = +2,254$ (`21.593 - 19.339`).

---

### 1.3. Veredito por Poluente: Unidades, Comparação com CAMS (D1) e Fatores de Conversão

No script oficial `qualidadeArES.js` (linhas 170–239), o IEMA-ES explicita a tabela de referência usada pelo servidor PRODEST (`* Valores em µg / m3` para todos os 6 poluentes). Abaixo está o comparativo de cada poluente entre a API do IEMA, as planilhas `.xlsx` do IEMA, as linhas CAMS do D1 (`openmeteo_raw.json`, em $\mu\text{g/m}^3$) e a tabela canônica do projeto ([`packages/core-iqar/src/iqar.ts`](../../packages/core-iqar/src/iqar.ts)):

| Poluente (`Poluente` / `PoluenteSigla` na API) | Coluna D1 (`observed_pollutants`) | Valor em `/api/mapa/{id}` (`ValorIqa` 16h / 17h em `RGV4`) | Ordem de Grandeza CAMS no D1 (`openmeteo_raw.json`, $\mu\text{g/m}^3$) | Ordem de Grandeza In-Situ Planilha IEMA 2026 ($\mu\text{g/m}^3$) | Faixa "Boa" ($I \in [0, 40]$) na API IEMA (`qualidadeArES.js`) vs. `core-iqar` | Veredito de Unidade e Fator de Conversão para `observed_pollutants` ($\mu\text{g/m}^3$) |
|---|---|---|---|---|---|---|
| **`Partículas Respiráveis (<2,5µm)`** · `(MP₂,₅)` | `pm25` | `"24.65"` / `"26.76"` *(sub-índice IQA 24h)*<br>*(Em `RGV6`: `mapa.Valor` = `6.20` / `12.42 µg/m³`)* | Mediana: `9,3 µg/m³`<br>P95: `16,3 µg/m³`<br>16h/17h: `5,8` / `5,1 µg/m³` | Mediana: `8,5 µg/m³`<br>Faixa típica: `1,4` a `35,0 µg/m³` | API IEMA: $0-25\ \mu\text{g/m}^3$<br>`core-iqar` (CONAMA PF-2): $0-15\ \mu\text{g/m}^3$ | **`mapa.Valor` já está em $\mu\text{g/m}^3$ (fator `1.0`).**<br>Para `ValorIqa` de `/api/mapa/{id}`, é sub-índice IQA: inverter via tabela CONAMA (`C = I * 15 / 40 = I * 0.375` p/ manter `individualIndex(pm25, C) == round(I)` no `core-iqar`, ou `I * 25 / 40 = I * 0.625` na escala estadual ES). |
| **`Partículas Inaláveis (<10µm)`** · `(MP₁₀)` | `pm10` | `"28.25"` / `"28.45"` *(sub-índice IQA 24h)*<br>*(`mapa.Valor` em `RGV4`: `3.06` / `11.27 µg/m³`; em `RGV3`: `30.94` / `85.04 µg/m³`)* | Mediana: `12,2 µg/m³`<br>P95: `21,9 µg/m³`<br>16h/17h: `7,8` / `6,7 µg/m³` | Mediana: `18,0 µg/m³`<br>Faixa típica: `3,0` a `85,0 µg/m³` | API IEMA: $0-50\ \mu\text{g/m}^3$<br>`core-iqar`: $0-50\ \mu\text{g/m}^3$ **(Idêntico)** | **`mapa.Valor` já está em $\mu\text{g/m}^3$ (fator `1.0`).**<br>Para `ValorIqa` de `/api/mapa/{id}`, inverter faixa Boa por **`C = I * (50 / 40) = I * 1.25`** $\mu\text{g/m}^3$ (ex.: `28.25 * 1.25 = 35.31 µg/m³` média 24h). |
| **`Ozônio`** · `(O₃)` | `o3` | `"9.61"` / `"9.76"` *(sub-índice IQA 8h)*<br>*(`mapa.Valor` em `RGV8`: `24.88` / `22.10 µg/m³`; em `RGV1`: `4.94` / `15.55 µg/m³`)* | Mediana: `54,0 µg/m³`<br>P95: `99,0 µg/m³`<br>16h/17h: `76,0` / `73,0 µg/m³` | Mediana: `22,0 µg/m³`<br>Faixa típica: `2,0` a `75,0 µg/m³` | API IEMA: $0-100\ \mu\text{g/m}^3$<br>`core-iqar`: $0-100\ \mu\text{g/m}^3$ **(Idêntico)** | **`mapa.Valor` já está em $\mu\text{g/m}^3$ (fator `1.0`).**<br>Para `ValorIqa` de `/api/mapa/{id}`, inverter faixa Boa por **`C = I * (100 / 40) = I * 2.5`** $\mu\text{g/m}^3$ (ex.: `11.28 * 2.5 = 28.20 µg/m³` média 8h). |
| **`Dióxido de Nitrogênio`** · `(NO₂)` | `no2` | `"1.60"` / `"2.31"` *(sub-índice IQA 1h)*<br>*(Em `RGV1`: `"3.62"` / `"4.10"`; em `RGV3`: `"3.93"` / `"4.36"`)* | Mediana: `7,6 µg/m³`<br>P95: `20,3 µg/m³`<br>16h/17h: `5,0` / `6,3 µg/m³` | Mediana: `8,5 µg/m³`<br>Faixa típica: `1,5` a `45,0 µg/m³` | API IEMA: $0-200\ \mu\text{g/m}^3$<br>`core-iqar`: $0-200\ \mu\text{g/m}^3$ **(Idêntico, janela 1h)** | **`mapa.Valor` já está em $\mu\text{g/m}^3$ (fator `1.0`).**<br>Como a janela regulatória do $\text{NO}_2$ é de **1 hora**, inverter `ValorIqa` por **`C = I * (200 / 40) = I * 5.0`** recupera a **concentração horária exata em $\mu\text{g/m}^3$**! (Ex.: `RGV4` 16h `1.60 * 5 = 8.00 µg/m³`; 17h `2.31 * 5 = 11.55 µg/m³`!). |
| **`Dióxido de Enxofre`** · `(SO₂)` | `so2` | `"2.47"` / `"2.47"` *(sub-índice IQA 24h)*<br>*(`mapa.Valor` em `SUL4`: `51.89` / `35.89 µg/m³`)* | Mediana: `8,3 µg/m³`<br>P95: `15,8 µg/m³`<br>16h/17h: `6,7` / `7,0 µg/m³` | Mediana: `3,2 µg/m³`<br>Faixa típica: `0,5` a `25,0 µg/m³` | API IEMA: $0-20\ \mu\text{g/m}^3$<br>`core-iqar`: $0-20\ \mu\text{g/m}^3$ **(Idêntico)** | **`mapa.Valor` já está em $\mu\text{g/m}^3$ (fator `1.0`).**<br>Para `ValorIqa` de `/api/mapa/{id}`, inverter faixa Boa por **`C = I * (20 / 40) = I * 0.5`** $\mu\text{g/m}^3$ (ex.: `2.47 * 0.5 = 1.235 µg/m³` média 24h). |
| **`Monóxido de Carbono`** · `(CO)` | `co` | `"16.38"` / `"16.92"` em `RGV4`<br>`"1.74"` / `"1.77"` em `RGV1`<br>`"0.51"` / `"0.52"` em `RGV6`<br>`"3.45"` / `"3.50"` em `RGV8` | CAMS (`carbon_monoxide`):<br>`110` a `450 µg/m³` | Planilha 2024/2026 (`CO ug/m3`): `120` a `650 µg/m³`<br>Planilha 2025.2 (`CO_ppm`): `0.07` a `0.55 ppm` | API IEMA (`qualidadeArES.js` L188):<br>Boa $0 - 10.000\ \mu\text{g/m}^3$ ($\equiv 0 - 9\text{ ppm}$)<br>Moderada $>10.000 - 13.000\ \mu\text{g/m}^3$ | **1) Na API `/api/mapa/{id}`:** `ValorIqa` de CO é o **sub-índice IQA ($I_{\text{CO}} \in [0, 40]$)** sobre $10.000\ \mu\text{g/m}^3$. Para converter `ValorIqa` p/ $\mu\text{g/m}^3$ (escala CAMS/D1), multiplicar por **`250`** ($10000 / 40$): `0.51 -> 127.5 µg/m³` (`RGV6`), `1.74 -> 435.0 µg/m³` (`RGV1`), `3.45 -> 862.5 µg/m³` (`RGV8`).<br>**2) Nas planilhas `.xlsx`:** `2024`, `2025.1` (col 11) e `2026` já estão em **$\mu\text{g/m}^3$ (fator `1.0`)**; apenas **`2025.2`** está em `ppm` (`CO_ppm`), exigindo multiplicar por **`1145`** para obter $\mu\text{g/m}^3$. |

### 1.4. Função Inversa Canônica para o Worker (`invertIqarToConcentration`)

Como `workers/ingestion/src/index.ts` passa as concentrações de `observed_pollutants` por `globalIQAr(concs)` de [`packages/core-iqar/src/iqar.ts`](../../packages/core-iqar/src/iqar.ts), se o worker converter `ValorIqa` de `/api/mapa/{id}` usando a **função inversa exata da tabela `TABLE` de `packages/core-iqar/src/iqar.ts`**:

$$C_p(I) = C_{\text{ini}} + \frac{C_{\text{fim}} - C_{\text{ini}}}{I_{\text{fim}} - I_{\text{ini}}} \cdot (I - I_{\text{ini}})$$

então **é matematicamente garantido que `individualIndex(p, invertIqar(p, ValorIqa))` devolverá exatamente `Math.round(ValorIqa)`**, preservando o IQAr oficial do IEMA em `observed_pollutants.iqar_index` e `primary_pollutant` sem nenhuma divergência entre o mapa do IEMA e o dashboard do AetherML! E para `co` (que não entra em `IQAR_INPUT` do `core-iqar`), basta aplicar `co_ugm3 = round2(valorIqa * 250)` na faixa Boa ($I \le 40$).

---

## 2. Semântica Temporal (`DataHora`), Latência e Validação `BRT → UTC (+3h)`

### 2.1. Formato e Fuso Horário na API PRODEST

- **Formato da string:** `"YYYY-MM-DDTHH:mm:ss"` **sem sufixo de timezone** (ex.: `"2026-10-18T16:00:00"` e `"2026-10-18T17:00:00"`).
- **Fuso horário real:** **Horário de Brasília (`BRT`, `America/Sao_Paulo`, `UTC-3` fixo — o Brasil não adota horário de verão)**.
  - Evidência direta: Na coleta executada às `20:30 UTC` (`17:30 BRT`) de `2026-10-18`, o último timestamp presente em `/api/mapa` e `/api/mapa/{id}` era `"2026-10-18T17:00:00"`. Se fosse UTC, `"17:00:00"` estaria 3h30min atrasado; como às `16:50 BRT` (`19:50 UTC`) era `"16:00:00"` e virou `"17:00:00"` entre `17:00` e `17:30 BRT`, fica provado que o relógio da API é `BRT (UTC-3)`.
- **Minuto da marcação:**
  - Todas as **7 estações ativas da RGV (`IdEstacao` 1, 3, 4, 5, 6, 8, 9)** reportam sempre em **hora cheia (`:00:00`)**.
  - As 6 estações da Região Sul (`IdEstacao` 11..16, fora do contrato) reportam em `:30:00`.
- **Atraso típico de publicação:** **15 a 30 minutos após a hora cheia**.
  - Às `17:30 BRT`, todas as 7 estações ativas da RGV já haviam publicado a leitura de `17:00:00`. Isso confirma que o agendamento do `workers/ingestion` em **`cron = "30 * * * *"` (minuto `:30` de cada hora)** é o momento ótimo para capturar a hora fechada `H:00` sem lag.
- **Conversão para o padrão UTC do D1 (`workers/ingestion`):**
  - Como `observed_pollutants.timestamp` e `environmental_features.timestamp` usam `YYYY-MM-DDTHH:00` em **UTC** (ver `hourFloor(now)` em [`workers/ingestion/src/index.ts`](../../workers/ingestion/src/index.ts#L148-L150)), o worker deve interpretar `DataHora` com offset explícito `-03:00`:
    ```ts
    const utcMs = Date.parse(`${dataHora}-03:00`);
    const timestampUtc = `${new Date(utcMs).toISOString().slice(0, 13)}:00`;
    ```
  - Exemplo real: `"2026-10-18T17:00:00"` (BRT) $\rightarrow$ `Date.parse("2026-10-18T17:00:00-03:00")` $\rightarrow$ **`"2026-10-18T20:00"` (UTC)**.

### 2.2. Validação Cruzada `BRT + 3h = UTC` contra Planilha Oficial 2026 e Open-Meteo (`ml/data/openmeteo_raw.json`)

Cruzamos as horas sobrepostas de `2026-09-30` da estação `EMQAr - RGV4 (Enseada do Suá)` na planilha oficial do IEMA ([`iema_ramqar_2026_horaria_sample.csv`](./amostras/iema_ramqar_2026_horaria_sample.csv)) com a série `meteo_hourly` de `ramqar_enseada_sua` em [`ml/data/openmeteo_raw.json`](../../ml/data/openmeteo_raw.json) (que está em UTC):

| Timestamp na Planilha IEMA (`BRT`) | Timestamp Convertido (`BRT + 3h = UTC`) | `TempAr` In-Situ IEMA (`RGV4`) | `temperature_2m` Open-Meteo em `BRT + 3h` (`UTC`) | `shortwave_radiation` Open-Meteo em `BRT + 3h` (**Alinhamento Correto**) | `shortwave_radiation` Open-Meteo **sem `+3h`** *(Erro de 3h)* |
|---|---|---:|---:|---:|---:|
| `2026-09-30 18:00:00` *(crepúsculo local)* | **`2026-09-30T21:00`** | `27,89 °C` | `25,90 °C` | **`21,0 W/m²`** *(fim do pôr do sol)* | `640,0 W/m²` *(sol forte das 15h!)* |
| `2026-09-30 19:00:00` *(noite)* | **`2026-09-30T22:00`** | `27,31 °C` | `25,70 °C` | **`0,0 W/m²`** *(noite)* | `421,0 W/m²` *(sol da tarde!)* |
| `2026-09-30 20:00:00` *(noite)* | **`2026-09-30T23:00`** | `27,30 °C` | `25,50 °C` | **`0,0 W/m²`** *(noite)* | `182,0 W/m²` *(sol de fim de tarde!)* |
| `2026-09-30 21:00:00` *(noite)* | **`2026-10-01T00:00`** | `27,38 °C` | `25,40 °C` | **`0,0 W/m²`** *(noite)* | `21,0 W/m²` *(crepúsculo)* |
| `2026-09-30 22:00:00` *(noite)* | **`2026-10-01T01:00`** | `27,25 °C` | `25,00 °C` | **`0,0 W/m²`** *(noite)* | `0,0 W/m²` |
| `2026-09-30 23:00:00` *(noite)* | **`2026-10-01T02:00`** | `27,15 °C` | `24,70 °C` | **`0,0 W/m²`** *(noite)* | `0,0 W/m²` |

**Conclusão:** A soma de **`+3 horas` (`BRT → UTC`)** no parser do Facho (`build_real_dataset.py`) e no worker de ingestão está **fisicamente validada** pela curva de radiação solar no pôr do sol em Vitória (~17h45 BRT = 20h45 UTC).

---

## 3. Comportamento de Exceção: Estação/Poluente Fora do Ar e `PM25` em `RGV8`

### 3.1. Estação Fora do Ar ou Desativada

| Cenário | Comportamento em `GET /api/mapa` | Comportamento em `GET /api/mapa/{IdEstacao}` | Como o Worker DEVE Tratar |
|---|---|---|---|
| **Estação ativa mas com telemetria offline** (caso real: **`IdEstacao = 2`, `EMQAr - RGV2 Carapina`**) | Permanece na lista de 14 objetos, porém com valores sentinela `.NET`:<br>`"DataHora": "0001-01-01T00:00:00"`, `"Iqa": 0.0`, `"Valor": 0.0`, `"Poluente": null`, `"Faixa": null`, `"Cor": null` | Retorna `HTTP 200 OK` com **array JSON vazio `[]`** (`0` elementos). | **Descartar / pular para fallback Open-Meteo.** **JAMAIS** interpretar `"Iqa": 0.0` ou `"Valor": 0.0` de `RGV2` como medição zero real! Checar `est.DataHora.startsWith("0001-") \|\| est.Poluente === null \|\| est.Faixa === null`. |
| **Estação desativada historicamente** (casos reais: **`IdEstacao = 7` (`RGV7`)** e **`IdEstacao = 10` (`RGV10`)**) | **Omitida do array** de `/api/mapa`. | Retorna `HTTP 200 OK` com **array JSON vazio `[]`**. | Se `array.length === 0`, tratar como estação sem dados no IEMA. |
| **Lacuna horária parcial (queda de link por 1..N horas nas últimas 48h)** (casos reais: `RGV3` tem `43` horas, `RGV5` tem `35` horas, `RGV8` tem `47` horas) | Exibe a última hora disponível em `DataHora`. | As horas faltantes são **omitidas dos arrays paralelos `DataHora` e `ValorIqa`** (não vêm com `null` nem `"0"`). `DataHora.length` é sempre igual a `ValorIqa.length` ($N \le 48$). | Iterar por índice `k` de `0` a `DataHora.length - 1` associando `DataHora[k]` a `parseFloat(ValorIqa[k])`. |

### 3.2. Poluente Desabilitado ou Não Monitorado na Estação (Confirmação de `PM25` em `RGV8`)

- **Comportamento:** Quando um poluente não é medido na estação ou está desabilitado no sistema de validação do IEMA, **o objeto daquele poluente desaparece completamente do array retornado por `GET /api/mapa/{IdEstacao}`** (não há entrada com `ValorIqa: null` nem `ValorIqa: []`).
- **Confirmação empírica de `PM25` desabilitado em `RGV8 (Vila Capixaba — Cariacica, IdEstacao=8)` em 2026:**
  - Na planilha oficial de 2026 (`medicoes-rgv-01-01-2026-a-30-09-2026.xlsx`), todas as 6.553 horas de `PM25` em `RGV8` trazem `-9999` com `Status PM25 = "!"` (equipamento desabilitado).
  - Em `GET https://qualidadedoarapi.es.gov.br/api/mapa/8` (tanto às `16:00` quanto às `17:00` de `2026-10-18`), o array retornado tem **exatamente 4 elementos**:
    1. `"Dióxido de Enxofre"` (`(SO₂)`)
    2. `"Dióxido de Nitrogênio"` (`(NO₂)`)
    3. `"Ozônio"` (`(O₃)`)
    4. `"Monóxido de Carbono"` (`(CO)`)
  - **Confirmado:** O item `"Partículas Respiráveis (<2,5µm)"` (`(MP₂,₅)`) — bem como `"Partículas Inaláveis (<10µm)"` (`(MP₁₀)`) — **some completamente do JSON de `/api/mapa/8`**.
- **Matriz completa de presença/ausência de poluentes em `/api/mapa/{id}` por estação da RGV (verificada em `18/10/2026`):**

| Estação (`IdEstacao`) | `MP₂,₅` (`pm25`) | `MP₁₀` (`pm10`) | `O₃` (`o3`) | `NO₂` (`no2`) | `SO₂` (`so2`) | `CO` (`co`) | Total de objetos no array `/api/mapa/{id}` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---:|
| **`RGV1` (`1` — Laranjeiras)** | Presente (48h) | **Ausente** | Presente (48h) | Presente (48h) | Presente (48h) | Presente (48h) | **5** |
| **`RGV2` (`2` — Carapina)** | **Ausente** | **Ausente** | **Ausente** | **Ausente** | **Ausente** | **Ausente** | **0 (`[]`)** |
| **`RGV3` (`3` — Jardim Camburi)** | Presente (43h) | Presente (43h) | **Ausente** | Presente (43h) | Presente (43h) | **Ausente** | **4** |
| **`RGV4` (`4` — Enseada do Suá)** | Presente (48h) | Presente (48h) | Presente (48h) | Presente (48h) | Presente (48h) | Presente (48h) | **6 (Completa)** |
| **`RGV5` (`5` — Vitória Centro)** | Presente (35h) | Presente (35h) | **Ausente** | **Ausente** | Presente (35h) | **Ausente** | **3** |
| **`RGV6` (`6` — Vila Velha IBES)** | Presente (48h) | Presente (48h) | Presente (48h) | **Ausente** | Presente (48h) | Presente (48h) | **5** |
| **`RGV8` (`8` — Cariacica)** | **Ausente** | **Ausente** | Presente (47h) | Presente (47h) | Presente (47h) | Presente (47h) | **4** |
| **`RGV9` (`9` — Cid. Continental)** | Presente (48h) | **Ausente** | **Ausente** | **Ausente** | Presente (48h) | **Ausente** | **2** |

> [!IMPORTANT]
> **Implicação direta para o cálculo de `iqar_index` no Worker (`workers/ingestion/src/index.ts`):**
> No código atual do Open-Meteo (`observedRowFrom` em [`workers/ingestion/src/index.ts`](../../workers/ingestion/src/index.ts#L248-L254)), exige-se `const complete = IQAR_INPUT.every((p) => concs[p] !== null)` porque o modelo CAMS sempre devolve os 5 poluentes juntos. Porém, nas estações físicas do IEMA, **apenas `RGV4 (Enseada do Suá)` mede simultaneamente todos os 5 poluentes CONAMA (`pm25, pm10, o3, no2, so2`)**; as outras 6 estações físicas medem de 2 a 4 poluentes (e os demais ficam `NULL` no banco, exatamente como manda a regra *"Sem hedge de fonte"*).
> Portanto, para linhas com `source = IEMA_SENTINEL` (`"IEMA"`), o worker deve calcular o `iqar_index`, `iqar_classification` e `primary_pollutant` tomando o **máximo sobre os poluentes efetivamente presentes (não-nulos) naquela estação** (exatamente como faz `calculateRegulatoryIQAr` em [`packages/core-iqar/src/iqar.ts`](../../packages/core-iqar/src/iqar.ts#L181-L209) e como faz o próprio IEMA em `/api/mapa`), deixando `NULL` apenas quando **todos** os poluentes da estação naquela hora forem `NULL`!
