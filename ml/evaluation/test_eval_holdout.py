"""Teste das métricas do backtest (puro, sem rede/modelo).

Roda: `python ml/evaluation/test_eval_holdout.py` (exit 0 = verde).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.evaluation.eval_holdout import band_index, regression_metrics


def test_band_index_matches_conama_edges():
    # PM2.5 15.0 -> limite superior da faixa Boa (40); 15.01 -> Moderada (>40)
    assert band_index("pm25", 15.0) == 40
    assert band_index("pm25", 15.01) > 40
    assert band_index("pm25", 0.0) == 0
    # O3 100 -> 40; 130 -> 80
    assert band_index("o3", 100.0) == 40
    assert band_index("o3", 130.0) == 80


def test_regression_metrics_perfect_prediction():
    m = regression_metrics([10.0, 20.0, 30.0], [10.0, 20.0, 30.0])
    assert m["mae"] == 0.0 and m["rmse"] == 0.0 and m["r2"] == 1.0


def test_regression_metrics_known_values():
    m = regression_metrics([10.0, 20.0], [12.0, 18.0])
    assert abs(m["mae"] - 2.0) < 1e-9
    assert abs(m["rmse"] - 2.0) < 1e-9
    assert m["bias"] == 0.0
    assert 0.0 < m["r2"] < 1.0


if __name__ == "__main__":
    test_band_index_matches_conama_edges()
    test_regression_metrics_perfect_prediction()
    test_regression_metrics_known_values()
    print("[OK] test_eval_holdout: 3/3 verdes")
