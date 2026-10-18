import json
import tempfile
import unittest
from pathlib import Path

from ml.evaluation.audit_spatial_variance import (
    audit_forecast_compare,
    audit_holdout_comparison,
    audit_openmeteo_raw,
    audit_seed_coordinates,
    audit_stations_data,
    format_markdown_report,
    run_full_audit,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


class TestAuditSpatialVariance(unittest.TestCase):
    def test_audit_seed_coordinates_confirms_9_unique_stations(self):
        result = audit_seed_coordinates(REPO_ROOT / "db" / "seed.sql")
        self.assertEqual(result["station_count"], 9)
        self.assertEqual(result["unique_coord_count"], 9)
        self.assertEqual(len(result["duplicate_pairs"]), 0)
        self.assertGreater(result["min_distance_km"], 2.0)
        self.assertLess(result["min_distance_km"], 2.5)
        self.assertGreater(result["max_distance_km"], 25.0)

    def test_audit_openmeteo_raw_quantifies_cams_and_meteo_clusters(self):
        result = audit_openmeteo_raw(REPO_ROOT / "ml" / "data" / "openmeteo_raw.json")
        self.assertEqual(result["station_count"], 9)
        self.assertEqual(result["hours_per_station"], 2352)

        # All 5 AQ variables collapse to only 2 distinct curves (8 core RMGV identical + serra_jacupemba)
        for aq_var in ("pm2_5", "pm10", "ozone", "nitrogen_dioxide", "sulphur_dioxide"):
            var_stats = result["aq_variables"][aq_var]
            self.assertEqual(var_stats["distinct_curves"], 2, f"{aq_var} should have 2 distinct curves")
            self.assertEqual(var_stats["core_8_max_delta"], 0.0)
            self.assertEqual(var_stats["core_8_mad"], 0.0)
            self.assertAlmostEqual(var_stats["core_8_min_corr"], 1.0, places=6)
            self.assertGreater(var_stats["unique_values_pooled"], 100)

        # Meteo: wind_speed_10m, relative_humidity_2m, etc. have 5 distinct curves (2 identical clusters of 3)
        for meteo_var in (
            "relative_humidity_2m",
            "wind_speed_10m",
            "wind_direction_10m",
            "pressure_msl",
            "shortwave_radiation",
            "boundary_layer_height",
        ):
            m_stats = result["meteo_variables"][meteo_var]
            self.assertEqual(m_stats["distinct_curves"], 5)

        # Temperature has 9 distinct curves over 2352h (archive DEM), but 5 in the 120h forecast tail
        temp_stats = result["meteo_variables"]["temperature_2m"]
        self.assertEqual(temp_stats["distinct_curves"], 9)
        self.assertEqual(temp_stats["forecast_tail_120h_distinct_curves"], 5)

    def test_audit_forecast_compare_detects_7_distinct_curves_and_identical_pairs(self):
        result = audit_forecast_compare(
            REPO_ROOT / "apps" / "web" / "public" / "data" / "forecast-compare.json"
        )
        self.assertEqual(result["station_count"], 9)
        self.assertEqual(result["horizon_hours"], 120)

        pm25_ml = result["ml_variables"]["pm25"]
        self.assertEqual(pm25_ml["distinct_curves"], 7)
        # Check identical clusters: camburi == paul and ibes == vila_velha_fundo
        clusters = [ sorted(c) for c in pm25_ml["identical_clusters"] if len(c) > 1 ]
        self.assertIn(["ramqar_camburi", "ramqar_paul"], clusters)
        self.assertIn(["ramqar_ibes", "ramqar_vila_velha_fundo"], clusters)

        # CAMS baseline in forecast-compare has only 2 distinct curves
        self.assertEqual(result["cams_variables"]["pm25"]["distinct_curves"], 2)

    def test_audit_holdout_comparison_confirms_core8_mad_under_0_3(self):
        result = audit_holdout_comparison(
            REPO_ROOT / "apps" / "web" / "public" / "data" / "comparison-data.json"
        )
        self.assertEqual(result["station_count"], 9)
        self.assertEqual(result["holdout_hours"], 168)
        pm25_ml = result["ml_variables"]["pm25"]
        self.assertEqual(pm25_ml["distinct_curves"], 7)
        self.assertLessEqual(pm25_ml["core_8_max_mad"], 0.3)
        self.assertGreater(pm25_ml["core_8_min_corr"], 0.99)

    def test_audit_stations_data_confirms_uniform_iqar_40(self):
        result = audit_stations_data(
            REPO_ROOT / "apps" / "web" / "public" / "data" / "stations-data.json"
        )
        self.assertEqual(result["station_count"], 9)
        self.assertEqual(result["step0_unique_iqar"], [40])
        self.assertEqual(result["step0_unique_no2_pred"], [3.0])

    def test_run_full_audit_and_markdown_output(self):
        report = run_full_audit(REPO_ROOT)
        md = format_markdown_report(report)
        self.assertIn("camburi", md)
        self.assertIn("paul", md)
        self.assertIn("ibes", md)
        self.assertIn("vila_velha_fundo", md)
        self.assertIn("7/9", md)
        self.assertIn("2/9", md)


if __name__ == "__main__":
    unittest.main()
