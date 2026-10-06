"""Testes do artefato ML-vs-API da janela de FORECAST (puro, sem rede/modelo).

Roda: `python ml/evaluation/test_build_forecast_compare.py` (exit 0 = verde).

Cobre as garantias do contrato de apps/web/public/data/forecast-compare.json:
- a coluna `ml` é COPIADA de stations-data.json (nunca recalculada — nenhum
  booster é carregado neste script);
- todo timestamp existe nos DOIS arquivos de origem (stations-data.json e
  openmeteo_raw.json), senão ValueError;
- arrays paralelos de mesmo tamanho (timestamps / ml / api);
- a janela NÃO encolhe: `window.hours` é o número de pontos, e a cobertura real
  de pares aparece em `coverage_pct` em vez de sumir do array;
- ausência vira `null` (nunca 0, nunca interpolação) e sai das métricas;
- `is_validation: false` + `validation_note` + caveat do CAMS-insumo;
- caveats de no2 com DOIS números medidos em runtime (piso do modelo e massa
  abaixo do piso na API pareada), nunca hardcoded.
"""

import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.evaluation.build_forecast_compare import (  # noqa: E402
    POLLUTANTS,
    build_forecast_compare,
    build_payload,
    no2_caveats,
    pair_stations,
)
from ml.training.predict_forecast import CLAMPS, active_model  # noqa: E402

BASE = datetime(2026, 10, 2, 17, tzinfo=timezone.utc)
N = 5
STATIONS = ("ramqar_a", "ramqar_b")


def _iso(h: int) -> str:
    return (BASE + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%MZ")


def _raw_time(h: int) -> str:
    return (BASE + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M")


def _write_inputs(tmp: str, n: int = N, api_null_at=(), stations=STATIONS, raw_skip=()):
    """Synthetic forecast bundle + raw file, same shape as the real ones."""
    times = [_raw_time(h) for h in range(n)]
    raw = {
        "source": "teste",
        "fetched_at": "2026-10-02T16:44:49Z",
        "stations": {},
    }
    forecast = {}
    for si, sid in enumerate(stations):
        aq = {"time": [t for h, t in enumerate(times) if h not in raw_skip]}
        for p in POLLUTANTS:
            col = [
                None if i in api_null_at else float(10 + si * 100 + i) for i in range(n)
            ]
            aq[_aq_key(p)] = [c for h, c in zip(range(n), col) if h not in raw_skip]
        raw["stations"][sid] = {
            "meta": {"id": sid, "name": f"Nome {sid}", "municipality": "X"},
            "aq_hourly": aq,
            "meteo_hourly": {"time": aq["time"]},
        }
        forecast[sid] = {
            "station": {
                "id": sid,
                "name": f"Nome {sid}",
                "municipality": "X",
                "lat": -20.1 - si,
                "lon": -40.2 - si,
            },
            "points": [
                {
                    "hour": i,
                    "day": i // 24 + 1,
                    "timestamp": _iso(i),
                    "features": [0.0] * 30,
                    "observed": {p: round(5.0 + i + 0.125 * si, 2) for p in POLLUTANTS},
                }
                for i in range(n)
            ],
        }
    raw_path = os.path.join(tmp, "raw.json")
    fc_path = os.path.join(tmp, "stations-data.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw, f)
    with open(fc_path, "w", encoding="utf-8") as f:
        json.dump(forecast, f)
    return raw_path, fc_path


def _aq_key(p: str) -> str:
    from ml.training.build_real_dataset import AQ_KEYS

    return AQ_KEYS[p]


def _run(tmp: str, out="forecast-compare.json", **kw):
    raw_path, fc_path = _write_inputs(tmp, **kw)
    out_path = os.path.join(tmp, out)
    version, order = active_model()
    payload = build_forecast_compare(
        raw_path=raw_path,
        forecast_path=fc_path,
        out_path=out_path,
        version=version,
        order=order,
    )
    return payload, out_path, fc_path


def _station(sid="st", n=4):
    """Station dict in the artifact shape, for the build_payload invariants."""
    return {
        "id": sid,
        "name": "Sintetica",
        "municipality": "X",
        "lat": 0.0,
        "lon": 0.0,
        "timestamps": [_iso(h) for h in range(n)],
        "pollutants": {p: {"ml": [1.0] * n, "api": [1.0] * n} for p in POLLUTANTS},
    }


def _build(stations, hours=None):
    st = stations[0]
    return build_payload(
        stations,
        model_version="vX",
        feature_order_version="v2",
        window_from=st["timestamps"][0],
        window_to=st["timestamps"][-1],
        window_hours=len(st["timestamps"]) if hours is None else hours,
        raw_fetched_at="2026-10-02T16:44:49Z",
        generated_at="2026-10-02T17:00:00Z",
        source_ml="apps/web/public/data/stations-data.json (LightGBM, calibrado)",
        source_api="Open-Meteo air-quality API (CAMS)",
        raw_file="ml/data/openmeteo_raw.json",
        validation_note="nota de teste",
        caveats=[],
    )


def _raises(fn):
    try:
        fn()
    except ValueError:
        return
    raise SystemExit("FALHOU: ValueError era esperada e não veio")


# --------------------------------------------------------------------------
def test_ml_column_is_copied_never_recomputed():
    """A coluna `ml` é a mesma do dashboard — nenhum booster é carregado."""
    import ml.evaluation.build_forecast_compare as mod
    from ml.training import predict_forecast as pf

    assert not hasattr(mod, "load_boosters"), "o script não deve importar load_boosters"
    original = pf.load_boosters

    def boom(version):
        raise AssertionError("build_forecast_compare não pode carregar boosters")

    pf.load_boosters = boom
    try:
        with tempfile.TemporaryDirectory() as tmp:
            payload, _, fc_path = _run(tmp)
            with open(fc_path, encoding="utf-8") as f:
                forecast = json.load(f)
    finally:
        pf.load_boosters = original

    for st in payload["stations"]:
        for i, pt in enumerate(forecast[st["id"]]["points"]):
            for p in POLLUTANTS:
                got = st["pollutants"][p]["ml"][i]
                assert got == round(pt["observed"][p], 3), (
                    f"ml[{i}] de {p} divergiu de observed: {got} != {pt['observed'][p]}"
                )


def test_parallel_arrays_have_equal_length():
    st = _station(n=5)
    st["pollutants"]["o3"]["ml"].pop()
    _raises(lambda: _build([st]))


def test_timestamp_count_matches_arrays():
    st = _station(n=5)
    st["timestamps"] = st["timestamps"][:-1]
    _raises(lambda: _build([st]))


def test_window_hours_must_match_timestamps():
    # a janela não pode encolher para "caber" no que a API entregou
    _raises(lambda: _build([_station(n=4)], hours=3))


def test_timestamps_must_be_ascending():
    st = _station(n=4)
    st["timestamps"][2], st["timestamps"][3] = st["timestamps"][3], st["timestamps"][2]
    _raises(lambda: _build([st]))


def test_timestamp_absent_in_raw_is_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        _raises(lambda: _run(tmp, raw_skip=(2,)))


def test_station_absent_in_raw_is_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        # o forecast tem 2 estações, o bruto só 1 → par impossível
        raw_path, fc_path = _write_inputs(tmp)
        with open(raw_path, encoding="utf-8") as f:
            raw = json.load(f)
        del raw["stations"]["ramqar_b"]
        with open(raw_path, "w", encoding="utf-8") as f:
            json.dump(raw, f)
        version, order = active_model()
        _raises(
            lambda: build_forecast_compare(
                raw_path=raw_path,
                forecast_path=fc_path,
                out_path=os.path.join(tmp, "o.json"),
                version=version,
                order=order,
            )
        )


def test_divergent_window_between_stations_is_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        # estação B com menos pontos que A → janelas divergentes
        raw_path, fc_path = _write_inputs(tmp, n=5)
        with open(fc_path, encoding="utf-8") as f:
            fc = json.load(f)
        fc["ramqar_b"]["points"] = fc["ramqar_b"]["points"][:4]
        with open(fc_path, "w", encoding="utf-8") as f:
            json.dump(fc, f)
        version, order = active_model()
        _raises(
            lambda: build_forecast_compare(
                raw_path=raw_path,
                forecast_path=fc_path,
                out_path=os.path.join(tmp, "o.json"),
                version=version,
                order=order,
            )
        )


def test_nulls_stay_null_and_coverage_is_reported():
    with tempfile.TemporaryDirectory() as tmp:
        payload, out_path, _ = _run(tmp, api_null_at=(3,))
        st = payload["stations"][0]
        for p in POLLUTANTS:
            assert st["pollutants"][p]["api"][3] is None, "ausência é null, não 0"
            assert st["pollutants"][p]["api"][2] is not None
            assert st["pollutants"][p]["ml"][3] is not None
        assert payload["window"]["hours"] == N, "janela não encolhe por causa do null"
        m = payload["summary"]["by_pollutant"]["pm25"]
        assert m["n_paired"] == (N - 1) * len(STATIONS)
        assert abs(m["coverage_pct"] - 80.0) < 1e-9
        with open(out_path, encoding="utf-8") as f:
            raw_json = json.load(f)
        assert raw_json["stations"][0]["pollutants"]["so2"]["api"][3] is None


def test_artifact_shape_is_the_panel_contract():
    with tempfile.TemporaryDirectory() as tmp:
        payload, out_path, _ = _run(tmp)
    assert payload["schema_version"] == 1
    assert payload["is_validation"] is False
    assert payload["validation_note"], "validation_note é obrigatório"
    assert payload["model_version"] and payload["feature_order_version"]
    assert set(payload["window"]) == {"from", "to", "hours"}
    assert set(payload["source"]) == {"ml", "api", "raw_file", "raw_fetched_at"}
    assert payload["window"]["hours"] == N
    assert payload["window"]["to"] > payload["window"]["from"]
    assert len(payload["stations"]) == len(STATIONS)
    for st in payload["stations"]:
        assert set(st["pollutants"]) == set(POLLUTANTS)
        n_ts = len(st["timestamps"])
        for p in POLLUTANTS:
            assert len(st["pollutants"][p]["ml"]) == n_ts
            assert len(st["pollutants"][p]["api"]) == n_ts
        assert set(st) == {
            "id",
            "name",
            "municipality",
            "lat",
            "lon",
            "timestamps",
            "pollutants",
        }
    assert "validation_note" in json.dumps(payload)


def test_cams_is_an_input_not_a_reference():
    with tempfile.TemporaryDirectory() as tmp:
        payload, _, _ = _run(tmp)
    note = (payload["validation_note"] + " " + " ".join(payload["caveats"])).lower()
    assert "não é validação" in note or "nao e validacao" in note
    assert "cams" in note and "feature" in note
    assert any("NÃO é validação" in c for c in payload["caveats"])


def test_no2_caveats_report_two_measured_numbers():
    st = _station(n=4)
    st["timestamps"] = [_iso(h) for h in range(4)]
    floor = CLAMPS["no2"]
    st["pollutants"]["no2"]["ml"] = [floor, floor, 5.0, None]
    st["pollutants"]["no2"]["api"] = [1.0, 2.0, 4.0, 9.0]
    cal = {"isotonic": {"no2": {"y": [0.8033, 9.0]}}}
    caveats = no2_caveats(cal, [st])
    joined = " ".join(caveats)
    # (a) 2 de 3 pontos cravados no piso -> 66.67%
    assert "66.67%" in joined, joined
    # (b) 2 de 3 valores da API abaixo do piso -> 66.67%, número separado
    assert caveats[0] != caveats[1], "os dois números vão em ressalvas separadas"
    assert "abaixo do piso" in caveats[1].lower()
    assert f"{floor}" in caveats[0] and "0.8033" in caveats[0]
    # zero pontos cravados -> 0.00%, medido e não afirmado
    st["pollutants"]["no2"]["ml"] = [4.0, 5.0, 6.0, None]
    assert "0.00%" in no2_caveats(cal, [st])[0]


def test_values_rounded_to_three_decimals_and_zero_is_a_value():
    st = _station(n=2)
    st["pollutants"]["pm25"]["ml"] = [1.23456, 0.0]
    st["pollutants"]["pm25"]["api"] = [9.87654, 0.0]
    got = _build([st])["stations"][0]["pollutants"]["pm25"]
    assert got["ml"] == [1.235, 0.0] and got["api"] == [9.877, 0.0]


if __name__ == "__main__":
    test_ml_column_is_copied_never_recomputed()
    test_parallel_arrays_have_equal_length()
    test_timestamp_count_matches_arrays()
    test_window_hours_must_match_timestamps()
    test_timestamps_must_be_ascending()
    test_timestamp_absent_in_raw_is_rejected()
    test_station_absent_in_raw_is_rejected()
    test_divergent_window_between_stations_is_rejected()
    test_nulls_stay_null_and_coverage_is_reported()
    test_artifact_shape_is_the_panel_contract()
    test_cams_is_an_input_not_a_reference()
    test_no2_caveats_report_two_measured_numbers()
    test_values_rounded_to_three_decimals_and_zero_is_a_value()
    print("[OK] test_build_forecast_compare: 13/13 verdes")
