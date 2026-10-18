"""
ml/training/test_fetch_from_d1.py — Testes do extrator Cloudflare D1 e merge com meteo.

TDD: exit 0 = verde.
Testa:
- Paginação com limite por página + loop por timestamp > último
- Erro HTTP e JSON inválido
- Separação explícita de fontes (IEMA vs open-meteo-cams-*)
- Função pura de merge (meteo_hourly + observed D1)
- Fallback para local com aviso quando D1 não configurado
"""

import os
import sys
import json
import io
from typing import Dict, Any, List

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training.fetch_from_d1 import (
    fetch_observed_from_d1,
    format_d1_observed_payload,
    merge_d1_with_meteo,
    resolve_training_data,
    build_d1_query_url,
)


def test_build_d1_query_url():
    url = build_d1_query_url("acc_123", "db_456")
    expected = "https://api.cloudflare.com/client/v4/accounts/acc_123/d1/database/db_456/query"
    assert url == expected, f"Esperado {expected}, obtido {url}"


def test_pagination_and_transport():
    # Cria dublê de transporte com 3 páginas
    call_log: List[Dict[str, Any]] = []

    def mock_post(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        call_log.append({"url": url, "token": token, "body": body})
        sql = body["sql"]
        params = body.get("params", [])
        last_ts = params[0] if params else ""

        if last_ts == "":
            rows = [
                {
                    "station_id": "ramqar_camburi",
                    "timestamp": f"2026-07-02T{h:02d}:00:00Z",
                    "pm25": 10.0 + h,
                    "pm10": 20.0 + h,
                    "o3": 15.0,
                    "no2": 5.0,
                    "so2": 2.0,
                    "co": 200.0,
                    "source": "open-meteo-cams-analysis",
                }
                for h in range(10)
            ]
        elif last_ts == "2026-07-02T09:00:00Z":
            rows = [
                {
                    "station_id": "ramqar_camburi",
                    "timestamp": f"2026-07-02T{h:02d}:00:00Z",
                    "pm25": 20.0 + h,
                    "pm10": 30.0 + h,
                    "o3": 25.0,
                    "no2": 8.0,
                    "so2": 3.0,
                    "co": 220.0,
                    "source": "open-meteo-cams-forecast",
                }
                for h in range(10, 20)
            ]
        elif last_ts == "2026-07-02T19:00:00Z":
            # Terceira página tem menos que page_size (5 rows) -> encerra paginação
            rows = [
                {
                    "station_id": "ramqar_camburi",
                    "timestamp": f"2026-07-02T{h:02d}:00:00Z",
                    "pm25": 30.0 + h,
                    "pm10": 40.0 + h,
                    "o3": 35.0,
                    "no2": 12.0,
                    "so2": 4.0,
                    "co": 240.0,
                    "source": "IEMA",
                }
                for h in range(20, 25)
            ]
        else:
            rows = []

        return {
            "success": True,
            "errors": [],
            "messages": [],
            "result": [{"results": rows, "success": True}],
        }

    rows = fetch_observed_from_d1(
        account_id="test_acc",
        database_id="test_db",
        token="test_tok",
        post_fn=mock_post,
        page_size=10,
    )

    assert len(rows) == 25, f"Esperado 25 registros, obtido {len(rows)}"
    assert len(call_log) == 3, f"Esperado 3 chamadas HTTP, obtido {len(call_log)}"
    assert call_log[1]["body"]["params"][0] == "2026-07-02T09:00:00Z"
    assert call_log[2]["body"]["params"][0] == "2026-07-02T19:00:00Z"


def test_d1_http_error():
    def mock_post_err(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "success": False,
            "errors": [{"code": 10000, "message": "Authentication error"}],
            "messages": [],
            "result": None,
        }

    try:
        fetch_observed_from_d1(
            account_id="test_acc",
            database_id="test_db",
            token="invalid_token",
            post_fn=mock_post_err,
        )
        assert False, "Deveria ter lançado RuntimeError"
    except RuntimeError as e:
        assert "Authentication error" in str(e)


def test_d1_invalid_json_payload():
    def mock_post_invalid(url: str, token: str, body: Dict[str, Any]) -> Any:
        return "not a dict"

    try:
        fetch_observed_from_d1(
            account_id="test_acc",
            database_id="test_db",
            token="tok",
            post_fn=mock_post_invalid,
        )
        assert False, "Deveria ter lançado ValueError/RuntimeError"
    except (ValueError, RuntimeError) as e:
        assert "inválid" in str(e).lower() or "invalid" in str(e).lower()


def test_format_d1_observed_payload_separates_sources():
    rows = [
        {
            "station_id": "ramqar_camburi",
            "timestamp": "2026-07-02T00:00:00Z",
            "pm25": 10.0,
            "pm10": 20.0,
            "o3": 15.0,
            "no2": 5.0,
            "so2": 2.0,
            "co": 100.0,
            "source": "open-meteo-cams-analysis",
        },
        {
            "station_id": "ramqar_camburi",
            "timestamp": "2026-07-02T01:00:00Z",
            "pm25": 12.0,
            "pm10": 22.0,
            "o3": 18.0,
            "no2": 6.0,
            "so2": 2.5,
            "co": 110.0,
            "source": "open-meteo-cams-forecast",
        },
        {
            "station_id": "ramqar_vitoria_centro",
            "timestamp": "2026-07-02T00:00:00Z",
            "pm25": 14.0,
            "pm10": 28.0,
            "o3": 20.0,
            "no2": 15.0,
            "so2": 3.0,
            "co": 200.0,
            "source": "IEMA",
        },
    ]

    payload = format_d1_observed_payload(rows)

    assert "summary" in payload
    summary = payload["summary"]
    assert summary["total_records"] == 3
    assert summary["stations_count"] == 2
    assert summary["window_start"] == "2026-07-02T00:00:00Z"
    assert summary["window_end"] == "2026-07-02T01:00:00Z"
    assert summary["sources"]["IEMA"] == 1
    assert summary["sources"]["open-meteo-cams-analysis"] == 1
    assert summary["sources"]["open-meteo-cams-forecast"] == 1

    # Estação camburi
    camburi = payload["stations"]["ramqar_camburi"]
    assert camburi["records_count"] == 2
    assert len(camburi["series"]) == 2
    assert camburi["series"][0]["pm25"] == 10.0
    assert camburi["series"][0]["source"] == "open-meteo-cams-analysis"


def test_pure_merge_d1_with_meteo():
    raw_meteo = {
        "source": "openmeteo",
        "fetched_at": "2026-07-02T03:00:00Z",
        "stations": {
            "ramqar_camburi": {
                "meta": {"id": "ramqar_camburi", "municipality": "Vitória"},
                "meteo_hourly": {
                    "time": ["2026-07-02T00:00", "2026-07-02T01:00", "2026-07-02T02:00"],
                    "temperature_2m": [22.0, 22.5, 23.0],
                    "relative_humidity_2m": [80.0, 78.0, 75.0],
                    "wind_speed_10m": [12.0, 14.0, 10.0],
                    "wind_direction_10m": [45.0, 50.0, 60.0],
                    "pressure_msl": [1013.0, 1013.2, 1013.5],
                    "shortwave_radiation": [0.0, 0.0, 150.0],
                    "boundary_layer_height": [300.0, 320.0, 500.0],
                },
                "aq_hourly": {
                    "time": ["2026-07-02T00:00", "2026-07-02T01:00", "2026-07-02T02:00"],
                    "pm2_5": [999.0, 999.0, 999.0],  # valores antigos/descartados
                    "pm10": [999.0, 999.0, 999.0],
                    "ozone": [999.0, 999.0, 999.0],
                    "nitrogen_dioxide": [999.0, 999.0, 999.0],
                    "sulphur_dioxide": [999.0, 999.0, 999.0],
                    "carbon_monoxide": [999.0, 999.0, 999.0],
                },
            }
        },
    }

    d1_payload = {
        "summary": {"total_records": 2},
        "stations": {
            "ramqar_camburi": {
                "records_count": 2,
                "series": [
                    {
                        "timestamp": "2026-07-02T00:00:00Z",
                        "pm25": 11.5,
                        "pm10": 21.0,
                        "o3": 16.0,
                        "no2": 7.0,
                        "so2": 3.0,
                        "co": 150.0,
                        "source": "open-meteo-cams-analysis",
                    },
                    {
                        "timestamp": "2026-07-02T01:00:00Z",
                        "pm25": 13.0,
                        "pm10": 23.0,
                        "o3": 19.0,
                        "no2": 8.0,
                        "so2": 3.5,
                        "co": 160.0,
                        "source": "IEMA",
                    },
                ],
            }
        },
    }

    merged = merge_d1_with_meteo(raw_meteo, d1_payload)
    st = merged["stations"]["ramqar_camburi"]
    times = st["aq_hourly"]["time"]
    assert len(times) == 2, f"Esperado 2 horas alinhadas, obtido {len(times)}"
    assert times == ["2026-07-02T00:00", "2026-07-02T01:00"]
    # Garante que os poluentes vieram do D1 e não do raw antigo
    assert st["aq_hourly"]["pm2_5"] == [11.5, 13.0]
    assert st["aq_hourly"]["pm10"] == [21.0, 23.0]
    assert st["aq_hourly"]["ozone"] == [16.0, 19.0]
    # E a meteorologia foi preservada
    assert st["meteo_hourly"]["temperature_2m"] == [22.0, 22.5]


def test_fallback_to_local_when_d1_unconfigured():
    # Sem env vars configuradas e sem d1_file
    stderr_buf = io.StringIO()
    old_stderr = sys.stderr
    sys.stderr = stderr_buf
    try:
        resolved_source, data_dict = resolve_training_data(
            source_mode="d1",
            local_raw_path="ml/data/openmeteo_raw.json",
            d1_file="ml/data/d1_nonexistent.json",
            env_vars={},  # sem credenciais
        )
    finally:
        sys.stderr = old_stderr

    warning_text = stderr_buf.getvalue()
    assert resolved_source == "local", f"Deveria cair para local, foi {resolved_source}"
    assert "AVISO" in warning_text or "WARNING" in warning_text
    assert "stations" in data_dict


if __name__ == "__main__":
    test_build_d1_query_url()
    test_pagination_and_transport()
    test_d1_http_error()
    test_d1_invalid_json_payload()
    test_format_d1_observed_payload_separates_sources()
    test_pure_merge_d1_with_meteo()
    test_fallback_to_local_when_d1_unconfigured()
    print("[OK] test_fetch_from_d1: 7/7 verdes")
