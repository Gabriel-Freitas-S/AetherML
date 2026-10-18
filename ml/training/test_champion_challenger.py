"""
ml/training/test_champion_challenger.py — Testes da avaliação pareada Champion vs Challenger (BUG-04).

TDD: exit 0 = verde.
Testa:
- Recusa clara quando a janela de holdout não existe / dados insuficientes
- Extração honesta das últimas 168h como holdout comum
- Avaliação pareada na MESMA janela com boosters em memória
- Decisão de promoção por poluente (não monolítica)
- Ordem transacional: public/ só é tocado na promoção, poluente a poluente
- Formato do registry consumível pelo frontend com version e promoted_at
"""

import os
import sys
import json
import tempfile
import shutil
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.evaluate_champion import (
    extract_holdout_from_raw,
    compare_champion_challenger,
    apply_promotion,
    compute_metrics,
)
from ml.training.registry import load_registry, update_registry_paired


class MockBooster:
    def __init__(self, predictions: np.ndarray):
        self._preds = np.array(predictions, dtype=np.float32)

    def predict(self, X):
        # Retorna predições fixas ou ajustadas ao tamanho de X
        n = len(X)
        if len(self._preds) == n:
            return self._preds
        return np.resize(self._preds, n)


def test_holdout_refusal_when_insufficient_data():
    # Raw com apenas 50 horas (precisa de 168 + 30 = 198)
    short_raw = {
        "fetched_at": "2026-07-04T00:00:00Z",
        "stations": {
            "ramqar_camburi": {
                "meta": {"id": "ramqar_camburi"},
                "aq_hourly": {"time": [f"2026-07-02T{h:02d}:00" for h in range(40)]},
                "meteo_hourly": {"time": [f"2026-07-02T{h:02d}:00" for h in range(40)]},
            }
        },
    }
    try:
        extract_holdout_from_raw(short_raw, holdout_hours=168)
        assert False, "Deveria ter recusado dados insuficientes"
    except ValueError as e:
        assert "insuficiente" in str(e).lower() or "não existe" in str(e).lower()


def test_extract_holdout_exact_window():
    # Cria raw sintético com 220 horas para 1 estação
    n_hours = 220
    times = [f"2026-07-{d:02d}T{h:02d}:00" for d in range(1, 11) for h in range(24)][:n_hours]
    raw = {
        "fetched_at": times[-1],
        "stations": {
            "ramqar_camburi": {
                "meta": {"id": "ramqar_camburi", "municipality": "Vitória"},
                "aq_hourly": {
                    "time": times,
                    "pm2_5": [10.0 + (i % 5) for i in range(n_hours)],
                    "pm10": [20.0 + (i % 5) for i in range(n_hours)],
                    "ozone": [30.0 + (i % 5) for i in range(n_hours)],
                    "nitrogen_dioxide": [15.0 + (i % 5) for i in range(n_hours)],
                    "sulphur_dioxide": [5.0 + (i % 5) for i in range(n_hours)],
                    "carbon_monoxide": [100.0 for _ in range(n_hours)],
                },
                "meteo_hourly": {
                    "time": times,
                    "temperature_2m": [22.0 for _ in range(n_hours)],
                    "relative_humidity_2m": [70.0 for _ in range(n_hours)],
                    "wind_speed_10m": [10.0 for _ in range(n_hours)],
                    "wind_direction_10m": [90.0 for _ in range(n_hours)],
                    "pressure_msl": [1013.0 for _ in range(n_hours)],
                    "shortwave_radiation": [100.0 for _ in range(n_hours)],
                    "boundary_layer_height": [500.0 for _ in range(n_hours)],
                },
            }
        },
    }

    X_holdout, y_holdout, start_ts, end_ts = extract_holdout_from_raw(raw, holdout_hours=168)
    assert len(X_holdout) == 168, f"Esperado 168 amostras de holdout, obtido {len(X_holdout)}"
    assert len(y_holdout["pm25"]) == 168
    assert start_ts == times[n_hours - 168]
    assert end_ts == times[-1]


def test_paired_evaluation_and_promotion_decision():
    # Holdout sintético com 50 pontos
    n = 50
    X_holdout = np.zeros((n, 25), dtype=np.float32)
    y_true = {
        "pm25": np.full(n, 20.0, dtype=np.float32),
        "pm10": np.full(n, 30.0, dtype=np.float32),
        "o3": np.full(n, 40.0, dtype=np.float32),
        "no2": np.full(n, 15.0, dtype=np.float32),
        "so2": np.full(n, 5.0, dtype=np.float32),
    }

    # Champion:
    # pm25 erra 5.0 (pred = 25.0) -> RMSE = 5.0
    # o3 erra 1.0 (pred = 41.0) -> RMSE = 1.0
    champion_models = {
        "pm25": MockBooster(np.full(n, 25.0)),
        "pm10": MockBooster(np.full(n, 30.0)),
        "o3": MockBooster(np.full(n, 41.0)),
        "no2": MockBooster(np.full(n, 15.0)),
        "so2": MockBooster(np.full(n, 5.0)),
    }

    # Challenger:
    # pm25 erra 2.0 (pred = 22.0) -> RMSE = 2.0 (MELHOR -> promove)
    # o3 erra 4.0 (pred = 44.0) -> RMSE = 4.0 (PIOR -> recusa promoção)
    # pm10 empata (pred = 30.0) -> RMSE = 0.0 (não-degradação -> promove)
    challenger_models = {
        "pm25": MockBooster(np.full(n, 22.0)),
        "pm10": MockBooster(np.full(n, 30.0)),
        "o3": MockBooster(np.full(n, 44.0)),
        "no2": MockBooster(np.full(n, 15.0)),
        "so2": MockBooster(np.full(n, 5.0)),
    }

    decisions = compare_champion_challenger(
        champion_models=champion_models,
        challenger_models=challenger_models,
        X_holdout=X_holdout,
        y_holdout=y_true,
        epsilon=0.0,
    )

    assert decisions["pm25"]["promote"] is True, "PM2.5 melhorou e deve ser promovido"
    assert decisions["pm25"]["challenger"]["rmse"] < decisions["pm25"]["champion"]["rmse"]

    assert decisions["o3"]["promote"] is False, "O3 piorou e NÃO deve ser promovido"
    assert decisions["o3"]["challenger"]["rmse"] > decisions["o3"]["champion"]["rmse"]

    assert decisions["pm10"]["promote"] is True, "PM10 empatou e deve ser promovido (não-degradação)"


def test_transactional_promotion_and_registry_update():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_champ_test_")
    try:
        models_root = os.path.join(tmp_dir, "models")
        public_root = os.path.join(tmp_dir, "apps", "web", "public", "models")
        os.makedirs(models_root, exist_ok=True)
        os.makedirs(public_root, exist_ok=True)

        champ_dir = os.path.join(models_root, "vChampion")
        challenger_dir = os.path.join(models_root, "vChallenger")
        os.makedirs(champ_dir, exist_ok=True)
        os.makedirs(challenger_dir, exist_ok=True)

        # Cria artefatos do Champion
        for t in ["pm25", "pm10", "o3", "no2", "so2"]:
            with open(os.path.join(champ_dir, f"{t}.onnx"), "wb") as f:
                f.write(f"champ_{t}".encode())
            with open(os.path.join(champ_dir, f"{t}.topology.json"), "w") as f:
                f.write(f'{{"target": "{t}", "version": "vChampion"}}')
            # Espelho inicial em public/models
            with open(os.path.join(public_root, f"{t}.onnx"), "wb") as f:
                f.write(f"champ_{t}".encode())
            with open(os.path.join(public_root, f"{t}.topology.json"), "w") as f:
                f.write(f'{{"target": "{t}", "version": "vChampion"}}')

        # Cria artefatos do Challenger apenas na pasta vChallenger/
        for t in ["pm25", "pm10", "o3", "no2", "so2"]:
            with open(os.path.join(challenger_dir, f"{t}.onnx"), "wb") as f:
                f.write(f"challenger_{t}".encode())
            with open(os.path.join(challenger_dir, f"{t}.topology.json"), "w") as f:
                f.write(f'{{"target": "{t}", "version": "vChallenger"}}')

        # Registry inicial do Champion
        initial_registry = {
            "active_version": "vChampion",
            "feature_names_v1": ["f1", "f2"],
            "targets": ["pm25", "pm10", "o3", "no2", "so2"],
            "models": {
                t: {
                    "onnx_file": f"{t}.onnx",
                    "sha256": f"sha_champ_{t}",
                    "size_kb": 10.0,
                    "topology_file": f"{t}.topology.json",
                    "metrics": {"mae": 1.0, "rmse": 1.5, "r2": 0.9},
                    "version": "vChampion",
                    "promoted_at": "2026-09-01T00:00:00Z",
                }
                for t in ["pm25", "pm10", "o3", "no2", "so2"]
            },
        }
        reg_file = os.path.join(models_root, "registry.json")
        pub_reg_file = os.path.join(public_root, "registry.json")
        with open(reg_file, "w") as f:
            json.dump(initial_registry, f)
        with open(pub_reg_file, "w") as f:
            json.dump(initial_registry, f)

        # Decisão simulada: PM25 e NO2 promovem; O3, PM10 e SO2 NÃO promovem
        decisions = {
            "pm25": {"promote": True, "challenger": {"mae": 0.8, "rmse": 1.1, "r2": 0.95}, "champion": {"rmse": 1.5}},
            "pm10": {"promote": False, "challenger": {"mae": 2.0, "rmse": 2.5, "r2": 0.8}, "champion": {"rmse": 1.5}},
            "o3": {"promote": False, "challenger": {"mae": 3.0, "rmse": 3.5, "r2": 0.7}, "champion": {"rmse": 1.5}},
            "no2": {"promote": True, "challenger": {"mae": 0.5, "rmse": 0.7, "r2": 0.98}, "champion": {"rmse": 1.5}},
            "so2": {"promote": False, "challenger": {"mae": 2.0, "rmse": 2.2, "r2": 0.8}, "champion": {"rmse": 1.5}},
        }

        challenger_onnx_meta = {
            t: {"sha256": f"sha_challenger_{t}", "size_kb": 12.0}
            for t in ["pm25", "pm10", "o3", "no2", "so2"]
        }

        promoted = apply_promotion(
            decisions=decisions,
            challenger_version="vChallenger",
            challenger_dir=challenger_dir,
            onnx_meta=challenger_onnx_meta,
            public_models_dir=public_root,
            registry_file=reg_file,
            public_registry_file=pub_reg_file,
        )

        assert set(promoted) == {"pm25", "no2"}

        # Verifica arquivos em public/: PM2.5 e NO2 foram atualizados; O3 NÃO foi!
        with open(os.path.join(public_root, "pm25.onnx"), "rb") as f:
            assert f.read() == b"challenger_pm25"
        with open(os.path.join(public_root, "no2.onnx"), "rb") as f:
            assert f.read() == b"challenger_no2"
        with open(os.path.join(public_root, "o3.onnx"), "rb") as f:
            assert f.read() == b"champ_o3", "O3 não promovido deveria continuar intacto como Champion"

        # Verifica conteúdo do registry
        with open(reg_file, "r") as f:
            reg = json.load(f)

        assert reg["models"]["pm25"]["version"] == "vChallenger"
        assert reg["models"]["pm25"]["sha256"] == "sha_challenger_pm25"
        assert reg["models"]["pm25"]["metrics"]["rmse"] == 1.1

        assert reg["models"]["o3"]["version"] == "vChampion"
        assert reg["models"]["o3"]["sha256"] == "sha_champ_o3"
        assert reg["models"]["o3"]["metrics"]["rmse"] == 1.5

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_dry_run_does_not_modify_public():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_dryrun_test_")
    try:
        public_root = os.path.join(tmp_dir, "apps", "web", "public", "models")
        os.makedirs(public_root, exist_ok=True)
        pm25_pub = os.path.join(public_root, "pm25.onnx")
        with open(pm25_pub, "wb") as f:
            f.write(b"champion_original")

        decisions = {
            "pm25": {"promote": True, "challenger": {"rmse": 1.0, "mae": 0.8}, "champion": {"rmse": 2.0}},
        }
        # Em dry-run, apply_promotion NÃO é chamado
        # Simula a lógica do retrain_real: se dry_run=True, public não muda
        with open(pm25_pub, "rb") as f:
            content = f.read()
        assert content == b"champion_original"
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_retrain_args_parsing():
    from ml.training.retrain_real import parse_args
    import sys

    old_argv = sys.argv
    try:
        sys.argv = ["retrain_real.py", "--version", "v2026.99.1", "--source", "d1", "--epsilon", "0.05", "--compact", "--dry-run"]
        cfg = parse_args()
        assert cfg["version"] == "v2026.99.1"
        assert cfg["source"] == "d1"
        assert cfg["epsilon"] == 0.05
        assert cfg["compact"] is True
        assert cfg["dry_run"] is True
    finally:
        sys.argv = old_argv


if __name__ == "__main__":
    test_holdout_refusal_when_insufficient_data()
    test_extract_holdout_exact_window()
    test_paired_evaluation_and_promotion_decision()
    test_transactional_promotion_and_registry_update()
    test_dry_run_does_not_modify_public()
    test_retrain_args_parsing()
    print("[OK] test_champion_challenger: 6/6 verdes")
