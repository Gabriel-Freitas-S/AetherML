"""
ml/training/calibrate.py — Calibração de viés + pesos de fronteira (só TREINO).

- compute_bias: resíduo médio (y_true - y_pred) por alvo no treino/validação.
  Remove viés sistemático (ex.: O3 previa -5.5 de viés) antes do clamp.
- boundary_weights: amostras com índice IQAr próximo da fronteira Boa/Moderada
  (30-60) recebem peso maior — o classificador de faixa erra nas bordas.
- save/load de calibration.json (versionado junto aos .onnx).

NUNCA usar o holdout aqui: viés e pesos vêm só do treino.
"""

import json
import os
from typing import Dict, List


def compute_bias(
    y_true: Dict[str, List[float]], y_pred: Dict[str, List[float]]
) -> Dict[str, float]:
    bias = {}
    for t in y_true:
        n = len(y_true[t])
        resid = sum(float(a) - float(b) for a, b in zip(y_true[t], y_pred[t]))
        bias[t] = float(round(resid / max(1, n), 3))
    return bias


def apply_bias(preds: Dict[str, float], bias: Dict[str, float]) -> Dict[str, float]:
    return {t: preds[t] + bias.get(t, 0.0) for t in preds}


def _frontier_index_proxy(target: str, value: float) -> float:
    """Aproxima o índice da faixa Boa/Moderada a partir da concentração."""
    edges = {"pm25": 15.0, "pm10": 50.0, "o3": 100.0, "no2": 200.0, "so2": 20.0}
    e = edges.get(target, 1.0)
    return 40.0 * value / e if e else 40.0


def boundary_weights(proxy_indices: List[float]) -> List[float]:
    out = []
    for idx in proxy_indices:
        if 30.0 <= idx <= 60.0:
            out.append(3.0)
        elif 60.0 < idx <= 90.0 or 20.0 <= idx < 30.0:
            out.append(2.0)
        else:
            out.append(1.0)
    return out


def target_weights(target: str, values: List[float]) -> List[float]:
    return boundary_weights([_frontier_index_proxy(target, v) for v in values])


def save_calibration(bias: Dict[str, float], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"bias": bias}, f, indent=2)


def load_calibration(path: str) -> Dict[str, float]:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f).get("bias", {})


def load_full(path: str) -> dict:
    """Carrega calibration.json completo: {'bias': {...}, 'isotonic': {...}}."""
    if not os.path.exists(path):
        return {"bias": {}, "isotonic": {}}
    with open(path, "r", encoding="utf-8") as f:
        d = json.load(f)
    return {"bias": d.get("bias", {}), "isotonic": d.get("isotonic", {})}


def calibrate_value(target: str, value: float, full: dict) -> float:
    iso = (full.get("isotonic") or {}).get(target)
    if iso:
        return apply_isotonic([value], iso)[0]
    return value + (full.get("bias") or {}).get(target, 0.0)


def fit_isotonic(y_true: List[float], y_pred: List[float]) -> Dict[str, List[float]]:
    """PAVA: mapeia predito -> calibrado preservando monotonicidade.
    Aprendido SÓ no treino/validação; expande a faixa comprimida do GBDT."""
    order = sorted(range(len(y_pred)), key=lambda i: y_pred[i])
    xs = [float(y_pred[i]) for i in order]
    ys = [float(y_true[i]) for i in order]
    # blocos [soma, n, xmin, xmax]
    blocks: List[List[float]] = []
    for x, y in zip(xs, ys):
        blocks.append([y, 1.0, x, x])
        while (
            len(blocks) >= 2
            and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]
        ):
            b2 = blocks.pop()
            b1 = blocks.pop()
            blocks.append([b1[0] + b2[0], b1[1] + b2[1], b1[2], b2[3]])
    cut_x, cut_y = [], []
    for s, n, xmin, xmax in blocks:
        cut_x.append(float(round(xmin, 4)))
        cut_y.append(float(round(s / n, 4)))
    return {"x": cut_x, "y": cut_y}


def apply_isotonic(values: List[float], mapping: Dict[str, List[float]]) -> List[float]:
    if not mapping or not mapping.get("x"):
        return list(values)
    xs, ys = mapping["x"], mapping["y"]
    out = []
    for v in values:
        if v <= xs[0]:
            out.append(ys[0])
        elif v >= xs[-1]:
            out.append(ys[-1])
        else:
            import bisect

            j = bisect.bisect_right(xs, v)
            x0, x1, y0, y1 = xs[j - 1], xs[j], ys[j - 1], ys[j]
            f = (v - x0) / (x1 - x0) if x1 > x0 else 0.0
            out.append(y0 + f * (y1 - y0))
    return out
