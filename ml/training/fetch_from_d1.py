"""
ml/training/fetch_from_d1.py — Extrator de séries observadas do Cloudflare D1.

BUG-03: Extrai a série histórica de treino da tabela `observed_pollutants` do
Cloudflare D1 via HTTP API oficial, separando explicitamente observações in-situ
(IEMA) de produtos de modelo (open-meteo-cams-*).
Usa paginação por keyset composta (timestamp, station_id) para evitar perda
de dados em empates de timestamp entre as 9 estações.
Fornece transporte injetável para testes sem rede e merge puro com meteorologia.
"""

import os
import sys
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable, Tuple


CLOUDFLARE_D1_QUERY_URL = (
    "https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
)

DEFAULT_OUTPUT_PATH = "ml/data/d1_observed.json"
DEFAULT_LOCAL_RAW = "ml/data/openmeteo_raw.json"


def build_d1_query_url(account_id: str, database_id: str) -> str:
    """Monta a URL canônica da API D1 da Cloudflare."""
    return CLOUDFLARE_D1_QUERY_URL.format(account_id=account_id, database_id=database_id)


def default_http_post(url: str, token: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Transporte HTTP POST padrão via urllib (sem dependências externas)."""
    data_bytes = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data_bytes,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "AetherML-D1-Extractor/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_body)
            return parsed
        except Exception:
            raise RuntimeError(f"HTTP {e.code} ao consultar Cloudflare D1: {err_body}")
    except Exception as e:
        raise RuntimeError(f"Falha de conexão com Cloudflare D1: {e}")


def fetch_observed_from_d1(
    account_id: str,
    database_id: str,
    token: str,
    post_fn: Optional[Callable[[str, str, Dict[str, Any]], Any]] = None,
    page_size: int = 1000,
) -> List[Dict[str, Any]]:
    """
    Extrai todos os registros de `observed_pollutants` via API D1 com paginação keyset composta.
    Paginação: WHERE (timestamp > ?) OR (timestamp = ? AND station_id > ?) ORDER BY timestamp ASC, station_id ASC
    Garante zero linhas perdidas em empates de timestamp entre as 9 estações.
    """
    transport = post_fn or default_http_post
    url = build_d1_query_url(account_id, database_id)

    all_rows: List[Dict[str, Any]] = []
    last_timestamp = ""
    last_station_id = ""

    sql_template = (
        "SELECT station_id, timestamp, pm25, pm10, o3, no2, so2, co, source "
        "FROM observed_pollutants "
        "WHERE (timestamp > ?) OR (timestamp = ? AND station_id > ?) "
        "ORDER BY timestamp ASC, station_id ASC "
        "LIMIT ?"
    )

    while True:
        body = {
            "sql": sql_template,
            "params": [last_timestamp, last_timestamp, last_station_id, page_size],
        }

        resp = transport(url, token, body)
        if not isinstance(resp, dict):
            raise ValueError(f"Resposta inválida recebida da API D1 (esperado dict, obtido {type(resp)})")

        if not resp.get("success"):
            errors = resp.get("errors", [])
            err_msg = "; ".join(e.get("message", str(e)) for e in errors) or "Erro desconhecido"
            raise RuntimeError(f"Erro na API Cloudflare D1: {err_msg}")

        result_blocks = resp.get("result")
        if not isinstance(result_blocks, list) or len(result_blocks) == 0:
            break

        rows = result_blocks[0].get("results", [])
        if not rows:
            break

        all_rows.extend(rows)
        if len(rows) < page_size:
            break

        last_timestamp = rows[-1]["timestamp"]
        last_station_id = rows[-1]["station_id"]

    return all_rows


def format_d1_observed_payload(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Estrutura a saída de `ml/data/d1_observed.json` por estação,
    com resumo de contagens, data/hora de extração (extracted_at), janela temporal
    e separação explícita de fontes.
    Separa explicitamente source='IEMA' (in-situ) de source='open-meteo-cams-*'.
    """
    sources_summary: Dict[str, int] = {}
    stations_data: Dict[str, Dict[str, Any]] = {}
    all_timestamps: List[str] = []

    for r in rows:
        st_id = r.get("station_id", "unknown")
        ts = r.get("timestamp", "")
        if ts:
            all_timestamps.append(ts)

        raw_source = r.get("source") or "não-declarada"
        sources_summary[raw_source] = sources_summary.get(raw_source, 0) + 1

        if st_id not in stations_data:
            stations_data[st_id] = {
                "records_count": 0,
                "window_start": ts,
                "window_end": ts,
                "sources": {},
                "series": [],
            }

        st = stations_data[st_id]
        st["records_count"] += 1
        st["sources"][raw_source] = st["sources"].get(raw_source, 0) + 1
        if ts and (not st["window_start"] or ts < st["window_start"]):
            st["window_start"] = ts
        if ts and (not st["window_end"] or ts > st["window_end"]):
            st["window_end"] = ts

        st["series"].append({
            "timestamp": ts,
            "pm25": r.get("pm25"),
            "pm10": r.get("pm10"),
            "o3": r.get("o3"),
            "no2": r.get("no2"),
            "so2": r.get("so2"),
            "co": r.get("co"),
            "source": raw_source,
        })

    window_start = min(all_timestamps) if all_timestamps else ""
    window_end = max(all_timestamps) if all_timestamps else ""
    extracted_at = datetime.now(timezone.utc).isoformat()

    return {
        "summary": {
            "total_records": len(rows),
            "stations_count": len(stations_data),
            "window_start": window_start,
            "window_end": window_end,
            "sources": sources_summary,
            "extracted_at": extracted_at,
        },
        "stations": stations_data,
    }


def _norm_ts(ts: str) -> str:
    """Normaliza timestamp ISO para 'YYYY-MM-DDTHH:MM' para junção exata."""
    return ts.replace("Z", "").replace(" ", "T")[:16]


def merge_d1_with_meteo(raw_openmeteo: Dict[str, Any], d1_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Função pura testável: junta a meteorologia horária de raw_openmeteo (meteo_hourly)
    com a série observada de poluentes do D1 (d1_data), alinhando por timestamp.
    Preserva a estrutura consumida por build_real_dataset.
    Registra e avisa sobre proveniência mista (estações mantidas do local).
    """
    merged_stations: Dict[str, Any] = {}
    d1_stations = d1_data.get("stations", {})
    retained_local_stations: List[str] = []
    d1_matched_stations: List[str] = []

    for station_id, entry in raw_openmeteo.get("stations", {}).items():
        meta = entry.get("meta", {})
        meteo_hourly = entry.get("meteo_hourly", {})
        meteo_times = meteo_hourly.get("time", [])

        st_d1 = d1_stations.get(station_id)
        if not st_d1:
            # Estação sem dados no D1: preserva original e anota proveniência
            merged_stations[station_id] = entry
            retained_local_stations.append(station_id)
            continue

        d1_by_ts: Dict[str, Dict[str, Any]] = {}
        for item in st_d1.get("series", []):
            k = _norm_ts(item.get("timestamp", ""))
            d1_by_ts[k] = item

        # Alinha horários presentes em ambos
        aligned_times: List[str] = []
        aligned_indices: List[int] = []
        aligned_pm25: List[Optional[float]] = []
        aligned_pm10: List[Optional[float]] = []
        aligned_o3: List[Optional[float]] = []
        aligned_no2: List[Optional[float]] = []
        aligned_so2: List[Optional[float]] = []
        aligned_co: List[Optional[float]] = []

        for idx, t_str in enumerate(meteo_times):
            norm_k = _norm_ts(t_str)
            if norm_k in d1_by_ts:
                obs = d1_by_ts[norm_k]
                aligned_times.append(t_str)
                aligned_indices.append(idx)
                aligned_pm25.append(obs.get("pm25"))
                aligned_pm10.append(obs.get("pm10"))
                aligned_o3.append(obs.get("o3"))
                aligned_no2.append(obs.get("no2"))
                aligned_so2.append(obs.get("so2"))
                aligned_co.append(obs.get("co"))

        if not aligned_times:
            # Sem sobreposição: preserva original
            merged_stations[station_id] = entry
            retained_local_stations.append(station_id)
            continue

        d1_matched_stations.append(station_id)

        # Filtra meteo_hourly para os índices alinhados
        aligned_meteo: Dict[str, Any] = {"time": aligned_times}
        for k, v_list in meteo_hourly.items():
            if k != "time" and isinstance(v_list, list):
                aligned_meteo[k] = [v_list[i] for i in aligned_indices if i < len(v_list)]

        aligned_aq: Dict[str, Any] = {
            "time": aligned_times,
            "pm2_5": aligned_pm25,
            "pm10": aligned_pm10,
            "ozone": aligned_o3,
            "nitrogen_dioxide": aligned_no2,
            "sulphur_dioxide": aligned_so2,
            "carbon_monoxide": aligned_co,
        }

        merged_stations[station_id] = {
            "meta": meta,
            "meteo_hourly": aligned_meteo,
            "aq_hourly": aligned_aq,
        }

    if retained_local_stations:
        print(
            f"[AetherML ML] Proveniência mista: {len(retained_local_stations)} estações mantidas do local "
            f"(ausentes no D1): {retained_local_stations}"
        )

    return {
        "source": "d1 (observed_pollutants) + open-meteo (meteo_hourly)",
        "fetched_at": raw_openmeteo.get("fetched_at", ""),
        "provenance": {
            "d1_stations": d1_matched_stations,
            "local_fallback_stations": retained_local_stations,
        },
        "stations": merged_stations,
    }


def _format_age(extracted_at_iso: str) -> str:
    """Calcula idade legível a partir de timestamp ISO."""
    try:
        extracted_dt = datetime.fromisoformat(extracted_at_iso.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = now - extracted_dt
        hours = delta.total_seconds() / 3600.0
        if hours < 1:
            return f"{int(delta.total_seconds() / 60)}m"
        if hours < 48:
            return f"{hours:.1f}h"
        return f"{hours / 24.0:.1f} dias"
    except Exception:
        return "idade indeterminada"


def resolve_training_data(
    source_mode: str = "d1",
    local_raw_path: str = DEFAULT_LOCAL_RAW,
    d1_file: str = DEFAULT_OUTPUT_PATH,
    env_vars: Optional[Dict[str, str]] = None,
    post_fn: Optional[Callable] = None,
    d1_required: bool = False,
) -> Tuple[str, Dict[str, Any]]:
    """
    Resolve e carrega os dados de treinamento com fallback explícito e aviso.
    Retorna (origem_resolvida: 'd1'|'local', dataset_raw_dict).
    Se d1_required (ou env D1_REQUIRED=1): aborta com RuntimeError se a extração falhar.
    """
    env = os.environ if env_vars is None else env_vars
    is_d1_required = d1_required or (env.get("D1_REQUIRED") == "1")

    with open(local_raw_path, "r", encoding="utf-8") as f:
        local_raw = json.load(f)

    if source_mode == "local":
        print(f"[AetherML ML] Fonte explicitamente configurada como LOCAL ({local_raw_path}).")
        return "local", local_raw

    # source_mode == "d1"
    account_id = env.get("CLOUDFLARE_ACCOUNT_ID")
    db_id = env.get("D1_DATABASE_ID")
    token = env.get("CLOUDFLARE_API_TOKEN")

    d1_payload: Optional[Dict[str, Any]] = None
    extraction_error: Optional[Exception] = None

    if account_id and db_id and token:
        try:
            print(f"[AetherML ML] Consultando Cloudflare D1 ({db_id})...")
            rows = fetch_observed_from_d1(
                account_id=account_id,
                database_id=db_id,
                token=token,
                post_fn=post_fn,
            )
            d1_payload = format_d1_observed_payload(rows)
            os.makedirs(os.path.dirname(d1_file), exist_ok=True)
            with open(d1_file, "w", encoding="utf-8") as f:
                json.dump(d1_payload, f, indent=2)
            print(f"[AetherML ML] Extração D1 concluída: {len(rows)} linhas salvas em {d1_file}.")
        except Exception as e:
            extraction_error = e
            if is_d1_required:
                raise RuntimeError(
                    f"D1_REQUIRED=1 mas a extração do Cloudflare D1 falhou: {e}"
                ) from e
            print(
                f"[AVISO AetherML] Falha ao extrair do Cloudflare D1 ({e}). "
                "Tentando arquivo d1_observed.json em cache ou fallback local...",
                file=sys.stderr,
            )
    else:
        if is_d1_required:
            raise RuntimeError(
                "D1_REQUIRED=1 mas as credenciais Cloudflare D1 (CLOUDFLARE_ACCOUNT_ID, "
                "D1_DATABASE_ID, CLOUDFLARE_API_TOKEN) não estão configuradas."
            )

    # Reutilização de cache quando a extração ao vivo não ocorreu
    if d1_payload is None and os.path.exists(d1_file):
        try:
            with open(d1_file, "r", encoding="utf-8") as f:
                d1_payload = json.load(f)
            ext_at = d1_payload.get("summary", {}).get("extracted_at", "data desconhecida")
            age_str = _format_age(ext_at)
            print(
                f"[AVISO AetherML] Reutilizando cache local de {d1_file} extraído em {ext_at} "
                f"({age_str} atrás). Dados não foram atualizados do D1.",
                file=sys.stderr,
            )
        except Exception:
            d1_payload = None

    if d1_payload is not None:
        merged = merge_d1_with_meteo(local_raw, d1_payload)
        return "d1", merged

    # Fallback explícito com aviso claro
    print(
        f"[AVISO AetherML] Cloudflare D1 não configurado ou indisponível — "
        f"realizando fallback explícito para fonte LOCAL ({local_raw_path}).",
        file=sys.stderr,
    )
    return "local", local_raw


def main() -> None:
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    db_id = os.environ.get("D1_DATABASE_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")

    if not (account_id and db_id and token):
        print(
            "Erro: Defina CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID e CLOUDFLARE_API_TOKEN.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"[AetherML ML] Extraindo dados de observed_pollutants do D1...")
    rows = fetch_observed_from_d1(account_id, db_id, token)
    payload = format_d1_observed_payload(rows)

    os.makedirs(os.path.dirname(DEFAULT_OUTPUT_PATH), exist_ok=True)
    with open(DEFAULT_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    summary = payload["summary"]
    print(f"[AetherML ML] Concluído! Total: {summary['total_records']} registros.")
    print(f"  Janela: {summary['window_start']} até {summary['window_end']}")
    print(f"  Fontes: {summary['sources']}")
    print(f"  Extraído em: {summary['extracted_at']}")


if __name__ == "__main__":
    main()
