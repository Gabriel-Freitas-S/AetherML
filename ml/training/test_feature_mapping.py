"""Teste do mapeamento de dados reais Open-Meteo -> 25 features canônicas.

Roda sem rede: `python ml/training/test_feature_mapping.py` (exit 0 = verde).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.build_real_dataset import (
    FEATURE_NAMES,
    FEATURE_NAMES_V2,
    row_to_features,
)

FIXTURE_METEO = {
    "temperature_2m": 26.5,
    "relative_humidity_2m": 72.0,
    "wind_speed_10m": 18.0,  # km/h
    "wind_direction_10m": 40.0,
    "pressure_msl": 1014.0,
    "shortwave_radiation": 500.0,
    "boundary_layer_height": 800.0,
}

FIXTURE_AQ = {"pm2_5": 12.0, "pm10": 22.0, "o3": 60.0, "no2": 8.0, "so2": 5.0}

FIXTURE_LAGS = {"pm25": 11.0, "pm10": 20.0, "no2": 7.0, "o3": 58.0, "pblh6": 750.0}

STATION_FLAGS = {"bridge_proximity": False, "traffic_heavy": False}


def test_feature_order_has_25_canonical_names():
    assert len(FEATURE_NAMES) == 25, f"esperado 25, obtido {len(FEATURE_NAMES)}"
    assert FEATURE_NAMES[0] == "temperature"
    assert FEATURE_NAMES[24] == "pblh_rolling6"


def test_feature_order_v2_appends_lag1_without_reordering():
    assert len(FEATURE_NAMES_V2) == 30
    assert FEATURE_NAMES_V2[:25] == FEATURE_NAMES, "V2 nunca reordena a V1"
    assert FEATURE_NAMES_V2[25:] == [
        "pm25_lag1",
        "pm10_lag1",
        "no2_lag1",
        "o3_lag1",
        "so2_lag1",
    ]


def test_row_to_features_v2_has_30_with_real_lag1():
    feats = row_to_features(
        FIXTURE_METEO,
        FIXTURE_AQ,
        "2026-09-18T15:00",
        FIXTURE_LAGS,
        STATION_FLAGS,
        order="v2",
        lags1={"pm25": 12.5, "pm10": 21.0, "no2": 8.2, "o3": 59.0, "so2": 5.1},
    )
    assert len(feats) == 30
    assert feats[25:] == [12.5, 21.0, 8.2, 59.0, 5.1]


def test_row_to_features_returns_25_floats_in_order():
    feats = row_to_features(
        FIXTURE_METEO, FIXTURE_AQ, "2026-09-18T15:00", FIXTURE_LAGS, STATION_FLAGS
    )
    assert len(feats) == 25, f"esperado 25 features, obtido {len(feats)}"
    assert all(isinstance(v, float) for v in feats)
    # temperature primeiro, wind_speed (m/s convertido de km/h) terceiro
    assert feats[0] == 26.5
    assert abs(feats[2] - 5.0) < 1e-6, f"wind_speed m/s errado: {feats[2]}"
    # wind_u/v coerentes com direção 40°: u=-v? não — confere Pitágoras
    import math

    spd = feats[2]
    assert (
        abs(math.hypot(feats[4], feats[5]) - spd) < 0.02
    )  # u/v arredondados a 2 casas
    # lags reais propagados (sem aleatoriedade)
    assert feats[20] == 11.0 and feats[23] == 58.0


def test_mapping_is_deterministic():
    a = row_to_features(
        FIXTURE_METEO, FIXTURE_AQ, "2026-09-18T15:00", FIXTURE_LAGS, STATION_FLAGS
    )
    b = row_to_features(
        FIXTURE_METEO, FIXTURE_AQ, "2026-09-18T15:00", FIXTURE_LAGS, STATION_FLAGS
    )
    assert a == b, "mapeamento deve ser determinístico (zero random)"


def test_satellite_proxy_uses_lagged_values_not_current():
    from ml.training.build_real_dataset import satellite_proxy

    aod, tropomi, _ = satellite_proxy({"pm10": 40.0, "no2": 10.0})
    assert tropomi == 10.0  # reflete 24h atrás, nunca a hora atual
    assert abs(aod - (0.08 + 40.0 / 400.0)) < 1e-9


if __name__ == "__main__":
    test_feature_order_has_25_canonical_names()
    test_feature_order_v2_appends_lag1_without_reordering()
    test_row_to_features_returns_25_floats_in_order()
    test_row_to_features_v2_has_30_with_real_lag1()
    test_mapping_is_deterministic()
    test_satellite_proxy_uses_lagged_values_not_current()
    print("[OK] test_feature_mapping: 6/6 verdes")
