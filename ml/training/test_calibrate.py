"""Teste da calibração de viés + pesos de fronteira (puros, sem I/O).

Roda: `python ml/training/test_calibrate.py` (exit 0 = verde).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.calibrate import (
    apply_bias,
    apply_isotonic,
    boundary_weights,
    compute_bias,
    fit_isotonic,
)


def test_compute_bias_is_mean_residual():
    b = compute_bias({"pm25": [12.0, 14.0]}, {"pm25": [10.0, 11.0]})
    assert abs(b["pm25"] - 2.5) < 1e-9, b


def test_apply_bias_shifts_prediction():
    out = apply_bias({"pm25": 10.0, "o3": 50.0}, {"pm25": 1.5, "o3": -5.0})
    assert out == {"pm25": 11.5, "o3": 45.0}


def test_boundary_weights_emphasize_frontier():
    # índices perto da fronteira Boa/Moderada (30-60) pesam mais que o centro
    w = boundary_weights([20, 35, 55, 100])
    assert w[1] > w[0] and w[2] > w[0], w
    assert w[3] == 1.0  # longe da fronteira: peso neutro
    assert all(x >= 1.0 for x in w)


def test_isotonic_is_monotone_and_interpolates():
    iso = fit_isotonic([1.0, 2.0, 3.0, 4.0], [1.1, 1.9, 3.2, 3.8])
    ys = iso["y"]
    assert all(b >= a for a, b in zip(ys, ys[1:])), iso
    out = apply_isotonic([0.0, 1.9, 99.0], iso)
    assert out[0] == ys[0] and out[2] == ys[-1]
    assert abs(out[1] - 2.0) < 0.3


if __name__ == "__main__":
    test_compute_bias_is_mean_residual()
    test_apply_bias_shifts_prediction()
    test_boundary_weights_emphasize_frontier()
    test_isotonic_is_monotone_and_interpolates()
    print("[OK] test_calibrate: 4/4 verdes")
