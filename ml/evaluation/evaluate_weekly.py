"""
ml/evaluation/evaluate_weekly.py — Auditoria Semanal de Erros, Acertos e Drift
Compara predições dos modelos contra observações oficiais e gera relatório markdown.
"""

import argparse
import os
import sys
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import numpy as np
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable, Tuple


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

    iso_year, iso_week, _ = datetime.now(timezone.utc).isocalendar()
    week_label = f"{iso_year}-W{iso_week:02d}"

    report_md = f"""# Relatorio de Auditoria Semanal de Modelos - {week_label}

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


def _compute_feature_psi_details(
    expected: np.ndarray,
    actual: np.ndarray,
    bins: int = 10,
) -> Tuple[float, int, int]:
    """
    Retorna `(psi_medio, colunas_validas, colunas_puladas)`.
    """
    exp_arr = np.asarray(expected, dtype=np.float64)
    act_arr = np.asarray(actual, dtype=np.float64)
    if exp_arr.size == 0 or act_arr.size == 0:
        return 0.0, 0, 0
    if exp_arr.ndim == 1:
        exp_arr = exp_arr.reshape(-1, 1)
    if act_arr.ndim == 1:
        act_arr = act_arr.reshape(-1, 1)

    n_cols = min(exp_arr.shape[1], act_arr.shape[1])
    psi_vals: List[float] = []
    skipped_cols = 0
    eps = 1e-4

    for col in range(n_cols):
        e_col = exp_arr[:, col]
        a_col = act_arr[:, col]
        e_col = e_col[np.isfinite(e_col)]
        a_col = a_col[np.isfinite(a_col)]
        if len(e_col) < bins or len(a_col) < bins:
            skipped_cols += 1
            continue
        if float(np.std(e_col)) < 1e-9 and float(np.std(a_col)) < 1e-9:
            if abs(float(np.mean(e_col)) - float(np.mean(a_col))) < 1e-6:
                psi_vals.append(0.0)
            else:
                psi_vals.append(1.0)
            continue

        quantiles = np.linspace(0, 100, bins + 1)
        edges = np.percentile(e_col, quantiles)
        edges[0] = -np.inf
        edges[-1] = np.inf
        unique_edges = np.unique(edges)
        if len(unique_edges) < 3:
            lo = min(float(np.min(e_col)), float(np.min(a_col))) - 1e-3
            hi = max(float(np.max(e_col)), float(np.max(a_col))) + 1e-3
            unique_edges = np.linspace(lo, hi, bins + 1)
            unique_edges[0] = -np.inf
            unique_edges[-1] = np.inf

        e_counts, _ = np.histogram(e_col, bins=unique_edges)
        a_counts, _ = np.histogram(a_col, bins=unique_edges)
        e_pct = np.clip(e_counts / max(1, len(e_col)), eps, 1.0)
        a_pct = np.clip(a_counts / max(1, len(a_col)), eps, 1.0)
        psi = float(np.sum((a_pct - e_pct) * np.log(a_pct / e_pct)))
        psi_vals.append(psi)

    mean_psi = round(float(np.mean(psi_vals)) if psi_vals else 0.0, 4)
    return mean_psi, len(psi_vals), skipped_cols


def compute_feature_psi(
    expected: np.ndarray,
    actual: np.ndarray,
    bins: int = 10,
) -> float:
    """
    Calcula o Population Stability Index (PSI) médio entre a janela de referência
    (treino/histórico) e a janela avaliada (últimas 168h), conforme specs/08 §2.
    """
    mean_psi, _, _ = _compute_feature_psi_details(expected, actual, bins=bins)
    return mean_psi



def build_weekly_evaluation_records(
    station_evals: Dict[str, Dict[str, Any]],
    week_code: str,
    model_version: str,
    retrained: int = 0,
) -> List[Dict[str, Any]]:
    """
    Formata os resultados por estação no contrato exato da tabela `weekly_evaluations`
    definida em `db/schema.sql` e `db/schema.ts`.
    """
    records: List[Dict[str, Any]] = []
    for station_id, ev in sorted(station_evals.items()):
        records.append({
            "id": f"weval_{week_code}_{station_id}_{model_version}",
            "week_code": week_code,
            "station_id": station_id,
            "model_version": model_version,
            "total_eval_points": int(ev["total_points"]),
            "mae_pm25": float(ev["mae_pm25"]),
            "mae_o3": float(ev["mae_o3"]),
            "mae_no2": float(ev["mae_no2"]),
            "iqar_accuracy_percentage": float(ev["iqar_accuracy_pct"]),
            "false_alarm_rate": float(ev["false_alarm_rate"]),
            "missed_event_rate": float(ev["missed_event_rate"]),
            "drift_detected": int(ev["drift_detected"]),
            "retrained": int(retrained),
            "evaluation_report_md": ev.get("report_md", ""),
        })
    return records


def next_model_version(
    registry_path: str = "models/registry.json",
    now: Optional[datetime] = None,
) -> str:
    """
    Gera a próxima versão `vAAAA.SS.N` para o retreino semanal (ex: `v2026.42.1`).
    Incrementa `N` se já existir versão na mesma semana ISO no registry.
    """
    from ml.training.registry import load_registry

    dt = now or datetime.now(timezone.utc)
    iso_year, iso_week, _ = dt.isocalendar()
    prefix = f"v{iso_year}.{iso_week:02d}."

    reg = load_registry(registry_path)
    existing: List[int] = []
    candidates = set(reg.get("versions", {}).keys())
    active = reg.get("active_version")
    if active:
        candidates.add(active)

    for v in candidates:
        if isinstance(v, str) and v.startswith(prefix):
            tail = v[len(prefix) :]
            if tail.isdigit():
                existing.append(int(tail))

    next_seq = (max(existing) + 1) if existing else 1
    return f"{prefix}{next_seq}"


def supplement_d1_with_history(
    raw_openmeteo: Dict[str, Any],
    d1_data: Dict[str, Any],
    merged: Dict[str, Any],
    min_hours: int = 360,
) -> Dict[str, Any]:
    """
    Quando o Cloudflare D1 possui apenas a janela recente de 7 dias (168h < min_hours),
    sobrepõe as observações reais do D1 sobre a série histórica contínua de `raw_openmeteo`
    e avança `fetched_at` para `window_end` do D1. Garante histórico suficiente para:
    - holdout comum de 168h + 30h de lags (`extract_holdout_from_raw`)
    - janela de treino anterior ao `end_cutoff` (`build_real_dataset`)
    """
    from ml.training.fetch_from_d1 import _norm_ts

    d1_stations = d1_data.get("stations", {})
    raw_stations = raw_openmeteo.get("stations", {})
    merged_stations = dict(merged.get("stations", {}))
    supplemented_counts: Dict[str, int] = {}

    for station_id, m_entry in list(merged_stations.items()):
        aq_m = m_entry.get("aq_hourly", {})
        if len(aq_m.get("time", [])) >= min_hours:
            continue
        raw_entry = raw_stations.get(station_id)
        st_d1 = d1_stations.get(station_id)
        if not raw_entry or not st_d1:
            continue

        d1_by_ts: Dict[str, Dict[str, Any]] = {}
        for item in st_d1.get("series", []):
            k = _norm_ts(item.get("timestamp", ""))
            if not k:
                continue
            if item.get("source") == "IEMA" or k not in d1_by_ts:
                d1_by_ts[k] = item

        raw_meteo = raw_entry.get("meteo_hourly", {})
        raw_aq = raw_entry.get("aq_hourly", {})
        meteo_times = list(raw_meteo.get("time", []))
        if not meteo_times or len(meteo_times) < len(aq_m.get("time", [])):
            continue

        raw_so2 = raw_aq.get("sulphur_dioxide") or raw_aq.get("sulfur_dioxide") or [None] * len(meteo_times)
        full_aq = {
            "time": list(raw_aq.get("time", meteo_times)),
            "pm2_5": list(raw_aq.get("pm2_5", [None] * len(meteo_times))),
            "pm10": list(raw_aq.get("pm10", [None] * len(meteo_times))),
            "nitrogen_dioxide": list(raw_aq.get("nitrogen_dioxide", [None] * len(meteo_times))),
            "sulphur_dioxide": list(raw_so2),
            "sulfur_dioxide": list(raw_so2),
            "ozone": list(raw_aq.get("ozone", [None] * len(meteo_times))),
            "carbon_monoxide": list(raw_aq.get("carbon_monoxide", [None] * len(meteo_times))),
        }
        overlaid = 0
        for idx, t_str in enumerate(meteo_times):
            norm_k = _norm_ts(t_str)
            if norm_k in d1_by_ts and idx < len(full_aq["time"]):
                obs = d1_by_ts[norm_k]
                overlaid += 1
                if obs.get("pm25") is not None:
                    full_aq["pm2_5"][idx] = obs.get("pm25")
                if obs.get("pm10") is not None:
                    full_aq["pm10"][idx] = obs.get("pm10")
                if obs.get("o3") is not None:
                    full_aq["ozone"][idx] = obs.get("o3")
                if obs.get("no2") is not None:
                    full_aq["nitrogen_dioxide"][idx] = obs.get("no2")
                if obs.get("so2") is not None:
                    full_aq["sulphur_dioxide"][idx] = obs.get("so2")
                    full_aq["sulfur_dioxide"][idx] = obs.get("so2")
                if obs.get("co") is not None:
                    full_aq["carbon_monoxide"][idx] = obs.get("co")


        if overlaid > 0:
            supplemented_counts[station_id] = overlaid
            merged_stations[station_id] = {
                **m_entry,
                "meteo_hourly": raw_meteo,
                "aq_hourly": full_aq,
            }

    fetched_at = raw_openmeteo.get("fetched_at", "")
    d1_window_end = (d1_data.get("summary") or {}).get("window_end") or ""
    if supplemented_counts and d1_window_end:
        norm_end = _norm_ts(d1_window_end)
        if len(norm_end) == 16 and (not fetched_at or norm_end > _norm_ts(fetched_at)):
            fetched_at = norm_end + ":00Z"

    prov = dict(merged.get("provenance", {}))
    if supplemented_counts:
        prov["supplemented_stations"] = supplemented_counts

    return {
        **merged,
        "fetched_at": fetched_at,
        "provenance": prov,
        "stations": merged_stations,
    }


def install_d1_retrain_compat() -> None:
    """
    Garante compatibilidade sem tocar em `fetch_from_d1.py` ou `retrain_real.py`:
    1. Injeta `urllib` no módulo `ml.training.fetch_from_d1` caso ausente.
    2. Envolve `resolve_training_data` para suplementar a série histórica quando
       o D1 contiver apenas a janela curta de 7 dias (168h).
    """
    import urllib
    import ml.training.fetch_from_d1 as f_mod

    if not hasattr(f_mod, "urllib"):
        setattr(f_mod, "urllib", urllib)

    if getattr(f_mod, "_weekly_compat_installed", False):
        return

    orig_resolve = f_mod.resolve_training_data

    def _wrapped_resolve(
        source_mode: str = "d1",
        local_raw_path: str = "ml/data/openmeteo_raw.json",
        d1_file: str = "ml/data/d1_observed.json",
        *args: Any,
        **kwargs: Any,
    ) -> Tuple[str, Dict[str, Any]]:
        resolved_source, merged = orig_resolve(
            source_mode=source_mode,
            local_raw_path=local_raw_path,
            d1_file=d1_file,
            *args,
            **kwargs,
        )
        if resolved_source == "d1" and os.path.exists(local_raw_path) and os.path.exists(d1_file):
            try:
                with open(local_raw_path, "r", encoding="utf-8") as f:
                    raw_openmeteo = json.load(f)
                with open(d1_file, "r", encoding="utf-8") as f:
                    d1_data = json.load(f)
                merged = supplement_d1_with_history(raw_openmeteo, d1_data, merged)
            except Exception as e:
                print(f"[AVISO AetherML] Suplementação histórica D1 ignorada: {e}", file=sys.stderr)
        return resolved_source, merged

    f_mod.resolve_training_data = _wrapped_resolve
    setattr(f_mod, "_weekly_compat_installed", True)



def fetch_d1_to_file(
    out_path: str = "ml/data/d1_observed.json",
    env_vars: Optional[Dict[str, str]] = None,
    post_fn: Optional[Callable[[str, str, Dict[str, Any]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Extrai `observed_pollutants` do Cloudflare D1 via `fetch_observed_from_d1`
    + `format_d1_observed_payload` e grava em `out_path`.
    """
    install_d1_retrain_compat()
    from ml.training.fetch_from_d1 import fetch_observed_from_d1, format_d1_observed_payload

    env = os.environ if env_vars is None else env_vars
    account_id = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    db_id = env.get("D1_DATABASE_ID", "")
    token = env.get("CLOUDFLARE_API_TOKEN", "")
    if not (account_id and db_id and token):
        raise RuntimeError(
            "Defina CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID e CLOUDFLARE_API_TOKEN para extrair dados do D1."
        )

    rows = fetch_observed_from_d1(
        account_id=account_id,
        database_id=db_id,
        token=token,
        post_fn=post_fn,
    )
    payload = format_d1_observed_payload(rows)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[AetherML ML] Extração D1 concluída: {len(rows)} linhas salvas em {out_path}.")
    return payload


def _d1_response_ok(resp: Any) -> bool:
    """Valida tanto o envelope HTTP da Cloudflare quanto `result[0].success` do D1."""
    if not isinstance(resp, dict) or not resp.get("success"):
        return False
    res_list = resp.get("result")
    if isinstance(res_list, list) and res_list:
        first = res_list[0]
        if isinstance(first, dict) and first.get("success") is False:
            return False
    return True


def _resolve_model_registry_metadata(
    version: str,
    now_iso: str,
    registry_path: str = "models/registry.json",
) -> Dict[str, Any]:
    """
    Extrai metadados e métricas reais de `models/registry.json` para popular a FK
    `model_registry` sem valores sintéticos falsos.
    """
    from ml.training.registry import load_registry

    reg = load_registry(registry_path)
    active_ver = reg.get("active_version")
    ver_entry = (reg.get("versions") or {}).get(version) or {}
    models_map = ver_entry.get("models") or reg.get("models") or {}
    pm25_meta = models_map.get("pm25") or {}
    metrics = pm25_meta.get("metrics") or {}

    onnx_file = pm25_meta.get("onnx_file") or "pm25.onnx"
    topology_file = pm25_meta.get("topology_file") or "pm25.topology.json"
    sha256 = pm25_meta.get("sha256") or "unknown"
    created_at = ver_entry.get("created_at") or now_iso

    return {
        "target_pollutant": "pm25",
        "architecture": "LightGBM-ONNX",
        "onnx_file_path": f"models/{version}/{onnx_file}",
        "onnx_hash_sha256": str(sha256),
        "saabas_topology_path": f"models/{version}/{topology_file}",
        "training_start_date": str(created_at),
        "training_end_date": str(created_at),
        "test_mae": float(metrics.get("mae", 0.0)),
        "test_rmse": float(metrics.get("rmse", 0.0)),
        "test_r2": float(metrics.get("r2", 0.0)),
        "is_active": 1 if (not active_ver or version == active_ver) else 0,
    }


def persist_weekly_evaluations_to_d1(
    records: List[Dict[str, Any]],
    account_id: str,
    database_id: str,
    token: str,
    post_fn: Optional[Callable[[str, str, Dict[str, Any]], Dict[str, Any]]] = None,
    registry_path: str = "models/registry.json",
) -> int:
    """
    Persiste os registros de `weekly_evaluations` no Cloudflare D1 via HTTP API.
    Garante antes a linha de `model_registry` com métricas reais de `models/registry.json`
    para satisfazer a FK `REFERENCES model_registry(version)`.
    """
    if not records:
        return 0

    install_d1_retrain_compat()
    from ml.training.fetch_from_d1 import build_d1_query_url, default_http_post

    transport = post_fn or default_http_post
    url = build_d1_query_url(account_id, database_id)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    versions = sorted({r["model_version"] for r in records})
    for ver in versions:
        meta = _resolve_model_registry_metadata(ver, now_iso, registry_path=registry_path)
        reg_sql = (
            "INSERT OR IGNORE INTO model_registry "
            "(version, target_pollutant, architecture, onnx_file_path, onnx_hash_sha256, "
            "saabas_topology_path, training_start_date, training_end_date, test_mae, test_rmse, test_r2, is_active) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        transport(
            url,
            token,
            {
                "sql": reg_sql,
                "params": [
                    ver,
                    meta["target_pollutant"],
                    meta["architecture"],
                    meta["onnx_file_path"],
                    meta["onnx_hash_sha256"],
                    meta["saabas_topology_path"],
                    meta["training_start_date"],
                    meta["training_end_date"],
                    meta["test_mae"],
                    meta["test_rmse"],
                    meta["test_r2"],
                    meta["is_active"],
                ],
            },
        )

    insert_sql = (
        "INSERT OR REPLACE INTO weekly_evaluations "
        "(id, week_code, station_id, model_version, total_eval_points, mae_pm25, mae_o3, mae_no2, "
        "iqar_accuracy_percentage, false_alarm_rate, missed_event_rate, drift_detected, retrained, evaluation_report_md) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )

    saved = 0
    for rec in records:
        resp = transport(
            url,
            token,
            {
                "sql": insert_sql,
                "params": [
                    rec["id"],
                    rec["week_code"],
                    rec["station_id"],
                    rec["model_version"],
                    rec["total_eval_points"],
                    rec["mae_pm25"],
                    rec["mae_o3"],
                    rec["mae_no2"],
                    rec["iqar_accuracy_percentage"],
                    rec["false_alarm_rate"],
                    rec["missed_event_rate"],
                    rec["drift_detected"],
                    rec["retrained"],
                    rec["evaluation_report_md"],
                ],
            },
        )
        if _d1_response_ok(resp):
            saved += 1

    return saved


def run_weekly_evaluation(
    raw_dict: Optional[Dict[str, Any]] = None,
    version: Optional[str] = None,
    order: Optional[str] = None,
    boosters: Optional[Dict[str, Any]] = None,
    calibration: Optional[Dict[str, Any]] = None,
    out_path: str = "ml/data/weekly_evaluation.json",
    report_path: str = "ml/data/weekly_evaluation_report.md",
    week_code: Optional[str] = None,
    retrained: int = 0,
    source_mode: str = "d1",
    raw_path: str = "ml/data/openmeteo_raw.json",
    d1_file: str = "ml/data/d1_observed.json",
    persist_d1: bool = False,
    post_fn: Optional[Callable] = None,
) -> Dict[str, Any]:
    """
    Executa a avaliação semanal (168h) por estação e global (specs/08 §2):
    - Calcula MAE (PM2.5, O3, NO2), acurácia IQAr, false_alarm_rate, missed_event_rate e PSI.
    - Expõe `psi_computed` e `skipped_points` para distinguir "sem drift" de "PSI não computado".
    - Gera registros compatíveis com `weekly_evaluations` e relatório Markdown se drift/missed.
    """
    install_d1_retrain_compat()
    from ml.evaluation.eval_holdout import HOLDOUT_HOURS, _holdout_window, _meteo_row, global_iqar
    from ml.training.build_real_dataset import AQ_KEYS, TARGETS, row_to_features
    from ml.training.calibrate import calibrate_value
    from ml.training.fetch_from_d1 import resolve_training_data
    from ml.training.predict_forecast import active_model, load_boosters, require_calibration
    from ml.training.registry import load_registry

    reg = load_registry("models/registry.json")
    if version is None or order is None:
        reg_ver, reg_order = active_model("models/registry.json")
        version = version or reg_ver
        order = order or reg_order or "v1"

    if raw_dict is None:
        _, raw_dict = resolve_training_data(
            source_mode=source_mode,
            local_raw_path=raw_path,
            d1_file=d1_file,
        )

    if boosters is None:
        boosters = load_boosters(version, registry=reg)
    if calibration is None:
        calibration = require_calibration(version, registry=reg)

    if not week_code:
        iso_year, iso_week, _ = datetime.now(timezone.utc).isocalendar()
        week_code = f"{iso_year}-W{iso_week:02d}"

    cutoff = (raw_dict.get("fetched_at") or "")[:13]
    global_yt: Dict[str, List[float]] = {t: [] for t in TARGETS}
    global_yp: Dict[str, List[float]] = {t: [] for t in TARGETS}
    global_iqar_t: List[int] = []
    global_iqar_p: List[int] = []
    global_cls_t: List[str] = []
    global_cls_p: List[str] = []
    ref_features: List[List[float]] = []
    holdout_features: List[List[float]] = []
    skipped_ref_points = 0
    skipped_holdout_points = 0

    station_evals: Dict[str, Dict[str, Any]] = {}

    for station_id, entry in raw_dict.get("stations", {}).items():
        flags = entry.get("meta", {})
        aq = entry.get("aq_hourly", {})
        met = entry.get("meteo_hourly", {})
        times = aq.get("time", [])
        h_idx = _holdout_window(times, cutoff, HOLDOUT_HOURS)
        if not h_idx:
            continue

        # Amostras anteriores ao holdout para cálculo de PSI
        ref_start = max(30, h_idx[0] - HOLDOUT_HOURS)
        for gi in range(ref_start, h_idx[0]):
            try:
                aq_now = {t: float(aq[AQ_KEYS[t]][gi]) for t in TARGETS}
                m_now = _meteo_row(met, gi)
                lags = {
                    "pm25": float(aq["pm2_5"][gi - 24]),
                    "pm10": float(aq["pm10"][gi - 24]),
                    "no2": float(aq["nitrogen_dioxide"][gi - 24]),
                    "o3": float(aq["ozone"][gi - 24]),
                    "pblh6": sum(float(x) for x in met["boundary_layer_height"][gi - 6 : gi]) / 6.0,
                }
                lags1 = (
                    {t: float(aq[AQ_KEYS[t]][gi - 1]) for t in TARGETS}
                    if order == "v2"
                    else None
                )
                ref_features.append(
                    row_to_features(m_now, aq_now, times[gi], lags, flags, order=order, lags1=lags1)
                )
            except Exception:
                skipped_ref_points += 1
                continue

        st_yt: Dict[str, List[float]] = {t: [] for t in TARGETS}
        st_yp: Dict[str, List[float]] = {t: [] for t in TARGETS}
        st_iqar_t: List[int] = []
        st_iqar_p: List[int] = []
        st_cls_t: List[str] = []
        st_cls_p: List[str] = []

        for gi in h_idx:
            if gi < 30:
                skipped_holdout_points += 1
                continue
            try:
                ts = times[gi]
                aq_now = {t: float(aq[AQ_KEYS[t]][gi]) for t in TARGETS}
                m_now = _meteo_row(met, gi)
                lags = {
                    "pm25": float(aq["pm2_5"][gi - 24]),
                    "pm10": float(aq["pm10"][gi - 24]),
                    "no2": float(aq["nitrogen_dioxide"][gi - 24]),
                    "o3": float(aq["ozone"][gi - 24]),
                    "pblh6": sum(float(x) for x in met["boundary_layer_height"][gi - 6 : gi]) / 6.0,
                }
                lags1 = (
                    {t: float(aq[AQ_KEYS[t]][gi - 1]) for t in TARGETS}
                    if order == "v2"
                    else None
                )
                feats = row_to_features(
                    m_now, aq_now, ts, lags, flags, order=order, lags1=lags1
                )
                holdout_features.append(feats)
                raw_pred = {}
                for t in TARGETS:
                    n_f = getattr(boosters[t], "num_feature", lambda: len(feats))()
                    raw_pred[t] = float(boosters[t].predict([feats[:n_f]])[0])
                pred = {
                    t: max(0.0, calibrate_value(t, v, calibration))
                    for t, v in raw_pred.items()
                }
                for t in TARGETS:
                    st_yt[t].append(aq_now[t])
                    st_yp[t].append(pred[t])
                    global_yt[t].append(aq_now[t])
                    global_yp[t].append(pred[t])

                it, _, ct = global_iqar(aq_now)
                ip, _, cp = global_iqar(pred)
                st_iqar_t.append(it)
                st_iqar_p.append(ip)
                st_cls_t.append(ct)
                st_cls_p.append(cp)
                global_iqar_t.append(it)
                global_iqar_p.append(ip)
                global_cls_t.append(ct)
                global_cls_p.append(cp)
            except Exception:
                skipped_holdout_points += 1
                continue

        if st_iqar_t:
            station_evals[station_id] = evaluate_predictions(
                st_yt, st_yp, st_iqar_t, st_iqar_p, st_cls_t, st_cls_p
            )

    if not global_iqar_t:
        raise ValueError("Nenhum ponto válido encontrado para avaliação semanal.")

    global_eval = evaluate_predictions(
        global_yt, global_yp, global_iqar_t, global_iqar_p, global_cls_t, global_cls_p
    )

    skipped_points = skipped_ref_points + skipped_holdout_points
    has_min_psi_window = (
        len(ref_features) >= HOLDOUT_HOURS and len(holdout_features) >= HOLDOUT_HOURS
    )
    if has_min_psi_window:
        feature_psi, psi_valid_cols, psi_skipped_cols = _compute_feature_psi_details(
            np.array(ref_features), np.array(holdout_features)
        )
        psi_computed = psi_valid_cols > 0
    else:
        feature_psi = 0.0
        psi_valid_cols = 0
        psi_skipped_cols = 0
        psi_computed = False

    if not psi_computed:
        print(
            f"[AVISO AetherML] PSI não computado (ref_points={len(ref_features)}, "
            f"holdout_points={len(holdout_features)}, min={HOLDOUT_HOURS}, valid_cols={psi_valid_cols}).",
            file=sys.stderr,
        )
    if skipped_points > 0:
        print(
            f"[AVISO AetherML] {skipped_points} pontos pulados na auditoria semanal "
            f"(ref={skipped_ref_points}, holdout={skipped_holdout_points}).",
            file=sys.stderr,
        )

    psi_drift = bool(psi_computed and feature_psi > 0.25)
    retrain_recommended = bool(
        global_eval["drift_detected"] == 1
        or global_eval["missed_event_rate"] > 0.15
        or psi_drift
    )
    if psi_drift and global_eval["drift_detected"] == 0:
        global_eval["drift_detected"] = 1

    records = build_weekly_evaluation_records(
        station_evals=station_evals,
        week_code=week_code,
        model_version=version,
        retrained=retrained,
    )

    d1_saved = 0
    if persist_d1:
        acc_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        db_id = os.environ.get("D1_DATABASE_ID", "")
        tok = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        if acc_id and db_id and tok:
            try:
                d1_saved = persist_weekly_evaluations_to_d1(
                    records=records,
                    account_id=acc_id,
                    database_id=db_id,
                    token=tok,
                    post_fn=post_fn,
                )
            except Exception as e:
                print(f"[AVISO AetherML] Falha ao persistir weekly_evaluations no D1: {e}", file=sys.stderr)

    summary = {
        "week_code": week_code,
        "model_version": version,
        "feature_order_version": order,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feature_psi": feature_psi,
        "psi_computed": psi_computed,
        "psi_valid_columns": psi_valid_cols,
        "psi_skipped_columns": psi_skipped_cols,
        "ref_points_count": len(ref_features),
        "holdout_points_count": len(holdout_features),
        "skipped_points": skipped_points,
        "skipped_ref_points": skipped_ref_points,
        "skipped_holdout_points": skipped_holdout_points,
        "retrain_recommended": retrain_recommended,
        "d1_records_saved": d1_saved,
        "global": global_eval,
        "stations": station_evals,
        "records": records,
    }

    if out_path:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

    if report_path:
        os.makedirs(os.path.dirname(report_path) or ".", exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(global_eval["report_md"])

    return summary


def derive_promoted_targets(registry: Dict[str, Any], challenger_version: str) -> List[str]:
    """Deriva os poluentes promovidos nesta execução a partir do registry.

    Schema vigente (`ml/training/registry.py::update_registry_paired`): o artefato
    ativo de cada poluente registra a versão de origem em `models.<target>.version`.
    Um alvo é considerado promovido quando essa versão é a do challenger desta execução.
    Ordem determinística: `targets` canônico do registry primeiro; chaves extras de
    `models` em seguida.
    """
    models = registry.get("models")
    if not isinstance(models, dict):
        return []
    targets = registry.get("targets")
    if not isinstance(targets, list):
        targets = []
    ordered: List[str] = [t for t in targets if isinstance(t, str)]
    ordered += [t for t in models.keys() if t not in ordered]
    return [
        t
        for t in ordered
        if isinstance(models.get(t), dict) and models[t].get("version") == challenger_version
    ]


def run_retrain_pipeline(
    source: str = "d1",
    version: Optional[str] = None,
    epsilon: float = 0.0,
    compact: bool = True,
    dry_run: bool = False,
    raw_path: str = "ml/data/openmeteo_raw.json",
    d1_file: str = "ml/data/d1_observed.json",
    dataset_path: str = "ml/data/train_dataset_real.json",
    order: Optional[str] = None,
    summary_out: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Executa `ml/training/retrain_real.py` com bridge D1 168h + versionamento automático `vAAAA.SS.N`
    + exportação de `$GITHUB_OUTPUT`, sem precisar modificar `retrain_real.py`.
    """
    install_d1_retrain_compat()
    from ml.training.registry import load_registry
    import ml.training.retrain_real as retrain_mod

    # Propaga resolve_training_data envolvido para o namespace de retrain_real
    import ml.training.fetch_from_d1 as f_mod
    retrain_mod.resolve_training_data = f_mod.resolve_training_data

    before_reg = load_registry("models/registry.json")
    prev_active = before_reg.get("active_version")

    challenger_version = (
        next_model_version("models/registry.json")
        if (not version or version == "auto" or version == prev_active)
        else version
    )

    retrain_argv = [
        "ml/training/retrain_real.py",
        "--source",
        source,
        "--version",
        challenger_version,
        "--dataset",
        dataset_path,
        "--epsilon",
        str(epsilon),
        "--raw",
        raw_path,
        "--d1-file",
        d1_file,
    ]
    if compact:
        retrain_argv.append("--compact")
    if dry_run:
        retrain_argv.append("--dry-run")
    if order:
        retrain_argv.extend(["--order", order])

    old_argv = sys.argv
    try:
        sys.argv = retrain_argv
        retrain_mod.main()
    finally:
        sys.argv = old_argv

    after_reg = load_registry("models/registry.json")
    active_version = after_reg.get("active_version") or prev_active or challenger_version
    promoted_targets = derive_promoted_targets(after_reg, challenger_version)
    any_promoted = bool(len(promoted_targets) > 0) and (not dry_run)

    summary = {
        "challenger_version": challenger_version,
        "previous_active_version": prev_active,
        "active_version": active_version,
        "promoted_targets": promoted_targets,
        "any_promoted": any_promoted,
        "dry_run": dry_run,
        "source": source,
    }

    if summary_out:
        os.makedirs(os.path.dirname(summary_out) or ".", exist_ok=True)
        with open(summary_out, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        promoted_str = "true" if any_promoted else "false"
        targets_csv = ",".join(promoted_targets)
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write(f"promoted={promoted_str}\n")
            f.write(f"challenger_version={challenger_version}\n")
            f.write(f"active_version={active_version}\n")
            f.write(f"promoted_targets={targets_csv}\n")

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Auditoria semanal e bridge de retreino AetherML (specs/08 §2).")
    parser.add_argument("--source", choices=["d1", "local"], default="d1")
    parser.add_argument("--raw", default="ml/data/openmeteo_raw.json")
    parser.add_argument("--d1-file", default="ml/data/d1_observed.json")
    parser.add_argument("--version", default=None)
    parser.add_argument("--order", default=None)
    parser.add_argument("--out", default="ml/data/weekly_evaluation.json")
    parser.add_argument("--report-out", default="ml/data/weekly_evaluation_report.md")
    parser.add_argument("--retrained", type=int, default=0)
    parser.add_argument("--persist-d1", action="store_true")
    parser.add_argument("--fetch-d1-only", action="store_true", help="Apenas extrai observados do D1 com compatibilidade urllib")
    parser.add_argument("--retrain", action="store_true", help="Executa retrain_real.py com bridge D1 168h e GITHUB_OUTPUT")
    parser.add_argument("--compact", action="store_true", help="Modo compacto (<1.5MB ONNX)")
    parser.add_argument("--dry-run", action="store_true", help="Executa retreino pareado em dry-run")
    parser.add_argument("--epsilon", type=float, default=0.0, help="Margem de não-degradação")
    parser.add_argument("--dataset", default="ml/data/train_dataset_real.json")
    parser.add_argument("--summary-out", default=None)
    args = parser.parse_args()

    if args.fetch_d1_only:
        fetch_d1_to_file(out_path=args.d1_file)
        return

    if args.retrain:
        run_retrain_pipeline(
            source=args.source,
            version=args.version,
            epsilon=args.epsilon,
            compact=True,
            dry_run=args.dry_run,
            raw_path=args.raw,
            d1_file=args.d1_file,
            dataset_path=args.dataset,
            order=args.order,
            summary_out=args.summary_out,
        )
        return

    summary = run_weekly_evaluation(
        version=args.version,
        order=args.order,
        out_path=args.out,
        report_path=args.report_out,
        retrained=args.retrained,
        source_mode=args.source,
        raw_path=args.raw,
        d1_file=args.d1_file,
        persist_d1=args.persist_d1,
    )
    print(summary["global"]["report_md"])
    print(
        f"[weekly_eval] semana={summary['week_code']} | versao={summary['model_version']} "
        f"| PSI={summary['feature_psi']:.4f} (computed={summary['psi_computed']}, skipped={summary['skipped_points']}) "
        f"| retrain_recommended={summary['retrain_recommended']}"
    )


if __name__ == "__main__":
    main()



