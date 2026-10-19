# 10 — Auditoria Numérica de Variância Espacial e Plano MOS In-Situ (IEMA-ES)

Este documento consolida:
1. A **auditoria numérica reproduzível** da variância espacial entre as 9 estações RAMQAr na RMGV (`ml/evaluation/audit_spatial_variance.py`);
2. A **proposta de mapeamento canônico `db/seed.sql` ↔ `EMQAr RGV1..RGV9`** (baseada na validação da Sonda em `docs/research/fontes-insitu.md`, commit `9156284`, aguardando aprovação do Maestro antes de alterar dados);
3. A **divisão arquitetural do MOS** em **(a) Dataset MOS ($X/Y$)**, **(b) Treino + Avaliação com Backtest In-Situ** e **(c) Escopo Worker / Web**.

---

## 1. Como Reproduzir a Auditoria Numérica

> [!NOTE]
> **Ambiente de Execução:** Os comandos Python abaixo com `/home/gabrielfs/.venvs/aetherml/bin/python` devem ser executados dentro do container distrobox (`agy-pessoal`), onde o ambiente virtual e bibliotecas de ML residem (o host foi alterado no upgrade de 13/10).

```bash
# Relatório em Markdown (padrão)
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/evaluation/audit_spatial_variance.py

# Saída estruturada em JSON
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/evaluation/audit_spatial_variance.py --json

# Testes automatizados da auditoria
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/evaluation/test_audit_spatial_variance.py
```

---

## 2. Evidência Quantitativa por Camada

### 2.1 Coordenadas Cadastradas (`db/seed.sql` e `ml/training/fetch_openmeteo.py`)
- **Estações**: 9 estações RAMQAr cadastradas, com **9/9 pares `(latitude, longitude)` distintos** (zero coordenadas duplicadas).
- **Menor distância par-a-par**: **2,13 km** (`ramqar_enseada_sua` ↔ `ramqar_paul`).
- **Maior distância par-a-par**: **26,142 km** (`ramqar_serra_jacupemba` ↔ `ramqar_vila_velha_fundo`).
- **Conclusão**: a baixa diferenciação espacial **não** decorre de duplicação no seed, mas da resolução espacial da grade CAMS global (~0,4° ≈ 40 km).

### 2.2 Série Bruta `ml/data/openmeteo_raw.json` (2.352 horas × 9 estações)

#### Qualidade do Ar (`aq_hourly` — CAMS Global ~40 km)
| Variável | Curvas Distintas (9 Estações) | Valores Únicos (Pool) | MAD Par-a-Par (Core-8) | Max Delta (Core-8) | Correlação Mínima (Core-8) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `pm2_5` | **2/9** | 199 | `0.0000` | `0.0000` | `1.000000` |
| `pm10` | **2/9** | 266 | `0.0000` | `0.0000` | `1.000000` |
| `ozone` | **2/9** | 136 | `0.0000` | `0.0000` | `1.000000` |
| `nitrogen_dioxide` | **2/9** | 262 | `0.0000` | `0.0000` | `1.000000` |
| `sulphur_dioxide` | **2/9** | 210 | `0.0000` | `0.0000` | `1.000000` |

- As **8 estações centrais da RMGV** (`ramqar_camburi`, `ramqar_enseada_sua`, `ramqar_vitoria_centro`, `ramqar_ibes`, `ramqar_paul`, `ramqar_cariacica`, `ramqar_serra_laranjeiras`, `ramqar_vila_velha_fundo`, todas ao sul de `-20.20°`) caem **exatamente no mesmo pixel da grade CAMS** (`MAD = 0.0`, `max_delta = 0.0`, `r = 1.000000`).
- Apenas `ramqar_serra_jacupemba` (`-20.1750, -40.1900`, ao norte de `-20.20°`) cai no pixel CAMS adjacente ao norte.

#### Meteorologia (`meteo_hourly` — Open-Meteo ~9–11 km + DEM)
| Variável | Curvas Distintas (2.352h) | Curvas Distintas (120h Forecast) | Valores Únicos (Pool) | MAD Médio Par-a-Par | Max Delta Par-a-Par |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `temperature_2m` | **9/9** | **5/9** | 176 | `0.3403 °C` | `4.3000 °C` |
| `relative_humidity_2m` | **5/9** | **5/9** | 59 | `1.9700 %` | `30.0000 %` |
| `wind_speed_10m` | **5/9** | **5/9** | 267 | `1.7163 km/h` | `20.1000 km/h` |
| `wind_direction_10m` | **5/9** | **5/9** | 358 | `46.1900 °` | `360.0000 °` |
| `pressure_msl` | **5/9** | **5/9** | 206 | `0.1152 hPa` | `1.2000 hPa` |
| `shortwave_radiation` | **5/9** | **5/9** | 960 | `9.7503 W/m²` | `394.0000 W/m²` |
| `boundary_layer_height` | **5/9** | **5/9** | 336 | `67.3069 m` | `1560.0000 m` |

- Na janela de previsão de 120h, as 9 estações colapsam em **5 células meteorológicas**:
  1. **Cluster Meteo A (idêntico)**: `ramqar_camburi == ramqar_enseada_sua == ramqar_paul`
  2. **Cluster Meteo B (idêntico)**: `ramqar_vitoria_centro == ramqar_ibes == ramqar_vila_velha_fundo`
  3. `ramqar_cariacica`
  4. `ramqar_serra_laranjeiras`
  5. `ramqar_serra_jacupemba`

### 2.3 Por que `comparison-data.json` e `forecast-compare.json` têm apenas 7/9 curvas ML distintas
| Poluente | Curvas ML (Holdout 168h) | MAD Máx Core-8 (Holdout 1-step) | Corr Mín Core-8 (Holdout) | Curvas ML (Forecast 120h) | MAD Máx Core-8 (Forecast) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `pm25` | **7/9** | `0.2599 µg/m³` | `0.992873` | **7/9** | `2.7587 µg/m³` |
| `pm10` | **6/9** | `0.2887 µg/m³` | `0.993644` | **7/9** | `3.4072 µg/m³` |
| `o3` | **7/9** | `1.0607 µg/m³` | `0.998796` | **7/9** | `16.5290 µg/m³` |
| `no2` | **7/9** | `0.3230 µg/m³` | `0.997483` | **7/9** | `4.0827 µg/m³` |
| `so2` | **7/9** | `0.2786 µg/m³` | `0.993246` | **7/9** | `5.8566 µg/m³` |

- No **Cluster A**, `ramqar_enseada_sua` tem `bridge_proximity: True`, enquanto `ramqar_camburi` e `ramqar_paul` têm ambos `bridge_proximity: False, traffic_heavy: False` $\implies$ **`ramqar_camburi == ramqar_paul` (`MAD = 0.0000`)**.
- No **Cluster B**, `ramqar_vitoria_centro` tem `traffic_heavy: True`, enquanto `ramqar_ibes` e `ramqar_vila_velha_fundo` têm ambos `bridge_proximity: False, traffic_heavy: False` $\implies$ **`ramqar_ibes == ramqar_vila_velha_fundo` (`MAD = 0.0000`)**.

---

## 3. Proposta de Decisão para `db/seed.sql` (Para Aprovação do Maestro)

A convenção do projeto fixa os 9 IDs `ramqar_*`. Cruzando com as 8 estações ativas nas planilhas horárias 2024–2026 do IEMA (`EMQAr - RGV1..RGV6, RGV8, RGV9`), propomos a seguinte decisão canônica (sem alterar `db/seed.sql` até aprovação do Maestro):

1. **6 Estações com Casamento Direto 1:1 (`source = 'IEMA'`)**:
   - `ramqar_serra_laranjeiras` $\leftrightarrow$ **`EMQAr - RGV1 - Laranjeiras`** (`IdEstacao=1`, `-20.19614, -40.24521`)
   - `ramqar_camburi` $\leftrightarrow$ **`EMQAr - RGV3 - Jardim Camburi`** (`IdEstacao=3`, `-20.25514, -40.26967`)
   - `ramqar_enseada_sua` $\leftrightarrow$ **`EMQAr - RGV4 - Enseada do Sua`** (`IdEstacao=4`, `-20.31330, -40.29069`)
   - `ramqar_vitoria_centro` $\leftrightarrow$ **`EMQAr - RGV5 - Vitória-Centro`** (`IdEstacao=5`, `-20.32070, -40.33297`)
   - `ramqar_ibes` $\leftrightarrow$ **`EMQAr - RGV6 - Vila Velha-IBES`** (`IdEstacao=6`, `-20.34865, -40.31742`)
   - `ramqar_cariacica` $\leftrightarrow$ **`EMQAr - RGV8 - Vila Capixaba`** (`IdEstacao=8`, `-20.34201, -40.40218`)
2. **3 Estações Divergentes (Decisão Recomendada)**:
   - **`ramqar_serra_jacupemba` $\to$ `EMQAr - RGV9 - Cidade Continental` (`IdEstacao=9`, `-20.22062, -40.22767`, `source = 'IEMA'`)**: Jacupemba pertence a Aracruz; `RGV9` é a estação física oficial do IEMA no setor norte/costeiro da Serra e está ativa tanto na planilha XLSX (`PM25, PM10, NO2, SO2` com >80% completude) quanto na API PRODEST.
   - **`ramqar_paul` $\to$ Opção recomendada: IDW Haversine $1/d^2$ sobre `RGV4 (Suá) + RGV5 (Centro) + RGV6 (IBES)` com `source = 'IEMA_IDW'` (mantendo coordenada `-20.33709, -40.29022` da antiga `RGV7` em Vila Velha) — ou associar `RGV2 Carapina` para não perder a 8ª estação física**:
     - *Por que não mapear `ramqar_paul` diretamente para `RGV2 Carapina` sem ressalva?* Porque `Paul` fica em Vila Velha (baía sul, entre Vitória Centro, Enseada do Suá e IBES), enquanto `RGV2 Carapina` fica na Serra (13 km ao norte) e só mede `PM25` e `PM10` (sem gases `O3/NO2/SO2`). Usar `RGV2` como estação doadora na malha IDW regional e interpolar `ramqar_paul` via IDW $1/d^2$ a partir das vizinhas imediatas (`RGV4` a 2,7 km, `RGV5` a 4,8 km e `RGV6` a 3,1 km) preserva a coerência geográfica de Vila Velha.
   - **`ramqar_vila_velha_fundo` $\to$ IDW Haversine $1/d^2$ com `source = 'IEMA_IDW'`**: não há estação física no sul/interior de Vila Velha; recebe interpolação espacial ponderada por $w_i = 1/d_i^2$ a partir das estações físicas ativas da RGV (`RGV6 IBES` a 2,7 km, `RGV4 Suá`, `RGV8 Cariacica`), declarando explicitamente `source = 'IEMA_IDW'`.

---

## 4. Divisão do Plano de Execução MOS: (a) Dataset, (b) Treino + Backtest, (c) Worker / Web

### (a) Dataset MOS ($X / Y$) — Escopo `ml/training/`
1. **Parser `ml/training/fetch_iema_insitu.py` $\to$ `ml/data/iema_insitu_raw.json`**:
   - Usa apenas biblioteca padrão (`zipfile` + `xml.etree.ElementTree.iterparse` + `urllib.request`) para ler as planilhas oficiais `.xlsx` do IEMA-ES (2024, 2025.1, 2025.2 e 2026 Jan–Set, ~6.553h em 2026).
   - **Mapeamento estrito de estações e isolamento de colunas (Fix C1 & R3)**: mapa canônico explícito dos 10 blocos físicos (`RGV1` a `RGV10`); blocos industriais ou fora do contrato canônico (`RGV10 Ponta Formosa`, `RGV7 Vila Velha-Centro` e `RGV2 Carapina` — ausente nos 9 IDs de `db/seed.sql`) são mapeados explicitamente como `None` e redefinem `curr_station = None` por coluna (evitando herança acidental de blocos vizinhos). Qualquer emissão de estação fora dos 9 IDs canônicos levanta `ValueError` imediatamente.
   - **Filtro de qualidade e extração de flags (Fix C2 & R5)**:
     - No layout moderno (linha 3), flags vêm de `Status <Parâmetro>`.
     - No layout legado (linha 8 == `"Flag"`), herda o parâmetro da coluna de valor à esquerda (`c_idx - 1`).
     - **Pareamento Estrito de Flags por Par de Colunas (Fix F1)**: quando uma estação possui múltiplas colunas para o mesmo parâmetro (ex.: sensores de vento principal e redundante, ou CO em ppm e $\mu\text{g/m}^3$), a flag é validada estritamente por par (`value_col` com a sua respectiva `flag_col = value_col + 1`), impedindo que uma flag vazia de coluna redundante sobrescreva a flag de erro da coluna principal. Mantém apenas medições numéricas $\ge 0$ cuja flag específica do par seja válida (`""`, `" "`, `"VU"`, `"VR"` ou `"VI"`), descartando sentinelas (`-9999`, `99999`) e flags de erro (`"IU"`, `"IT"`, `"ID"`, `"IF"`, `"!"`).
     - **Cálculo de Cobertura Real (`total_hours`)**: registros 100% vazios (sem nenhuma medição válida) são descartados antes do sumário, garantindo que `total_hours` reflita a cobertura horária real da estação e não o total de linhas brutas da planilha.
   - **Normalização física e temporal**:
     - Converte timestamps locais `BRT (UTC-3)` para `UTC` (`+3h`, formato `YYYY-MM-DDTHH:00`) para alinhar 1:1 com `openmeteo_raw.json` (truncando horários `:30` da planilha legado para `:00`).
     - Fator de conversão de CO em 2025.2 (`CO_ppm`): `CO_PPM_TO_UGM3 = 1145.6` ($28.01 / 24.45 \approx 1145.6\ \mu\text{g/m}^3\text{ per ppm}$ a 25 °C e 1 atm, reconciliado física e empiricamente com o IEMA).
     - Ignora a coluna "Temperatura Interna" (abrigo do sensor) para evitar contaminação de `TempAr`.
     - **Unidade de Vento (Fix R4)**: Converte `VelVento` in-situ de `m/s` para `km/h` (`* 3.6`) ao gravar `wind_speed_10m`, compatibilizando a entrada com `row_to_features` que divide `wind_speed_10m` por `3.6`.
   - **Regra de Ausência no Alvo $Y$ (SEM IDW em $Y$) (Fix C3)**: para pares `(estação, poluente)` não monitorados pela estação física (ex.: `O3` em `RGV3`/`RGV5`/`RGV9`; `PM25` em `RGV8`), o alvo $Y$ permanece `None`/ausente (sem imputação IDW no ground truth de treino!). Os consumidores em `train_lightgbm.py` e `evaluate_champion.py` aplicam máscara explícita de finitude (`np.isfinite`) por alvo, treinando e avaliando cada modelo sem NaN silencioso.
2. **Join MOS em `ml/training/build_real_dataset.py` e `ml/training/fetch_from_d1.py`**:
   - **CLI Opt-In Explícito (Fix R1)**: `--insitu` em `build_real_dataset.py` é opt-in explícito (`default=None`); a execução padrão não auto-detecta o JSON in-situ silenciosamente.
   - **Contrato de features**: `FEATURE_ORDER_V2` (em `db/schema.ts`) e `FEATURE_NAMES_V2` (em `packages/inference-client/src/features.ts`) são idênticos em ordem e nomes (30 features: 25 features canônicas da V1 seguidas por 5 lags de 1h: `pm25_lag1`, `pm10_lag1`, `no2_lag1`, `o3_lag1`, `so2_lag1`).
   - **Alvo $Y$**: concentrações horárias brutas $\mu\text{g/m}^3$ in-situ do IEMA provenientes do parser XLSX (`pm25, pm10, o3, no2, so2`).
   - **CAVEAT Crítico do D1 (`source='IEMA'`) (Fix R2 & C3-do-córtex)**:
     - As linhas gravadas no D1 pelo worker representam equivalentes de janelas regulatórias (sub-índices invertidos sobre médias móveis de 24h/8h/1h), **NÃO** verdade horária instantânea. Para evitar contaminação do treino horário, `allow_d1_regulatory_as_y=False` é o padrão fail-safe em `fetch_from_d1.py` / `merge_d1_with_meteo`; o uso como $Y$ exige flag explícita `allow_d1_regulatory_as_y=True`.
     - Paginação por keyset ordenada estritamente por `(timestamp ASC, station_id ASC, id ASC)`, com desempate total por `id` (UUID), eliminando saltos de linhas em grupos multi-fonte na fronteira de página de 1.000 registros.
   - **Preditores $X$ (`FEATURE_ORDER_V2` / `FEATURE_NAMES_V2`)**:
     - `pm25_lag24..o3_lag24` (índices 20..23) e `pm25_lag1..so2_lag1` (índices 25..29): lags in-situ da própria estação em $t-24\text{h}$ e $t-1\text{h}$ (com fallback por variável para `cams_aq_hourly` quando houver lacuna de manutenção na hora do lag).
     - Meteorologia (índices 0..8): **atualmente dormente ("a implementar")** — `observed_pollutants` no D1 não possui colunas meteorológicas e `fetch_from_d1.py` faz `SELECT` apenas de poluentes. Portanto, as features meteorológicas vêm do Open-Meteo `cams_meteo_hourly` (temperatura, umidade, vento, pressão, radiação e PBLH). O contrato futuro para meteo in-situ requer migração de schema (`temp_c`, `humidity_pct`, `wind_speed_ms`, `wind_dir_deg`) + ajuste no `SELECT` do D1 e merge no builder.

### (b) Treino + Avaliação com Backtest In-Situ — Escopo `ml/training/` + `ml/evaluation/`
1. **Split temporal sem vazamento (Zero Data Leakage)**:
   - Reserva as últimas **168h (7 dias)** da janela histórica validada do IEMA (ex.: `2026-09-24T00:00Z` a `2026-09-30T23:00Z`) como holdout comum em `extract_holdout_from_raw` (`ml/training/evaluate_champion.py`).
   - Treina os 5 modelos LightGBM Challenger (`order="v2"`, 30 features) exclusivamente nas horas anteriores a `holdout_start` (`end_cutoff`), ajustando a calibração isotônica (`calibrate.py`) sem tocar no holdout.
2. **Backtest In-Situ Pareado (`evaluate_champion.py`, `eval_holdout.py`, `build_comparison.py`)**:
   - Avalia `ml` (LightGBM V2 calibrado com lags in-situ) vs `ground truth IEMA` e vs `baseline CAMS` nas 9 estações durante as 168h de holdout.
   - Roda `ml/evaluation/audit_spatial_variance.py` sobre os novos artefatos para comprovar numericamente a quebra dos clusters idênticos (`9/9` curvas distintas e MAD par-a-par real entre estações).

### (c) O Que Fica para o Worker e para o Web — Escopo `workers/ingestion` (Veio) + `apps/web` (Vitral)
1. **Worker de Ingestão em Tempo Real (`workers/ingestion`, frente do Veio)**:
   - No cron `:30`, consultar `GET https://qualidadedoarapi.es.gov.br/api/mapa` e `GET https://qualidadedoarapi.es.gov.br/api/mapa/{IdEstacao}` (janela móvel de 48h).
   - Gravar em `observed_pollutants` (D1) com `source = 'IEMA'` (e `'IEMA_IDW'` para estações interpoladas), fornecendo os lags reais `lag1` e `lag24` por estação para a inferência ONNX (`FEATURE_ORDER_V2`) na borda.
   - Em caso de consulta local com exigência de D1, utilizar a variável de ambiente `D1_REQUIRED=1` (não há flag `--d1-required`).
2. **Web / Artefatos Públicos (`apps/web`)**:
   - Enquanto os modelos ativos em produção (`apps/web/public/models/`) ainda forem os treinados no CAMS, a UI mantém os avisos honestos já aplicados neste floor (`previsão regional CAMS ~40 km + correção local de meteo; diferenciação por estação virá com in-situ/MOS`).
   - Assim que o Challenger MOS (`Y=IEMA`, `X=lags in-situ + meteo Open-Meteo`) for promovido e o Worker popular `source='IEMA'`, atualizar `model-eval.json`, `comparison-data.json`, `forecast-compare.json` e o rótulo de proveniência para refletir a calibração in-situ ativa.
