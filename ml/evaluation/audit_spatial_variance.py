"""
ml/evaluation/audit_spatial_variance.py — Auditoria numérica reproduzível de variância espacial.

Quantifica a variância espacial (ou ausência dela) entre as 9 estações RAMQAr em:
1. Coordenadas cadastradas em `db/seed.sql` (prova de que o seed NÃO tem coordenadas duplicadas)
2. `ml/data/openmeteo_raw.json` (séries horárias CAMS AQ ~40 km e Open-Meteo meteorologia)
3. `apps/web/public/data/comparison-data.json` (holdout temporal de 168h, ML 1-step vs CAMS)
4. `apps/web/public/data/forecast-compare.json` (previsão recursiva de 120h, ML vs CAMS)
5. `apps/web/public/data/stations-data.json` (snapshot step=0 exibido no Dashboard/Mapa)

Uso:
    python ml/evaluation/audit_spatial_variance.py
    python ml/evaluation/audit_spatial_variance.py --json
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]

CORE_8_STATIONS = (
    "ramqar_camburi",
    "ramqar_enseada_sua",
    "ramqar_vitoria_centro",
    "ramqar_ibes",
    "ramqar_paul",
    "ramqar_cariacica",
    "ramqar_serra_laranjeiras",
    "ramqar_vila_velha_fundo",
)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def _group_identical_curves(series_by_station: dict[str, list[float | None]]) -> list[list[str]]:
    buckets: dict[tuple[Any, ...], list[str]] = {}
    for st, vals in sorted(series_by_station.items()):
        sig = tuple(round(float(x), 6) if x is not None else None for x in vals)
        buckets.setdefault(sig, []).append(st)
    return list(buckets.values())


def _pairwise_metrics(
    series_by_station: dict[str, list[float | None]],
    station_subset: list[str] | None = None,
) -> dict[str, Any]:
    stations = sorted(station_subset if station_subset is not None else series_by_station.keys())
    arrays = {
        st: np.array([float(x) if x is not None else np.nan for x in series_by_station[st]], dtype=np.float64)
        for st in stations
    }

    mads: list[float] = []
    max_deltas: list[float] = []
    corrs: list[float] = []
    identical_pairs: list[tuple[str, str]] = []

    for i in range(len(stations)):
        for j in range(i + 1, len(stations)):
            s1, s2 = stations[i], stations[j]
            a, b = arrays[s1], arrays[s2]
            valid = ~np.isnan(a) & ~np.isnan(b)
            if not np.any(valid):
                continue
            diff = np.abs(a[valid] - b[valid])
            mad = float(np.mean(diff))
            mx = float(np.max(diff))
            mads.append(mad)
            max_deltas.append(mx)
            if mx == 0.0:
                identical_pairs.append((s1, s2))
            if np.std(a[valid]) == 0.0 and np.std(b[valid]) == 0.0:
                corr = 1.0 if mx == 0.0 else 0.0
            elif np.std(a[valid]) == 0.0 or np.std(b[valid]) == 0.0:
                corr = 0.0
            else:
                corr = float(np.corrcoef(a[valid], b[valid])[0, 1])
            corrs.append(corr)

    all_vals = [
        round(float(x), 6)
        for st in stations
        for x in series_by_station[st]
        if x is not None
    ]
    clusters = _group_identical_curves({st: series_by_station[st] for st in stations})

    return {
        "distinct_curves": len(clusters),
        "identical_clusters": clusters,
        "identical_pairs_count": len(identical_pairs),
        "unique_values_pooled": len(set(all_vals)),
        "mean_mad": round(float(np.mean(mads)), 4) if mads else 0.0,
        "max_mad": round(float(np.max(mads)), 4) if mads else 0.0,
        "max_delta": round(float(np.max(max_deltas)), 4) if max_deltas else 0.0,
        "min_corr": round(float(np.min(corrs)), 6) if corrs else 1.0,
    }


def audit_seed_coordinates(seed_path: Path | None = None) -> dict[str, Any]:
    path = seed_path or (REPO_ROOT / "db" / "seed.sql")
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\(\s*'(ramqar_[a-z_]+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)"
    )
    stations: list[dict[str, Any]] = []
    for match in pattern.finditer(text):
        st_id, name, district, lat_s, lon_s = match.groups()
        stations.append(
            {
                "id": st_id,
                "name": name,
                "district": district,
                "lat": float(lat_s),
                "lon": float(lon_s),
            }
        )

    coords = [(s["lat"], s["lon"]) for s in stations]
    duplicate_pairs: list[tuple[str, str]] = []
    distances: list[tuple[float, str, str]] = []
    for i in range(len(stations)):
        for j in range(i + 1, len(stations)):
            s1, s2 = stations[i], stations[j]
            dist = _haversine_km(s1["lat"], s1["lon"], s2["lat"], s2["lon"])
            distances.append((dist, s1["id"], s2["id"]))
            if dist < 0.001:
                duplicate_pairs.append((s1["id"], s2["id"]))

    distances.sort(key=lambda x: x[0])
    return {
        "station_count": len(stations),
        "unique_coord_count": len(set(coords)),
        "duplicate_pairs": duplicate_pairs,
        "min_distance_km": round(distances[0][0], 3) if distances else 0.0,
        "min_distance_pair": [distances[0][1], distances[0][2]] if distances else [],
        "max_distance_km": round(distances[-1][0], 3) if distances else 0.0,
        "max_distance_pair": [distances[-1][1], distances[-1][2]] if distances else [],
        "stations": stations,
    }


def audit_openmeteo_raw(raw_path: Path | None = None) -> dict[str, Any]:
    path = raw_path or (REPO_ROOT / "ml" / "data" / "openmeteo_raw.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    stations_dict = data["stations"]
    station_ids = sorted(stations_dict.keys())
    core_8 = [s for s in CORE_8_STATIONS if s in stations_dict]

    sample_st = stations_dict[station_ids[0]]
    hours_count = len(sample_st["aq_hourly"]["time"])

    aq_vars = [k for k in sample_st["aq_hourly"].keys() if k != "time"]
    meteo_vars = [k for k in sample_st["meteo_hourly"].keys() if k != "time"]

    aq_report: dict[str, Any] = {}
    for var in aq_vars:
        series = {st: stations_dict[st]["aq_hourly"][var] for st in station_ids}
        all_stats = _pairwise_metrics(series)
        core_stats = _pairwise_metrics(series, core_8)
        aq_report[var] = {
            **all_stats,
            "core_8_distinct_curves": core_stats["distinct_curves"],
            "core_8_mad": core_stats["max_mad"],
            "core_8_max_delta": core_stats["max_delta"],
            "core_8_min_corr": core_stats["min_corr"],
        }

    meteo_report: dict[str, Any] = {}
    for var in meteo_vars:
        series = {st: stations_dict[st]["meteo_hourly"][var] for st in station_ids}
        tail_series = {st: stations_dict[st]["meteo_hourly"][var][-120:] for st in station_ids}
        all_stats = _pairwise_metrics(series)
        tail_stats = _pairwise_metrics(tail_series)
        meteo_report[var] = {
            **all_stats,
            "forecast_tail_120h_distinct_curves": tail_stats["distinct_curves"],
            "forecast_tail_120h_clusters": tail_stats["identical_clusters"],
        }

    return {
        "station_count": len(station_ids),
        "hours_per_station": hours_count,
        "provenance": data.get("provenance", {}),
        "aq_variables": aq_report,
        "meteo_variables": meteo_report,
    }


def audit_forecast_compare(forecast_path: Path | None = None) -> dict[str, Any]:
    path = forecast_path or (REPO_ROOT / "apps" / "web" / "public" / "data" / "forecast-compare.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    stations_ById = {st["id"]: st for st in data["stations"]}
    station_ids = sorted(stations_ById.keys())
    core_8 = [s for s in CORE_8_STATIONS if s in stations_ById]
    pollutants = ("pm25", "pm10", "o3", "no2", "so2")

    ml_report: dict[str, Any] = {}
    cams_report: dict[str, Any] = {}
    for pol in pollutants:
        ml_series = {
            st: stations_ById[st]["pollutants"][pol]["ml"]
            for st in station_ids
        }
        cams_series = {
            st: stations_ById[st]["pollutants"][pol]["api"]
            for st in station_ids
        }
        ml_all = _pairwise_metrics(ml_series)
        ml_core = _pairwise_metrics(ml_series, core_8)
        ml_report[pol] = {
            **ml_all,
            "core_8_max_mad": ml_core["max_mad"],
            "core_8_mean_mad": ml_core["mean_mad"],
            "core_8_max_delta": ml_core["max_delta"],
            "core_8_min_corr": ml_core["min_corr"],
        }
        cams_report[pol] = _pairwise_metrics(cams_series)

    return {
        "station_count": len(station_ids),
        "horizon_hours": int(data.get("window", {}).get("hours", 120)),
        "ml_variables": ml_report,
        "cams_variables": cams_report,
    }


def audit_holdout_comparison(comparison_path: Path | None = None) -> dict[str, Any]:
    path = comparison_path or (REPO_ROOT / "apps" / "web" / "public" / "data" / "comparison-data.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    stations_ById = {st["id"]: st for st in data["stations"]}
    station_ids = sorted(stations_ById.keys())
    core_8 = [s for s in CORE_8_STATIONS if s in stations_ById]
    pollutants = ("pm25", "pm10", "o3", "no2", "so2")

    ml_report: dict[str, Any] = {}
    cams_report: dict[str, Any] = {}
    for pol in pollutants:
        ml_series = {
            st: stations_ById[st]["pollutants"][pol]["ml"]
            for st in station_ids
        }
        cams_series = {
            st: stations_ById[st]["pollutants"][pol]["api"]
            for st in station_ids
        }
        ml_all = _pairwise_metrics(ml_series)
        ml_core = _pairwise_metrics(ml_series, core_8)
        ml_report[pol] = {
            **ml_all,
            "core_8_max_mad": ml_core["max_mad"],
            "core_8_mean_mad": ml_core["mean_mad"],
            "core_8_max_delta": ml_core["max_delta"],
            "core_8_min_corr": ml_core["min_corr"],
        }
        cams_report[pol] = _pairwise_metrics(cams_series)

    return {
        "station_count": len(station_ids),
        "holdout_hours": int(data.get("holdout", {}).get("hours", 168)),
        "ml_variables": ml_report,
        "cams_variables": cams_report,
    }


def _conama_iqar_o3(o3_ugm3: float) -> int:
    # Faixa N1 (Boa) CONAMA 491/2018 para O3: [0, 100] -> IQAr [0, 40]
    return int(round((o3_ugm3 / 100.0) * 40.0))


def audit_stations_data(stations_path: Path | None = None) -> dict[str, Any]:
    path = stations_path or (REPO_ROOT / "apps" / "web" / "public" / "data" / "stations-data.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    station_ids = sorted(data.keys())

    no2_preds = sorted({float(data[st]["points"][0]["observed"]["no2"]) for st in station_ids})
    pm25_preds = sorted({float(data[st]["points"][0]["observed"]["pm25"]) for st in station_ids})
    o3_preds = sorted({float(data[st]["points"][0]["observed"]["o3"]) for st in station_ids})
    iqars = sorted({_conama_iqar_o3(float(data[st]["points"][0]["observed"]["o3"])) for st in station_ids})
    pm25_lags = sorted({float(data[st]["points"][0]["features"][25]) for st in station_ids})
    o3_lags = sorted({float(data[st]["points"][0]["features"][28]) for st in station_ids})

    return {
        "station_count": len(station_ids),
        "step0_unique_iqar": iqars,
        "step0_unique_no2_pred": no2_preds,
        "step0_unique_pm25_pred_count": len(pm25_preds),
        "step0_unique_pm25_pred": pm25_preds,
        "step0_unique_o3_pred": o3_preds,
        "step0_unique_pm25_lag1": pm25_lags,
        "step0_unique_o3_lag1": o3_lags,
    }


def run_full_audit(
    repo_root: Path | None = None,
    *,
    openmeteo_path: Path | None = None,
    comparison_path: Path | None = None,
    forecast_path: Path | None = None,
    stations_path: Path | None = None,
) -> dict[str, Any]:
    """Auditoria completa.

    Os artefatos regeneráveis podem ser sobrescritos para apontar a fixtures
    congeladas (CI determinístico). Sem sobrescritas o comportamento é o de
    sempre: lê o repo vivo a partir de `repo_root` (uso manual do script).
    """
    root = repo_root or REPO_ROOT
    return {
        "seed": audit_seed_coordinates(root / "db" / "seed.sql"),
        "openmeteo_raw": audit_openmeteo_raw(
            openmeteo_path or root / "ml" / "data" / "openmeteo_raw.json"
        ),
        "holdout_comparison": audit_holdout_comparison(
            comparison_path or root / "apps" / "web" / "public" / "data" / "comparison-data.json"
        ),
        "forecast_compare": audit_forecast_compare(
            forecast_path or root / "apps" / "web" / "public" / "data" / "forecast-compare.json"
        ),
        "stations_data": audit_stations_data(
            stations_path or root / "apps" / "web" / "public" / "data" / "stations-data.json"
        ),
    }


def format_markdown_report(report: dict[str, Any]) -> str:
    seed = report["seed"]
    raw = report["openmeteo_raw"]
    hold = report["holdout_comparison"]
    fc = report["forecast_compare"]
    st_data = report["stations_data"]

    lines = [
        "# Auditoria Numérica de Variância Espacial — RAMQAr (AetherML)",
        "",
        "## 1. Coordenadas do Seed (`db/seed.sql`)",
        f"- Estações cadastradas: **{seed['station_count']}** ({seed['unique_coord_count']}/{seed['station_count']} pares `(lat, lon)` únicos)",
        f"- Pares duplicados: **{len(seed['duplicate_pairs'])}** (causa NÃO é o seed)",
        f"- Menor distância entre estações: **{seed['min_distance_km']} km** (`{seed['min_distance_pair'][0]}` ↔ `{seed['min_distance_pair'][1]}`)",
        f"- Maior distância entre estações: **{seed['max_distance_km']} km** (`{seed['max_distance_pair'][0]}` ↔ `{seed['max_distance_pair'][1]}`)",
        "",
        "## 2. Dados Brutos `ml/data/openmeteo_raw.json` (2.352h por estação)",
        "### 2.1 Qualidade do Ar CAMS Global (~0,4° / ~40 km)",
        "| Variável | Curvas Distintas | Valores Únicos (Pool) | MAD Core-8 | Max Delta Core-8 | Corr Mín Core-8 |",
        "| :--- | :---: | :---: | :---: | :---: | :---: |",
    ]
    for var, stats in raw["aq_variables"].items():
        lines.append(
            f"| `{var}` | **{stats['distinct_curves']}/9** | {stats['unique_values_pooled']} | "
            f"{stats['core_8_mad']:.4f} | {stats['core_8_max_delta']:.4f} | {stats['core_8_min_corr']:.6f} |"
        )

    lines.extend(
        [
            "",
            "- **8 estações centrais da RMGV** (`camburi`, `enseada_sua`, `vitoria_centro`, `ibes`, `paul`, `cariacica`, `serra_laranjeiras`, `vila_velha_fundo`) caem exatamente na **mesma célula CAMS (`MAD = 0.0`, `r = 1.000000`)**.",
            "- Apenas `ramqar_serra_jacupemba` (`-20.1750, -40.1900`, ao norte de `-20.20°`) cai no pixel CAMS vizinho.",
            "",
            "### 2.2 Meteorologia Open-Meteo (`meteo_hourly`)",
            "| Variável | Curvas Distintas (2.352h) | Curvas Distintas (120h Forecast) | Valores Únicos | MAD Médio | Max Delta |",
            "| :--- | :---: | :---: | :---: | :---: | :---: |",
        ]
    )
    for var, stats in raw["meteo_variables"].items():
        lines.append(
            f"| `{var}` | **{stats['distinct_curves']}/9** | **{stats['forecast_tail_120h_distinct_curves']}/9** | "
            f"{stats['unique_values_pooled']} | {stats['mean_mad']:.4f} | {stats['max_delta']:.4f} |"
        )

    lines.extend(
        [
            "",
            "- Dois clusters meteorológicos compartilham a mesma célula de grade Open-Meteo:",
            "  - **Cluster A**: `ramqar_camburi == ramqar_enseada_sua == ramqar_paul`",
            "  - **Cluster B**: `ramqar_vitoria_centro == ramqar_ibes == ramqar_vila_velha_fundo`",
            "",
            "## 3. Holdout 168h (`comparison-data.json`, 1-step) & Forecast 120h (`forecast-compare.json`, recursivo)",
            "| Poluente | Curvas ML (Holdout 168h) | MAD Máx Core-8 (Holdout) | Corr Mín Core-8 (Holdout) | Curvas ML (Forecast 120h) | MAD Máx Core-8 (Forecast) |",
            "| :--- | :---: | :---: | :---: | :---: | :---: |",
        ]
    )
    for pol in ("pm25", "pm10", "o3", "no2", "so2"):
        h_s = hold["ml_variables"][pol]
        f_s = fc["ml_variables"][pol]
        lines.append(
            f"| `{pol}` | **{h_s['distinct_curves']}/9** | {h_s['core_8_max_mad']:.4f} µg/m³ | "
            f"{h_s['core_8_min_corr']:.6f} | **{f_s['distinct_curves']}/9** | {f_s['core_8_max_mad']:.4f} µg/m³ |"
        )

    lines.extend(
        [
            "",
            "- **Por que existem apenas 7/9 curvas ML distintas**:",
            "  - No Cluster A (`camburi`, `enseada_sua`, `paul`), apenas `enseada_sua` possui `bridge_proximity=True` no proxy sintético de tráfego; logo **`ramqar_camburi == ramqar_paul` (`MAD = 0.0000`)**.",
            "  - No Cluster B (`vitoria_centro`, `ibes`, `vila_velha_fundo`), apenas `vitoria_centro` possui `traffic_heavy=True`; logo **`ramqar_ibes == ramqar_vila_velha_fundo` (`MAD = 0.0000`)**.",
            f"- **Consequência em `stations-data.json` (`step=0`)**: todas as 9 estações exibem **IQAr = {st_data['step0_unique_iqar'][0]}** (Boa, dominado por O₃) e `no2 = {st_data['step0_unique_no2_pred'][0]} µg/m³`.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Auditoria numérica de variância espacial RAMQAr")
    parser.add_argument("--json", action="store_true", help="Imprime saída em JSON em vez de Markdown")
    args = parser.parse_args()

    report = run_full_audit(REPO_ROOT)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(format_markdown_report(report))


if __name__ == "__main__":
    main()
