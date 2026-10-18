# 10 — Auditoria Numérica de Variância Espacial e Preparação MOS (In-Situ)

Este documento consolida:
1. A **auditoria numérica reproduzível** da variância espacial entre as 9 estações RAMQAr na RMGV (`ml/evaluation/audit_spatial_variance.py`);
2. A **arquitetura de treino MOS (*Model Output Statistics*)** implementada em `ml/training/fetch_from_d1.py`, `ml/training/build_real_dataset.py` e `ml/training/evaluate_champion.py`;
3. O **passo a passo operacional (runbook)** para ativar a calibração por estação assim que a fonte *in-situ* (`source='IEMA'`) for entregue no Cloudflare D1.

---

## 1. Como Reproduzir a Auditoria Numérica

```bash
# Relatório em Markdown (padrão)
PYTHONPATH=. python ml/evaluation/audit_spatial_variance.py

# Saída estruturada em JSON
PYTHONPATH=. python ml/evaluation/audit_spatial_variance.py --json

# Testes automatizados da auditoria
PYTHONPATH=. python ml/evaluation/test_audit_spatial_variance.py
```

---

## 2. Evidência Quantitativa por Camada

### 2.1 Coordenadas Cadastradas (`db/seed.sql` e `ml/training/fetch_openmeteo.py`)
- **Estações**: 9 estações RAMQAr cadastradas, com **9/9 pares `(latitude, longitude)` distintos** (zero coordenadas duplicadas).
- **Menor distância par-a-par**: **2,13 km** (`ramqar_enseada_sua` ↔ `ramqar_paul`).
- **Maior distância par-a-par**: **26,142 km** (`ramqar_serra_jacupemba` ↔ `ramqar_vila_velha_fundo`).
- **Conclusão**: a baixa diferenciação espacial **não** decorre de erro no cadastro de coordenadas (`db/seed.sql`), mas da resolução espacial da reanálise/previsão atmosférica CAMS global (~0,4° ≈ 40 km).

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

- Na janela de previsão de 120h (e em todas as variáveis exceto `temperature_2m` no arquivo histórico com correção de altitude DEM), as 9 estações colapsam em **5 células meteorológicas**:
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

- Dentro do **Cluster Meteo A**, `ramqar_enseada_sua` possui `bridge_proximity: True` (que multiplica o proxy determinístico de tráfego em `build_real_dataset.py:traffic_proxy`), enquanto `ramqar_camburi` e `ramqar_paul` têm ambos `bridge_proximity: False, traffic_heavy: False`. Como recebem exatamente o mesmo vetor de 30 features em todas as horas, **`ramqar_camburi == ramqar_paul` (`MAD = 0.0000`)**.
- Dentro do **Cluster Meteo B**, `ramqar_vitoria_centro` possui `traffic_heavy: True`, enquanto `ramqar_ibes` e `ramqar_vila_velha_fundo` têm ambos `bridge_proximity: False, traffic_heavy: False`. Logo, **`ramqar_ibes == ramqar_vila_velha_fundo` (`MAD = 0.0000`)**.
- No snapshot inicial de `stations-data.json` (`step=0`), todas as 9 estações apresentam **`IQAr = 40` (Boa, O₃)** e **`no2 = 3.0 µg/m³`** (cravado no piso operacional `CLAMPS["no2"] = 3.0`).

---

## 3. Arquitetura MOS Preparada (`Y = IEMA`, `X = CAMS + meteo`)

Para resolver a causa raiz sem inventar offsets estáticos por estação, o pipeline de treinamento foi preparado para operar como **Model Output Statistics (MOS)** assim que houver medições reais das estações na tabela `observed_pollutants` com `source = 'IEMA'`:

1. **Separação Estrita de Fontes no Merge (`ml/training/fetch_from_d1.py:merge_d1_with_meteo`)**:
   - Extrai todos os registros de `observed_pollutants` do D1 e separa explicitamente `source == 'IEMA'` no dicionário por estação `insitu_hourly` (indexado por timestamp normalizado `YYYY-MM-DDTHH:MM`).
   - Em empates de timestamp entre `IEMA` e `open-meteo-cams-*`, prioriza sempre `IEMA`.
   - Preserva integralmente a grade contínua de 92 dias do Open-Meteo/CAMS em `cams_aq_hourly` e `cams_meteo_hourly`, garantindo que o buffer de lags de 30h (`t-24`, `t-1` e média móvel de 6h de `pblh`) nunca seja truncado mesmo quando o D1 possui janelas curtas ou falhas de sensor.
   - Anota em `provenance`:
     - `target_mode`: `"mos_insitu"` (quando `insitu_records_count > 0`) ou `"cams_fallback"` (quando `insitu_records_count == 0`).
     - `insitu_stations` e `insitu_records_count`.

2. **Construção do Dataset MOS (`ml/training/build_real_dataset.py:build_real_dataset`)**:
   - **Modo MOS (`target_mode == "mos_insitu"`)**:
     - **Alvo (`Y`)**: lido estritamente de `insitu_hourly` (`source = 'IEMA'`). Horas que só possuem `open-meteo-cams-*` nunca são misturadas em `Y`.
     - **Preditores (`X`)**: lidos de `cams_aq_hourly` + `cams_meteo_hourly` (`CAMS + meteo` — lags de 24h, lags de 1h, proxies de satélite, variáveis meteorológicas horárias e flags da estação). Assim, o modelo aprende a corrigir o fundo regional CAMS para a realidade microambiental de cada estação, mantendo compatibilidade total com a inferência de 120h no navegador/Worker (onde apenas previsões CAMS + meteo existem no futuro).
   - **Modo Fallback (`target_mode == "cams_fallback"`)**:
     - Quando não há nenhum registro `source = 'IEMA'` no D1 (ou quando executado em modo `--source local`), preserva 100% do comportamento atual (`Y = CAMS`, `X = CAMS + meteo`).

---

## 4. Passo a Passo (Runbook) Quando a Sonda Entregar a Fonte In-Situ

Quando o conector de dados *in-situ* do IEMA popular a tabela `observed_pollutants` do Cloudflare D1:

### Passo 1 — Verificar Contrato de Ingestão no D1
Certifique-se de que os registros gravados em `observed_pollutants` obedecem a:
- `station_id`: ID canônico da estação (`ramqar_camburi`, `ramqar_enseada_sua`, `ramqar_vitoria_centro`, `ramqar_ibes`, `ramqar_paul`, `ramqar_cariacica`, `ramqar_serra_laranjeiras`, `ramqar_serra_jacupemba`, `ramqar_vila_velha_fundo`);
- `timestamp`: horário UTC em formato ISO (`YYYY-MM-DDTHH:00:00Z`);
- `source`: exatamente `'IEMA'` (case-sensitive);
- `pm25`, `pm10`, `o3`, `no2`, `so2`: concentrações medidas em `µg/m³` (`NULL` quando o analisador de um poluente específico estiver em manutenção).

### Passo 2 — Atualizar Grade CAMS/Meteo e Extrair Dados do D1
```bash
export CLOUDFLARE_ACCOUNT_ID="<account_id>"
export D1_DATABASE_ID="<database_id>"
export CLOUDFLARE_API_TOKEN="<api_token>"

# 1. Atualiza a grade contínua CAMS + meteorologia (92 dias + 120h forecast)
/home/gabrielfs/.venvs/aetherml/bin/python ml/training/fetch_openmeteo.py

# 2. Extrai observed_pollutants do D1 e inspeciona contagem de source='IEMA'
/home/gabrielfs/.venvs/aetherml/bin/python ml/training/fetch_from_d1.py
```
Verifique no console que `Fontes: {'IEMA': <N>, ...}` reporta `N > 0` registros.

### Passo 3 — Executar Retreino com `--source d1`
```bash
/home/gabrielfs/.venvs/aetherml/bin/python ml/training/retrain_real.py --source d1 --d1-required
```
- O pipeline executará automaticamente `merge_d1_with_meteo`, ativará `target_mode = "mos_insitu"`, construirá `ml/data/train_dataset_real.json` com `Y = IEMA` e `X = CAMS + meteo`, avaliará o Challenger contra o Champion no holdout temporal de 168h e atualizará os artefatos ONNX/JSON promovidos.

### Passo 4 — Regenerar Artefatos de Comparação e Auditar Variância Espacial
```bash
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/training/predict_forecast.py
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/evaluation/build_comparison.py
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/evaluation/build_forecast_compare.py
PYTHONPATH=. /home/gabrielfs/.venvs/aetherml/bin/python ml/evaluation/audit_spatial_variance.py
```
Confirme no relatório do `audit_spatial_variance.py` o ganho de curvas distintas e o aumento do MAD par-a-par entre as estações calibradas com `source='IEMA'`.
