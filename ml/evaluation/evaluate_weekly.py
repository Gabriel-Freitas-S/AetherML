"""
ml/evaluation/evaluate_weekly.py — Auditoria Semanal de Erros, Acertos e Drift
Compara predições dos modelos contra observações oficiais e gera relatório markdown.
"""

import os
import sys
import json
import math

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import numpy as np
from datetime import datetime
from typing import Dict, Any, List


def evaluate_predictions(
    y_true: Dict[str, List[float]],
    y_pred: Dict[str, List[float]],
    iqar_true: List[int],
    iqar_pred: List[int],
    cls_true: List[str],
    cls_pred: List[str]
) -> Dict[str, Any]:
    n = len(iqar_true)
    assert n > 0, "Sem pontos para avaliação"

    mae_pm25 = float(np.mean(np.abs(np.array(y_true["pm25"]) - np.array(y_pred["pm25"]))))
    mae_o3 = float(np.mean(np.abs(np.array(y_true["o3"]) - np.array(y_pred["o3"]))))
    mae_no2 = float(np.mean(np.abs(np.array(y_true["no2"]) - np.array(y_pred["no2"]))))

    # Acurácia de enquadramento da classe IQAr
    correct_cls = sum(1 for t, p in zip(cls_true, cls_pred) if t == p)
    accuracy_pct = round((correct_cls / n) * 100.0, 2)

    # Taxa de alarme falso: previu Ruim+ mas foi Boa/Moderada
    unhealthy_classes = {"Ruim", "Muito Ruim", "Péssima"}
    false_alarms = sum(1 for t, p in zip(cls_true, cls_pred) if p in unhealthy_classes and t not in unhealthy_classes)
    total_unhealthy_preds = sum(1 for p in cls_pred if p in unhealthy_classes)
    false_alarm_rate = round(false_alarms / max(1, total_unhealthy_preds), 3)

    # Eventos perdidos: foi Ruim+ mas previu Boa/Moderada
    missed_events = sum(1 for t, p in zip(cls_true, cls_pred) if t in unhealthy_classes and p not in unhealthy_classes)
    total_unhealthy_trues = sum(1 for t in cls_true if t in unhealthy_classes)
    missed_event_rate = round(missed_events / max(1, total_unhealthy_trues), 3)

    # Drift detectado se erro exceder limiares regulatórios
    drift_detected = (missed_event_rate > 0.15) or (mae_pm25 > 8.0) or (accuracy_pct < 75.0)

    report_md = f"""# Relatorio de Auditoria Semanal de Modelos - {datetime.now().strftime('%Y-W%W')}

- **Total de Amostras Avaliadas**: {n}
- **Acuracia de Classificacao IQAr**: {accuracy_pct}% (Meta: >=75%)
- **MAE PM2.5**: {mae_pm25:.2f} µg/m³
- **MAE O3**: {mae_o3:.2f} µg/m³
- **MAE NO2**: {mae_no2:.2f} µg/m³
- **Taxa de Alarme Falso**: {false_alarm_rate * 100:.1f}%
- **Taxa de Eventos Criticos Perdidos**: {missed_event_rate * 100:.1f}%
- **Status de Drift**: {'DRIFT DETECTADO (Retreino Recomendado)' if drift_detected else 'MODELO ESTAVEL'}
"""

    return {
        "total_points": n,
        "mae_pm25": round(mae_pm25, 2),
        "mae_o3": round(mae_o3, 2),
        "mae_no2": round(mae_no2, 2),
        "iqar_accuracy_pct": accuracy_pct,
        "false_alarm_rate": false_alarm_rate,
        "missed_event_rate": missed_event_rate,
        "drift_detected": 1 if drift_detected else 0,
        "report_md": report_md
    }


if __name__ == "__main__":
    # Teste com dados simulados de avaliação
    np.random.seed(42)
    N = 168  # 7 dias x 24h
    y_true = {"pm25": np.random.uniform(8, 35, N).tolist(), "o3": np.random.uniform(20, 120, N).tolist(), "no2": np.random.uniform(15, 60, N).tolist()}
    y_pred = {"pm25": (np.array(y_true["pm25"]) + np.random.normal(0, 2, N)).tolist(), "o3": (np.array(y_true["o3"]) + np.random.normal(0, 5, N)).tolist(), "no2": (np.array(y_true["no2"]) + np.random.normal(0, 4, N)).tolist()}
    iqar_t = [int(v * 2.5) for v in y_true["pm25"]]
    iqar_p = [int(v * 2.5) for v in y_pred["pm25"]]
    cls_t = ["Boa" if i <= 40 else ("Moderada" if i <= 80 else "Ruim") for i in iqar_t]
    cls_p = ["Boa" if i <= 40 else ("Moderada" if i <= 80 else "Ruim") for i in iqar_p]

    res = evaluate_predictions(y_true, y_pred, iqar_t, iqar_p, cls_t, cls_p)
    print(res["report_md"])
