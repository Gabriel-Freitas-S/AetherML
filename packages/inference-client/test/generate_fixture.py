import json
import os
import sys

# Garante path para importar ml
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, ROOT_DIR)

from ml.training.build_real_dataset import (
    row_to_features,
    FEATURE_NAMES_V2,
    FEATURE_NAMES,
    AQ_KEYS,
)

def generate():
    raw_path = os.path.join(ROOT_DIR, "ml", "data", "openmeteo_raw.json")
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # Pegamos indices específicos com condições variadas
    cases = []
    
    # Caso 1: ramqar_camburi - pico dia de semana (segunda-feira 08h)
    # 2026-07-06T08:00 (i=104)
    # Caso 2: ramqar_camburi - madrugada dia de semana (segunda-feira 02h)
    # 2026-07-06T02:00 (i=98)
    # Caso 3: ramqar_camburi - tarde fim de semana (domingo 15h)
    # 2026-07-05T15:00 (i=87)
    # Caso 4: ramqar_enseada_sua - ponte/tráfego pico (segunda-feira 18h)
    # 2026-07-06T18:00 (i=114)
    sample_specs = [
        ("ramqar_camburi", 2200, "v2", "camburi_quinta_tarde"),
        ("ramqar_camburi", 2220, "v2", "camburi_sexta_meiodia"),
        ("ramqar_camburi", 2250, "v2", "camburi_sabado_fimdesemana"),
        ("ramqar_enseada_sua", 2200, "v2", "enseada_sua_quinta_ponte"),
        ("ramqar_camburi", 2200, "v1", "camburi_quinta_v1"),
    ]

    for station_id, idx, order, desc in sample_specs:
        st_data = raw["stations"][station_id]
        flags = st_data["meta"]
        met = st_data["meteo_hourly"]
        aq = st_data["aq_hourly"]
        ts = aq["time"][idx]

        m_now = {
            k: met[k][idx]
            for k in (
                "temperature_2m",
                "relative_humidity_2m",
                "wind_speed_10m",
                "wind_direction_10m",
                "pressure_msl",
                "shortwave_radiation",
                "boundary_layer_height",
            )
        }

        # Lags 24h atrás
        lags = {
            t: float(aq[AQ_KEYS[t]][idx - 24])
            for t in ("pm25", "pm10", "no2", "o3")
        }
        lags["pblh6"] = float(sum(met["boundary_layer_height"][idx - 6 : idx]) / 6.0)

        # Lags 1h atrás
        lags1 = {
            t: float(aq[AQ_KEYS[t]][idx - 1])
            for t in ("pm25", "pm10", "no2", "o3", "so2")
        }

        aq_est = {
            t: float(aq[AQ_KEYS[t]][idx - 1])
            for t in ("pm25", "pm10", "o3", "no2", "so2")
        }

        feats = row_to_features(
            meteo=m_now,
            aq=aq_est,
            iso_ts=ts,
            lags=lags,
            flags=flags,
            order=order,
            lags1=lags1 if order == "v2" else None,
        )

        cases.append({
            "description": desc,
            "station_id": station_id,
            "iso_ts": ts,
            "order": order,
            "flags": flags,
            "meteo": m_now,
            "aq": aq_est,
            "lags": lags,
            "lags1": lags1 if order == "v2" else None,
            "expected_features": feats,
            "feature_names": FEATURE_NAMES_V2 if order == "v2" else FEATURE_NAMES,
        })

    out_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "features_fixture.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"cases": cases}, f, indent=2)

    print(f"Gerado {len(cases)} casos de teste em {out_path}")

if __name__ == "__main__":
    generate()
