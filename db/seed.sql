-- Seed: 9 estações RAMQAr/IEMA — RMGV (coordenadas aproximadas; confirmar com IEMA antes de prod)
INSERT OR IGNORE INTO monitoring_stations (id, name, municipality, latitude, longitude, altitude, source) VALUES
('ramqar_camburi', 'Camburi - Vitória', 'Vitória', -20.2764, -40.2881, 8, 'IEMA'),
('ramqar_enseada_sua', 'Enseada do Suá - Vitória', 'Vitória', -20.3125, -40.2870, 12, 'IEMA'),
('ramqar_vitoria_centro', 'Vitória Centro', 'Vitória', -20.3196, -40.3370, 15, 'IEMA'),
('ramqar_ibes', 'IBES - Vila Velha', 'Vila Velha', -20.3478, -40.3068, 10, 'IEMA'),
('ramqar_paul', 'Paul - Vila Velha', 'Vila Velha', -20.3297, -40.2960, 6, 'IEMA'),
('ramqar_cariacica', 'Cariacica Centro', 'Cariacica', -20.2634, -40.4166, 35, 'IEMA'),
('ramqar_serra_laranjeiras', 'Laranjeiras - Serra', 'Serra', -20.2125, -40.2380, 25, 'IEMA'),
('ramqar_serra_jacupemba', 'Jacupemba - Serra', 'Serra', -20.1750, -40.1900, 30, 'IEMA'),
('ramqar_vila_velha_fundo', 'Vila Velha Interior', 'Vila Velha', -20.3700, -40.3300, 20, 'IEMA');
