-- Migration 0003_observed_source_unique — permite coexistência CAMS × IEMA no mesmo (station_id, timestamp).
--
-- Contexto: em 0001_init.sql a tabela nasceu com UNIQUE(station_id, timestamp), cujo autoindex
-- interno do SQLite não pode ser removido via DROP INDEX. Com a entrada da ingestão in-situ
-- oficial (source='IEMA') ao lado das séries CAMS (source='open-meteo-cams-reanalysis' e
-- 'open-meteo-cams-forecast'), o upsert por (station_id, timestamp) sobrescreveria o CAMS
-- (necessário como preditor X do MOS e fallback para estações sem sensor físico).
--
-- Rebuild canônico de tabela no SQLite/D1:
-- Cria tabela nova com a restrição UNIQUE(station_id, timestamp, source) desejada,
-- copia todas as linhas pré-existentes preservando id e created_at, descarta a original
-- e renomeia a nova.
--
-- Nota sobre atomicidade no D1:
-- O executor remoto de migrations do Cloudflare D1 (via wrangler d1 migrations apply)
-- envia os statements como batch sequencial. A sequência é estruturada defensivamente:
-- 1. CREATE TABLE observed_pollutants_new não afeta a tabela em produção.
-- 2. INSERT INTO ... SELECT copia os dados integralmente.
-- 3. DROP e ALTER RENAME ocorrem somente após a cópia íntegra.
-- Caso o processo seja interrompido antes do passo 3, os dados originais permanecem intactos.

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
