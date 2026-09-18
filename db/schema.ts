// Espelho Drizzle do db/schema.sql — fonte de tipos do Workers API
import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const monitoringStations = sqliteTable('monitoring_stations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  municipality: text('municipality').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  altitude: real('altitude'),
  isActive: integer('is_active').default(1),
  source: text('source').default('IEMA'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const observedPollutants = sqliteTable('observed_pollutants', {
  id: text('id').primaryKey(),
  stationId: text('station_id').notNull().references(() => monitoringStations.id),
  timestamp: text('timestamp').notNull(),
  pm25: real('pm25'), pm10: real('pm10'), so2: real('so2'),
  no2: real('no2'), o3: real('o3'), co: real('co'),
  iqarIndex: integer('iqar_index'),
  iqarClassification: text('iqar_classification'),
  primaryPollutant: text('primary_pollutant'),
});

export const environmentalFeatures = sqliteTable('environmental_features', {
  id: text('id').primaryKey(),
  stationId: text('station_id').notNull().references(() => monitoringStations.id),
  timestamp: text('timestamp').notNull(),
  isForecast: integer('is_forecast').default(0),
  temperature: real('temperature'),
  relativeHumidity: real('relative_humidity'),
  windSpeed: real('wind_speed'),
  windDirection: real('wind_direction'),
  windU: real('wind_u'), windV: real('wind_v'),
  boundaryLayerHeight: real('boundary_layer_height'),
  surfacePressure: real('surface_pressure'),
  solarRadiation: real('solar_radiation'),
  satelliteAod: real('satellite_aod'),
  satelliteTropomiNo2: real('satellite_tropomi_no2'),
  satelliteUvai: real('satellite_uvai'),
  trafficSpeedAvg: real('traffic_speed_avg'),
  trafficDelayRatio: real('traffic_delay_ratio'),
  trafficCongestionIndex: real('traffic_congestion_index'),
});

export const modelRegistry = sqliteTable('model_registry', {
  version: text('version').primaryKey(),
  targetPollutant: text('target_pollutant').notNull(),
  architecture: text('architecture').notNull(),
  onnxFilePath: text('onnx_file_path').notNull(),
  onnxHashSha256: text('onnx_hash_sha256').notNull(),
  saabasTopologyPath: text('saabas_topology_path').notNull(),
  trainingStartDate: text('training_start_date').notNull(),
  trainingEndDate: text('training_end_date').notNull(),
  testMae: real('test_mae').notNull(),
  testRmse: real('test_rmse').notNull(),
  testR2: real('test_r2').notNull(),
  isActive: integer('is_active').default(1),
  metadataJson: text('metadata_json'),
});

export const predictionLogs = sqliteTable('prediction_logs', {
  id: text('id').primaryKey(),
  modelVersion: text('model_version').notNull().references(() => modelRegistry.version),
  stationId: text('station_id').notNull().references(() => monitoringStations.id),
  forecastGeneratedAt: text('forecast_generated_at').notNull(),
  targetTimestamp: text('target_timestamp').notNull(),
  predictedPm25: real('predicted_pm25'),
  predictedPm10: real('predicted_pm10'),
  predictedO3: real('predicted_o3'),
  predictedNo2: real('predicted_no2'),
  predictedSo2: real('predicted_so2'),
  predictedIqar: integer('predicted_iqar'),
  predictedClassification: text('predicted_classification'),
});

export const weeklyEvaluations = sqliteTable('weekly_evaluations', {
  id: text('id').primaryKey(),
  weekCode: text('week_code').notNull(),
  stationId: text('station_id').notNull().references(() => monitoringStations.id),
  modelVersion: text('model_version').notNull().references(() => modelRegistry.version),
  totalEvalPoints: integer('total_eval_points').notNull(),
  maePm25: real('mae_pm25').notNull(),
  maeO3: real('mae_o3').notNull(),
  maeNo2: real('mae_no2').notNull(),
  iqarAccuracyPercentage: real('iqar_accuracy_percentage').notNull(),
  falseAlarmRate: real('false_alarm_rate').notNull(),
  missedEventRate: real('missed_event_rate').notNull(),
  driftDetected: integer('drift_detected').default(0),
  retrained: integer('retrained').default(0),
  evaluationReportMd: text('evaluation_report_md'),
});

export const webPushSubscriptions = sqliteTable('web_push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  preferredStationId: text('preferred_station_id').references(() => monitoringStations.id),
  minAlertLevel: text('min_alert_level').default('Ruim'),
});

export const FEATURE_ORDER_V1 = [
  'temperature','relative_humidity','wind_speed','wind_direction','wind_u','wind_v',
  'boundary_layer_height','surface_pressure','solar_radiation',
  'hour_sin','hour_cos','dow_sin','dow_cos','is_weekend',
  'traffic_speed_avg','traffic_delay_ratio','traffic_congestion_index',
  'satellite_aod','satellite_tropomi_no2','satellite_uvai',
  'pm25_lag24','pm10_lag24','no2_lag24','o3_lag24','pblh_rolling6',
] as const;

// V2 = V1 intacta (mesma ordem, mesmos índices) + 5 lags autoregressivos de 1h.
// Regra do contrato: nunca reordenar; só anexar com bump de versão da ordem.
export const FEATURE_ORDER_V2 = [
  ...FEATURE_ORDER_V1,
  'pm25_lag1','pm10_lag1','no2_lag1','o3_lag1','so2_lag1',
] as const;
