# AetherML — 04 Contratos de API (Workers)

Base: `https://api.aetherml.pages.dev` (Workers). Todos JSON, validação Zod, erro padrão `{error:{code,message}}`.

## 1. Endpoints

### GET /api/stations
Lista 9 estações ativas.
→ `200 [{id,name,municipality,latitude,longitude,altitude,source}]`

### GET /api/history?station={id}&from={ISO}&to={ISO}
Observado + IQAr materializado.
→ `200 {station_id, points:[{timestamp,pm25,pm10,so2,no2,o3,co,iqar_index,iqar_classification,primary_pollutant}]}`

### GET /api/forecast-features?station={id}&h={1..48}
Features prontas p/ ONNX (ordem canônica do manifest). Preferido pelo Worker.
→ `200 {station_id, generated_at, horizon_hours, feature_names:[...25], rows:[[n...],...], meta:{meteo_source, traffic, satellite}}`
- Cache edge 30min; fallback PWA usa cache 6h.

### GET /api/forecast?station={id}&h=48
Fallback server-side (se WASM indisponível): retorna predições do último `prediction_logs`.
→ `200 {model_version, points:[{target_timestamp,predicted_pm25,pm10,o3,no2,iqar,classification}]}`

### GET /api/models/manifest
→ `200 {active_version, targets:{pm25:{onnx_url,sha256,topology_url},...}, feature_names, iqar_table_version:"CONAMA-491/2018"}`

### POST /api/push/subscribe
Body `{endpoint,p256dh,auth,preferred_station_id,min_alert_level}` → `201 {id}` (upsert por endpoint).

### DELETE /api/push/unsubscribe
Body `{endpoint}` → `204`.

### GET /api/evaluations?week={AAAA-WSS}&station={id}
→ `200 [{week_code,mae_pm25,mae_o3,mae_no2,iqar_accuracy_percentage,false_alarm_rate,missed_event_rate,drift_detected}]`

### POST /api/predictions/log (interno/fire-and-forget)
Body `{model_version,station_id,forecast_generated_at,points:[...]}` → `202`. Usado pelo cliente p/ telemetria de acerto.

## 2. Crons (wrangler.toml)

```toml
[triggers]
crons = ["*/30 * * * *", "0 * * * *", "0 6 * * 1"]
# :30 ingestão | :00 varredura push 6-24h | seg 06h avaliação semanal
```

## 3. Regras

- `station_id` sempre `ramqar_*` validado contra D1.
- Timestamps ISO-8601 UTC; D1 DATETIME.
- `h` clamp 1..48; `feature_names` ordem imutável por `model_version`.
- Push só dispara em transição para Ruim/Muito Ruim/Péssima (evita spam em permanência).
