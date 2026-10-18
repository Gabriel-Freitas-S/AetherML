"""Teste das métricas do backtest (puro, sem rede/modelo).

Roda: `python ml/evaluation/test_eval_holdout.py` (exit 0 = verde).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.evaluation.eval_holdout import (
    band_index,
    collect_persistence,
    iqar_persistence_metrics,
    persistence_pairs,
    regression_metrics,
    skill_score,
)
from ml.training.build_real_dataset import AQ_KEYS


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


def test_persistence_pairs():
    # Série pequena com índices no início (pula i - lag < 0)
    series = [10.0, 20.0, 30.0, 40.0, 50.0]
    idx = [0, 1, 2, 3, 4]

    # lag 1: pula i=0 (0-1 = -1 < 0), inclui 1..4 (n=4)
    yt, yp = persistence_pairs(series, idx, 1)
    assert yt == [20.0, 30.0, 40.0, 50.0]
    assert yp == [10.0, 20.0, 30.0, 40.0]
    assert len(yt) == 4

    # lag 24 com histórico insuficiente: pula tudo (n=0)
    yt, yp = persistence_pairs(series, idx, 24)
    assert yt == [] and yp == []

    # lag 24 com histórico suficiente
    series30 = [float(i) for i in range(30)]
    yt, yp = persistence_pairs(series30, [23, 24, 25], 24)
    # i=23 pula (23-24 < 0), i=24 -> (24, 0), i=25 -> (25, 1)
    assert yt == [24.0, 25.0]
    assert yp == [0.0, 1.0]
    assert len(yt) == 2


def test_skill_score():
    # None para baseline <= 0 ou sem n
    assert skill_score(0.5, 0.0) is None
    assert skill_score(0.5, -1.0) is None
    assert skill_score(None, 2.0) is None
    assert skill_score(1.0, None) is None
    assert skill_score(None, None) is None

    # 0.5 quando o modelo tem metade do erro
    assert skill_score(1.0, 2.0) == 0.5

    # Negativo quando pior que o baseline
    neg = skill_score(3.0, 2.0)
    assert neg is not None and neg < 0.0
    assert neg == -0.5

    # Sanity com valores arredondados conhecidos
    assert skill_score(0.57, 3.31) == 0.8278
    assert skill_score(0.92, 3.31) == 0.7221


def test_collect_persistence():
    # Raw sintético (2 estações: st1 ~40h, st2 ~5h)
    times1 = [f"2026-10-01T{h:02d}:00" for h in range(24)] + [
        f"2026-10-02T{h:02d}:00" for h in range(16)
    ]
    aq1 = {"time": times1}
    for col in AQ_KEYS.values():
        aq1[col] = [float(i) for i in range(40)]

    times2 = [f"2026-10-01T{h:02d}:00" for h in range(5)]
    aq2 = {"time": times2}
    for col in AQ_KEYS.values():
        aq2[col] = [float(i) for i in range(5)]

    raw = {
        "stations": {
            "st1": {"meta": {"name": "Estação 1"}, "aq_hourly": aq1},
            "st2": {"meta": {"name": "Estação 2"}, "aq_hourly": aq2},
        }
    }

    # cutoff no final da st1, hours=5, lag24
    # st1: end_idx=39, horas 35..39 -> pares (35, 11), ..., (39, 15)
    # st2: end_idx=4, horas 0..4 -> lag24 pula todos (i - 24 < 0), não quebra
    pairs = collect_persistence(raw, cutoff="2026-10-02T15", hours=5, lag=24)
    for t in AQ_KEYS:
        yt, yp = pairs[t]
        assert len(yt) == 5
        assert yt == [35.0, 36.0, 37.0, 38.0, 39.0]
        assert yp == [11.0, 12.0, 13.0, 14.0, 15.0]

    # iqar_persistence_metrics também não quebra com st2
    iq_res = iqar_persistence_metrics(raw, cutoff="2026-10-02T15", hours=5, lag=24)
    assert "mae_index" in iq_res
    assert "within_5pts" in iq_res
    assert "within_10pts" in iq_res
    assert "class_accuracy" in iq_res


if __name__ == "__main__":
    test_band_index_matches_conama_edges()
    test_regression_metrics_perfect_prediction()
    test_regression_metrics_known_values()
    test_persistence_pairs()
    test_skill_score()
    test_collect_persistence()
    print("[OK] test_eval_holdout: 6/6 verdes")

