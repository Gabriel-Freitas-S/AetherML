"""
ml/training/fetch_openmeteo.py — Download de dados REAIS (Open-Meteo, sem API key).

- Qualidade do ar (CAMS): pm2_5, pm10, ozone, nitrogen_dioxide, sulphur_dioxide
- Meteorologia: temperature_2m, relative_humidity_2m, wind_speed_10m,
  wind_direction_10m, pressure_msl, shortwave_radiation, boundary_layer_height
- Janela: past_days=92 (histórico p/ treino) + forecast_days=6 (120h p/ previsão)

Uso: `python ml/training/fetch_openmeteo.py` → grava ml/data/openmeteo_raw.json
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

STATIONS = [
    {
        "id": "ramqar_camburi",
        "name": "Camburi - Vitória",
        "municipality": "Vitória",
        "lat": -20.2764,
        "lon": -40.2881,
        "coastal": True,
        "downwind_tubarao": True,
    },
    {
        "id": "ramqar_enseada_sua",
        "name": "Enseada do Suá - Vitória",
        "municipality": "Vitória",
        "lat": -20.3125,
        "lon": -40.2870,
        "coastal": True,
        "bridge_proximity": True,
    },
    {
        "id": "ramqar_vitoria_centro",
        "name": "Vitória Centro",
        "municipality": "Vitória",
        "lat": -20.3196,
        "lon": -40.3370,
        "urban_canyon": True,
        "traffic_heavy": True,
    },
    {
        "id": "ramqar_ibes",
        "name": "IBES - Vila Velha",
        "municipality": "Vila Velha",
        "lat": -20.3478,
        "lon": -40.3068,
        "urban": True,
    },
    {
        "id": "ramqar_paul",
        "name": "Paul - Vila Velha",
        "municipality": "Vila Velha",
        "lat": -20.3297,
        "lon": -40.2960,
        "port_industrial": True,
    },
    {
        "id": "ramqar_cariacica",
        "name": "Cariacica Centro",
        "municipality": "Cariacica",
        "lat": -20.2634,
        "lon": -40.4166,
        "interior_valley": True,
        "high_heat": True,
    },
    {
        "id": "ramqar_serra_laranjeiras",
        "name": "Laranjeiras - Serra",
        "municipality": "Serra",
        "lat": -20.2125,
        "lon": -40.2380,
        "suburban_commercial": True,
    },
    {
        "id": "ramqar_serra_jacupemba",
        "name": "Jacupemba - Serra",
        "municipality": "Serra",
        "lat": -20.1750,
        "lon": -40.1900,
        "coastal_north": True,
    },
    {
        "id": "ramqar_vila_velha_fundo",
        "name": "Vila Velha Interior",
        "municipality": "Vila Velha",
        "lat": -20.3700,
        "lon": -40.3300,
        "interior_residential": True,
    },
]

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
METEO_URL = "https://api.open-meteo.com/v1/forecast"
AQ_VARS = "pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide"
METEO_VARS = (
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,"
    "pressure_msl,shortwave_radiation,boundary_layer_height"
)


def get_json(url: str, params: dict, retries: int = 3) -> dict:
    qs = urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                f"{url}?{qs}", headers={"User-Agent": "AetherML/1.0"}
            )
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except Exception as e:  # noqa: BLE001 — rede instável, tenta de novo
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Falha após {retries} tentativas em {url}: {last_err}")


def fetch_station(st: dict) -> dict:
    base = {"latitude": st["lat"], "longitude": st["lon"], "timezone": "UTC"}
    aq = get_json(
        AQ_URL, {**base, "hourly": AQ_VARS, "past_days": 92, "forecast_days": 6}
    )
    meteo = get_json(
        METEO_URL, {**base, "hourly": METEO_VARS, "past_days": 92, "forecast_days": 6}
    )
    return {
        "meta": st,
        "aq_hourly": aq.get("hourly", {}),
        "meteo_hourly": meteo.get("hourly", {}),
    }


def fetch_all(output_path: str = "ml/data/openmeteo_raw.json") -> dict:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    payload = {
        "source": "open-meteo (CAMS air-quality + forecast/archive meteorology)",
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stations": {},
    }
    for st in STATIONS:
        print(f"[fetch] {st['id']} ...", flush=True)
        data = fetch_station(st)
        n_aq = len(data["aq_hourly"].get("time", []))
        n_met = len(data["meteo_hourly"].get("time", []))
        print(f"  aq_hours={n_aq} meteo_hours={n_met}")
        payload["stations"][st["id"]] = data
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(f"[fetch] Salvo em {output_path}")
    return payload


if __name__ == "__main__":
    fetch_all()
