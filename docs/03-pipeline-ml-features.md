# AetherML — 03 Pipeline de Machine Learning e Ordem Canônica de Features

O módulo preditivo do AetherML apoia-se em regressores LightGBM treinados de forma independente para cada um dos 5 alvos regulatórios, convertidos para o padrão aberto ONNX (`ai.onnx.ml:TreeEnsembleRegressor`).

---

## 1. Ordem Canônica das 25 Features (FEATURE_ORDER_V1)

Para garantir compatibilidade estrita e imutabilidade entre os tensores de entrada serializados e o runtime WebAssembly no navegador, a ordem das features é rigorosamente fixada em:

```
 0: temperature                  (Temperatura do ar a 2m, °C)
 1: relative_humidity            (Umidade relativa do ar, %)
 2: wind_speed                   (Velocidade do vento a 10m, m/s)
 3: wind_direction               (Direção meteorológica do vento, graus 0-360°)
 4: wind_u                       (Componente zonal do vento: -spd * sin(rad))
 5: wind_v                       (Componente meridional do vento: -spd * cos(rad))
 6: boundary_layer_height        (Altura da Camada Limite Planetária - PBLH, metros)
 7: surface_pressure             (Pressão atmosférica ao nível da superfície, hPa)
 8: solar_radiation              (Radiação solar global de onda curta, W/m²)
 9: hour_sin                     (Componente cíclica do horário do dia: sin(2π·h/24))
10: hour_cos                     (Componente cíclica do horário do dia: cos(2π·h/24))
11: dow_sin                      (Componente cíclica do dia da semana: sin(2π·dow/7))
12: dow_cos                      (Componente cíclica do dia da semana: cos(2π·dow/7))
13: is_weekend                   (Flag binária indicadora de fim de semana: 0 ou 1)
14: traffic_speed_avg            (Velocidade média de tráfego nas artérias/pontes, km/h)
15: traffic_delay_ratio          (Razão de atraso de circulação: tempo_real / tempo_livre)
16: traffic_congestion_index     (Índice normalizado de congestionamento contínuo, 0.0-1.0)
17: satellite_aod                (Profundidade Óptica de Aerossóis - MODIS MAIAC 550nm)
18: satellite_tropomi_no2        (Coluna troposférica integrada - Sentinel-5P TROPOMI)
19: satellite_uvai               (Índice Ultravioleta de Aerossóis - UVAI Sentinel-5P)
20: pm25_lag24                   (Concentração observada de PM2.5 há 24 horas, µg/m³)
21: pm10_lag24                   (Concentração observada de PM10 há 24 horas, µg/m³)
22: no2_lag24                    (Concentração observada de NO2 há 24 horas, µg/m³)
23: o3_lag24                     (Concentração observada de O3 há 24 horas, µg/m³)
24: pblh_rolling6                (Média móvel de 6 horas da altura da camada limite, metros)
```

> [!IMPORTANT]
> Versões futuras do modelo jamais reordenam as features existentes. Novas variáveis serão sempre acrescentadas ao final do vetor (apêndice $N+1$).

## 1.1. Extensão V2 — Lags Autoregressivos de 1h (FEATURE_ORDER_V2)

A V1 provou-se cega à escalada intradiária de episódios (só havia lag de 24h). A V2 **anexa** 5 variáveis ao final, sem tocar nos índices 0–24:

```
25: pm25_lag1   (PM2.5 há 1 hora, µg/m³ — real no passo 1, recursivo depois)
26: pm10_lag1   (PM10 há 1 hora, µg/m³)
27: no2_lag1    (NO2 há 1 hora, µg/m³)
28: o3_lag1     (O3 há 1 hora, µg/m³)
29: so2_lag1    (SO2 há 1 hora, µg/m³)
```

Contrato em `db/schema.ts` (`FEATURE_ORDER_V2`), worker ONNX com dimensão dinâmica e manifesto `registry.json` com `feature_order_version`. Efeito medido no mesmo holdout: faixa IQAr 80,8% → **91,9%** (detalhes e protocolo no guia 09).

---

## 2. Restrições Monotônicas (Monotonic Constraints)

Para evitar que o modelo aprenda correlações espúrias que violem leis físicas da dispersão atmosférica, o LightGBM é treinado com restrições monotônicas estritas:

- Mais emissão → nunca menos poluição (monotonia positiva).
- Mais vento ou PBLH mais alta → nunca mais poluição (monotonia negativa).

Isso assegura que reduções de tráfego ou aumento na velocidade dos ventos jamais produzam aumentos paradoxais nas concentrações previstas.

---

## 3. Gates de Qualidade para Deploy

Nenhum modelo é promovido para a pasta de produção ou sincronizado com o Cloudflare R2 caso não atinja os critérios mínimos de validação:

- **Particulados ($PM_{2.5}$ e $PM_{10}$)**: $R^2 \ge 0.65$ e $MAE \le 4.5\,\mu g/m^3$.
- **Fotoquímicos ($O_3$ e $NO_2$)**: $R^2 \ge 0.55$ e $MAE \le 6.0\,\mu g/m^3$.
- **Tamanho do Arquivo Serializado**: Estritamente inferior a **1,5 MB** por modelo.
- **Segurança Criptográfica**: Hash SHA-256 gerado e registrado no manifesto `registry.json`.

---

## 4. Calibração e Pesos (só treino, nunca holdout)

- **Viés médio** por alvo (remove erro sistemático, ex.: O₃ com −5,5).
- **Pesos de fronteira ×3** nas amostras com índice próximo de 40 (a faixa erra nas bordas).
- **Isotônica (PAVA)** na cauda de validação — usada na V1; na V2 o lag1 já resolve a compressão e a isotônica foi desligada.
- **Calibração versionada** em `models/<versão>/calibration.json` (espelho em `apps/web/public/models/`), aplicada identicamente em `predict_forecast.py` e `eval_holdout.py`.
