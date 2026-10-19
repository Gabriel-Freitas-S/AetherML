# Pesquisa e Validação de Fontes de Dados In-Situ (Qualidade do Ar RMGV)

**Data da investigação:** 2026-10-18  
**Responsável:** Sonda (Pesquisadora)  
**Branch / Worktree:** `floor/dados-insitu`  
**Referências normativas:** [`db/seed.sql`](../../db/seed.sql), [`specs/08-pipeline-ml-roadmap.md`](../../specs/08-pipeline-ml-roadmap.md) (§2 — Transição MOS), [`docs/09-dados-reais-backtest.md`](../09-dados-reais-backtest.md) (§1.1 — Circularidade CAMS / BUG-05)  
**Amostras reais salvas em:** [`docs/research/amostras/`](./amostras/)

---

## 1. Resumo Executivo e Evidência de Diferenciação Entre Estações

O diagnóstico do Maestro foi integralmente confirmado e destravado: enquanto o produto regional CAMS (via Open-Meteo, grade de ~0,4° / ~40 km) devolve valores idênticos para todas as 9 estações da Região Metropolitana da Grande Vitória (RMGV), **o IEMA-ES (Instituto Estadual de Meio Ambiente e Recursos Hídricos) opera e publica dados físicos *in-situ* horários individualizados por estação através de duas vias públicas, abertas e sem necessidade de chave de API**:

1. **API REST JSON em Tempo Real (PRODEST / IEMA-ES):**
   - `GET https://qualidadedoarapi.es.gov.br/api/mapa` — retorna o estado atual de todas as estações ativas (RGV1 a RGV9 + SUL1 a SUL6), com coordenadas oficiais, `IdEstacao`, `DataHora` (horário local UTC-3), `Iqa`, `Faixa`, `Poluente` dominante e `Valor` (concentração física medida).
   - `GET https://qualidadedoarapi.es.gov.br/api/mapa/{IdEstacao}` — retorna a série horária das **últimas 48 horas** para cada poluente monitorado na estação (`SO₂`, `CO`, `O₃`, `NO₂`, `MP₂,₅`, `MP₁₀`).
2. **Planilhas Horárias Históricas Validadas (IEMA-ES, 2001 a Setembro/2026):**
   - Publicadas diretamente em `https://iema.es.gov.br/qualidadedoar/dadosdemonitoramento/automatica`, incluindo o arquivo de 2026 (`https://iema.es.gov.br/media/CQAI/medicoes-rgv-01-01-2026-a-30-09-2026.xlsx`, 6,37 MB, 6.553 horas de `2026-01-01 00:00` a `2026-09-30 23:00`), os dois semestres de 2025 e os arquivos anuais de 2001 a 2024.
   - Contêm **concentrações horárias brutas em $\mu\text{g/m}^3$** (`PM25`, `PM10`, `O3`, `NO2`, `NO`, `NOX`, `SO2`, `CO`) **mais meteorologia medida na própria torre de cada estação** (`TempAr`, `RH`, `VelVento`, `DirVento`, `Rain`, `Radiação`, `Press_Ar`) e **flags de controle de qualidade** (`VU`, `VI`, `IU`, `IT`, `ID`, `!`).

### Prova empírica de diferenciação espacial na RMGV (medições reais coletadas em 18/10/2026 às 16h00 BRT)

Dados extraídos de [`docs/research/amostras/iema_api_mapa_live.json`](./amostras/iema_api_mapa_live.json) e [`docs/research/amostras/iema_api_estacoes_48h_sample.json`](./amostras/iema_api_estacoes_48h_sample.json):

| Estação IEMA (`IdEstacao`) | Bairro / Município | `DataHora` | IQAr Geral | Poluente Dominante (`Valor` medido) | Sub-índice `MP₂,₅` (16h) | Sub-índice `MP₁₀` (16h) | Sub-índice `NO₂` (16h) | Sub-índice `O₃` (16h) |
|---|---|---|---|---|---:|---:|---:|---:|
| **EMQAr - RGV1** (`1`) | Laranjeiras / Serra | `2026-10-18T16:00:00` | **10,03** (Boa) | O₃ (`4,94 µg/m³`) | 5,25 | — | 3,62 | 10,03 |
| **EMQAr - RGV3** (`3`) | Jardim Camburi / Vitória | `2026-10-18T16:00:00` | **19,34** (Boa) | MP₁₀ (`30,94 µg/m³`) | 4,51 | 19,34 | 3,93 | — |
| **EMQAr - RGV4** (`4`) | Enseada do Suá / Vitória | `2026-10-18T16:00:00` | **28,25** (Boa) | MP₁₀ (`3,06*` / IQA `28,25`) | **24,65** (pico 41,22 Moderada em 17/10 16h) | **28,25** | 1,60 | 9,61 |
| **EMQAr - RGV5** (`5`) | Centro / Vitória | `2026-10-18T16:00:00` | **9,83** (Boa) | MP₂,₅ (`3,84 µg/m³`) | 9,83 | 3,78 | — | — |
| **EMQAr - RGV6** (`6`) | IBES / Vila Velha | `2026-10-18T16:00:00` | **17,54** (Boa) | MP₂,₅ (`6,20 µg/m³`) | 17,54 | 15,82 | 1,61 | 9,38 |
| **EMQAr - RGV8** (`8`) | Vila Capixaba / Cariacica | `2026-10-18T16:00:00` | **11,28** (Boa) | O₃ (`24,88 µg/m³`) | — | — | 5,24 | 11,28 |
| **EMQAr - RGV9** (`9`) | Cidade Continental / Serra | `2026-10-18T16:00:00` | **12,12** (Boa) | MP₂,₅ (`1,66 µg/m³`) | 12,12 | 9,74 | 1,35 | — |

---

## 2. Quadro Comparativo Geral das Fontes Investigadas

| Fonte | Endpoint / URL Testada | Status HTTP | Cobertura RMGV (9 estações) | Granularidade | Histórico Disponível | Autenticação | Licença / ToS | Recomendação AetherML |
|---|---|---|---|---|---|---|---|---|
| **IEMA-ES API Tempo Real (PRODEST)** | `https://qualidadedoarapi.es.gov.br/api/mapa` e `/api/mapa/{id}` | **200 OK** | **7/8 ativas na RGV** (`RGV1..RGV9`, exceto `RGV2` s/ telemetria no momento e `RGV7`/`RGV10` desativadas) + 6 Sul | **Horária** (janela móvel de 48h) | Últimas 48 horas | **Nenhuma** (pública, CORS aberto) | Dados Abertos Gov-ES (LAI 12.527/2011 / Lei 14.850/2024) | **PRIMÁRIA (Tempo Real / Worker Ingestion)** |
| **IEMA-ES Planilhas Horárias RAMQAr** | `https://iema.es.gov.br/media/CQAI/medicoes-rgv-01-01-2026-a-30-09-2026.xlsx` (+ 2001–2025) | **200 OK** | **8 estações RGV** (`RGV1, RGV2, RGV3, RGV4, RGV5, RGV6, RGV8, RGV9`) + 6 Sul + 4 Norte | **Horária** (concentração $\mu\text{g/m}^3$ + meteo in-situ) | **2001 a 30/09/2026** (25 anos) | **Nenhuma** (download direto HTTPS) | Dados Públicos IEMA-ES / CC0 | **PRIMÁRIA (Treino e Backtest MOS)** |
| **MMA MonitorAr (Dados Abertos Gov Federal)** | `https://dados.mma.gov.br/api/3/action/package_show?id=ar-puro-monitorar` (`dados_monitorar_2025.zip`) | **200 OK** | **8 estações RGV** (`RGV1..6, 8, 9` + `RGV10` Ponta Formosa) + 6 Sul | **Horária** (`nu_concentracao` + `nu_iqar` em CSV) | **2022 a 2025** (arquivos anuais ZIP/CSV) | **Nenhuma** (CKAN aberto) | **CC-BY** (Creative Commons Atribuição) | **SECUNDÁRIA (Backfill Histórico Padronizado CSV)** |
| **Portal Dados Abertos ES (`dados.es.gov.br`)** | `https://dados.es.gov.br/api/3/action/package_show?id=rede-de-monitoramento-da-qualidade-do-ar-regiao-grande-vitoria` | **200 OK** | 11 pontos da Rede Manual de Poeira Sedimentável (`PMPS - RGV 1..11`) | Apenas cadastro de coordenadas no CSV atual | Criado em 2022, atualizado em maio/2026 | **Nenhuma** (CKAN API v3) | **CC0** (Creative Commons CCZero) | Auxiliar (validação de coordenadas oficiais das estações) |
| **OpenAQ (v3 REST + Vector Tiles + S3 AWS)** | `https://api.openaq.org/v3/locations` (401) / `https://tiles.openaq.org/locations/tiles/8/99/142.pbf` (200) / `https://openaq-data-archive.s3.amazonaws.com/` (200) | **401** (v3 s/ key) / **200 OK** (Tiles + S3) | **0/9 estações IEMA**. Apenas 3 sensores low-cost AirGradient (`Quality01`, `Quality02`, `teste1`) em Jardim da Penha/Camburi, **inativos desde 30/01/2026** | Horária nos CSV.gz do S3 | Out/2024 (2 dias) e Nov/2025–Jan/2026 (69 dias) | API v3 exige `X-API-Key`; S3 AWS é público s/ key | Termos próprios OpenAQ (proíbe competir com OpenAQ usando API hospedada) | **Descartada** (não possui estações IEMA e sensores locais estão inativos) |
| **INMET (Meteorologia Oficial)** | `https://apitempo.inmet.gov.br/estacoes/T` e `https://portal.inmet.gov.br/uploads/dadoshistoricos/2026.zip` | **200 OK** | 2 estações na RMGV: `A612` (Vitória/UFES, **Operante**) e `A634` (Vila Velha, **Em Pane**). Apenas meteorologia (não mede AQ) | **Horária** (UTC) | 2000 a Outubro/2026 | `portal.inmet.gov.br` (ZIP): **Nenhuma**; API tempo real requer token | Dados Abertos Gov Federal (PDA INMET) | **SECUNDÁRIA (Covariáveis Meteorológicas Sinóticas)** |
| **sensor.community (Luftdaten)** | `https://data.sensor.community/airrohr/v1/filter/box=-20.5,-40.6,-20.0,-40.1` e `/filter/country=BR` | **200 OK** | **0/9 estações** (`[]` na RMGV e 0 no ES; 18 locais no Brasil restritos a RS/SC/PR/SP) | ~2,5 min (tempo real) / diária (arquivo) | Desde 2015 (onde há sensores) | **Nenhuma** | DbCL 1.0 / ODbL | **Descartada** (zero cobertura no ES) |
| **IQAir (AirVisual)** | `https://api.airvisual.com/v2/nearest_city?lat=-20.3125&lon=-40.2870` e `https://www.iqair.com/air-quality/brazil/espirito-santo/vitoria` | **400** (API s/ key) / **200 OK** (Web) | **0/9 estações físicas** (`No locations are available`; exibe apenas `53 *` modelado por satélite) | Horária (estimativa modelada) | Sem histórico in-situ aberto | Exige API key (`key=`) | Proprietária (Community Tier proíbe treino de ML/redistribuição) | **Descartada** (sem sensores físicos em Vitória + licença restritiva) |
| **PurpleAir** | `https://api.purpleair.com/v1/sensors?fields=name,latitude,longitude&nwlat=-20.0&nwlng=-40.6&selat=-20.5&selng=-40.1` | **403** (`ApiKeyMissingError`) | **0/9 estações RAMQAr** (rede privada de sensores ópticos `PMS5003`, apenas PM) | 2 min / horária | Cobrado por pontos por chamada | Exige `X-API-Key` + saldo de pontos pagos | Proprietária / Comercial restrita | **Descartada** (paga por pontos, exige chave e não mede gases O₃/NO₂/SO₂/CO) |
| **Dados Abertos Municipais (Vitória, Vila Velha, Serra, Cariacica)** | `https://geoweb.vitoria.es.gov.br/api/feed/dcat-us/1.1.json`, `https://wstransparencia.vitoria.es.gov.br/`, `https://transparencia.vilavelha.es.gov.br/DadosAbertos.Lista.aspx`, `http://transparencia.serra.es.gov.br/`, `https://transparencia.cariacica.es.gov.br/` | **200 OK** | **0/9 estações** (municípios não operam rede automática própria; competência estadual do IEMA) | N/A | N/A | Nenhuma | CC0 / LAI Municipal | **Descartada** (apenas dados administrativo-financeiros e geobases urbanas) |

---

## 3. Análise Detalhada por Fonte Testada

### 3.1. IEMA-ES — API REST em Tempo Real (`qualidadedoarapi.es.gov.br`)

Desenvolvida pelo PRODEST em parceria com o IEMA-ES para alimentar o painel oficial (`https://iema.es.gov.br/qualidadedoar` e `https://iema.es.gov.br/qualidadedoar/boletim`), documentada no script oficial `https://cdn.es.gov.br/scripts/jquery/jquery-qualidadeArES/1.0.0/js/qualidadeArES.js`.

- **Endpoints Exatos Testados:**
  1. `GET https://qualidadedoarapi.es.gov.br/api/mapa` (HTTP 200)
     - Retorna JSON com 14 estações (`EMQAr - RGV1..RGV6, RGV8, RGV9` e `EMQAr - SUL1..SUL6`).
     - Campos por estação: `IdEstacao` (int), `Descricao` (`"EMQAr - RGV4"`), `Localizacao` (`"Enseada do Suá"`), `Latitude`, `Longitude`, `DataHora` (ISO local, ex.: `"2026-10-18T16:00:00"`), `Iqa` (float), `Valor` (float, concentração do poluente dominante), `Poluente` (string), `Faixa` (`"Boa"`, `"Moderada"`, etc.), `Cor` (hex).
  2. `GET https://qualidadedoarapi.es.gov.br/api/mapa/{IdEstacao}` (HTTP 200, testado para `IdEstacao` = `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12`)
     - Retorna array JSON por poluente medido na estação (`Dióxido de Enxofre (SO₂)`, `Monóxido de Carbono (CO)`, `Ozônio (O₃)`, `Dióxido de Nitrogênio (NO₂)`, `Partículas Respiráveis (<2,5µm) (MP₂,₅)`, `Partículas Inaláveis (<10µm) (MP₁₀)`).
     - Cada objeto traz `DataHora` (array com as últimas **48 horas**), `ValorIqa` (array com os 48 valores horários do sub-índice IQA daquele poluente), `Min`, `Max`, `Cor` e `FaixaIQA`.
- **Amostras Reais Salvas:**
  - [`docs/research/amostras/iema_api_mapa_live.json`](./amostras/iema_api_mapa_live.json) (`16:00 BRT`)
  - [`docs/research/amostras/iema_api_estacoes_48h_sample.json`](./amostras/iema_api_estacoes_48h_sample.json) (`16:00 BRT`)
  - [`docs/research/amostras/iema_api_mapa_17h_comparison.json`](./amostras/iema_api_mapa_17h_comparison.json) (`17:00 BRT` — comparativo de 2 horas distintas e todas as 16 estações)
- **Especificação Completa do Contrato Operacional (Unidades, Fatores de Conversão, Fuso `BRT → UTC +3h` e Tratamento de Exceções):** ver documento dedicado **[`docs/research/iema-api-contrato-operacional.md`](./iema-api-contrato-operacional.md)**.
- **Granularidade e Latência:** Horária (`:00` nas estações RGV, `:30` nas estações SUL). Na coleta às `16:48 BRT` (`16:00`) e às `17:30 BRT` (`17:00`) de `18/10/2026`, todas as estações RGV ativas já reportavam a hora fechada (latência típica de 15 a 30 minutos).
- **Autenticação, Licença e Limites:** Sem autenticação, cabeçalho `Access-Control-Allow-Origin: *` habilitado, amparado pela Lei Federal nº 14.850/2024 (Política Nacional de Qualidade do Ar) e Lei de Acesso à Informação.
- **Riscos e Observações Técnicas:**
  - O endpoint `/api/mapa/{IdEstacao}` retorna o **sub-índice `ValorIqa`** de cada poluente nas últimas 48h, enquanto `/api/mapa` retorna `Valor` (concentração horária em $\mu\text{g/m}^3$) apenas para o poluente dominante da hora atual e `Iqa` (índice adimensional `0..400`, que concorda 100% com `round(Iqa, 2) == ValorIqa[-1]`). A tabela de inversão por poluente, a regra de cálculo de `iqar_index` com subconjunto de poluentes medidos e os sentinelas de estação offline (`DataHora: "0001-01-01T00:00:00"` em `RGV2`) estão detalhados em [`docs/research/iema-api-contrato-operacional.md`](./iema-api-contrato-operacional.md).


---

### 3.2. IEMA-ES — Planilhas Horárias Históricas Validadas (`iema.es.gov.br`)

Página oficial: `https://iema.es.gov.br/qualidadedoar/dadosdemonitoramento/automatica`

- **Endpoints Exatos Testados (HTTP 200):**
  - **2026 (01/01/2026 a 30/09/2026):** `https://iema.es.gov.br/media/CQAI/medicoes-rgv-01-01-2026-a-30-09-2026.xlsx?v=T13SDnMcPffyo62zX-v5J_Z5pOUejCvDSVCgK64WIjw` (`6.373.268` bytes, aba `'Sheet1'`, `6.556` linhas = `3` cabeçalhos + **`6.553` horas**)
  - **2025.2 (01/07/2025 a 31/12/2025):** `https://iema.es.gov.br/media/CQAI/Medi%C3%A7%C3%B5es%20Grande%20Vit%C3%B3ria%20-%2001.07.2025%20a%2031.12.2025.xlsx` (`3.629.179` bytes, aba `'Sheet1'`, `4.419` linhas = `3` cabeçalhos + **`4.416` horas**)
  - **2025.1 (01/01/2025 a 30/06/2025):** `https://iema.es.gov.br/media/CQAI/Medi%C3%A7%C3%B5es%20RGV%20-%2001.01.2025%20a%2030.06.2025.xlsx` (`5.169.653` bytes, aba `'Medições'`, `4.352` linhas = `8` cabeçalhos + **`4.344` horas**)
  - **2024 (01/01/2024 a 31/12/2024):** `https://iema.es.gov.br/media/Qualidade%20do%20ar/Dados%20RGV%2001.01.2024%20-%2031.12.2024.xlsx` (`9.933.977` bytes, aba `'Sheet'`, `8.782` linhas = `8` cabeçalhos + **`8.774` horas**)
  - **2023 a 2001:** Links diretos `.xlsx` (2020–2023) e `.xls` (2001–2017) listados na mesma página.
- **Amostras Reais Salvas:**
  - [`docs/research/amostras/iema_ramqar_2026_horaria_sample.csv`](./amostras/iema_ramqar_2026_horaria_sample.csv) (últimas horas de `2026-09-30` para as 8 estações RGV)
  - [`docs/research/amostras/iema_ramqar_2024_2025_sample.csv`](./amostras/iema_ramqar_2024_2025_sample.csv) (3 horas de amostra para `2024`, `2025.1` e `2025.2` nas estações de referência `RGV1` e `RGV4`)

#### 3.2.1. Mudança Crítica de Layout entre `2024`/`2025.1` e `2025.2`/`2026` (Especificação para `fetch_iema_insitu.py`)

> [!WARNING]
> **O IEMA-ES trocou o software exportador das planilhas em 01/07/2025.** O script `fetch_iema_insitu.py` **PRECISA** detectar o formato pela célula `A1` (ou pelo número de linhas de cabeçalho) antes de iterar as linhas, pois `2024` e `2025.1` usam o **Formato Legado (8 linhas de cabeçalho + serial float do Excel + `sharedStrings.xml`)**, enquanto `2025.2` e `2026` usam o **Formato Novo (3 linhas de cabeçalho + string ISO + inline strings)**.

| Aspecto Estrutural | **Formato Legado (`2024` e `2025.1` — até 30/06/2025)** | **Formato Novo (`2025.2` e `2026` — a partir de 01/07/2025)** |
|---|---|---|
| **Armazenamento XML (`.xlsx`)** | Usa tabela `xl/sharedStrings.xml` (`c[@t="s"]` contém índice inteiro na tabela de strings). Aba chama-se `'Sheet'` (`2024`) ou `'Medições'` (`2025.1`). | **Sem `sharedStrings.xml`**: todas as strings vêm inline (`c[@t="str"]/v`). Aba chama-se `'Sheet1'`. |
| **Linhas de Cabeçalho** | **8 linhas** (`r="1"` a `r="8"`). Os dados horários começam na **linha 9 (`r="9"`)**. | **3 linhas** (`r="1"` a `r="3"`). Os dados horários começam na **linha 4 (`r="4"`)**. |
| **Total de Colunas** | `281` colunas em `2024`; `291` colunas em `2025.1` (pois `2025.1` adiciona par extra `Valor [ppm]` + `Flag` para CO em 5 estações). | `191` colunas tanto em `2025.2` quanto em `2026`. |
| **Estações Presentes (Linha 2)** | **10 estações** (com parênteses): `EMQAr - RGV1 (Laranjeiras)`, `EMQAr - RGV10 (Ponta Formosa)`, `EMQAr - RGV2 (Carapina)`, `EMQAr - RGV3 (Jardim Camburi)`, `EMQAr - RGV4 (Enseada do Suá)`, `EMQAr - RGV5 (Vitória-Centro)`, `EMQAr - RGV6 (Vila Velha-IBES)`, `EMQAr - RGV7 (Vila Velha-Centro)`, `EMQAr - RGV8 (Vila Capixaba)`, `EMQAr - RGV9 (Cidade Continental)`. *(Nota: `RGV7` tem 0% de dados válidos; `RGV10` foi desativada em mar/2025).* | **8 estações** (com hífen, sem `RGV7` e sem `RGV10`): `EMQAr - RGV1 - Laranjeiras`, `EMQAr - RGV2 - Carapina`, `EMQAr - RGV3 - Jardim Camburi`, `EMQAr - RGV4 - Enseada do Sua`, `EMQAr - RGV5 - Vitória-Centro`, `EMQAr - RGV6 - Vila Velha-IBES`, `EMQAr - RGV8 - Vila Capixaba`, `EMQAr - RGV9 - Cidade Continental`. |
| **Identificação do Parâmetro e Unidade** | **Linha 5** traz o nome por extenso (`Ozônio`, `Dióxido de Nitrogênio`, `Monóxido de Nitrogênio`, `Óxidos de Nitrogênio`, `Dióxido de Enxofre`, `Monóxido de Carbono`, `Partículas Inaláveis (<10µm)`, `Partículas Respiráveis (<2,5µm)`, `Velocidade Escalar do Vento`, `Direção Escalar do Vento`, `Umidade Relativa`, `Temperatura`, `Precipitação Pluviométrica`, `Pressão Atmosférica`, `Radiação Solar Global`) e **Linha 8** alterna `Valor [µg/m³]` (ou `[ppm]`, `[°C]`, `[m/s]`, `[°]`, `[%]`, `[mm]`) nas colunas ímpares com `Flag` nas colunas pares. | **Linha 3** traz sigla + unidade nas colunas ímpares (`TempAr (C°)`, `VelVento (m/s)`, `DirVento (Y/N)` ou `DirVento (°)`, `RH (%)`, `Rain (mm)`, `Radiação (watt/m2)`, `Press_Ar (mbar)`, `SO2 (ug/m3)`, `O3 (ug/m3)`, `NO (ug/m3)`, `NO2 (ug/m3)`, `NOX (ug/m3)`, `CO_ppm (ppm)` em `2025.2` / `CO (ug/m3)` em `2026`, `PM10 (ug/m3)`, `PM25 (ug/m3)`) e `Status <Parâmetro>` nas colunas pares. |
| **Unidade de `CO`** | Em `2024`: `Valor [µg/m³]`. Em `2025.1`: traz **ambas** as colunas (`Valor [µg/m³]` e, logo ao lado, `Valor [ppm]` com flag `VC`). | Em `2025.2`: apenas **`CO_ppm (ppm)`** (converter p/ $\mu\text{g/m}^3$ via $\text{CO}_{\mu\text{g/m}^3} = \text{CO}_{\text{ppm}} \times 1145$). Em `2026`: já vem convertido em **`CO (ug/m3)`**. |
| **Formato de `Data/Hora` (Coluna 0)** | **Float serial do Excel** (época `1899-12-30`), gravado em **meia hora (`:30`)**: ex. `45292.4375` $\rightarrow$ `2024-01-01 10:30:00` (truncar/alinhar para `:00` no join horário). | **String ISO local (BRT)** em hora cheia (`:00`): ex. `"2025-07-01 00:00:00"`. |
| **Flags `Status` / `Flag` Válidas** | `""` (vazio), `" "` (espaço simples — padrão nas células normais de 2024/2025.1!), `"VU"` (Válido Usuário), `"VR"` (Válido Reescalonado), `"VC"` (Válido Calculado). | `""` (vazio), `"VU"` (Válido Usuário), `"VI"` (Válido Inspeção). |
| **Flags Inválidas e Sentinelas** | Flags: `"IF"`, `"ID"`, `"IP"`, `"IC"`, `"IE"`, `"IR"`, `"IT"`, `"IU"`. Sentinela numérica de erro: **`99999`**. | Flags: `"!"`, `"-"`, `"I%"`, `"IC"`, `"ID"`, `"IF"`, `"II"`, `"IP"`, `"IS"`, `"IT"`, `"IU"`. Sentinela numérica de erro: **`-9999`**. |

#### 3.2.2. Contagem de Horas Válidas e Meteorologia In-Situ por Ano (`2024`, `2025.1`, `2025.2` e `2026`)

Todas as 4 planilhas possuem **meteorologia in-situ medida nas torres das próprias estações** (`TempAr`, `RH`, `VelVento`, `DirVento` em `RGV1, RGV2, RGV3, RGV4, RGV6, RGV8`; `TempAr` e `RH` em `RGV5`; `Press_Ar` e `Radiação` adicionais em `RGV2` e `RGV4`; apenas `RGV9` não possui sensores meteorológicos):

| Estação IEMA | Período / Total Horas | `TempAr` / `RH` / `Vento` válidos | `PM25` válido (horas / %) | `PM10` válido (horas / %) | `O3` válido (horas / %) | `NO2` válido (horas / %) | `SO2` válido (horas / %) | `CO` válido (horas / %) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| **RGV1 (Laranjeiras)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.538 (97,3%)<br>4.341 (99,9%)<br>4.385 (99,3%)<br>6.382 (97,4%) | **8.752 (99,7%)**<br>**3.587 (82,6%)**<br>1.128 (25,5%)<br>**5.817 (88,8%)** | 914 (10,4%)<br>0 (0,0%)<br>925 (20,9%)<br>725 (11,1%) | **7.910 (90,2%)**<br>**4.329 (99,7%)**<br>**3.789 (85,8%)**<br>**6.374 (97,3%)** | **8.420 (96,0%)**<br>**4.330 (99,7%)**<br>**3.869 (87,6%)**<br>**4.523 (69,0%)** | **8.234 (93,8%)**<br>**4.333 (99,7%)**<br>**3.225 (73,0%)**<br>**6.384 (97,4%)** | **7.968 (90,8%)**<br>**4.316 (99,4%)**<br>2.058 (46,6%)<br>**6.380 (97,4%)** |
| **RGV2 (Carapina)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.584 (97,8%)<br>3.823 (88,0%)<br>2.224 (50,4%)<br>6.423 (98,0%) | **8.732 (99,5%)**<br>**4.227 (97,3%)**<br>**3.365 (76,2%)**<br>**3.805 (58,1%)** | **8.132 (92,7%)**<br>**2.365 (54,4%)**<br>**3.198 (72,4%)**<br>**3.963 (60,5%)** | N/M | N/M | N/M | N/M |
| **RGV3 (Jardim Camburi)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.621 (98,3%)<br>4.244 (97,7%)<br>3.569 (80,8%)<br>5.730 (87,4%) | 339 (3,9%)<br>0 (0,0%)<br>849 (19,2%)<br>**5.927 (90,4%)** | **8.728 (99,5%)**<br>**4.263 (98,1%)**<br>**3.891 (88,1%)**<br>**5.798 (88,5%)** | N/M | **8.050 (91,7%)**<br>**3.680 (84,7%)**<br>2.106 (47,7%)<br>2.567 (39,2%) | **7.429 (84,7%)**<br>**4.138 (95,3%)**<br>**3.962 (89,7%)**<br>**4.581 (69,9%)** | N/M |
| **RGV4 (Enseada do Suá)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.623 (98,3%)<br>4.338 (99,9%)<br>3.529 (79,9%)<br>6.385 (97,4%) | **8.640 (98,5%)**<br>**4.336 (99,8%)**<br>**3.534 (80,0%)**<br>**6.504 (99,3%)** | **8.211 (93,6%)**<br>**4.301 (99,0%)**<br>**3.529 (79,9%)**<br>**6.365 (97,1%)** | **7.828 (89,2%)**<br>**4.326 (99,6%)**<br>**3.539 (80,1%)**<br>**6.416 (97,9%)** | **8.451 (96,3%)**<br>**4.290 (98,8%)**<br>**3.402 (77,0%)**<br>**6.378 (97,3%)** | **8.702 (99,2%)**<br>**4.170 (96,0%)**<br>**3.528 (79,9%)**<br>**6.430 (98,1%)** | **8.069 (92,0%)**<br>**4.235 (97,5%)**<br>**3.546 (80,3%)**<br>**6.034 (92,1%)** |
| **RGV5 (Vitória-Centro)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.493 (96,8%)<br>4.300 (99,0%)<br>4.054 (91,8%)<br>5.840 (89,1%) | **8.068 (92,0%)**<br>**3.000 (69,1%)**<br>647 (14,7%)<br>**5.812 (88,7%)** | **8.040 (91,6%)**<br>214 (4,9%)<br>605 (13,7%)<br>**5.798 (88,5%)** | N/M | **8.661 (98,7%)**<br>**3.902 (89,8%)**<br>**3.391 (76,8%)**<br>**3.912 (59,7%)** | **8.602 (98,0%)**<br>**4.331 (99,7%)**<br>**3.963 (89,7%)**<br>**5.769 (88,0%)** | **8.460 (96,4%)**<br>**4.225 (97,3%)**<br>**3.411 (77,2%)**<br>197 (3,0%) |
| **RGV6 (Vila Velha-IBES)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.638 (98,4%)<br>4.275 (98,4%)<br>3.965 (89,8%)<br>6.526 (99,6%) | 2.719 (31,0%)<br>0 (0,0%)<br>1.278 (28,9%)<br>**6.450 (98,4%)** | 0 (0,0%)<br>0 (0,0%)<br>1.412 (32,0%)<br>**6.013 (91,8%)** | **7.880 (89,8%)**<br>**4.318 (99,4%)**<br>**3.432 (77,7%)**<br>**6.235 (95,1%)** | **8.582 (97,8%)**<br>**4.004 (92,2%)**<br>**3.997 (90,5%)**<br>618 (9,4%) | **8.738 (99,6%)**<br>**4.314 (99,3%)**<br>**3.936 (89,1%)**<br>**6.526 (99,6%)** | **7.922 (90,3%)**<br>**4.129 (95,1%)**<br>**3.609 (81,7%)**<br>**6.077 (92,7%)** |
| **RGV8 (Vila Capixaba)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | 8.660 (98,7%)<br>4.164 (95,9%)<br>4.031 (91,3%)<br>6.224 (95,0%) | **6.282 (71,6%)**<br>0 (0,0%)<br>0 (0,0%)<br>0 (0,0%) | **6.709 (76,5%)**<br>0 (0,0%)<br>993 (22,5%)<br>2.246 (34,3%) | **8.409 (95,8%)**<br>**4.321 (99,5%)**<br>**3.945 (89,3%)**<br>**6.091 (93,0%)** | **8.292 (94,5%)**<br>**4.194 (96,5%)**<br>**4.023 (91,1%)**<br>**6.171 (94,2%)** | **8.637 (98,4%)**<br>**4.234 (97,5%)**<br>**4.018 (91,0%)**<br>**5.862 (89,5%)** | **7.881 (89,8%)**<br>**4.310 (99,2%)**<br>**3.936 (89,1%)**<br>**6.165 (94,1%)** |
| **RGV9 (Cidade Continental)** | `2024` (`8.774` h)<br>`2025.1` (`4.344` h)<br>`2025.2` (`4.416` h)<br>`2026` (`6.553` h) | N/M | **7.941 (90,5%)**<br>**4.298 (98,9%)**<br>**3.273 (74,1%)**<br>**5.345 (81,6%)** | **8.348 (95,1%)**<br>**4.292 (98,8%)**<br>**3.274 (74,1%)**<br>**5.239 (79,9%)** | N/M | 1.155 (13,2%)<br>0 (0,0%)<br>N/M<br>**5.719 (87,3%)** | 0 (0,0%)<br>0 (0,0%)<br>N/M<br>**5.689 (86,8%)** | N/M |

#### 3.2.3. Amostra Real de 3 Linhas por Período (`2024`, `2025.1`, `2025.2`) — `RGV4 (Enseada do Suá)` e `RGV1 (Laranjeiras)`

Extraída de [`docs/research/amostras/iema_ramqar_2024_2025_sample.csv`](./amostras/iema_ramqar_2024_2025_sample.csv):

```csv
arquivo,formato,timestamp_bruto_col0,timestamp_iso_brt,estacao,PM25_ugm3,Flag_PM25,PM10_ugm3,Flag_PM10,O3_ugm3,Flag_O3,NO2_ugm3,Flag_NO2,SO2_ugm3,Flag_SO2,CO_ugm3,CO_ppm,TempAr_C,RH_pct,VelVento_ms,DirVento_deg
2024,Legado_8_cabecalhos,45292.8125,2024-01-01 19:30:00,EMQAr - RGV4 (Enseada do Suá),5.2,,5.2,VR,24.44,,35.88,,3.46,VU,141.69,,24,98.2,1.6,207.8
2024,Legado_8_cabecalhos,45292.85416666667,2024-01-01 20:30:00,EMQAr - RGV4 (Enseada do Suá),4.2,,4.4,,23.4,,36.37,,2.98,VU,143.49,,23.9,98.8,1.3,188.4
2024,Legado_8_cabecalhos,45292.89583333333,2024-01-01 21:30:00,EMQAr - RGV4 (Enseada do Suá),3.4,,5.9,,24.6,,25.28,,2.77,VU,129.68,,24,98.3,1.4,194.4
2025_1,Legado_8_cabecalhos,45658.39583333333,2025-01-01 09:30:00,EMQAr - RGV4 (Enseada do Suá),7,,25.8,,34.07,,21.05,,7.56,,630.35,0.55,29.3,79.6,1.4,76.1
2025_1,Legado_8_cabecalhos,45658.4375,2025-01-01 10:30:00,EMQAr - RGV4 (Enseada do Suá),9.2,,21.8,,45.43,,7.12,,4.42,,466.74,0.407,30.1,77.6,1.6,47.5
2025_1,Legado_8_cabecalhos,45658.47916666667,2025-01-01 11:30:00,EMQAr - RGV4 (Enseada do Suá),10.7,,19.7,,44.87,,6.29,,4.12,,400.69,0.35,30,78.4,1.7,46.7
2025_2,Novo_3_cabecalhos,2025-12-14 15:00:00,2025-12-14 15:00:00,EMQAr - RGV4 (Enseada do Suá),13.511,VI,44.3815,VI,16.94649,VU,8.520145,VU,6.372127,VU,,0.1116746,27.93431,,1.292736,47.53162
2025_2,Novo_3_cabecalhos,2025-12-14 16:00:00,2025-12-14 16:00:00,EMQAr - RGV4 (Enseada do Suá),13.0453,VI,55.3918,VI,13.56382,VU,9.255548,VU,2.314729,VU,,0.0854937,27.16304,,1.228885,58.53357
2025_2,Novo_3_cabecalhos,2025-12-14 17:00:00,2025-12-14 17:00:00,EMQAr - RGV4 (Enseada do Suá),34.6005,VI,70.6889,VI,15.47812,VU,8.35323,VU,1.389986,VU,,0.0720706,26.62705,,1.334698,57.84337
```

---

### 3.3. MMA MonitorAr — Portal de Dados Abertos do Governo Federal (`dados.mma.gov.br`)

- **Endpoints Exatos Testados (HTTP 200):**
  - Metadados CKAN: `https://dados.mma.gov.br/api/3/action/package_show?id=ar-puro-monitorar`
  - Dicionário de dados: `https://dados.mma.gov.br/dataset/5be05b46-3bda-4f6e-9bf2-810e716fff33/resource/09c0df22-3688-45f6-b8da-40eb55012477/download/arquivo-auxiliar-dados-monitorar.pdf`
  - Série 2025: `https://dados.mma.gov.br/dataset/5be05b46-3bda-4f6e-9bf2-810e716fff33/resource/e4f35322-b8a7-423c-bc12-21bbd0804a0a/download/dados_monitorar_2025.zip` (também disponíveis `2022.zip`, `2023.zip`, `2024.zip`).
- **Amostra Real Salva:** [`docs/research/amostras/mma_monitorar_2025_iema_sample.csv`](./amostras/mma_monitorar_2025_iema_sample.csv)
- **Achados:** Contém todas as estações do IEMA-ES (`no_fonte_dados = "Instituto de Meio Ambiente e Recursos Hídricos do Espírito Santo (IEMA)"`), incluindo `EMQAr - RGV1..RGV6, RGV8, RGV9, RGV10` e `SUL1..SUL6`, em formato CSV flat padronizado (`dh_medicao`, `nu_iqar`, `nu_concentracao`, `st_situacao`, `cd_normalizado`, `id_estacao`, `cod_estacao`, `no_estacao`).
- **Limitações:** Publicação em lotes anuais fechados (ainda sem lote 2026); nas linhas do IEMA, os campos `nu_latitude`, `nu_longitude` e `no_municipio` vêm em branco `""` e em algumas séries `nu_concentracao` repete `nu_iqar`. Por isso, as planilhas diretas do IEMA (Seção 3.2) são superiores para treino.

---

### 3.4. Portal de Dados Abertos do ES (`dados.es.gov.br`)

- **Endpoints Exatos Testados (HTTP 200):**
  - Busca organizacional CKAN: `https://dados.es.gov.br/api/3/action/package_search?fq=organization:iema-instituto-de-meio-ambiente-e-recursos-hidricos&rows=50`
  - Pacote Qualidade do Ar: `https://dados.es.gov.br/api/3/action/package_show?id=rede-de-monitoramento-da-qualidade-do-ar-regiao-grande-vitoria`
  - Recurso CSV: `https://dados.es.gov.br/dataset/738a7eb5-2c9c-42af-8e71-d7b5326e44a3/resource/b0025852-772b-43e8-9ab3-1a0ff6f2fa51/download/52-772b-43e8-9ab3-1a0ff6f2fa51`
- **Amostras Reais Salvas:** [`docs/research/amostras/dados_es_gov_br_ckan.json`](./amostras/dados_es_gov_br_ckan.json) e [`docs/research/amostras/dados_es_gov_br_rmps.csv`](./amostras/dados_es_gov_br_rmps.csv).
- **Achados:** O único CSV de qualidade do ar publicado pelo IEMA no CKAN estadual contém apenas a tabela de localização (11 linhas) dos pontos da Rede Manual de Poeira Sedimentável (`PMPS - RGV 1` a `11`, que compartilham endereço físico com as estações automáticas `EMQAr - RGV 1` a `9`), sem séries horárias de gases ou particulados inaláveis.

---

### 3.5. OpenAQ (`api.openaq.org` v3, Vector Tiles e AWS S3 Open Data)

- **Endpoints Exatos Testados:**
  1. `GET https://api.openaq.org/v3/locations?coordinates=-20.3125,-40.2870&radius=25000&limit=100` → **HTTP 401 Unauthorized** (`{"message": "Unauthorized. A valid API key must be provided in the X-API-Key header."}`).
  2. `GET https://tiles.openaq.org/locations/tiles/8/99/142.pbf` e `/10/397/570.pbf` (Mapbox Vector Tiles do OpenAQ Explorer) → **HTTP 200 OK**. Decodificando o protobuf MVT, identificamos **todas as 3 únicas localidades registradas no OpenAQ em todo o Espírito Santo**:
     - `location_id = 3107138` (`"teste1-3077081"`, AirGradient, `-20.258241, -40.278852`, Jardim Camburi): apenas 2 dias de dados (`09/10/2024` a `10/10/2024`).
     - `location_id = 6126992` (`"Quality01-6096926"`, AirGradient, `-20.271173, -40.288689`, UFES/Jardim da Penha): 69 dias de dados (`11/11/2025` a `30/01/2026`), inativo há quase 9 meses.
     - `location_id = 6126993` (`"Quality02-6096927"`, AirGradient, `-20.271186, -40.288675`, colocalizado com `Quality01`): 69 dias de dados (`11/11/2025` a `30/01/2026`), inativo.
  3. `GET https://openaq-data-archive.s3.amazonaws.com/records/csv.gz/locationid=6126992/year=2026/month=01/location-6126992-20260130.csv.gz` → **HTTP 200 OK** (bucket público AWS S3 sem necessidade de chave de API).
- **Amostras Reais Salvas:** [`docs/research/amostras/openaq_v3_and_s3_sample.json`](./amostras/openaq_v3_and_s3_sample.json) e [`docs/research/amostras/openaq_s3_location_6126992_20260130.csv`](./amostras/openaq_s3_location_6126992_20260130.csv).
- **Conclusão sobre OpenAQ:** **Não há necessidade de solicitar API key do OpenAQ (nenhum bloqueio para a missão)**, pois provamos via Vector Tiles + S3 que o OpenAQ **não ingere nenhuma estação oficial do IEMA-ES** e os 3 sensores comunitários AirGradient em Vitória estão desligados desde 30/01/2026.

---

### 3.6. INMET, `sensor.community`, `IQAir`, `PurpleAir`, Dados Municipais e Plataforma IEMA-SP

Amostras consolidadas em [`docs/research/amostras/inmet_es_estacoes_sample.json`](./amostras/inmet_es_estacoes_sample.json) e [`docs/research/amostras/other_sources_responses.json`](./amostras/other_sources_responses.json):

- **INMET (`apitempo.inmet.gov.br` e `portal.inmet.gov.br`):**
  - `GET https://apitempo.inmet.gov.br/estacoes/T` (HTTP 200): lista 11 estações automáticas no ES. Na RMGV existem **A612 (`VITORIA`, lat `-20.270833`, lon `-40.305833`, status `Operante`)** e **A634 (`VILA VELHA`, lat `-20.466944`, lon `-40.403889`, status `Pane`)**.
  - Pacote anual `https://portal.inmet.gov.br/uploads/dadoshistoricos/2026.zip` (HTTP 200, 136,9 MB, atualizado em `05/10/2026`) e `2025.zip` (90,9 MB): fornecem meteorologia horária medida (`temperatura`, `umidade`, `vento`, `pressão`, `radiação global`), útil como fallback quando o sensor meteorológico de alguma estação RAMQAr estiver em manutenção (como `RGV5 Vitória-Centro`, que não mede vento, ou `RGV9 Cidade Continental`, que só mede poluentes).
- **`sensor.community`:**
  - `GET https://data.sensor.community/airrohr/v1/filter/box=-20.5,-40.6,-20.0,-40.1` → HTTP 200, corpo `[]` (zero sensores na RMGV).
  - `GET https://data.sensor.community/airrohr/v1/filter/country=BR` → HTTP 200, 59 leituras em 18 locais no Brasil, todos nos estados de RS, SC, PR e SP (nenhum no ES).
- **IQAir (`api.airvisual.com` / `iqair.com`):**
  - `GET https://api.airvisual.com/v2/nearest_city?lat=-20.3125&lon=-40.2870` → HTTP 400 (`incorrect_api_key`).
  - Página `https://www.iqair.com/air-quality/brazil/espirito-santo/vitoria` (HTTP 200): reporta `53 * US AQI+` (asterisco indica estimativa modelada por satélite) e informa em *"Where is the cleanest air quality in Vitoria?"*: **`No locations are available`**.
- **PurpleAir (`api.purpleair.com`):**
  - `GET https://api.purpleair.com/v1/sensors?fields=name,latitude,longitude&nwlat=-20.0&nwlng=-40.6&selat=-20.5&selng=-40.1` → HTTP 403 (`ApiKeyMissingError`). Exige conta com cartão/pontos e mede apenas material particulado óptico (`PMS5003`), sem gases.
- **Portais Municipais (Vitória, Vila Velha, Serra, Cariacica):**
  - `https://geoweb.vitoria.es.gov.br/api/feed/dcat-us/1.1.json` (HTTP 200, 21 datasets geoespaciais urbanos, 0 de qualidade do ar), `https://wstransparencia.vitoria.es.gov.br/` (HTTP 200), `https://transparencia.vilavelha.es.gov.br/DadosAbertos.Lista.aspx` (HTTP 200), `http://transparencia.serra.es.gov.br/` (HTTP 200), `https://transparencia.cariacica.es.gov.br/` (HTTP 200). Nenhum município opera estações próprias de qualidade do ar.
- **Plataforma da Qualidade do Ar — IEMA ONG SP (`https://energiaeambiente.org.br/qualidadedoar`):**
  - Consolida relatórios históricos estaduais (a partir de 2000) em painel informativo, mas com defasagem de meses/anos em relação às planilhas diretas do IEMA-ES (`iema.es.gov.br`).

---

## 4. Mapeamento Canônico das 9 Estações (`db/seed.sql` ↔ IEMA-ES Oficial)

Ao cruzar [`db/seed.sql`](../../db/seed.sql) com a tabela oficial do IEMA (`https://iema.es.gov.br/media/CQAI/TABELA%201%20CORRETA.png` e `https://qualidadedoarapi.es.gov.br/api/mapa`), identificamos que **6 das 9 estações do `seed.sql` têm correspondência direta 1:1 com estações ativas da RAMQAr-RGV**, enquanto **3 IDs do `seed.sql` tinham nomes/coordenadas aproximados** que precisam ser mapeados para as estações reais da RAMQAr-RGV:

| ID AetherML (`db/seed.sql`) | Nome atual em `db/seed.sql` | Coord. `seed.sql` | Estação Oficial IEMA-ES Correspondente (`IdEstacao`) | Coord. Oficial IEMA (SIRGAS 2000 / API) | Distância `seed` ↔ Oficial | Status em Out/2026 e Poluentes Ativos |
|---|---|---|---|---|---:|---|
| `ramqar_serra_laranjeiras` | Laranjeiras - Serra | `-20.2125, -40.2380` | **EMQAr - RGV1 — Laranjeiras** (Hosp. Dório Silva, Serra) · `IdEstacao=1` | `-20.19614, -40.24521` | 1,97 km | **Ativa (API + XLSX):** `PM25, PM10, O3, NO2, SO2, CO` + Meteo |
| `ramqar_camburi` | Camburi - Vitória | `-20.2764, -40.2881` | **EMQAr - RGV3 — Jardim Camburi** (Unid. Saúde, Vitória) · `IdEstacao=3` | `-20.25514, -40.26967` | 3,05 km | **Ativa (API + XLSX):** `PM25, PM10, NO2, SO2` + Meteo |
| `ramqar_enseada_sua` | Enseada do Suá - Vitória | `-20.3125, -40.2870` | **EMQAr - RGV4 — Enseada do Suá** (Corpo de Bombeiros, Vitória) · `IdEstacao=4` | `-20.31330, -40.29069` | 0,40 km | **Ativa (API + XLSX, mais completa da rede):** `PM25, PM10, O3, NO2, SO2, CO` + Meteo completa |
| `ramqar_vitoria_centro` | Vitória Centro | `-20.3196, -40.3370` | **EMQAr - RGV5 — Vitória - Centro** (Min. Fazenda, Vitória) · `IdEstacao=5` | `-20.32070, -40.33297` | 0,44 km | **Ativa (API + XLSX):** `PM25, PM10, NO2, SO2, CO` + Temp/RH |
| `ramqar_ibes` | IBES - Vila Velha | `-20.3478, -40.3068` | **EMQAr - RGV6 — Vila Velha - IBES** (4º BPM, Vila Velha) · `IdEstacao=6` | `-20.34865, -40.31742` | 1,11 km | **Ativa (API + XLSX):** `PM25, PM10, O3, NO2, SO2, CO` + Meteo |
| `ramqar_cariacica` | Cariacica Centro | `-20.2634, -40.4166` | **EMQAr - RGV8 — Vila Capixaba** (CEASA, Cariacica) · `IdEstacao=8` | `-20.34201, -40.40218` | 8,87 km | **Ativa (API + XLSX):** `O3, NO2, SO2, CO, PM10` (`PM25` desabilitado em 2026) + Meteo |
| `ramqar_serra_jacupemba` *(divergente)* | Jacupemba - Serra *(nota: Jacupemba fica em Aracruz)* | `-20.1750, -40.1900` | **EMQAr - RGV9 — Cidade Continental** (Serra) · `IdEstacao=9` | `RGV9`: `-20.22062, -40.22767` | 6,41 km (`RGV9`) | **`RGV9` Ativa (API + XLSX):** `PM25, PM10, NO2, SO2` |
| `ramqar_paul` *(divergente)* | Paul - Vila Velha | `-20.3297, -40.2960` | Sem estação física ativa em Paul (`RGV7` desativada em 2020) | `RGV7`: `-20.33709, -40.29022` | 1,02 km (`RGV7`) | Para manter coerência com Vila Velha, recebe interpolação IDW local (`RGV4` + `RGV5` + `RGV6`) |
| `ramqar_vila_velha_fundo` *(divergente)* | Vila Velha Interior | `-20.3700, -40.3300` | Sem estação física no sul de Vila Velha | — | — | Para manter o contrato de 9 IDs `ramqar_*`, imputar via **IDW Haversine inverso (`1/d²`)** a partir de `RGV6 (IBES, a 2,7 km)` + `RGV8 (Cariacica)` + `RGV4 (Suá)` |

> [!NOTE]
> **Descarte Canônico de RGV2 (Carapina):**
> A estação física `EMQAr - RGV2 (Carapina)` está ativa na planilha XLSX do IEMA (`PM25, PM10` + meteo), porém **não existe no contrato canônico de 9 estações** de `db/seed.sql`. Por decisão de governança arquitetural, `RGV2` é **descartada formalmente por contrato** pelo parser (`fetch_iema_insitu.py`), **NÃO sendo mapeada para `ramqar_serra_jacupemba` nem para `ramqar_paul`**, para não contradizer o schema canônico nem induzir distorções geográficas (Carapina fica na Serra, a 13 km de Paul em Vila Velha).

### 4.1. Identificação dos `IdEstacao` 11 a 16 em `/api/mapa` (Rede RAMQAr-Sul) e Decisão sobre o Contrato de 9 Estações

O endpoint `GET https://qualidadedoarapi.es.gov.br/api/mapa` retorna exatamente **14 entradas** porque omite as estações desativadas `IdEstacao = 7` (`EMQAr - RGV7 — Vila Velha-Centro`) e `IdEstacao = 10` (`EMQAr - RGV10 — Ponta Formosa`), listando **8 estações da RAMQAr-RGV (`IdEstacao` 1, 2, 3, 4, 5, 6, 8, 9)** e **6 estações da RAMQAr-Sul (`IdEstacao` 11, 12, 13, 14, 15, 16)**. Cruzando o payload salvo em [`docs/research/amostras/iema_api_mapa_live.json`](./amostras/iema_api_mapa_live.json) com a tabela oficial de metadados da Região Sul (`https://iema.es.gov.br/media/CQAI/Localiza%C3%A7%C3%A3o%20das%20Esta%C3%A7%C3%B5es%20da%20Regi%C3%A3o%20Sul.png`), temos:

| `IdEstacao` (`/api/mapa`) | `Descricao` | `Localizacao` (Bairro / Endereço Oficial IEMA) | Município | Coordenadas Geográficas (`/api/mapa`) | Coordenadas UTM SIRGAS 2000 24K (`X`, `Y`) | Pertence à RMGV (LC Estadual 58/95)? | Distância até `RGV4` (Vitória) |
|---:|---|---|---|---|---|---:|---:|
| **`11`** | `EMQAr - SUL1` | Balneário de Meaípe (Estação de Tratamento de Água) | **Guarapari** | `-20.73700, -40.53500` | `340161 E, 7706211 N` | **Sim** *(extremo sul de Guarapari, divisa c/ Anchieta)* | 53,5 km |
| **`12`** | `EMQAr - SUL2` | Ubu / Praia de Parati (Estação de Tratamento de Água) | **Anchieta** | `-20.80283, -40.59693` | `333798 E, 7698849 N` | **Não** *(Microrregião Litoral Sul)* | 62,9 km |
| **`13`** | `EMQAr - SUL3` | Guanabara / Praia de Castelhanos (Estação de Tratamento de Água) | **Anchieta** | `-20.82134, -40.62636` | `330757 E, 7696769 N` | **Não** *(Microrregião Litoral Sul)* | 66,3 km |
| **`14`** | `EMQAr - SUL4` | Comunidade de Belo Horizonte (Rua Projetada, s/nº, zona rural) | **Anchieta** | `-20.74185, -40.60891` | `332488 E, 7705591 N` | **Não** *(Microrregião Litoral Sul)* | 57,9 km |
| **`15`** | `EMQAr - SUL5` | Mãe-Bá (Rua Eta, s/nº) | **Anchieta** | `-20.76741, -40.57441` | `336103 E, 7702794 N` | **Não** *(Microrregião Litoral Sul)* | 58,4 km |
| **`16`** | `EMQAr - SUL6` | Anchieta Centro (Prefeitura de Anchieta) | **Anchieta** | `-20.81289, -40.63343` | `330000 E, 7697695 N` | **Não** *(Microrregião Litoral Sul)* | 65,9 km |

**Decisão técnica e evidência (por que `IdEstacao` 11–16 ficam fora do contrato de 9 estações):**  
Embora o município de Guarapari integre juridicamente a RMGV (Lei Complementar Estadual nº 58/1995), a estação `IdEstacao = 11` (`EMQAr - SUL1 — Meaípe`) e as estações `IdEstacao = 12..16` (`SUL2..SUL6`, todas no município de Anchieta, fora da RMGV) pertencem à **RAMQAr-Sul** — uma rede distinta, implantada pelo Termo de Compromisso Ambiental da Samarco Mineração S.A. para monitorar exclusivamente a bacia aérea do Complexo Industrial de Ponta Ubu (53 a 66 km ao sul de Vitória). As evidências técnicas nas fontes oficiais do IEMA confirmam essa separação: (1) nas planilhas históricas `Medições RGV` / `medicoes-rgv-2026.xlsx`, as estações `SUL1..SUL6` **não estão incluídas** (são publicadas em pacote separado sob o título *"Rede Automática de Monitoramento da Qualidade do Ar - Região Sul"* em `iema.es.gov.br/qualidadedoar/dadosdemonitoramento/automatica`); (2) na API `/api/mapa`, `SUL1..SUL6` reportam timestamps defasados em meia hora (`:30`) e sem `MP₂,₅` em `SUL1, SUL2, SUL5, SUL6`; e (3) a distância de `SUL1 (Meaípe)` até a estação mais meridional do `db/seed.sql` (`ramqar_vila_velha_fundo`) é de **46,0 km**, representando outro regime meteorológico e de emissões. Portanto, **nenhum dos IDs 11–16 deve entrar no contrato de 9 estações `ramqar_*`**, devendo o worker filtrar apenas `IdEstacao IN (1, 2, 3, 4, 5, 6, 8, 9)` (`Descricao LIKE 'EMQAr - RGV%'`).

> [!IMPORTANT]
> **Decisão recomendada para o contrato de 9 estações (`db/seed.sql`):**
> Como as convenções do AetherML (`AGENTS.md` / `.agents/rules/aetherml-conventions.md`) fixam os 9 IDs `ramqar_*` de `db/seed.sql`:
> 1. Atualizar as coordenadas (`latitude`, `longitude`) das 6 estações diretas + associar `ramqar_serra_jacupemba` → `EMQAr - RGV9 (Cidade Continental, Serra)`.
> 2. Manter `ramqar_paul` e `ramqar_vila_velha_fundo` alimentadas por interpolação espacial IDW ponderada por Haversine $1/d^2$ das estações físicas vizinhas `RGV6 IBES`, `RGV4 Suá` e `RGV5 Centro` (com `source = 'IEMA_IDW'`).
> 3. `RGV2 Carapina` é formalmente descartada pelo parser para preservar o contrato canônico de 9 estações.

---

## 5. Plano de Integração para o MOS (`specs/08 §2` — $X = \text{CAMS}$, $Y = \text{in-situ}$)

### 5.1. Arquitetura de Dados e Contrato com Tabelas D1 (`db/schema.ts` & `workers/ingestion`)

Conforme verificado em [`db/schema.ts`](../../db/schema.ts#L22-L70) e [`workers/ingestion/src/index.ts`](../../workers/ingestion/src/index.ts#L61-L72), o banco D1 possui duas tabelas de séries observadas/covariáveis ao lado de `monitoring_stations`:
- **`observed_pollutants`** (`UNIQUE(station_id, timestamp)`): armazena `pm25, pm10, so2, no2, o3, co, iqar_index, iqar_classification, primary_pollutant, source`. A coluna `source` é anulável e sem default (Migration `0002_observed_source.sql`), e **a constante `export const IEMA_SENTINEL = "IEMA"` já está declarada e reservada em [`workers/ingestion/src/index.ts`](../../workers/ingestion/src/index.ts#L64)** especificamente para observações oficiais *in-situ* do IEMA (enquanto o fallback Open-Meteo grava `CAMPS_ANALYSIS_SOURCE = "open-meteo-cams-reanalysis"` ou `CAMPS_FORECAST_SOURCE = "open-meteo-cams-forecast"`).
- **`environmental_features`** (`UNIQUE(station_id, timestamp, is_forecast)`): armazena `temperature, relative_humidity, wind_speed, wind_direction, wind_u, wind_v, boundary_layer_height, surface_pressure, solar_radiation, satellite_*, traffic_*, is_forecast, source` (onde o worker hoje grava `FEATURES_SOURCE = "open-meteo-forecast-api"`).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. PIPELINE DE TREINO & BACKTEST MOS (ml/training/ + ml/evaluation/)        │
│                                                                              │
│  [IEMA XLSX 2024..2026] ──► fetch_iema_insitu.py                            │
│   (Concentrações µg/m³ +      - Suporta Formato Legado (2024/2025.1, 8 cab.) │
│    Meteo in-situ por RGV)       e Formato Novo (2025.2/2026, 3 cab.)         │
│                               - Filtra Status in ("", " ", "VU", "VI",       │
│                                 "VR", "VC") e descarta sentinelas            │
│                                 (-9999, 99999, "!", "-", "IF", "ID", "IU")   │
│                               - Converte CO_ppm (2025.2) * 1145 -> µg/m³     │
│                               - Converte timestamp BRT (UTC-3) -> UTC        │
│                               - Imputa lacunas de poluente por estação (IDW) │
│                                        │                                     │
│  [Open-Meteo CAMS + Meteo] ────────────┼──► build_real_dataset.py (modo MOS) │
│   (Grade regional + PBLH)              │     - X (30 feats FEATURE_ORDER_V2):│
│                                        │       Meteo (in-situ IEMA c/        │
│                                        │       fallback Open-Meteo para PBLH)│
│                                        │       + Lags 24h e 1h IN-SITU       │
│                                        │     - Y (5 alvos):                  │
│                                        │       Ground truth físico IEMA-ES   │
│                                        │       (pm25, pm10, o3, no2, so2)    │
└────────────────────────────────────────┼─────────────────────────────────────┘
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. INGESTÃO OPERACIONAL EM TEMPO REAL (workers/ingestion — Cron :30)        │
│                                                                              │
│  GET https://qualidadedoarapi.es.gov.br/api/mapa                             │
│  GET https://qualidadedoarapi.es.gov.br/api/mapa/{IdEstacao} (1..6, 8, 9)    │
│   │                                                                          │
│   ├──► Grava em `observed_pollutants` (D1) usando `IEMA_SENTINEL = 'IEMA'`   │
│   │    via `buildObservedUpsert()` (ON CONFLICT(station_id, timestamp))      │
│   │    (diferenciando estações no mapa e nos gráficos históricos de 48h!)    │
│   ├──► Mantém `environmental_features` alimentada por `buildFeaturesUpsert()`│
│   │    (PBLH, pressão, radiação e vento NWP do Open-Meteo em UTC)            │
│   └──► Alimenta `pm25_lag1..so2_lag1` e `lag24` reais por estação no         │
│        vetor de features (`FEATURE_ORDER_V2`) antes da inferência ONNX!      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2. Passos Executáveis para Implementação (Frente de Engenharia / ML)

1. **Novo script `ml/training/fetch_iema_insitu.py`:**
   - Baixa as planilhas de `2024`, `2025.1`, `2025.2` e `2026` diretamente de `https://iema.es.gov.br/media/...` usando `zipfile` + `xml.etree.ElementTree.iterparse` da stdlib Python.
   - Detecta automaticamente os dois layouts documentados na Seção 3.2.1:
     - **Formato Legado (`2024` e `2025.1`):** carrega `xl/sharedStrings.xml`, lê 8 linhas de cabeçalho (estação na linha 2, parâmetro por extenso na linha 5, unidade na linha 8), converte o float serial do Excel da coluna 0 (`1899-12-30`) de BRT para UTC e trunca `:30` para `:00`.
     - **Formato Novo (`2025.2` e `2026`):** lê strings inline nas 3 linhas de cabeçalho (estação na linha 2, parâmetro curto na linha 3), converte `CO_ppm (ppm)` de `2025.2` para $\mu\text{g/m}^3$ ($\times 1145$) e converte o timestamp ISO local da coluna 0 de BRT (`UTC-3`) para UTC.
   - Aplica filtro estrito de qualidade: mantém apenas valores numéricos finitos ($0 \le v < 90000$) cuja coluna `Flag`/`Status` adjacente pertença a `{"", " ", "VU", "VI", "VR", "VC"}`.
   - Para poluentes não medidos em determinada estação (ex.: `O3` em `RGV3 Camburi` e `RGV5 Centro`; `PM25` em `RGV8 Cariacica`), aplica interpolação espacial ponderada pelo inverso do quadrado da distância Haversine ($w_i = 1/d_i^2$) usando as estações físicas ativas da RGV na mesma hora, marcando flag de proveniência `in_situ_interpolated`.
   - Salva `ml/data/iema_insitu_raw.json` no mesmo contrato de `openmeteo_raw.json`.
2. **Join MOS em `ml/training/build_real_dataset.py`:**
   - Combina `openmeteo_raw.json` (que fornece `boundary_layer_height` / `pblh_rolling6` e `surface_pressure`/`shortwave_radiation` onde ausentes) com `iema_insitu_raw.json` (que fornece o alvo $Y$ real *in-situ* e os lags `lag24` e `lag1` específicos de cada estação).
   - Preserva intacto o contrato `FEATURE_ORDER_V2` (30 features em [`db/schema.ts`](../../db/schema.ts#L169-L176)) e os 5 alvos (`pm25`, `pm10`, `o3`, `no2`, `so2`).
3. **Ingestão em Tempo Real em [`workers/ingestion/src/index.ts`](../../workers/ingestion/src/index.ts):**
   - No cron `:30`, consulta `https://qualidadedoarapi.es.gov.br/api/mapa` e `/api/mapa/{IdEstacao}` para os IDs da RGV (`1, 2, 3, 4, 5, 6, 8, 9`), com timeout de 5s e fallback gracioso para Open-Meteo (`CAMPS_ANALYSIS_SOURCE` / `CAMPS_FORECAST_SOURCE`) caso a API do IEMA esteja indisponível.
   - Converte o timestamp local (`America/Sao_Paulo`, `UTC-3`) para UTC (`YYYY-MM-DDTHH:00`), inverte o sub-índice horário `ValorIqa` de cada poluente pela tabela CONAMA 491/2018 (`packages/core-iqar/src/iqar.ts`) ou utiliza `Valor` direto quando for o poluente dominante, e executa o upsert em **`observed_pollutants`** via `buildObservedUpsert()` gravando `source = IEMA_SENTINEL` (`"IEMA"`), ao lado do upsert meteorológico em **`environmental_features`** via `buildFeaturesUpsert()`.
   - Com isso, cada estação em `observed_pollutants` passa a exibir imediatamente **seu próprio IQAr físico real e sua própria curva de 48h** no app!
4. **Declaração de Proveniência em `apps/web/public/data/model-eval.json`:**
   - Atualizar `provenance.target_source` de `"CAMS regional (~40km)"` para `"IEMA-ES RAMQAr in-situ (estações físicas RGV1..RGV9, validado CQAI)"`.

