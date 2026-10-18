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
  - [`docs/research/amostras/iema_api_mapa_live.json`](./amostras/iema_api_mapa_live.json)
  - [`docs/research/amostras/iema_api_estacoes_48h_sample.json`](./amostras/iema_api_estacoes_48h_sample.json)
- **Granularidade e Latência:** Horária (`:00` nas estações RGV, `:30` nas estações SUL). Na coleta às `16:48 BRT` de `18/10/2026`, todas as estações RGV ativas já reportavam o dado de `2026-10-18T16:00:00` (latência < 45 minutos).
- **Autenticação, Licença e Limites:** Sem autenticação, cabeçalho `Access-Control-Allow-Origin: *` habilitado, amparado pela Lei Federal nº 14.850/2024 (Política Nacional de Qualidade do Ar) e Lei de Acesso à Informação.
- **Riscos e Observações Técnicas:**
  - O endpoint `/api/mapa/{IdEstacao}` retorna o **sub-índice `ValorIqa`** de cada poluente nas últimas 48h, enquanto `/api/mapa` retorna `Valor` (concentração) apenas para o poluente dominante da hora atual. Contudo, como o sub-índice é uma função linear por partes bijetora em cada faixa ($I_p = I_{\text{ini}} + \frac{I_{\text{fim}} - I_{\text{ini}}}{C_{\text{fim}} - C_{\text{ini}}}(C_p - C_{\text{ini}})$), a concentração equivalente pode ser invertida analiticamente; porém, **atenção**: o cálculo do IQA para MP₂,₅ e MP₁₀ usa média móvel de 24h (e CO/O₃ média de 8h), enquanto SO₂/NO₂ no boletim horário refletem a janela vigente. Por isso, para **treino de modelos ML**, deve-se usar as planilhas horárias de concentração bruta (Seção 3.2), e usar a API `/api/mapa/{id}` no Worker de ingestão para monitoramento ao vivo e cálculo/inversão operacional.

---

### 3.2. IEMA-ES — Planilhas Horárias Históricas Validadas (`iema.es.gov.br`)

Página oficial: `https://iema.es.gov.br/qualidadedoar/dadosdemonitoramento/automatica`

- **Endpoints Exatos Testados (HTTP 200):**
  - **2026 (01/01/2026 a 30/09/2026):** `https://iema.es.gov.br/media/CQAI/medicoes-rgv-01-01-2026-a-30-09-2026.xlsx?v=T13SDnMcPffyo62zX-v5J_Z5pOUejCvDSVCgK64WIjw` (6.373.268 bytes, 6.556 linhas)
  - **2025.2 (01/07/2025 a 31/12/2025):** `https://iema.es.gov.br/media/CQAI/Medi%C3%A7%C3%B5es%20Grande%20Vit%C3%B3ria%20-%2001.07.2025%20a%2031.12.2025.xlsx` (3.629.179 bytes)
  - **2025.1 (01/01/2025 a 30/06/2025):** `https://iema.es.gov.br/media/CQAI/Medi%C3%A7%C3%B5es%20RGV%20-%2001.01.2025%20a%2030.06.2025.xlsx`
  - **2024 (01/01/2024 a 31/12/2024):** `https://iema.es.gov.br/media/Qualidade%20do%20ar/Dados%20RGV%2001.01.2024%20-%2031.12.2024.xlsx` (9.933.977 bytes)
  - **2023 a 2001:** Links diretos `.xlsx` (2020–2023) e `.xls` (2001–2017) listados na mesma página.
- **Amostra Real Salva:** [`docs/research/amostras/iema_ramqar_2026_horaria_sample.csv`](./amostras/iema_ramqar_2026_horaria_sample.csv) (extraída das últimas horas de `2026-09-30` para todas as 8 estações da RGV).
- **Estrutura e Completude Medida em 2026 (`6.553` horas entre Jan–Set/2026):**

| Estação na Planilha IEMA | `TempAr` / `RH` / `Vento` | `PM25 (µg/m³)` | `PM10 (µg/m³)` | `O3 (µg/m³)` | `NO2 (µg/m³)` | `SO2 (µg/m³)` | `CO (µg/m³)` |
|---|---:|---:|---:|---:|---:|---:|---:|
| **EMQAr - RGV1 - Laranjeiras** | 97,4% | **88,8%** | 11,1% | **97,3%** | **69,0%** | **97,4%** | **97,4%** |
| **EMQAr - RGV2 - Carapina** | 98,0% (+ Rad/Press) | **58,1%** | **60,5%** | N/M | N/M | N/M | N/M |
| **EMQAr - RGV3 - Jardim Camburi** | 87,4% | **90,4%** | **88,5%** | N/M | 39,2% | **69,9%** | N/M |
| **EMQAr - RGV4 - Enseada do Sua** | 97,4% (+ Rad/Press) | **99,3%** | **97,1%** | **97,9%** | **97,3%** | **98,1%** | **92,1%** |
| **EMQAr - RGV5 - Vitória-Centro** | 89,1% (s/ vento) | **88,7%** | **88,5%** | N/M | **59,7%** | **88,0%** | 3,0% |
| **EMQAr - RGV6 - Vila Velha-IBES** | 99,6% | **98,4%** | **91,8%** | **95,1%** | 9,4% | **99,6%** | **92,7%** |
| **EMQAr - RGV8 - Vila Capixaba** | 95,0% | 0,0% (flag `!`) | 34,3% | **93,0%** | **94,2%** | **89,5%** | **94,1%** |
| **EMQAr - RGV9 - Cidade Continental** | N/M | **81,6%** | **79,9%** | N/M | **87,3%** | **86,8%** | N/M |

*(N/M = Poluente não monitorado pelo equipamento daquela estação).*

- **Flags de Qualidade (Colunas `Status <Parâmetro>`):**
  - **Válidos:** célula vazia `""`, `"VU"` (Válido pelo Usuário), `"VI"` (Válido pela Inspeção).
  - **Inválidos (devem ser descartados no `build_real_dataset.py`):** `"IU"` (Inválido pelo Usuário, ex.: valores negativos de deriva zero como `-86.2` ou sentinela `-9999`), `"IT"` (Interrupção/Telemetria, com valor `0`), `"ID"` (Indisponível), `"!"` ( Equipamento desabilitado).

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
| `ramqar_serra_jacupemba` *(divergente)* | Jacupemba - Serra *(nota: Jacupemba fica em Aracruz)* | `-20.1750, -40.1900` | **EMQAr - RGV9 — Cidade Continental** (Serra) · `IdEstacao=9` *(ou **EMQAr - RGV2 — Carapina**, Serra, `IdEstacao=2`)* | `RGV9`: `-20.22062, -40.22767`<br>`RGV2`: `-20.23220, -40.25489` | 6,41 km (`RGV9`) | **`RGV9` Ativa (API + XLSX):** `PM25, PM10, NO2, SO2`<br>**`RGV2` Ativa (XLSX):** `PM25, PM10` + Meteo completa |
| `ramqar_paul` *(divergente)* | Paul - Vila Velha | `-20.3297, -40.2960` | **EMQAr - RGV7 — Vila Velha - Centro** (Colégio Marista, Vila Velha) *(desativada; histórico até 2020)* ou mapear `RGV2 Carapina` | `RGV7`: `-20.33709, -40.29022` | 1,02 km (`RGV7`) | `RGV7` desativada pelo IEMA; para operação contínua 2026 usar **EMQAr - RGV2 (Carapina)** ou interpolação IDW (`RGV4` + `RGV5` + `RGV6`) |
| `ramqar_vila_velha_fundo` *(divergente)* | Vila Velha Interior | `-20.3700, -40.3300` | Sem estação física no sul de Vila Velha (ou substituir por `EMQAr - RGV2 Carapina` / `EMQAr - SUL1 Meaípe`) | `SUL1`: `-20.73700, -40.53500` | — | Para manter o contrato de 9 IDs `ramqar_*`, imputar via **IDW Haversine inverso (`1/d²`)** a partir de `RGV6 (IBES, a 2,7 km)` + `RGV8 (Cariacica)` + `RGV4 (Suá)` |

> [!IMPORTANT]
> **Decisão recomendada para o contrato de estações:**
> Como as convenções do AetherML (`AGENTS.md` / `.agents/rules/aetherml-conventions.md`) fixam os 9 IDs `ramqar_*` de `db/seed.sql`, recomendamos:
> 1. Atualizar as coordenadas (`latitude`, `longitude`) das 6 estações diretas + associar `ramqar_serra_jacupemba` → `EMQAr - RGV9 (Cidade Continental, Serra)` e `ramqar_paul` → `EMQAr - RGV2 (Carapina, Serra)` (ou manter `ramqar_paul` e `ramqar_vila_velha_fundo` alimentadas por interpolação espacial IDW ponderada por Haversine $1/d^2$ das estações físicas vizinhas `RGV6 IBES`, `RGV4 Suá` e `RGV5 Centro`, declarando `source = 'IEMA_IDW'`).
> 2. Assim, **8 estações físicas reais da RGV (`RGV1, RGV2, RGV3, RGV4, RGV5, RGV6, RGV8, RGV9`) entram diretamente no pipeline**.

---

## 5. Plano de Integração para o MOS (`specs/08 §2` — $X = \text{CAMS}$, $Y = \text{in-situ}$)

### 5.1. Arquitetura de Dados (Treino Offline vs. Ingestão Edge)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. PIPELINE DE TREINO & BACKTEST MOS (ml/training/ + ml/evaluation/)        │
│                                                                              │
│  [IEMA XLSX 2024..2026] ──► parse_iema_insitu.py                             │
│   (Concentrações µg/m³ +      - Filtra Status in ("", "VU", "VI")            │
│    Meteo in-situ por RGV)     - Descarta "-9999", "IU", "IT", "ID", "!"      │
│                               - Converte timestamp BRT (UTC-3)               │
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
│  GET https://qualidadedoarapi.es.gov.br/api/mapa/{IdEstacao} (1,3,4,5,6,8,9) │
│   │                                                                          │
│   ├──► Grava em `observed_measurements` (D1) com `source = 'IEMA'`           │
│   │    (diferenciando estações no mapa e nos gráficos históricos de 48h!)    │
│   └──► Alimenta `pm25_lag1..so2_lag1` e `lag24` reais por estação no         │
│        vetor de features (`FEATURE_ORDER_V2`) antes da inferência ONNX!      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2. Passos Executáveis para Implementação (Frente de Engenharia / ML)

1. **Novo script `ml/training/fetch_iema_insitu.py`:**
   - Baixa `medicoes-rgv-01-01-2026-a-30-09-2026.xlsx` e `Medições Grande Vitória - 01.07.2025 a 31.12.2025.xlsx` diretamente de `https://iema.es.gov.br/media/CQAI/...` (usando `zipfile` + `xml.etree.ElementTree.iterparse` da biblioteca padrão Python — zero dependências pesadas, parseia 6.553 horas em ~2 segundos).
   - Aplica filtro estrito de qualidade: mantém apenas valores numéricos $\ge 0$ cuja coluna `Status` adjacente seja `""`, `"VU"` ou `"VI"`.
   - Para poluentes não medidos em determinada estação (ex.: `O3` em `RGV3 Camburi` e `RGV5 Centro`; `PM25` em `RGV8 Cariacica`), aplica interpolação espacial ponderada pelo inverso do quadrado da distância Haversine ($w_i = 1/d_i^2$) usando as estações físicas ativas da RGV na mesma hora, marcando flag de proveniência `in_situ_interpolated`.
   - Salva `ml/data/iema_insitu_raw.json` no mesmo contrato de `openmeteo_raw.json`.
2. **Join MOS em `ml/training/build_real_dataset.py`:**
   - Combina `openmeteo_raw.json` (que fornece `boundary_layer_height` / `pblh_rolling6` e `surface_pressure`/`shortwave_radiation` onde ausentes) com `iema_insitu_raw.json` (que fornece o alvo $Y$ real *in-situ* e os lags `lag24` e `lag1` específicos de cada estação).
   - Preserva intacto o contrato `FEATURE_ORDER_V2` (30 features) e os 5 alvos (`pm25`, `pm10`, `o3`, `no2`, `so2`).
3. **Ingestão em Tempo Real em `workers/ingestion/src/index.ts`:**
   - No cron `:30`, consulta `https://qualidadedoarapi.es.gov.br/api/mapa` e `/api/mapa/{IdEstacao}` (timeout 5s, fallback gracioso para Open-Meteo se indisponível).
   - Converte o sub-índice horário `ValorIqa` de cada poluente pela função inversa da tabela IQAr (`packages/core-iqar`) ou usa `Valor` direto quando for o poluente dominante, gravando em `observed_measurements` com `source = 'IEMA'`.
   - Com isso, cada uma das 9 estações passa a exibir imediatamente **seu próprio IQAr físico real e sua própria curva de 48h** no app!
4. **Declaração de Proveniência em `apps/web/public/data/model-eval.json`:**
   - Atualizar `provenance.target_source` de `"CAMS regional (~40km)"` para `"IEMA-ES RAMQAr in-situ (estações físicas RGV1..RGV9, validado CQAI)"`.
