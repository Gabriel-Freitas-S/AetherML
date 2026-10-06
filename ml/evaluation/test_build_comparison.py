"""Testes do artefato ML-vs-API (puro, sem rede/modelo).

Roda: `python ml/evaluation/test_build_comparison.py` (exit 0 = verde).

Cobre as garantias do contrato de apps/web/public/data/comparison-data.json:
- janela de holdout derivada de `fetched_at` (mesma regra de eval_holdout.py);
- arrays paralelos de mesmo tamanho (timestamps / ml / api);
- zero future-leak (nada depois de holdout.to <= fetched_at);
- `null` (nunca 0) quando um dos lados falta, e exclusão do ponto das métricas;
- matemática das métricas de resumo em entrada sintética pequena.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.evaluation.build_comparison import (  # noqa: E402
    HOLDOUT_HOURS,
    build_payload,
    holdout_indices,
    metrics,
)

BASE = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _times(n: int) -> list:
    return [(BASE + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(n)]


def _station(sid: str = "st", n: int = 4, fill=None):
    """Estação sintética com n horas e todos os 5 poluentes presentes."""
    ts = [(BASE + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%MZ") for h in range(n)]
    pollutants = {}
    for p in ("pm25", "pm10", "o3", "no2", "so2"):
        pollutants[p] = {
            "ml": [fill[0]] * n if fill else [1.0] * n,
            "api": [fill[1]] * n if fill else [1.0] * n,
        }
    return {
        "id": sid,
        "name": "Sintetica",
        "municipality": "X",
        "lat": 0.0,
        "lon": 0.0,
        "timestamps": ts,
        "pollutants": pollutants,
    }


def test_holdout_indices_derived_from_cutoff():
    times = _times(240)
    # fetched_at 3 dias antes do fim da série: o "passado" termina em times[200].
    fetched = (BASE + timedelta(hours=200, minutes=44)).strftime("%Y-%m-%dT%H:%M:%SZ")
    idx = holdout_indices(times, fetched[:13])
    assert len(idx) == HOLDOUT_HOURS == 168
    assert idx[-1] == 200, "o holdout termina na última hora <= fetched_at"
    assert times[idx[-1]][:13] == fetched[:13]
    assert times[idx[0]] == times[200 - 167]
    assert times[idx[0]] == (BASE + timedelta(hours=33)).strftime("%Y-%m-%dT%H:%M")
    # cutoff vazio = usa a série toda (mesma regra de eval_holdout.py:172)
    assert holdout_indices(times, "")[-1] == len(times) - 1


def test_holdout_indices_are_strictly_increasing():
    idx = holdout_indices(_times(240), "2026-10-09T16")
    assert idx == sorted(idx) and idx == list(range(idx[0], idx[0] + 168))


def _build(stations, to=None, fetched="2026-09-04T16:44:49Z"):
    to = to or stations[0]["timestamps"][-1]
    return build_payload(
        stations,
        model_version="vX",
        feature_order_version="v2",
        holdout_from=stations[0]["timestamps"][0],
        holdout_to=to,
        holdout_hours=HOLDOUT_HOURS,
        raw_fetched_at=fetched,
        generated_at="2026-10-02T17:00:00Z",
        protocol="protocolo de teste",
        source_api="Open-Meteo air-quality API (CAMS)",
        raw_file="ml/data/openmeteo_raw.json",
        caveats=[],
    )


def test_parallel_arrays_have_equal_length():
    st = _station(n=5)
    st["pollutants"]["o3"]["ml"].pop()  # um elemento a menos só no lado ML
    try:
        _build([st])
        raise SystemExit("FALHOU: array ml menor que api deveria ser rejeitado")
    except ValueError:
        pass


def test_timestamp_count_matches_arrays():
    st = _station(n=5)
    st["timestamps"] = st["timestamps"][:-1]
    try:
        _build([st])
        raise SystemExit("FALHOU: timestamps != ml/api deveria ser rejeitado")
    except ValueError:
        pass


def test_no_future_leak():
    # (a) holdout.to antes da última hora do array -> rejeitado
    st = _station(n=3)
    try:
        _build([st], to="2026-08-31T23:00Z", fetched="2026-10-02T16:44:49Z")
        raise SystemExit("FALHOU: hora futura ao holdout.to deveria ser rejeitada")
    except ValueError:
        pass
    # (b) holdout.to depois de fetched_at -> rejeitado (nada além do fetch)
    st = _station(n=3)
    try:
        _build([st], to="2026-09-10T00:00Z", fetched="2026-09-09T23:00:00Z")
        raise SystemExit("FALHOU: holdout.to > fetched_at deveria ser rejeitado")
    except ValueError:
        pass
    # (c) caso feliz: última hora == holdout.to < fetched_at
    st = _station(n=3)
    ok = _build([st])
    assert ok["holdout"]["to"] == "2026-09-01T02:00Z"
    assert ok["holdout"]["from"] == "2026-09-01T00:00Z"


def test_missing_values_become_null_and_leave_metrics():
    st = _station(n=4)
    st["pollutants"]["pm25"]["ml"][1] = None  # previsão ausente
    st["pollutants"]["pm25"]["api"][2] = None  # Open-Meteo ausente
    st["pollutants"]["pm10"]["ml"] = [2.5, None, 4.0, 6.0]
    st["pollutants"]["pm10"]["api"] = [1.0, 3.0, 3.0, None]
    st["pollutants"]["o3"]["ml"] = [10.0, 12.0, 14.0, 16.0]
    st["pollutants"]["o3"]["api"] = [11.0, 11.0, 15.0, 16.0]
    st["pollutants"]["no2"]["ml"] = [0.0] * 4  # 0 é valor, não ausente
    st["pollutants"]["no2"]["api"] = [0.0] * 4
    st["pollutants"]["so2"]["ml"] = [1.0] * 4
    st["pollutants"]["so2"]["api"] = [2.0] * 4

    p = _build([st])
    assert p["stations"][0]["pollutants"]["pm25"]["ml"][1] is None
    assert p["stations"][0]["pollutants"]["pm25"]["api"][2] is None
    # par com qualquer lado ausente não entra em n
    assert p["summary"]["by_pollutant"]["pm25"]["n"] == 2
    assert p["summary"]["by_pollutant"]["pm10"]["n"] == 2
    # zero é número, não null
    assert p["stations"][0]["pollutants"]["no2"]["ml"][0] == 0.0
    assert p["summary"]["by_pollutant"]["no2"]["n"] == 4


def test_summary_metric_math_tiny_synthetic():
    # o3: ml=[10,12,14] api=[11,11,15] -> err=[-1,1,-1]
    m = metrics([(10.0, 11.0), (12.0, 11.0), (14.0, 15.0)])
    assert abs(m["mae"] - 1.0) < 1e-9
    assert abs(m["rmse"] - 1.0) < 1e-9
    assert abs(m["bias"] - (-1 / 3)) < 1e-3
    assert abs(m["r2"] - 0.71875) < 1e-3
    assert m["n"] == 3
    # perfeito
    m = metrics([(5.0, 5.0), (7.0, 7.0)])
    assert m["mae"] == 0.0 and m["rmse"] == 0.0 and m["r2"] == 1.0 and m["n"] == 2
    # api constante -> r2 indefinido, reportado 0.0 sem quebrar
    m = metrics([(1.0, 4.0), (3.0, 4.0)])
    assert m["r2"] == 0.0 and abs(m["mae"] - 2.0) < 1e-9  # |−3| |−1| -> 2.0
    # pares incompletos saem do cálculo
    m = metrics([(1.0, 4.0), (None, 4.0), (3.0, None)])
    assert m["n"] == 1 and abs(m["mae"] - 3.0) < 1e-9


def test_summary_aggregates_all_stations():
    a, b = _station("a", n=2), _station("b", n=2)
    a["pollutants"]["pm25"]["ml"] = [1.0, 3.0]
    a["pollutants"]["pm25"]["api"] = [2.0, 4.0]
    b["pollutants"]["pm25"]["ml"] = [10.0, 20.0]
    b["pollutants"]["pm25"]["api"] = [10.0, 30.0]
    for st in (a, b):
        for p in ("pm10", "o3", "no2", "so2"):
            st["pollutants"][p] = {"ml": [1.0, 1.0], "api": [1.0, 1.0]}
    p = _build([a, b])
    byp = p["summary"]["by_pollutant"]["pm25"]
    assert byp["n"] == 4, "by_pollutant agrega TODAS as estações"
    assert abs(byp["mae"] - 3.0) < 1e-9  # |−1| |−1| |0| |−10| -> 12/4
    assert abs(p["summary"]["by_station"]["a"]["pm25"]["mae"] - 1.0) < 1e-9
    assert abs(p["summary"]["by_station"]["b"]["pm25"]["mae"] - 5.0) < 1e-9
    assert "r2" not in p["summary"]["by_station"]["a"]["pm25"], (
        "by_station = mae/rmse/bias/n"
    )


def test_values_rounded_to_three_decimals():
    st = _station(n=2)
    st["pollutants"]["pm25"]["ml"] = [1.23456, 2.0]
    st["pollutants"]["pm25"]["api"] = [9.87654, 1.0]
    p = _build([st])
    got = p["stations"][0]["pollutants"]["pm25"]
    assert got["ml"] == [1.235, 2.0] and got["api"] == [9.877, 1.0]
    assert got["ml"][0] == 1.235  # json round-trip


if __name__ == "__main__":
    test_holdout_indices_derived_from_cutoff()
    test_holdout_indices_are_strictly_increasing()
    test_parallel_arrays_have_equal_length()
    test_timestamp_count_matches_arrays()
    test_no_future_leak()
    test_missing_values_become_null_and_leave_metrics()
    test_summary_metric_math_tiny_synthetic()
    test_summary_aggregates_all_stations()
    test_values_rounded_to_three_decimals()
    print("[OK] test_build_comparison: 9/9 verdes")
