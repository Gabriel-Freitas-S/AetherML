-- Migration 0003_observed_source_unique — permite coexistência CAMS × IEMA no mesmo (station_id, timestamp).
--
-- Contexto: em 0001_init.sql a tabela nasceu com UNIQUE(station_id, timestamp), cujo autoindex
-- interno do SQLite não pode ser removido via DROP INDEX. Com a entrada da ingestão in-situ
-- oficial (source='IEMA') ao lado das séries CAMS (source='open-meteo-cams-reanalysis' e
-- 'open-meteo-cams-forecast'), o upsert por (station_id, timestamp) sobrescreveria o CAMS
-- (necessário como preditor X do MOS e fallback para estações sem sensor físico).
--
-- Rebuild canônico SQLite/D1 (sem BEGIN/COMMIT explícitos, pois o executor de migrations do D1
-- já envolve cada arquivo em transação): cria tabela nova com UNIQUE(station_id, timestamp, source),
-- copia todas as linhas existentes preservando id e created_at, substitui a tabela original e
-- recria o índice de leitura por (station_id, timestamp).

CREATE TABLE observed_pollutants_new (
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
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(station_id, timestamp, source)
);

INSERT INTO observed_pollutants_new (
    id, station_id, timestamp, pm25, pm10, so2, no2, o3, co,
    iqar_index, iqar_classification, primary_pollutant, source, created_at
)
SELECT
    id, station_id, timestamp, pm25, pm10, so2, no2, o3, co,
    iqar_index, iqar_classification, primary_pollutant, source, created_at
FROM observed_pollutants;

DROP TABLE observed_pollutants;

ALTER TABLE observed_pollutants_new RENAME TO observed_pollutants;

CREATE INDEX IF NOT EXISTS idx_observed_station_time ON observed_pollutants(station_id, timestamp);
