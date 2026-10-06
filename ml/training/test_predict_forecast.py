"""Teste do default seguro do predict_forecast (versão + calibração).

Cobre a regressão real: predict_forecast.py defaultava v2026.38.2 (sem
calibration.json) e escrevia stations-data.json com números NÃO calibrados,
sem nenhum aviso.

Roda sem rede e sem modelo: `python ml/training/test_predict_forecast.py`
(exit 0 = verde). Assim como os demais scripts em ml/, as rotas são relativas
ao CWD — por isso os testes que tocam `models/` rodam num tmp via os.chdir.
"""

import contextlib
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.predict_forecast import (
    active_model,
    order_for_nfeatures,
    predict_all,
    require_calibration,
)


@contextlib.contextmanager
def fake_repo(registry: dict, calibration):
    """models/registry.json + models/<active>/calibration.json num tmp, com CWD
    dentro dele (require_calibration resolve `models/` relativo ao CWD)."""
    tmp = tempfile.mkdtemp()
    cwd = os.getcwd()
    try:
        models = os.path.join(tmp, "models")
        os.makedirs(os.path.join(models, registry["active_version"]), exist_ok=True)
        registry_path = os.path.join(models, "registry.json")
        with open(registry_path, "w", encoding="utf-8") as f:
            json.dump(registry, f)
        if calibration is not None:
            path = os.path.join(models, registry["active_version"], "calibration.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(calibration, f)
        os.chdir(tmp)
        yield tmp, registry_path
    finally:
        os.chdir(cwd)
        shutil.rmtree(tmp, ignore_errors=True)


def test_active_model_reads_registry():
    """models/registry.json é a fonte da verdade do modelo ativo."""
    version, order = active_model()
    assert version and version.startswith("v"), version
    # se o registry não declarar a ordem, fica None (inferida do booster)
    assert order in (None, "v1", "v2"), order


def test_order_for_nfeatures_maps_booster_width_to_order():
    """Booster de 30 features => v2; de 25 => v1. Nunca o contrário."""
    assert order_for_nfeatures(30) == "v2"
    assert order_for_nfeatures(25) == "v1"


def test_require_calibration_raises_when_file_missing():
    with fake_repo({"active_version": "vSemCal"}, None):
        try:
            require_calibration("vSemCal")
            raise AssertionError("deveria abortar sem calibration.json")
        except RuntimeError as e:
            assert "calibration.json" in str(e), e


def test_require_calibration_raises_when_file_is_empty_maps():
    """calibration.json presente mas com maps vazios também aborta — era o
    caminho silencioso (load_full devolvia {'bias':{}, 'isotonic':{}})."""
    with fake_repo({"active_version": "vVazia"}, {"bias": {}, "isotonic": {}}):
        try:
            require_calibration("vVazia")
            raise AssertionError("deveria abortar com calibration.json vazio")
        except RuntimeError as e:
            assert "calibration.json" in str(e), e


def test_require_calibration_returns_maps_when_present():
    cal_json = {"bias": {"pm25": -1.5}, "isotonic": {"pm25": {"x": [1.0], "y": [1.0]}}}
    with fake_repo({"active_version": "vOk"}, cal_json):
        cal = require_calibration("vOk")
        assert cal["bias"]["pm25"] == -1.5
        assert cal["isotonic"]["pm25"]["x"] == [1.0]


def test_predict_all_aborts_instead_of_writing_uncalibrated_json():
    """Regressão principal: predict_all NÃO pode escrever stations-data.json
    quando a versão ativa não tem calibração."""
    registry = {"active_version": "vSemCal", "feature_order_version": "v2"}
    with fake_repo(registry, None) as (tmp, registry_path):
        out_path = os.path.join(tmp, "stations-data.json")
        try:
            predict_all(
                raw_path=os.path.join(tmp, "raw-inexistente.json"),
                out_path=out_path,
                registry_path=registry_path,
            )
            raise AssertionError("predict_all deveria ter abortado")
        except RuntimeError as e:
            assert "calibration.json" in str(e), e
        assert not os.path.exists(out_path), (
            "nenhum JSON pode ser escrito sem calibração"
        )


if __name__ == "__main__":
    test_active_model_reads_registry()
    test_order_for_nfeatures_maps_booster_width_to_order()
    test_require_calibration_raises_when_file_missing()
    test_require_calibration_raises_when_file_is_empty_maps()
    test_require_calibration_returns_maps_when_present()
    test_predict_all_aborts_instead_of_writing_uncalibrated_json()
    print("[OK] test_predict_forecast: 6/6 verdes")
