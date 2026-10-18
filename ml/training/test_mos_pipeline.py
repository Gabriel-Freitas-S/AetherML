"""
ml/training/test_mos_pipeline.py — Testes TDD para o caminho de treino MOS (Y=IEMA, X=CAMS+meteo) e fallback.

Garante que:
1. Quando `observed_pollutants` possui registros com `source='IEMA'` (in-situ),
   `build_real_dataset` treina com `Y = IEMA` (alvos in-situ) e `X = CAMS + meteo`
   (lags 24h, lags 1h, proxies de satélite e meteorologia vindos da grade contínua CAMS/Open-Meteo).
2. Registros com `source='open-meteo-cams-*'` no D1 NUNCA são misturados em `Y` quando
   o modo MOS (`source='IEMA'`) está ativo.
3. Quando NÃO há registros `source='IEMA'` (apenas CAMS ou execução local), o fallback
   mantém exatamente o comportamento atual (`Y = CAMS`, `X = CAMS + meteo`).
4. `extract_holdout_from_raw` funciona tanto no modo MOS (`Y = IEMA`, `X = CAMS + meteo`)
   quanto quando o D1 possui apenas 168h de backfill CAMS (usando `cams_aq_hourly` para o buffer de lags de 30h).
"""

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from ml.training.build_real_dataset import FEATURE_NAMES_V2, build_real_dataset
from ml.training.evaluate_champion import extract_holdout_from_raw
from ml.training.fetch_from_d1 import merge_d1_with_meteo


def _make_synthetic_raw(hours: int = 220) -> dict:
    start = datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc)
    times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00") for h in range(hours)]
    return {
        "source": "open-meteo",
        "fetched_at": times[-1] + ":00Z",
        "stations": {
            "ramqar_camburi": {
                "meta": {
                    "id": "ramqar_camburi",
                    "municipality": "Vitória",
                    "bridge_proximity": False,
                    "traffic_heavy": False,
                },
                "meteo_hourly": {
                    "time": times,
                    "temperature_2m": [24.0 + (h % 5) * 0.5 for h in range(hours)],
                    "relative_humidity_2m": [75.0 for _ in range(hours)],
                    "wind_speed_10m": [14.4 for _ in range(hours)],
                    "wind_direction_10m": [90.0 for _ in range(hours)],
                    "pressure_msl": [1012.0 for _ in range(hours)],
                    "shortwave_radiation": [200.0 for _ in range(hours)],
                    "boundary_layer_height": [600.0 for _ in range(hours)],
                },
                "aq_hourly": {
                    "time": times,
                    # Valores CAMS constantes e distintos do in-situ para provar X=CAMS e Y=IEMA
                    "pm2_5": [8.0 for _ in range(hours)],
                    "pm10": [16.0 for _ in range(hours)],
                    "ozone": [40.0 for _ in range(hours)],
                    "nitrogen_dioxide": [5.0 for _ in range(hours)],
                    "sulphur_dioxide": [2.0 for _ in range(hours)],
                    "carbon_monoxide": [120.0 for _ in range(hours)],
                },
            },
            "ramqar_paul": {
                "meta": {
                    "id": "ramqar_paul",
                    "municipality": "Vila Velha",
                    "bridge_proximity": False,
                    "traffic_heavy": False,
                },
                "meteo_hourly": {
                    "time": times,
                    "temperature_2m": [24.0 + (h % 5) * 0.5 for h in range(hours)],
                    "relative_humidity_2m": [75.0 for _ in range(hours)],
                    "wind_speed_10m": [14.4 for _ in range(hours)],
                    "wind_direction_10m": [90.0 for _ in range(hours)],
                    "pressure_msl": [1012.0 for _ in range(hours)],
                    "shortwave_radiation": [200.0 for _ in range(hours)],
                    "boundary_layer_height": [600.0 for _ in range(hours)],
                },
                "aq_hourly": {
                    "time": times,
                    "pm2_5": [8.0 for _ in range(hours)],
                    "pm10": [16.0 for _ in range(hours)],
                    "ozone": [40.0 for _ in range(hours)],
                    "nitrogen_dioxide": [5.0 for _ in range(hours)],
                    "sulphur_dioxide": [2.0 for _ in range(hours)],
                    "carbon_monoxide": [120.0 for _ in range(hours)],
                },
            },
        },
    }


class TestMOSPipeline(unittest.TestCase):
    def test_mos_training_uses_y_iema_and_x_cams_meteo(self):
        """
        Quando observed_pollutants contém source='IEMA':
        - Y deve vir estritamente dos registros IEMA (diferenciando camburi vs paul!).
        - X (lags de 24h, lags de 1h, satélite e meteo) deve vir de CAMS + meteo.
        - Horas que só possuem source='open-meteo-cams-*' NÃO entram como Y no modo MOS.
        """
        raw = _make_synthetic_raw(hours=60)
        times = raw["stations"]["ramqar_camburi"]["aq_hourly"]["time"]

        # D1 tem CAMS nas horas 0..29 e IEMA nas horas 30..34 (5 horas por estação)
        # Note que em CAMS camburi == paul (pm2_5 = 8.0), mas no IEMA camburi=25.0 e paul=14.0!
        camburi_series = [
            {
                "timestamp": times[h] + ":00Z",
                "pm25": 8.0,
                "pm10": 16.0,
                "o3": 40.0,
                "no2": 5.0,
                "so2": 2.0,
                "co": 120.0,
                "source": "open-meteo-cams-reanalysis",
            }
            for h in range(30)
        ] + [
            {
                "timestamp": times[h] + ":00Z",
                "pm25": 25.5,
                "pm10": 48.0,
                "o3": 62.0,
                "no2": 18.0,
                "so2": 6.5,
                "co": 250.0,
                "source": "IEMA",
            }
            for h in range(30, 35)
        ]

        paul_series = [
            {
                "timestamp": times[h] + ":00Z",
                "pm25": 14.2,
                "pm10": 29.0,
                "o3": 51.0,
                "no2": 11.0,
                "so2": 9.0,
                "co": 190.0,
                "source": "IEMA",
            }
            for h in range(30, 35)
        ]

        d1_payload = {
            "summary": {"total_records": len(camburi_series) + len(paul_series), "extracted_at": times[-1] + ":00Z"},
            "stations": {
                "ramqar_camburi": {"records_count": len(camburi_series), "series": camburi_series},
                "ramqar_paul": {"records_count": len(paul_series), "series": paul_series},
            },
        }

        merged = merge_d1_with_meteo(raw, d1_payload)

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "merged_raw.json")
            out_path = os.path.join(tmpdir, "train_mos.json")
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(merged, f)

            info = build_real_dataset(raw_path=raw_path, out_path=out_path, order="v2")
            self.assertEqual(info["target_mode"], "mos_insitu")
            # 5 horas IEMA em camburi + 5 horas IEMA em paul = 10 amostras MOS
            self.assertEqual(info["sample_count"], 10)

            with open(out_path, "r", encoding="utf-8") as f:
                dataset = json.load(f)

            self.assertEqual(dataset["target_mode"], "mos_insitu")
            self.assertEqual(dataset["count"], 10)

            # Verifica que Y veio do IEMA (25.5 para camburi, 14.2 para paul), NUNCA do CAMS (8.0)
            pm25_targets = dataset["target_values"]["pm25"]
            self.assertEqual(pm25_targets[:5], [25.5] * 5)
            self.assertEqual(pm25_targets[5:], [14.2] * 5)

            # Verifica que X (lags 24h e lags 1h) veio de CAMS (pm2_5=8.0, pm10=16.0, no2=5.0, o3=40.0, so2=2.0)
            idx_pm25_lag24 = FEATURE_NAMES_V2.index("pm25_lag24")
            idx_pm25_lag1 = FEATURE_NAMES_V2.index("pm25_lag1")
            idx_no2_lag1 = FEATURE_NAMES_V2.index("no2_lag1")
            for row in dataset["features"]:
                self.assertEqual(row[idx_pm25_lag24], 8.0)
                self.assertEqual(row[idx_pm25_lag1], 8.0)
                self.assertEqual(row[idx_no2_lag1], 5.0)

    def test_fallback_without_iema_preserves_cams_behavior(self):
        """
        Quando NÃO há registros source='IEMA' (apenas open-meteo-cams-* ou arquivo local),
        build_real_dataset opera em modo fallback ('cams_fallback') com Y=CAMS e X=CAMS+meteo.
        """
        raw = _make_synthetic_raw(hours=40)
        times = raw["stations"]["ramqar_camburi"]["aq_hourly"]["time"]

        # D1 contendo apenas open-meteo-cams-reanalysis (sem IEMA)
        d1_payload = {
            "summary": {"total_records": 40, "extracted_at": times[-1] + ":00Z"},
            "stations": {
                "ramqar_camburi": {
                    "records_count": 40,
                    "series": [
                        {
                            "timestamp": times[h] + ":00Z",
                            "pm25": 8.0,
                            "pm10": 16.0,
                            "o3": 40.0,
                            "no2": 5.0,
                            "so2": 2.0,
                            "co": 120.0,
                            "source": "open-meteo-cams-reanalysis",
                        }
                        for h in range(40)
                    ],
                }
            },
        }

        merged = merge_d1_with_meteo(raw, d1_payload)
        self.assertEqual(merged["provenance"]["target_mode"], "cams_fallback")
        self.assertEqual(merged["provenance"]["insitu_records_count"], 0)

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "merged_fallback.json")
            out_path = os.path.join(tmpdir, "train_fallback.json")
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(merged, f)

            info = build_real_dataset(raw_path=raw_path, out_path=out_path, order="v2")
            self.assertEqual(info["target_mode"], "cams_fallback")
            # 2 estações * (40 - 30) horas = 20 amostras
            self.assertEqual(info["sample_count"], 20)

    def test_7day_d1_backfill_does_not_starve_holdout_or_training(self):
        """
        Se o D1 tiver apenas 168h (7 dias) de backfill CAMS (sem IEMA),
        extract_holdout_from_raw (que exige 168 + 30 = 198h) e build_real_dataset
        usam a série completa cams_aq_hourly (220h) para não falhar por falta de buffer de lag.
        """
        raw = _make_synthetic_raw(hours=220)
        times = raw["stations"]["ramqar_camburi"]["aq_hourly"]["time"]
        # D1 tem apenas as últimas 168h
        tail_times = times[-168:]
        d1_payload = {
            "summary": {"total_records": 168 * 2, "extracted_at": times[-1] + ":00Z"},
            "stations": {
                st_id: {
                    "records_count": 168,
                    "series": [
                        {
                            "timestamp": t + ":00Z",
                            "pm25": 8.0,
                            "pm10": 16.0,
                            "o3": 40.0,
                            "no2": 5.0,
                            "so2": 2.0,
                            "co": 120.0,
                            "source": "open-meteo-cams-reanalysis",
                        }
                        for t in tail_times
                    ],
                }
                for st_id in ("ramqar_camburi", "ramqar_paul")
            },
        }

        merged = merge_d1_with_meteo(raw, d1_payload)
        X_hold, y_hold, h_start, h_end = extract_holdout_from_raw(merged, holdout_hours=168, order="v2")
        self.assertEqual(X_hold.shape, (168 * 2, 30))
        self.assertEqual(len(y_hold["pm25"]), 168 * 2)

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "merged_168.json")
            out_path = os.path.join(tmpdir, "train_before_holdout.json")
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(merged, f)

            train_cutoff = times[-169][:13]
            info = build_real_dataset(
                raw_path=raw_path, out_path=out_path, end_cutoff=train_cutoff, order="v2"
            )
            # Horas 30..51 (22 horas * 2 estações = 44 amostras antes do holdout)
            self.assertEqual(info["sample_count"], 44)


if __name__ == "__main__":
    unittest.main()
