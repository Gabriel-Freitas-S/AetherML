"""
ml/evaluation/test_evaluate_weekly.py — Testes TDD da avaliação semanal (specs/08 §2).

Roda: `python ml/evaluation/test_evaluate_weekly.py` (exit 0 = verde).
Testa:
- evaluate_predictions (estável vs drift por missed_event_rate > 0.15, mae_pm25 > 8.0, iqar_accuracy < 75%)
- compute_feature_psi (drift PSI nas features)
- build_weekly_evaluation_records (contrato exato da tabela weekly_evaluations em db/schema.sql)
- persist_weekly_evaluations_to_d1 (transporte HTTP injetável + FK model_registry)
- run_weekly_evaluation (avaliação 168h por estação + global + geração de relatório markdown)
"""

import json
import os
import shutil
import sys
import tempfile
from typing import Any, Dict, List

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from datetime import datetime, timezone
from ml.evaluation.evaluate_weekly import (
    build_weekly_evaluation_records,
    compute_feature_psi,
    evaluate_predictions,
    fetch_d1_to_file,
    install_d1_retrain_compat,
    next_model_version,
    persist_weekly_evaluations_to_d1,
    run_weekly_evaluation,
    supplement_d1_with_history,
)


class _MockBooster:
    def __init__(self, value: float):
        self.value = value

    def predict(self, X):
        return [self.value for _ in range(len(X))]

    def num_feature(self) -> int:
        return 25


def test_evaluate_predictions_stable_and_drift_gates():
    # 1. Caso estável: erro baixo, acurácia 100%, zero eventos perdidos
    n = 20
    y_true = {
        "pm25": [10.0] * n,
        "o3": [40.0] * n,
        "no2": [20.0] * n,
    }
    y_pred = {
        "pm25": [10.5] * n,
        "o3": [41.0] * n,
        "no2": [20.5] * n,
    }
    iqar_t = [25] * n
    iqar_p = [26] * n
    cls_t = ["Boa"] * n
    cls_p = ["Boa"] * n

    res = evaluate_predictions(y_true, y_pred, iqar_t, iqar_p, cls_t, cls_p)
    assert res["drift_detected"] == 0
    assert res["iqar_accuracy_pct"] == 100.0
    assert res["missed_event_rate"] == 0.0
    assert res["false_alarm_rate"] == 0.0
    assert "MODELO ESTAVEL" in res["report_md"]

    # 2. Caso missed_event_rate > 0.15 (specs/08 §2): 2 de 4 eventos Ruim perdidos (0.5 > 0.15)
    cls_t_missed = ["Ruim", "Ruim", "Ruim", "Ruim"] + ["Boa"] * 16
    cls_p_missed = ["Moderada", "Moderada", "Ruim", "Ruim"] + ["Boa"] * 16
    res_missed = evaluate_predictions(
        y_true, y_pred, iqar_t, iqar_p, cls_t_missed, cls_p_missed
    )
    assert res_missed["missed_event_rate"] == 0.5
    assert res_missed["drift_detected"] == 1
    assert "DRIFT DETECTADO" in res_missed["report_md"]


def test_compute_feature_psi():
    rng = np.random.default_rng(42)
    base = rng.normal(loc=20.0, scale=2.0, size=(500, 5))
    same = rng.normal(loc=20.0, scale=2.0, size=(200, 5))
    shifted = rng.normal(loc=35.0, scale=2.0, size=(200, 5))

    psi_same = compute_feature_psi(base, same)
    psi_shifted = compute_feature_psi(base, shifted)

    assert psi_same < 0.15, f"PSI esperado baixo para mesma distribuição, obtido {psi_same}"
    assert psi_shifted > 0.25, f"PSI esperado alto para distribuição deslocada, obtido {psi_shifted}"


def test_build_weekly_evaluation_records_matches_d1_schema():
    station_evals = {
        "ramqar_camburi": {
            "total_points": 168,
            "mae_pm25": 1.25,
            "mae_o3": 2.1,
            "mae_no2": 0.95,
            "iqar_accuracy_pct": 92.5,
            "false_alarm_rate": 0.0,
            "missed_event_rate": 0.0,
            "drift_detected": 0,
            "report_md": "# Relatorio Camburi",
        }
    }
    records = build_weekly_evaluation_records(
        station_evals=station_evals,
        week_code="2026-W42",
        model_version="v2026.38.5",
        retrained=1,
    )
    assert len(records) == 1
    rec = records[0]
    expected_cols = {
        "id",
        "week_code",
        "station_id",
        "model_version",
        "total_eval_points",
        "mae_pm25",
        "mae_o3",
        "mae_no2",
        "iqar_accuracy_percentage",
        "false_alarm_rate",
        "missed_event_rate",
        "drift_detected",
        "retrained",
        "evaluation_report_md",
    }
    assert set(rec.keys()) == expected_cols
    assert rec["week_code"] == "2026-W42"
    assert rec["station_id"] == "ramqar_camburi"
    assert rec["model_version"] == "v2026.38.5"
    assert rec["total_eval_points"] == 168
    assert rec["retrained"] == 1


def test_persist_weekly_evaluations_to_d1():
    calls: List[Dict[str, Any]] = []

    def mock_post(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        calls.append({"url": url, "token": token, "body": body})
        return {"success": True, "errors": [], "result": [{"results": [], "success": True}]}

    records = [
        {
            "id": "weval_2026-W42_ramqar_camburi",
            "week_code": "2026-W42",
            "station_id": "ramqar_camburi",
            "model_version": "v2026.38.5",
            "total_eval_points": 168,
            "mae_pm25": 1.1,
            "mae_o3": 2.0,
            "mae_no2": 0.8,
            "iqar_accuracy_percentage": 94.0,
            "false_alarm_rate": 0.0,
            "missed_event_rate": 0.0,
            "drift_detected": 0,
            "retrained": 0,
            "evaluation_report_md": "# Report",
        }
    ]

    n_saved = persist_weekly_evaluations_to_d1(
        records=records,
        account_id="acc_123",
        database_id="db_456",
        token="tok_789",
        post_fn=mock_post,
    )
    assert n_saved == 1
    # Deve ter garantido model_registry (FK) com métricas reais do models/registry.json e inserido em weekly_evaluations
    sqls = [c["body"]["sql"] for c in calls]
    assert any("INTO model_registry" in s for s in sqls)
    assert any("INTO weekly_evaluations" in s for s in sqls)

    reg_params = calls[0]["body"]["params"]
    assert reg_params[0] == "v2026.38.5"
    assert reg_params[4] != "registry-managed"
    assert len(reg_params[4]) == 64  # SHA-256 real de pm25.onnx em models/registry.json
    assert reg_params[8] == 0.39     # test_mae real de pm25
    assert reg_params[9] == 0.59     # test_rmse real de pm25
    assert reg_params[10] == 0.9711  # test_r2 real de pm25

    # Verifica que result[0].success == False não conta como salvo
    def mock_post_inner_fail(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return {"success": True, "errors": [], "result": [{"results": [], "success": False}]}

    n_failed = persist_weekly_evaluations_to_d1(
        records=records,
        account_id="acc_123",
        database_id="db_456",
        token="tok_789",
        post_fn=mock_post_inner_fail,
    )
    assert n_failed == 0


def test_install_d1_retrain_compat_and_fetch_d1_only():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_compat_test_")
    try:
        install_d1_retrain_compat()
        import ml.training.fetch_from_d1 as f_mod

        raw_path = os.path.join(tmp_dir, "raw.json")
        raw_payload = {
            "fetched_at": "2026-10-18T19:00:00Z",
            "stations": {
                "ramqar_camburi": {
                    "meta": {"id": "ramqar_camburi"},
                    "meteo_hourly": {"time": ["2026-10-18T18:00", "2026-10-18T19:00"], "temperature_2m": [24.0, 25.0]},
                    "aq_hourly": {
                        "time": ["2026-10-18T18:00", "2026-10-18T19:00"],
                        "pm2_5": [10.0, 11.0],
                        "pm10": [20.0, 21.0],
                        "nitrogen_dioxide": [12.0, 13.0],
                        "sulphur_dioxide": [3.0, 3.5],
                        "ozone": [30.0, 32.0],
                        "carbon_monoxide": [100.0, 110.0],
                    },
                }
            },
        }
        with open(raw_path, "w", encoding="utf-8") as f:
            json.dump(raw_payload, f)

        # 1. Regressão obrigatória: após install_d1_retrain_compat(), resolve_training_data(source_mode="local", ...) deve funcionar sem TypeError
        src, loaded = f_mod.resolve_training_data(
            source_mode="local",
            local_raw_path=raw_path,
            d1_file=os.path.join(tmp_dir, "d1.json"),
        )
        assert src == "local"
        assert "ramqar_camburi" in loaded["stations"]

        # 2. Regressão obrigatória: --fetch-d1-only (fetch_d1_to_file) com post_fn mock e arquivo tmp
        d1_rows = [
            {
                "id": "obs_1",
                "station_id": "ramqar_camburi",
                "timestamp": "2026-10-18T19:00:00Z",
                "pm25": 15.5,
                "pm10": 28.0,
                "o3": 40.0,
                "no2": 18.0,
                "so2": 4.2,
                "co": 130.0,
                "iqar": 31,
                "source": "open-meteo-cams-reanalysis",
            }
        ]
        call_count = 0

        def mock_d1_post(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
            nonlocal call_count
            call_count += 1
            rows = d1_rows if call_count == 1 else []
            return {"success": True, "result": [{"success": True, "results": rows}]}

        d1_out = os.path.join(tmp_dir, "d1_observed.json")
        payload = fetch_d1_to_file(
            out_path=d1_out,
            env_vars={
                "CLOUDFLARE_ACCOUNT_ID": "acc_test",
                "D1_DATABASE_ID": "db_test",
                "CLOUDFLARE_API_TOKEN": "tok_test",
            },
            post_fn=mock_d1_post,
        )
        assert os.path.exists(d1_out)
        assert payload["summary"]["total_records"] == 1
        assert "ramqar_camburi" in payload["stations"]

        # 3. Regressão: resolve_training_data(source_mode="d1") usando cache salvo e suplementando histórico
        src_d1, merged_d1 = f_mod.resolve_training_data(
            source_mode="d1",
            local_raw_path=raw_path,
            d1_file=d1_out,
            env_vars={},
        )
        assert src_d1 == "d1"
        assert merged_d1["stations"]["ramqar_camburi"]["aq_hourly"]["pm2_5"][-1] == 15.5
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_next_model_version_and_supplement_d1_with_history():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_ver_sup_")
    try:
        reg_file = os.path.join(tmp_dir, "registry.json")
        with open(reg_file, "w", encoding="utf-8") as f:
            json.dump({"active_version": "v2026.42.1", "versions": {"v2026.42.1": {}}}, f)

        dt = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)
        v = next_model_version(reg_file, now=dt)
        assert v == "v2026.42.2"

        # Testa suplementação de 168h do D1 sobre histórico de 240h
        times = [f"2026-10-{d:02d}T{h:02d}:00" for d in range(1, 11) for h in range(24)]
        raw_openmeteo = {
            "fetched_at": times[100] + ":00Z",
            "stations": {
                "ramqar_camburi": {
                    "meta": {"id": "ramqar_camburi"},
                    "meteo_hourly": {"time": times, "temperature_2m": [25.0] * len(times)},
                    "aq_hourly": {
                        "time": times,
                        "pm2_5": [10.0] * len(times),
                        "pm10": [20.0] * len(times),
                        "nitrogen_dioxide": [15.0] * len(times),
                        "sulfur_dioxide": [3.0] * len(times),
                        "ozone": [30.0] * len(times),
                        "carbon_monoxide": [100.0] * len(times),
                    },
                }
            },
        }
        d1_window = times[-168:]
        d1_data = {
            "summary": {"window_end": d1_window[-1] + ":00Z"},
            "stations": {
                "ramqar_camburi": {
                    "series": [
                        {
                            "timestamp": ts + ":00Z",
                            "pm25": 42.0,
                            "pm10": 55.0,
                            "o3": 60.0,
                            "no2": 22.0,
                            "so2": 5.0,
                            "co": 120.0,
                            "source": "open-meteo-cams-reanalysis",
                        }
                        for ts in d1_window
                    ]
                }
            },
        }
        short_merged = {
            "fetched_at": times[100] + ":00Z",
            "provenance": {"d1_stations": ["ramqar_camburi"]},
            "stations": {
                "ramqar_camburi": {
                    "meta": {"id": "ramqar_camburi"},
                    "meteo_hourly": {"time": d1_window},
                    "aq_hourly": {"time": d1_window, "pm2_5": [42.0] * 168},
                }
            },
        }
        sup = supplement_d1_with_history(raw_openmeteo, d1_data, short_merged, min_hours=360)
        aq_sup = sup["stations"]["ramqar_camburi"]["aq_hourly"]
        assert len(aq_sup["time"]) == 240
        assert aq_sup["pm2_5"][0] == 10.0
        assert aq_sup["pm2_5"][-1] == 42.0
        assert aq_sup["sulphur_dioxide"][-1] == 5.0
        assert sup["fetched_at"] == d1_window[-1] + ":00Z"
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_run_weekly_evaluation_end_to_end():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_weekly_eval_")
    try:
        # 1. Com 210h (apenas 12h de ref após 30h de lag < 168h): psi_computed deve ser False
        n_short = 210
        times_short = [
            f"2026-10-{d:02d}T{h:02d}:00"
            for d in range(1, 15)
            for h in range(24)
        ][:n_short]
        raw_short = {
            "fetched_at": times_short[-1] + ":00Z",
            "stations": {
                "ramqar_camburi": {
                    "meta": {"id": "ramqar_camburi", "name": "Camburi", "municipality": "Vitória"},
                    "aq_hourly": {
                        "time": times_short,
                        "pm2_5": [12.0] * n_short,
                        "pm10": [22.0] * n_short,
                        "ozone": [35.0] * n_short,
                        "nitrogen_dioxide": [14.0] * n_short,
                        "sulphur_dioxide": [4.0] * n_short,
                        "carbon_monoxide": [100.0] * n_short,
                    },
                    "meteo_hourly": {
                        "time": times_short,
                        "temperature_2m": [24.0] * n_short,
                        "relative_humidity_2m": [72.0] * n_short,
                        "wind_speed_10m": [11.0] * n_short,
                        "wind_direction_10m": [45.0] * n_short,
                        "pressure_msl": [1013.0] * n_short,
                        "shortwave_radiation": [120.0] * n_short,
                        "boundary_layer_height": [550.0] * n_short,
                    },
                }
            },
        }
        out_json = os.path.join(tmp_dir, "weekly_evaluation.json")
        out_md = os.path.join(tmp_dir, "weekly_evaluation_report.md")

        boosters = {
            t: _MockBooster(v)
            for t, v in [("pm25", 12.0), ("pm10", 22.0), ("o3", 35.0), ("no2", 14.0), ("so2", 4.0)]
        }
        cal = {"bias": {t: 0.0 for t in boosters}, "isotonic": {}}

        summary_short = run_weekly_evaluation(
            raw_dict=raw_short,
            version="v2026.38.5",
            order="v1",
            boosters=boosters,
            calibration=cal,
            out_path=out_json,
            report_path=out_md,
            week_code="2026-W42",
        )
        assert summary_short["psi_computed"] is False
        assert summary_short["ref_points_count"] < 168
        assert summary_short["skipped_points"] == 0

        # 2. Com 380h (>= 168h de ref + 168h de holdout + 30h de lag): psi_computed deve ser True
        n_full = 380
        times_full = [
            f"2026-10-{d:02d}T{h:02d}:00"
            for d in range(1, 20)
            for h in range(24)
        ][:n_full]
        rng = np.random.default_rng(7)
        raw_full = {
            "fetched_at": times_full[-1] + ":00Z",
            "stations": {
                "ramqar_camburi": {
                    "meta": {"id": "ramqar_camburi", "name": "Camburi", "municipality": "Vitória"},
                    "aq_hourly": {
                        "time": times_full,
                        "pm2_5": list(rng.normal(12.0, 1.0, n_full)),
                        "pm10": list(rng.normal(22.0, 1.5, n_full)),
                        "ozone": list(rng.normal(35.0, 2.0, n_full)),
                        "nitrogen_dioxide": list(rng.normal(14.0, 1.0, n_full)),
                        "sulphur_dioxide": list(rng.normal(4.0, 0.3, n_full)),
                        "carbon_monoxide": list(rng.normal(100.0, 5.0, n_full)),
                    },
                    "meteo_hourly": {
                        "time": times_full,
                        "temperature_2m": list(rng.normal(24.0, 1.0, n_full)),
                        "relative_humidity_2m": list(rng.normal(72.0, 3.0, n_full)),
                        "wind_speed_10m": list(rng.normal(11.0, 1.0, n_full)),
                        "wind_direction_10m": list(rng.normal(45.0, 5.0, n_full)),
                        "pressure_msl": list(rng.normal(1013.0, 1.0, n_full)),
                        "shortwave_radiation": list(rng.normal(120.0, 10.0, n_full)),
                        "boundary_layer_height": list(rng.normal(550.0, 20.0, n_full)),
                    },
                }
            },
        }
        summary_full = run_weekly_evaluation(
            raw_dict=raw_full,
            version="v2026.38.5",
            order="v1",
            boosters=boosters,
            calibration=cal,
            out_path=out_json,
            report_path=out_md,
            week_code="2026-W42",
        )
        assert summary_full["psi_computed"] is True
        assert summary_full["ref_points_count"] == 168
        assert summary_full["holdout_points_count"] == 168
        assert summary_full["skipped_points"] == 0
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    test_evaluate_predictions_stable_and_drift_gates()
    test_compute_feature_psi()
    test_build_weekly_evaluation_records_matches_d1_schema()
    test_persist_weekly_evaluations_to_d1()
    test_install_d1_retrain_compat_and_fetch_d1_only()
    test_next_model_version_and_supplement_d1_with_history()
    test_run_weekly_evaluation_end_to_end()
    print("[OK] test_evaluate_weekly: 7/7 verdes")


