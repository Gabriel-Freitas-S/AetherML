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
    load_champion_boosters,
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

    def save_model(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("mock_model_dump")


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


def test_extract_holdout_skips_nulls_defensively():
    # Cria raw sintético com 220 horas e insere valores None propositais
    n_hours = 220
    times = [f"2026-07-{d:02d}T{h:02d}:00" for d in range(1, 11) for h in range(24)][:n_hours]
    pm25_vals = [10.0 + (i % 5) for i in range(n_hours)]
    temp_vals = [22.0 for _ in range(n_hours)]
    pblh_vals = [500.0 for _ in range(n_hours)]

    # Insere None propositalmente em 3 horas dentro da janela de holdout (horas finais)
    pm25_vals[200] = None  # Alvo None
    temp_vals[205] = None  # Meteo None
    pblh_vals[210 - 2] = None  # PBLH no lag de 6h None

    raw = {
        "fetched_at": times[-1],
        "stations": {
            "ramqar_camburi": {
                "meta": {"id": "ramqar_camburi", "municipality": "Vitória"},
                "aq_hourly": {
                    "time": times,
                    "pm2_5": pm25_vals,
                    "pm10": [20.0 for _ in range(n_hours)],
                    "ozone": [30.0 for _ in range(n_hours)],
                    "nitrogen_dioxide": [15.0 for _ in range(n_hours)],
                    "sulphur_dioxide": [5.0 for _ in range(n_hours)],
                    "carbon_monoxide": [100.0 for _ in range(n_hours)],
                },
                "meteo_hourly": {
                    "time": times,
                    "temperature_2m": temp_vals,
                    "relative_humidity_2m": [70.0 for _ in range(n_hours)],
                    "wind_speed_10m": [10.0 for _ in range(n_hours)],
                    "wind_direction_10m": [90.0 for _ in range(n_hours)],
                    "pressure_msl": [1013.0 for _ in range(n_hours)],
                    "shortwave_radiation": [100.0 for _ in range(n_hours)],
                    "boundary_layer_height": pblh_vals,
                },
            }
        },
    }

    # Deve pular defensivamente as horas com None e extrair as horas válidas restantes
    X_holdout, y_holdout, _, _ = extract_holdout_from_raw(raw, holdout_hours=168)
    assert len(X_holdout) < 168, "Deveria ter pulado as horas com None"
    # 1h pm25 + 1h temp + 6h com pblh no histórico + 1h pontual = 159 válidas
    assert len(X_holdout) == 159, f"Deveria ter mantido 159 horas válidas, obtido {len(X_holdout)}"
    assert len(y_holdout["pm25"]) == len(X_holdout)


def test_extract_holdout_fails_when_all_hours_are_null():
    n_hours = 220
    times = [f"2026-07-{d:02d}T{h:02d}:00" for d in range(1, 11) for h in range(24)][:n_hours]
    raw = {
        "fetched_at": times[-1],
        "stations": {
            "ramqar_camburi": {
                "meta": {"id": "ramqar_camburi"},
                "aq_hourly": {
                    "time": times,
                    "pm2_5": [None] * n_hours,
                    "pm10": [None] * n_hours,
                    "ozone": [None] * n_hours,
                    "nitrogen_dioxide": [None] * n_hours,
                    "sulphur_dioxide": [None] * n_hours,
                    "carbon_monoxide": [None] * n_hours,
                },
                "meteo_hourly": {
                    "time": times,
                    "temperature_2m": [22.0] * n_hours,
                    "relative_humidity_2m": [70.0] * n_hours,
                    "wind_speed_10m": [10.0] * n_hours,
                    "wind_direction_10m": [90.0] * n_hours,
                    "pressure_msl": [1013.0] * n_hours,
                    "shortwave_radiation": [100.0] * n_hours,
                    "boundary_layer_height": [500.0] * n_hours,
                },
            }
        },
    }

    try:
        extract_holdout_from_raw(raw, holdout_hours=168)
        assert False, "Deveria falhar quando todas as horas contêm None"
    except ValueError as e:
        assert "válida" in str(e).lower() or "nulos" in str(e).lower()


def test_paired_evaluation_uses_raw_float_rmse():
    n = 10
    X_holdout = np.zeros((n, 25), dtype=np.float32)
    y_true = {"pm25": np.zeros(n, dtype=np.float32)}

    # Champion: erro constante 10.0000 -> RMSE = 10.0000
    # Challenger: erro constante 10.0040 -> RMSE = 10.0040 (pior)
    # Arredondado a 2 casas: ambos seriam 10.00 (falso empate)
    # Com float cru: 10.0040 > 10.0000 -> promote deve ser False
    champ_preds = np.full(n, 10.0)
    chall_preds = np.full(n, 10.004)

    champion_models = {"pm25": MockBooster(champ_preds)}
    challenger_models = {"pm25": MockBooster(chall_preds)}

    decisions = compare_champion_challenger(
        champion_models=champion_models,
        challenger_models=challenger_models,
        X_holdout=X_holdout,
        y_holdout=y_true,
        epsilon=0.0,
        targets=["pm25"],
    )

    assert decisions["pm25"]["champion"]["rmse"] == 10.0
    assert decisions["pm25"]["challenger"]["rmse"] == 10.0
    assert decisions["pm25"]["promote"] is False, "Decisão deve ser feita em float cru, não arredondado"


def test_apply_promotion_fails_if_artifact_missing():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_promo_fail_")
    try:
        chall_dir = os.path.join(tmp_dir, "challenger")
        pub_dir = os.path.join(tmp_dir, "public")
        os.makedirs(chall_dir, exist_ok=True)
        os.makedirs(pub_dir, exist_ok=True)

        decisions = {"pm25": {"promote": True}}
        # src_onnx NÃO existe em chall_dir
        try:
            apply_promotion(
                decisions=decisions,
                challenger_version="vChallenger",
                challenger_dir=chall_dir,
                onnx_meta={"pm25": {"sha256": "x", "size_kb": 1}},
                public_models_dir=pub_dir,
                registry_file=os.path.join(tmp_dir, "registry.json"),
            )
            assert False, "Deveria ter falhado com FileNotFoundError"
        except FileNotFoundError as e:
            assert "ausente" in str(e).lower() or "pm25" in str(e).lower()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_retrain_aborts_on_corrupted_champion():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_corrupt_champ_")
    try:
        reg_data = {
            "active_version": "vCorruptChamp",
            "models": {t: {"version": "vCorruptChamp"} for t in ["pm25", "pm10", "o3", "no2", "so2"]},
        }
        # Diretório da versão ativa existe, mas falta o booster .txt
        os.makedirs(os.path.join(tmp_dir, "vCorruptChamp"), exist_ok=True)

        try:
            load_champion_boosters(reg_data, models_dir=tmp_dir)
            assert False, "Deveria lançar FileNotFoundError para boosters ausentes"
        except FileNotFoundError as e:
            assert "não encontrado" in str(e).lower()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_synthetic_target_does_not_hash_challenger():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_synth_test_")
    try:
        reg_file = os.path.join(tmp_dir, "registry.json")
        pub_file = os.path.join(tmp_dir, "pub_reg.json")
        initial_reg = {
            "active_version": "vChamp",
            "targets": ["pm25", "pm10"],
            "models": {
                "pm25": {"version": "vChamp", "sha256": "sha_orig_pm25", "size_kb": 10.0}
            },
        }
        with open(reg_file, "w") as f:
            json.dump(initial_reg, f)

        # Promove apenas pm25; pm10 é sintético não promovido
        decisions = {
            "pm25": {"promote": True},
            "pm10": {"promote": False},
        }
        onnx_results = {
            "pm25": {"sha256": "sha_new_pm25", "size_kb": 12.0},
            "pm10": {"sha256": "sha_new_pm10", "size_kb": 14.0},
        }
        challenger_metrics = {
            "pm25": {"rmse": 1.0},
            "pm10": {"rmse": 2.0},
        }

        updated = update_registry_paired(
            challenger_version="vChall",
            promoted_targets=["pm25"],
            onnx_results=onnx_results,
            challenger_metrics=challenger_metrics,
            registry_file=reg_file,
            public_file=pub_file,
        )

        assert updated["models"]["pm25"]["version"] == "vChall"
        assert updated["models"]["pm25"]["sha256"] == "sha_new_pm25"
        # pm10 sintético mantido no champion NÃO deve herdar o sha256 do challenger!
        assert updated["models"]["pm10"]["version"] == "vChamp"
        assert updated["models"]["pm10"]["sha256"] is None
        assert updated["models"]["pm10"]["size_kb"] is None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_dry_run_invokes_pipeline_without_modifying_public():
    tmp_dir = tempfile.mkdtemp(prefix="aetherml_dryrun_real_")
    try:
        pub_dir = os.path.join(tmp_dir, "apps", "web", "public", "models")
        os.makedirs(pub_dir, exist_ok=True)
        orig_file = os.path.join(pub_dir, "pm25.onnx")
        with open(orig_file, "wb") as f:
            f.write(b"champion_original_bytes")

        import unittest.mock as mock
        from ml.training.retrain_real import main

        mock_booster = MockBooster(np.full(10, 20.0))
        mock_train_res = {
            "models": {t: mock_booster for t in ["pm25", "pm10", "o3", "no2", "so2"]},
            "metrics": {t: {"rmse": 1.0, "mae": 0.5, "r2": 0.9} for t in ["pm25", "pm10", "o3", "no2", "so2"]},
            "feature_names": [f"f{i}" for i in range(25)],
            "bias": {},
            "isotonic": {},
        }

        n_hours = 220
        times = [f"2026-07-{d:02d}T{h:02d}:00" for d in range(1, 11) for h in range(24)][:n_hours]
        raw_data = {
            "fetched_at": times[-1],
            "stations": {
                "ramqar_camburi": {
                    "meta": {"id": "ramqar_camburi"},
                    "aq_hourly": {
                        "time": times,
                        "pm2_5": [10.0] * n_hours,
                        "pm10": [20.0] * n_hours,
                        "ozone": [30.0] * n_hours,
                        "nitrogen_dioxide": [15.0] * n_hours,
                        "sulphur_dioxide": [5.0] * n_hours,
                        "carbon_monoxide": [100.0] * n_hours,
                    },
                    "meteo_hourly": {
                        "time": times,
                        "temperature_2m": [22.0] * n_hours,
                        "relative_humidity_2m": [70.0] * n_hours,
                        "wind_speed_10m": [10.0] * n_hours,
                        "wind_direction_10m": [90.0] * n_hours,
                        "pressure_msl": [1013.0] * n_hours,
                        "shortwave_radiation": [100.0] * n_hours,
                        "boundary_layer_height": [500.0] * n_hours,
                    },
                }
            },
        }
        raw_path = os.path.join(tmp_dir, "raw.json")
        with open(raw_path, "w") as f:
            json.dump(raw_data, f)

        old_argv = sys.argv
        sys.argv = [
            "retrain_real.py",
            "--dry-run",
            "--raw", raw_path,
            "--source", "local",
            "--dataset", os.path.join(tmp_dir, "dataset.json"),
            "--version", "v2026.test.1",
        ]

        with mock.patch("ml.training.retrain_real.train_models", return_value=mock_train_res), \
             mock.patch("ml.training.retrain_real.PUBLIC_MODELS", pub_dir), \
             mock.patch("ml.training.retrain_real.export_to_onnx", return_value={t: {"sha256": "x", "size_kb": 1} for t in ["pm25", "pm10", "o3", "no2", "so2"]}), \
             mock.patch("ml.training.retrain_real.export_saabas_topologies"):
            main()

        # Prova que o dry-run real NÃO tocou no arquivo public/models
        with open(orig_file, "rb") as f:
            assert f.read() == b"champion_original_bytes", "Dry-run não deve tocar nos arquivos em public/models!"
    finally:
        sys.argv = old_argv
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_retrain_args_parsing():
    from ml.training.retrain_real import parse_args

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
    test_extract_holdout_skips_nulls_defensively()
    test_extract_holdout_fails_when_all_hours_are_null()
    test_paired_evaluation_and_promotion_decision()
    test_paired_evaluation_uses_raw_float_rmse()
    test_transactional_promotion_and_registry_update()
    test_apply_promotion_fails_if_artifact_missing()
    test_retrain_aborts_on_corrupted_champion()
    test_synthetic_target_does_not_hash_challenger()
    test_dry_run_invokes_pipeline_without_modifying_public()
    test_retrain_args_parsing()
    print("[OK] test_champion_challenger: 12/12 verdes")
