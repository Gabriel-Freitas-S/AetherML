"""
ml/training/test_fetch_from_d1.py — Testes do extrator Cloudflare D1 e merge com meteo.

TDD: exit 0 = verde.
Testa:
- Paginação com keyset composta (timestamp > ? OR (timestamp = ? AND station_id > ?))
- Paginação com 9 estações empatadas no timestamp de corte (zero linhas perdidas)
- Erro HTTP e JSON inválido
- Separação explícita de fontes (IEMA vs open-meteo-cams-*)
- Função pura de merge (meteo_hourly + observed D1) com aviso de procedência mista
- extracted_at presente no summary do payload
- Reutilização de cache emite AVISO com a idade do cache
- D1_REQUIRED=1 / --d1-required falha quando a extração falha
"""

import os
import sys
import json
import io
from datetime import datetime, timezone, timedelta
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


def test_pagination_and_transport_keyset():
    # Cria dublê de transporte com 3 páginas testando keyset composta
    call_log: List[Dict[str, Any]] = []

    def mock_post(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        call_log.append({"url": url, "token": token, "body": body})
        sql = body["sql"]
        params = body.get("params", [])
        last_ts = params[0] if params else ""
        last_st = params[2] if len(params) > 2 else ""

        assert "ORDER BY timestamp ASC, station_id ASC, id ASC" in sql, "SQL deve ordenar por timestamp, station_id e id"
        assert "(timestamp > ?) OR (timestamp = ? AND station_id > ?) OR (timestamp = ? AND station_id = ? AND id > ?)" in sql, "SQL deve usar keyset composta com desempate por id"

        if last_ts == "":
            rows = [
                {
                    "station_id": f"ramqar_{h:02d}",
                    "timestamp": "2026-07-02T00:00:00Z",
                    "pm25": 10.0 + h,
                    "pm10": 20.0 + h,
                    "o3": 15.0,
                    "no2": 5.0,
                    "so2": 2.0,
                    "co": 200.0,
                    "source": "open-meteo-cams-reanalysis",
                }
                for h in range(10)
            ]
        elif last_ts == "2026-07-02T00:00:00Z" and last_st == "ramqar_09":
            rows = [
                {
                    "station_id": f"ramqar_{h:02d}",
                    "timestamp": "2026-07-02T01:00:00Z",
                    "pm25": 20.0 + h,
                    "pm10": 30.0 + h,
                    "o3": 25.0,
                    "no2": 8.0,
                    "so2": 3.0,
                    "co": 220.0,
                    "source": "open-meteo-cams-forecast",
                }
                for h in range(10)
            ]
        elif last_ts == "2026-07-02T01:00:00Z" and last_st == "ramqar_09":
            rows = [
                {
                    "station_id": f"ramqar_{h:02d}",
                    "timestamp": "2026-07-02T02:00:00Z",
                    "pm25": 30.0 + h,
                    "pm10": 40.0 + h,
                    "o3": 35.0,
                    "no2": 12.0,
                    "so2": 4.0,
                    "co": 240.0,
                    "source": "IEMA",
                }
                for h in range(5)
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
    assert call_log[1]["body"]["params"][0] == "2026-07-02T00:00:00Z"
    assert call_log[1]["body"]["params"][2] == "ramqar_09"


def test_pagination_with_tied_timestamps_across_9_stations():
    """
    CRÍTICO (1): Réplica do reviewer.
    9 estações empatadas em cada timestamp.
    60 timestamps * 9 estações = 540 linhas.
    Com page_size=50, a página corta no meio de um grupo de empates (50 não é múltiplo de 9).
    A paginação composta (timestamp, station_id) NÃO pode perder nenhuma linha.
    """
    stations = [f"ramqar_{i:02d}" for i in range(9)]
    all_dataset: List[Dict[str, Any]] = []
    for h in range(60):
        ts = f"2026-07-01T{h:02d}:00:00Z"
        for st in stations:
            all_dataset.append({
                "station_id": st,
                "timestamp": ts,
                "pm25": 10.0,
                "pm10": 20.0,
                "o3": 30.0,
                "no2": 5.0,
                "so2": 2.0,
                "co": 100.0,
                "source": "open-meteo-cams-reanalysis",
            })

    # Ordenado como o banco: timestamp ASC, station_id ASC
    all_dataset.sort(key=lambda r: (r["timestamp"], r["station_id"]))
    assert len(all_dataset) == 540

    def mock_db_transport(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        params = body.get("params", [])
        last_ts = params[0]
        last_st = params[2]
        last_id = params[5]
        limit = params[6]

        # Simula: WHERE (timestamp > ?) OR (timestamp = ? AND station_id > ?) OR (timestamp = ? AND station_id = ? AND id > ?)
        filtered = [
            r for r in all_dataset
            if (r["timestamp"] > last_ts)
            or (r["timestamp"] == last_ts and r["station_id"] > last_st)
            or (r["timestamp"] == last_ts and r["station_id"] == last_st and r.get("id", "") > last_id)
        ]
        page = filtered[:limit]
        return {
            "success": True,
            "errors": [],
            "messages": [],
            "result": [{"results": page, "success": True}],
        }

    rows = fetch_observed_from_d1(
        account_id="acc",
        database_id="db",
        token="tok",
        post_fn=mock_db_transport,
        page_size=50,
    )

    assert len(rows) == 540, (
        f"PERDA DE LINHAS DETECTADA! Esperado 540 registros, obtido {len(rows)} "
        f"(perda de {540 - len(rows)} linhas em empates)"
    )
    keys = [(r["timestamp"], r["station_id"]) for r in rows]
    assert len(set(keys)) == 540, "Não deve haver duplicatas na paginação"


def test_pagination_multisource_tiebreaker_id_c3_cortex():
    """
    BLOQUEANTE C3-DO-CÓRTEX:
    Verifica que na fronteira de página de 1000 (ou qualquer page_size),
    quando há múltiplas linhas com MESMO (timestamp, station_id) — ex: CAMS + IEMA,
    o desempate por `id` garante ordem total e zero linhas puladas.
    """
    records = []
    # 25 timestamps, 2 estações, cada estação tem 3 fontes por timestamp (IEMA, cams-forecast, cams-reanalysis)
    # Total: 25 * 2 * 3 = 150 linhas
    import uuid
    for h in range(25):
        ts = f"2026-07-01T{h:02d}:00:00Z"
        for st in ["ramqar_camburi", "ramqar_ibes"]:
            for src in ["IEMA", "open-meteo-cams-forecast", "open-meteo-cams-reanalysis"]:
                records.append({
                    "id": str(uuid.uuid4()),
                    "station_id": st,
                    "timestamp": ts,
                    "source": src,
                    "pm25": 10.0,
                    "pm10": 20.0,
                    "o3": 30.0,
                    "no2": 5.0,
                    "so2": 2.0,
                    "co": 100.0,
                })

    records.sort(key=lambda r: (r["timestamp"], r["station_id"], r["id"]))

    def mock_multisource_transport(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
        params = body.get("params", [])
        last_ts = params[0]
        last_st = params[2]
        last_id = params[5]
        limit = params[6]

        filtered = [
            r for r in records
            if (r["timestamp"] > last_ts)
            or (r["timestamp"] == last_ts and r["station_id"] > last_st)
            or (r["timestamp"] == last_ts and r["station_id"] == last_st and r["id"] > last_id)
        ]
        return {
            "success": True,
            "errors": [],
            "messages": [],
            "result": [{"results": filtered[:limit], "success": True}],
        }

    # page_size=7 corta grupos no meio de (timestamp, station_id)
    fetched = fetch_observed_from_d1(
        account_id="acc",
        database_id="db",
        token="tok",
        post_fn=mock_multisource_transport,
        page_size=7,
    )

    assert len(fetched) == 150, f"Esperado 150 registros multi-fonte, obtido {len(fetched)}"
    fetched_ids = [r["id"] for r in fetched]
    assert len(set(fetched_ids)) == 150, "Todas as 150 IDs únicas devem ser paginadas sem duplicação nem perda"


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


def test_format_d1_observed_payload_separates_sources_and_has_extracted_at():
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
            "source": "open-meteo-cams-reanalysis",
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
    assert summary["sources"]["open-meteo-cams-reanalysis"] == 1
    assert summary["sources"]["open-meteo-cams-forecast"] == 1
    assert "extracted_at" in summary, "Payload deve conter extracted_at no summary"

    # Estação camburi
    camburi = payload["stations"]["ramqar_camburi"]
    assert camburi["records_count"] == 2
    assert len(camburi["series"]) == 2
    assert camburi["series"][0]["pm25"] == 10.0
    assert camburi["series"][0]["source"] == "open-meteo-cams-reanalysis"


def test_pure_merge_d1_with_meteo_and_provenance():
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
                    "pm2_5": [999.0, 999.0, 999.0],
                    "pm10": [999.0, 999.0, 999.0],
                    "ozone": [999.0, 999.0, 999.0],
                    "nitrogen_dioxide": [999.0, 999.0, 999.0],
                    "sulphur_dioxide": [999.0, 999.0, 999.0],
                    "carbon_monoxide": [999.0, 999.0, 999.0],
                },
            },
            "ramqar_cariacica": {
                "meta": {"id": "ramqar_cariacica", "municipality": "Cariacica"},
                "meteo_hourly": {"time": ["2026-07-02T00:00"], "temperature_2m": [21.0]},
                "aq_hourly": {"time": ["2026-07-02T00:00"], "pm2_5": [5.0]},
            },
        },
    }

    d1_payload = {
        "summary": {"total_records": 2, "extracted_at": "2026-07-02T02:00:00Z"},
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
                        "source": "open-meteo-cams-reanalysis",
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
            # cariacica ausente no D1
        },
    }

    merged = merge_d1_with_meteo(raw_meteo, d1_payload)
    st = merged["stations"]["ramqar_camburi"]
    times = st["aq_hourly"]["time"]
    assert len(times) == 2, f"Esperado 2 horas alinhadas, obtido {len(times)}"
    assert times == ["2026-07-02T00:00", "2026-07-02T01:00"]
    assert st["aq_hourly"]["pm2_5"] == [11.5, 13.0]

    # Verifica proveniência mista
    assert "provenance" in merged
    assert "ramqar_cariacica" in merged["provenance"]["local_fallback_stations"]


def test_reused_cache_emits_warning_with_age():
    # Cache D1 de 48h atrás
    cache_path = "/tmp/test_d1_cache_old.json"
    old_time = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    cache_data = {
        "summary": {"total_records": 10, "extracted_at": old_time},
        "stations": {},
    }
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache_data, f)

    stderr_buf = io.StringIO()
    old_stderr = sys.stderr
    sys.stderr = stderr_buf
    try:
        # Credenciais presentes mas mock_post falha
        def mock_failing_post(*args, **kwargs):
            raise RuntimeError("API timeout")

        resolved_source, data_dict = resolve_training_data(
            source_mode="d1",
            local_raw_path="ml/data/openmeteo_raw.json",
            d1_file=cache_path,
            env_vars={"CLOUDFLARE_ACCOUNT_ID": "a", "D1_DATABASE_ID": "b", "CLOUDFLARE_API_TOKEN": "c"},
            post_fn=mock_failing_post,
        )
    finally:
        sys.stderr = old_stderr
        if os.path.exists(cache_path):
            os.remove(cache_path)

    warning_text = stderr_buf.getvalue()
    assert "AVISO" in warning_text
    assert "cache" in warning_text.lower()
    assert ("48h" in warning_text or "dias" in warning_text or "horas" in warning_text or "2026" in warning_text)


def test_d1_required_raises_on_failure():
    # D1_REQUIRED=1 deve abortar com RuntimeError em falha, sem cair para cache ou local
    def mock_failing_post(*args, **kwargs):
        raise RuntimeError("Conexão recusada pelo D1")

    try:
        resolve_training_data(
            source_mode="d1",
            local_raw_path="ml/data/openmeteo_raw.json",
            d1_file="ml/data/d1_observed.json",
            env_vars={
                "CLOUDFLARE_ACCOUNT_ID": "a",
                "D1_DATABASE_ID": "b",
                "CLOUDFLARE_API_TOKEN": "c",
                "D1_REQUIRED": "1",
            },
            post_fn=mock_failing_post,
        )
        assert False, "Deveria ter abortado com D1_REQUIRED=1"
    except RuntimeError as e:
        assert "D1_REQUIRED" in str(e)


def test_fallback_to_local_when_d1_unconfigured():
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


def test_default_http_post_urllib_transport():
    from unittest.mock import patch, MagicMock
    from ml.training.fetch_from_d1 import default_http_post

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({"success": True, "result": []}).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp) as mocked_open:
        res = default_http_post("https://api.cloudflare.com/test", "secret_token", {"sql": "SELECT 1"})
        assert res["success"] is True
        assert mocked_open.called


def test_merge_d1_separates_insitu_iema_from_cams_and_prioritizes_iema():
    raw_meteo = {
        "source": "openmeteo",
        "fetched_at": "2026-07-02T03:00:00Z",
        "stations": {
            "ramqar_camburi": {
                "meta": {"id": "ramqar_camburi", "municipality": "Vitória"},
                "meteo_hourly": {
                    "time": ["2026-07-02T00:00", "2026-07-02T01:00", "2026-07-02T02:00"],
                    "temperature_2m": [22.0, 22.5, 23.0],
                },
                "aq_hourly": {
                    "time": ["2026-07-02T00:00", "2026-07-02T01:00", "2026-07-02T02:00"],
                    "pm2_5": [8.0, 8.5, 9.0],
                },
            }
        },
    }
    d1_payload = {
        "summary": {"total_records": 3, "extracted_at": "2026-07-02T02:00:00Z"},
        "stations": {
            "ramqar_camburi": {
                "records_count": 3,
                "series": [
                    {
                        "timestamp": "2026-07-02T00:00:00Z",
                        "pm25": 11.5,
                        "pm10": 21.0,
                        "o3": 16.0,
                        "no2": 7.0,
                        "so2": 3.0,
                        "co": 150.0,
                        "source": "open-meteo-cams-reanalysis",
                    },
                    # No timestamp 01:00 há tanto CAMS quanto IEMA; IEMA deve vencer
                    {
                        "timestamp": "2026-07-02T01:00:00Z",
                        "pm25": 19.5,
                        "pm10": 35.0,
                        "o3": 28.0,
                        "no2": 14.0,
                        "so2": 5.5,
                        "co": 180.0,
                        "source": "IEMA",
                    },
                    {
                        "timestamp": "2026-07-02T01:00:00Z",
                        "pm25": 8.5,
                        "pm10": 18.0,
                        "o3": 19.0,
                        "no2": 8.0,
                        "so2": 3.5,
                        "co": 160.0,
                        "source": "open-meteo-cams-forecast",
                    },
                ],
            }
        },
    }

    # Por padrão (fail-safe R2), allow_d1_regulatory_as_y=False bloqueia promoção para Y
    merged_guarded = merge_d1_with_meteo(raw_meteo, d1_payload)
    assert merged_guarded["stations"]["ramqar_camburi"]["insitu_hourly"] == {}

    # Com opt-in explícito (allow_d1_regulatory_as_y=True), insitu_hourly é preenchido
    merged = merge_d1_with_meteo(raw_meteo, d1_payload, allow_d1_regulatory_as_y=True)
    st = merged["stations"]["ramqar_camburi"]
    # IEMA deve vencer no empate de timestamp em 01:00
    assert st["aq_hourly"]["pm2_5"] == [11.5, 19.5]
    # cams_aq_hourly e cams_meteo_hourly preservam a grade CAMS/meteo completa para X no MOS
    assert st["cams_aq_hourly"]["pm2_5"] == [8.0, 8.5, 9.0]
    assert st["cams_meteo_hourly"]["temperature_2m"] == [22.0, 22.5, 23.0]
    # insitu_hourly contém estritamente registros com source == 'IEMA'
    assert list(st["insitu_hourly"].keys()) == ["2026-07-02T01:00"]
    assert st["insitu_hourly"]["2026-07-02T01:00"]["pm25"] == 19.5
    assert st["insitu_hourly"]["2026-07-02T01:00"]["source"] == "IEMA"
    assert merged["provenance"]["target_mode"] == "mos_insitu"
    assert merged["provenance"]["insitu_stations"] == ["ramqar_camburi"]
    assert merged["provenance"]["insitu_records_count"] == 1


if __name__ == "__main__":
    test_build_d1_query_url()
    test_pagination_and_transport_keyset()
    test_pagination_with_tied_timestamps_across_9_stations()
    test_pagination_multisource_tiebreaker_id_c3_cortex()
    test_d1_http_error()
    test_d1_invalid_json_payload()
    test_format_d1_observed_payload_separates_sources_and_has_extracted_at()
    test_pure_merge_d1_with_meteo_and_provenance()
    test_reused_cache_emits_warning_with_age()
    test_d1_required_raises_on_failure()
    test_fallback_to_local_when_d1_unconfigured()
    test_default_http_post_urllib_transport()
    test_merge_d1_separates_insitu_iema_from_cams_and_prioritizes_iema()
    print("[OK] test_fetch_from_d1: 13/13 verdes")
