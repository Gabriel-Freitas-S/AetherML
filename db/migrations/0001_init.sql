-- AetherML D1 schema canônico — CONAMA 491/2018, RMGV (9 estações)
-- Aplicar via: wrangler d1 migrations apply aetherml-db

-- 1. Estações de Monitoramento da RMGV
CREATE TABLE IF NOT EXISTS monitoring_stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    municipality TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL,
    is_active INTEGER DEFAULT 1,
    source TEXT DEFAULT 'IEMA',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Observações Oficiais Multipoluentes (Ground Truth IEMA)
CREATE TABLE IF NOT EXISTS observed_pollutants (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    timestamp DATETIME NOT NULL,
    pm25 REAL,
    pm10 REAL,
    so2 REAL,
    no2 REAL,
    o3 REAL,
    co REAL,
    iqar_index INTEGER,
    iqar_classification TEXT,
    primary_pollutant TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(station_id, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_observed_station_time ON observed_pollutants(station_id, timestamp);

-- 3. Variáveis Meteorológicas, Orbitais e de Mobilidade
CREATE TABLE IF NOT EXISTS environmental_features (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    timestamp DATETIME NOT NULL,
    is_forecast INTEGER DEFAULT 0,
    temperature REAL,
    relative_humidity REAL,
    wind_speed REAL,
    wind_direction REAL,
    wind_u REAL,
    wind_v REAL,
    boundary_layer_height REAL,
    surface_pressure REAL,
    solar_radiation REAL,
    satellite_aod REAL,
    satellite_tropomi_no2 REAL,
    satellite_uvai REAL,
    traffic_speed_avg REAL,
    traffic_delay_ratio REAL,
    traffic_congestion_index REAL,
    source TEXT DEFAULT 'Open-Meteo+Orbital',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(station_id, timestamp, is_forecast)
);
CREATE INDEX IF NOT EXISTS idx_features_station_time ON environmental_features(station_id, timestamp, is_forecast);

-- 4. Registro de Modelos e Metadados de Interpretabilidade
CREATE TABLE IF NOT EXISTS model_registry (
    version TEXT PRIMARY KEY,
    target_pollutant TEXT NOT NULL,
    architecture TEXT NOT NULL,
    onnx_file_path TEXT NOT NULL,
    onnx_hash_sha256 TEXT NOT NULL,
    saabas_topology_path TEXT NOT NULL,
    training_start_date DATETIME NOT NULL,
    training_end_date DATETIME NOT NULL,
    test_mae REAL NOT NULL,
    test_rmse REAL NOT NULL,
    test_r2 REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Logs de Previsões Executadas
CREATE TABLE IF NOT EXISTS prediction_logs (
    id TEXT PRIMARY KEY,
    model_version TEXT NOT NULL REFERENCES model_registry(version),
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    forecast_generated_at DATETIME NOT NULL,
    target_timestamp DATETIME NOT NULL,
    predicted_pm25 REAL,
    predicted_pm10 REAL,
    predicted_o3 REAL,
    predicted_no2 REAL,
    predicted_so2 REAL,
    predicted_iqar INTEGER,
    predicted_classification TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_version, station_id, forecast_generated_at, target_timestamp)
);
CREATE INDEX IF NOT EXISTS idx_pred_station_target ON prediction_logs(station_id, target_timestamp);

-- 6. Auditoria Semanal de Erros, Acertos e Drift
CREATE TABLE IF NOT EXISTS weekly_evaluations (
    id TEXT PRIMARY KEY,
    week_code TEXT NOT NULL,
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    model_version TEXT NOT NULL REFERENCES model_registry(version),
    total_eval_points INTEGER NOT NULL,
    mae_pm25 REAL NOT NULL,
    mae_o3 REAL NOT NULL,
    mae_no2 REAL NOT NULL,
    iqar_accuracy_percentage REAL NOT NULL,
    false_alarm_rate REAL NOT NULL,
    missed_event_rate REAL NOT NULL,
    drift_detected INTEGER DEFAULT 0,
    retrained INTEGER DEFAULT 0,
    evaluation_report_md TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_eval_week ON weekly_evaluations(week_code, station_id);

-- 7. Assinaturas para Alertas Web Push
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    preferred_station_id TEXT REFERENCES monitoring_stations(id),
    min_alert_level TEXT DEFAULT 'Ruim',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
