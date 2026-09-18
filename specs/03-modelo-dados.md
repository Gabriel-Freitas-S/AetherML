# AetherML — 03 Modelo de Dados (D1 / SQLite)

> Canônico: `db/schema.sql` (DDL) + `db/schema.ts` (Drizzle). Este doc explica decisões.

## 1. ER (resumo)

```
monitoring_stations 1──N observed_pollutants
monitoring_stations 1──N environmental_features
monitoring_stations 1──N prediction_logs
monitoring_stations 1──N weekly_evaluations
monitoring_stations 1──N web_push_subscriptions (preferred_station_id)
model_registry 1──N prediction_logs
model_registry 1──N weekly_evaluations
```

## 2. Tabelas e rationale

| Tabela | Grão | Notas |
|--------|------|-------|
| `monitoring_stations` | 1 linha / estação (9 RAMQAr) | PK textual `ramqar_*`; lat/lon p/ Haversine; `is_active` p/ desativar sem deletar |
| `observed_pollutants` | 1 linha / estação / hora | Ground truth IEMA. `UNIQUE(station,timestamp)` + índice. `iqar_index/class/primary` materializados p/ auditoria rápida |
| `environmental_features` | 1 linha / estação / hora / is_forecast | `is_forecast 0|1` separa histórico × Open-Meteo. Inclui `wind_u/v`, `PBLH`, `AOD`, `tropomi_no2`, `traffic_congestion_index` (H-II/III, nullable) |
| `model_registry` | 1 linha / versão / poluente | 5 linhas ativas por ciclo (pm25,pm10,o3,no2,so2). `onnx_hash_sha256` = cache-buster PWA; `saabas_topology_path` p/ XAI; `metadata_json` guarda constraints + hiperparams |
| `prediction_logs` | 1 linha / versão / estação / geração / alvo | Permite avaliar o mesmo alvo sob gerações distintas (drift de forecast). UNIQUE quádruplo |
| `weekly_evaluations` | 1 linha / semana / estação / versão | `week_code 'AAAA-WSS'`; MAE por poluente-chave, `iqar_accuracy`, `false_alarm_rate`, `missed_event_rate`, `drift_detected`, `retrained` |
| `web_push_subscriptions` | 1 linha / endpoint | `endpoint UNIQUE`; `min_alert_level` filtra ruído (Moderada/Ruim/Muito Ruim) |

## 3. Tabela CONAMA 491 (referência normativa — ver `packages/core-iqar`)

Faixas implementadas em código puro (sem I/O) para uso idêntico no Worker (TS) e no treinamento (PY):

| Classe | I | PM2.5_24h | PM10_24h | O3_8h | NO2_1h | SO2_24h |
|---|---|---|---|---|---|---|
| Boa | 0-40 | 0-15 | 0-50 | 0-100 | 0-200 | 0-20 |
| Moderada | 41-80 | 15-25 | 50-100 | 100-130 | 200-240 | 20-40 |
| Ruim | 81-120 | 25-50 | 100-150 | 130-160 | 240-320 | 40-365 |
| Muito Ruim | 121-200 | 50-75 | 150-250 | 160-200 | 320-1130 | 365-800 |
| Péssima | >200 | >75 | >250 | >200 | >1130 | >800 |

Fórmula: `I_p = I_ini + (I_fim-I_ini)/(C_fim-C_ini)*(C_p-C_ini)`; `IQAr = max(I_p)` + `primary_pollutant = argmax`.

## 4. Índices e performance D1

- `idx_observed_station_time`, `idx_features_station_time`, `idx_pred_station_target`, `idx_eval_week` (ver schema.sql).
- Retenção sugerida: observações/features 2 anos (cron purga), logs 90 dias, evaluations permanente.
- Escrita: batch horário via ingestion Worker (9 estações × ~3 fontes = <100 writes/hora, dentro do limite D1).

## 5. Seed — 9 estações RAMQAr (`db/seed.sql`)

`ramqar_camburi, ramqar_enseada_sua, ramqar_vitoria_centro, ramqar_jardim_camburi? (consolidar), ramqar_ibes, ramqar_paul, ramqar_cariacica, ramqar_serra, ramqar_vila_velha_fundo` — coordenadas aproximadas RMGV; ajustar com IEMA oficial antes de H-I done. `municipality` ∈ {Vitória, Vila Velha, Serra, Cariacica}.
