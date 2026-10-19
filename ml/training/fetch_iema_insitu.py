"""
ml/training/fetch_iema_insitu.py — Parser in-situ oficial IEMA/PRODEST (2024..2026).

Lê planilhas .xlsx oficiais do IEMA e extrai concentrações horárias de poluentes
(PM25, PM10, O3, NO2, SO2, CO) e meteorologia in-situ, tratando as 7 surpresas:
1. Dois layouts: Legado (8 cabeçalhos, sharedStrings) vs Novo (3 cabeçalhos, inlineStr).
2. Strings inline e shared strings tratadas sem dependências externas (zipfile + iterparse).
3. Normalização temporal BRT -> UTC (+3h) truncando :30 para :00 no legado.
4. Descarte de 'Temperatura Interna' do abrigo de sensores.
5. Fator CO reconciliado 1145.6 (CO_ppm em 2025.2 para ug/m3).
6. Gaps de sensores preservados como None (sem imputação IDW no alvo Y).
7. Validação estrita de flags (""/VU/VR/VI/VC) e descarte de sentinelas (-9999/99999).
"""

import csv
import io
import json
import math
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Fator físico a 25 °C e 1 atm: 28.01 g/mol / 24.45 L/mol ≈ 1145.6 ug/m³ por ppm.
# Reconciliado empiricamente com colunas duplas de CO da planilha 2025.1 do IEMA.
CO_PPM_TO_UGM3: float = 1145.6

# Flags de validação aceitas pelo IEMA-ES
VALID_FLAGS = {"", " ", "VU", "VR", "VI", "VC"}

# Contrato canônico estrito das 9 estações do sistema (db/seed.sql)
CANONICAL_STATIONS = {
    "ramqar_camburi",
    "ramqar_enseada_sua",
    "ramqar_vitoria_centro",
    "ramqar_ibes",
    "ramqar_paul",
    "ramqar_cariacica",
    "ramqar_serra_laranjeiras",
    "ramqar_serra_jacupemba",
    "ramqar_vila_velha_fundo",
}

# Mapeamento explícito das 10 estações presentes nas planilhas oficiais (Legado e Novo)
# RGV7, RGV10 e RGV2 são explicitamente descartados (None) para evitar herança espúria (C1)
# e violação do contrato de 9 estações canônicas de db/seed.sql (R3).
IEMA_STATION_MAP: Dict[str, Optional[str]] = {
    # RGV1 - Laranjeiras -> ramqar_serra_laranjeiras
    "EMQAr - RGV1 - Laranjeiras": "ramqar_serra_laranjeiras",
    "EMQAr - RGV1 (Laranjeiras)": "ramqar_serra_laranjeiras",
    # RGV2 - Carapina -> Descarte explícito: fora do contrato de 9 IDs (db/seed.sql)
    "EMQAr - RGV2 - Carapina": None,
    "EMQAr - RGV2 (Carapina)": None,
    # RGV3 - Jardim Camburi -> ramqar_camburi
    "EMQAr - RGV3 - Jardim Camburi": "ramqar_camburi",
    "EMQAr - RGV3 (Jardim Camburi)": "ramqar_camburi",
    # RGV4 - Enseada do Suá -> ramqar_enseada_sua
    "EMQAr - RGV4 - Enseada do Sua": "ramqar_enseada_sua",
    "EMQAr - RGV4 - Enseada do Suá": "ramqar_enseada_sua",
    "EMQAr - RGV4 (Enseada do Suá)": "ramqar_enseada_sua",
    # RGV5 - Vitória-Centro -> ramqar_vitoria_centro
    "EMQAr - RGV5 - Vitória-Centro": "ramqar_vitoria_centro",
    "EMQAr - RGV5 (Vitória-Centro)": "ramqar_vitoria_centro",
    # RGV6 - Vila Velha-IBES -> ramqar_ibes
    "EMQAr - RGV6 - Vila Velha-IBES": "ramqar_ibes",
    "EMQAr - RGV6 (Vila Velha-IBES)": "ramqar_ibes",
    # RGV7 - Vila Velha-Centro -> Descarte explícito: fora de operação
    "EMQAr - RGV7 - Vila Velha-Centro": None,
    "EMQAr - RGV7 (Vila Velha-Centro)": None,
    # RGV8 - Vila Capixaba -> ramqar_cariacica
    "EMQAr - RGV8 - Vila Capixaba": "ramqar_cariacica",
    "EMQAr - RGV8 (Vila Capixaba)": "ramqar_cariacica",
    # RGV9 - Cidade Continental -> ramqar_serra_jacupemba
    "EMQAr - RGV9 - Cidade Continental": "ramqar_serra_jacupemba",
    "EMQAr - RGV9 (Cidade Continental)": "ramqar_serra_jacupemba",
    # RGV10 - Ponta Formosa -> Descarte explícito: particular Vale desativada
    "EMQAr - RGV10 - Ponta Formosa": None,
    "EMQAr - RGV10 (Ponta Formosa)": None,
}

IEMA_URLS = {
    "2026": "https://iema.es.gov.br/media/CQAI/medicoes-rgv-01-01-2026-a-30-09-2026.xlsx",
    "2025_2": "https://iema.es.gov.br/media/CQAI/Medi%C3%A7%C3%B5es%20Grande%20Vit%C3%B3ria%20-%2001.07.2025%20a%2031.12.2025.xlsx",
    "2025_1": "https://iema.es.gov.br/media/CQAI/Medi%C3%A7%C3%B5es%20RGV%20-%2001.01.2025%20a%2030.06.2025.xlsx",
    "2024": "https://iema.es.gov.br/media/Qualidade%20do%20ar/Dados%20RGV%2001.01.2024%20-%2031.12.2024.xlsx",
}


def is_valid_flag(flag: Optional[str]) -> bool:
    """Verifica se a flag de validação do IEMA indica medição válida."""
    if flag is None:
        return True
    return str(flag).strip().upper() in VALID_FLAGS


def excel_serial_to_utc_iso(serial_val: float) -> str:
    """Converte serial float do Excel em hora cheia UTC ISO (BRT :30 -> :00 + 3h)."""
    dt = datetime(1899, 12, 30) + timedelta(days=float(serial_val))
    dt_hour = dt.replace(minute=0, second=0, microsecond=0)
    dt_utc = dt_hour + timedelta(hours=3)
    return dt_utc.strftime("%Y-%m-%dT%H:00")


def iso_brt_to_utc_iso(iso_str: str) -> str:
    """Converte string ISO de horário local BRT para hora cheia UTC ISO (+3h)."""
    clean_str = iso_str.strip().replace("T", " ")[:19]
    dt = datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
    dt_hour = dt.replace(minute=0, second=0, microsecond=0)
    dt_utc = dt_hour + timedelta(hours=3)
    return dt_utc.strftime("%Y-%m-%dT%H:00")


def normalize_station_name(raw_name: str) -> Optional[str]:
    """
    Mapeia string de estação IEMA para o ID canônico correspondente.
    Retorna None para estações descartadas (RGV2, RGV7, RGV10) ou não-mapeadas.
    Falha alto com ValueError se emitir um ID fora de CANONICAL_STATIONS (R3).
    """
    if not raw_name:
        return None
    raw_clean = raw_name.strip()
    if raw_clean in IEMA_STATION_MAP:
        mapped = IEMA_STATION_MAP[raw_clean]
        if mapped is not None and mapped not in CANONICAL_STATIONS:
            raise ValueError(f"Estação '{mapped}' emitida fora do contrato canônico de 9 IDs (db/seed.sql)")
        return mapped

    m = re.search(r"RGV\s*(10|[1-9])\b", raw_clean, re.IGNORECASE)
    if m:
        num = m.group(1)
        for pattern, station_id in IEMA_STATION_MAP.items():
            if f"RGV{num}" in pattern:
                if station_id is not None and station_id not in CANONICAL_STATIONS:
                    raise ValueError(f"Estação '{station_id}' emitida fora do contrato canônico de 9 IDs (db/seed.sql)")
                return station_id
    return None


def _col_to_index(col_letters: str) -> int:
    """Converte letras de coluna de planilha (A, B, AA...) em índice 0-indexed."""
    idx = 0
    for char in col_letters.upper():
        idx = idx * 26 + (ord(char) - ord("A") + 1)
    return idx - 1


def _extract_cell_text(elem: ET.Element, shared_strings: List[str]) -> str:
    """Extrai texto representativo de um elemento de célula do OpenXML."""
    cell_type = elem.get("t")
    if cell_type == "s":
        v_elem = elem.find("{*}v")
        if v_elem is not None and v_elem.text is not None:
            try:
                idx = int(v_elem.text)
                if 0 <= idx < len(shared_strings):
                    return shared_strings[idx]
            except ValueError:
                pass
        return ""
    if cell_type == "inlineStr":
        t_elem = elem.find(".//{*}t")
        if t_elem is not None and t_elem.text is not None:
            return t_elem.text
        return ""
    v_elem = elem.find("{*}v")
    if v_elem is not None and v_elem.text is not None:
        return v_elem.text
    t_elem = elem.find(".//{*}t")
    if t_elem is not None and t_elem.text is not None:
        return t_elem.text
    return ""


def _load_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    """Carrega strings compartilhadas de xl/sharedStrings.xml se presente."""
    strings = []
    if "xl/sharedStrings.xml" not in zf.namelist():
        return strings
    with zf.open("xl/sharedStrings.xml") as f:
        for event, elem in ET.iterparse(f):
            if elem.tag.endswith("si"):
                text_parts = [t.text for t in elem.findall(".//{*}t") if t.text]
                strings.append("".join(text_parts))
                elem.clear()
    return strings


def _map_param_name(raw_name: str) -> Optional[Tuple[str, str]]:
    """Identifica o poluente ou variável meteorológica e sua unidade a partir do cabeçalho."""
    s = raw_name.strip()
    s_lower = s.lower()

    # Ignorar expressamente "Temperatura Interna" / "TempInt" (abrigo físico de sensores)
    if "temperatura interna" in s_lower or "tempint" in s_lower:
        return None

    # Mapeamento de poluentes
    if "pm25" in s_lower or "pm2,5" in s_lower or "respiráveis" in s_lower or "respiraveis" in s_lower:
        return ("pm25", "ugm3")
    if "pm10" in s_lower or "inaláveis" in s_lower or "inalaveis" in s_lower:
        return ("pm10", "ugm3")
    if "o3" in s_lower or "ozônio" in s_lower or "ozonio" in s_lower:
        return ("o3", "ugm3")
    if "no2" in s_lower or "dióxido de nitrogênio" in s_lower or "dioxido de nitrogenio" in s_lower:
        return ("no2", "ugm3")
    if "so2" in s_lower or "dióxido de enxofre" in s_lower or "dioxido de enxofre" in s_lower:
        return ("so2", "ugm3")
    if "co_ppm" in s_lower:
        return ("co", "ppm")
    if "monóxido de carbono" in s_lower or "monoxido de carbono" in s_lower or (
        s_lower.startswith("co") and not s_lower.startswith("con")
    ):
        return ("co", "ugm3")

    # Mapeamento meteorológico
    if "tempar" in s_lower or ("temperatura" in s_lower and "interna" not in s_lower):
        return ("temperature_2m", "c")
    if "rh" in s_lower or "umidade" in s_lower:
        return ("relative_humidity_2m", "pct")
    if "velvento" in s_lower or "velocidade" in s_lower:
        return ("wind_speed_10m", "ms")
    if "dirvento" in s_lower or "direção" in s_lower or "direcao" in s_lower:
        return ("wind_direction_10m", "deg")
    if "press_ar" in s_lower or "pressão" in s_lower or "pressao" in s_lower:
        return ("pressure_msl", "hpa")
    if "radiação" in s_lower or "radiacao" in s_lower or "solar" in s_lower:
        return ("shortwave_radiation", "wm2")

    return None


def parse_iema_xlsx(data: Union[bytes, str]) -> List[Dict[str, Any]]:
    """Analisa arquivo XLSX do IEMA (Legado ou Novo) e retorna lista de medições normalizadas."""
    if isinstance(data, str):
        zf = zipfile.ZipFile(data, "r")
    else:
        zf = zipfile.ZipFile(io.BytesIO(data), "r")

    shared_strings = _load_shared_strings(zf)

    sheet_names = [n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
    if not sheet_names:
        raise ValueError("Nenhuma planilha encontrada no arquivo XLSX")
    main_sheet = sorted(sheet_names)[0]

    header_rows: Dict[int, Dict[int, str]] = {}
    data_rows: List[Tuple[int, Dict[int, str]]] = []

    with zf.open(main_sheet) as sheet_file:
        for event, elem in ET.iterparse(sheet_file):
            if elem.tag.endswith("row"):
                r_attr = elem.get("r")
                row_idx = int(r_attr) if r_attr else len(header_rows) + len(data_rows) + 1
                row_data: Dict[int, str] = {}
                for c in elem.findall(".//{*}c"):
                    r_ref = c.get("r")
                    if r_ref:
                        letters = "".join(filter(str.isalpha, r_ref))
                        c_idx = _col_to_index(letters)
                    else:
                        c_idx = len(row_data)
                    val = _extract_cell_text(c, shared_strings)
                    if val != "":
                        row_data[c_idx] = val
                if row_idx <= 12:
                    header_rows[row_idx] = row_data
                else:
                    data_rows.append((row_idx, row_data))
                elem.clear()

    # Detectar layout legado (8 cabeçalhos) vs novo (3 cabeçalhos)
    is_legado = False
    if 5 in header_rows and any("Partículas" in v or "Ozônio" in v or "Monóxido" in v for v in header_rows[5].values()):
        is_legado = True
    elif 8 in header_rows and any("Valor" in v for v in header_rows[8].values()):
        is_legado = True

    start_data_row = 9 if is_legado else 4
    # Mover linhas do range 4..12 para data_rows se couberem
    for r_idx in sorted(header_rows.keys()):
        if r_idx >= start_data_row:
            data_rows.append((r_idx, header_rows[r_idx]))
    data_rows.sort(key=lambda x: x[0])

    # Mapear colunas: station_id -> {col_idx: (param, unit, is_flag, value_col)}
    # Para layout novo:
    # Linha 2 = Estações
    # Linha 3 = Parâmetro e Status
    # Para layout legado:
    # Linha 2 = Estações
    # Linha 5 = Parâmetro longo
    # Linha 8 = Valor / Flag
    col_mapping: Dict[int, Dict[str, Any]] = {}

    station_row = header_rows.get(2, {})
    last_station = None
    for c_idx in sorted(station_row.keys()):
        st_val = station_row[c_idx]
        norm = normalize_station_name(st_val)
        if norm:
            last_station = norm

    # Re-mapear cada coluna com preenchimento da estação para a direita
    curr_station = None
    # FIX BARATOS: max_col calculado sobre todas as linhas de cabeçalho e amostra
    all_col_keys = []
    for r in header_rows.values():
        if r:
            all_col_keys.extend(r.keys())
    for _, r in data_rows[:5]:
        if r:
            all_col_keys.extend(r.keys())
    max_col = max(all_col_keys, default=200)

    for c_idx in range(1, max_col + 1):
        if c_idx in station_row:
            # FIX C1: atualiza curr_station explicitamente para toda coluna com cabeçalho de estação.
            # Se normalize_station_name devolver None (descarte de RGV2/RGV7/RGV10), curr_station fica None!
            curr_station = normalize_station_name(station_row[c_idx])

        if not curr_station:
            continue

        if is_legado:
            val_flag_str = header_rows.get(8, {}).get(c_idx, "").strip()
            is_flag = "flag" in val_flag_str.lower()
            if is_flag:
                # FIX C2: no formato legado, o nome do parâmetro está apenas na coluna de valor.
                # A coluna de flag herda o parâmetro da coluna imediatamente à esquerda (c_idx - 1).
                if (c_idx - 1) in col_mapping and col_mapping[c_idx - 1]["station_id"] == curr_station:
                    prev_meta = col_mapping[c_idx - 1]
                    col_mapping[c_idx] = {
                        "station_id": curr_station,
                        "param": prev_meta["param"],
                        "unit": prev_meta["unit"],
                        "is_flag": True,
                    }
            else:
                param_str = header_rows.get(5, {}).get(c_idx, "")
                mapped = _map_param_name(param_str)
                if mapped:
                    col_mapping[c_idx] = {
                        "station_id": curr_station,
                        "param": mapped[0],
                        "unit": mapped[1],
                        "is_flag": False,
                    }
        else:
            param_str = header_rows.get(3, {}).get(c_idx, "")
            is_flag = param_str.lower().startswith("status")
            if is_flag:
                # O status refere-se ao parâmetro anterior ou do nome
                clean_p = param_str.lower().replace("status", "").strip()
                mapped = _map_param_name(clean_p)
                if not mapped and (c_idx - 1) in col_mapping:
                    mapped = (col_mapping[c_idx - 1]["param"], col_mapping[c_idx - 1]["unit"])
            else:
                mapped = _map_param_name(param_str)

            if mapped:
                col_mapping[c_idx] = {
                    "station_id": curr_station,
                    "param": mapped[0],
                    "unit": mapped[1],
                    "is_flag": is_flag,
                }

    records: List[Dict[str, Any]] = []

    for r_idx, row in data_rows:
        ts_raw = row.get(0)
        if not ts_raw:
            continue
        try:
            if is_legado or re.match(r"^\d+(\.\d+)?$", ts_raw.strip()):
                ts_utc = excel_serial_to_utc_iso(float(ts_raw))
            else:
                ts_utc = iso_brt_to_utc_iso(ts_raw)
        except Exception:
            continue

        # Agrupar medições da linha por estação
        station_concs: Dict[str, Dict[str, Any]] = {}
        station_flags: Dict[str, Dict[str, str]] = {}

        for c_idx, meta in col_mapping.items():
            st_id = meta["station_id"]
            param = meta["param"]
            val_str = row.get(c_idx, "").strip()

            if st_id not in station_concs:
                station_concs[st_id] = {}
                station_flags[st_id] = {}

            if meta["is_flag"]:
                station_flags[st_id][param] = val_str
            else:
                if val_str != "":
                    try:
                        num = float(val_str)
                        if math.isfinite(num) and num >= 0 and num not in (99999, 9999, -9999):
                            # Conversão de unidades
                            if meta["unit"] == "ppm" and param == "co":
                                num = round(num * CO_PPM_TO_UGM3, 3)
                            elif meta["unit"] == "ms" and param == "wind_speed_10m":
                                # FIX R4: converte m/s da planilha para km/h (* 3.6), compatível com row_to_features
                                num = round(num * 3.6, 2)
                            station_concs[st_id][param] = num
                    except ValueError:
                        pass

        for st_id, concs in station_concs.items():
            flags = station_flags.get(st_id, {})
            # Filtrar por flags de validação
            filtered_concs = {}
            for p, v in concs.items():
                f = flags.get(p, "")
                if is_valid_flag(f):
                    filtered_concs[p] = v

            rec = {
                "station_id": st_id,
                "timestamp_utc": ts_utc,
                "pm25": filtered_concs.get("pm25"),
                "pm10": filtered_concs.get("pm10"),
                "o3": filtered_concs.get("o3"),
                "no2": filtered_concs.get("no2"),
                "so2": filtered_concs.get("so2"),
                "co": filtered_concs.get("co"),
                "temperature_2m": filtered_concs.get("temperature_2m"),
                "relative_humidity_2m": filtered_concs.get("relative_humidity_2m"),
                "wind_speed_10m": filtered_concs.get("wind_speed_10m"),
                "wind_direction_10m": filtered_concs.get("wind_direction_10m"),
                "pressure_msl": filtered_concs.get("pressure_msl"),
                "shortwave_radiation": filtered_concs.get("shortwave_radiation"),
            }
            records.append(rec)

    return records


def download_iema_xlsx(year_key: str, cache_dir: str = "ml/data/cache_xlsx") -> str:
    """Baixa planilha oficial do IEMA se ainda não existir no cache local."""
    if year_key not in IEMA_URLS:
        raise ValueError(f"Chave de planilha '{year_key}' não permitida. Válidas: {list(IEMA_URLS.keys())}")
    os.makedirs(cache_dir, exist_ok=True)
    url = IEMA_URLS[year_key]
    filename = f"iema_{year_key}.xlsx"
    target_path = os.path.join(cache_dir, filename)
    if os.path.exists(target_path) and os.path.getsize(target_path) > 100_000:
        return target_path

    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=45) as resp, open(target_path, "wb") as out:
        out.write(resp.read())
    return target_path


def fetch_and_parse_all_iema(
    cache_dir: str = "ml/data/cache_xlsx",
    output_json: str = "ml/data/iema_insitu_raw.json",
    years: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Baixa e processa planilhas do IEMA, gerando o arquivo consolidado de verdade horária."""
    selected_years = years or ["2024", "2025_1", "2025_2", "2026"]
    stations_data: Dict[str, Dict[str, Any]] = {}

    for y in selected_years:
        print(f"[iema_parser] Baixando/verificando cache da planilha {y}...", flush=True)
        xlsx_path = download_iema_xlsx(y, cache_dir=cache_dir)
        print(f"[iema_parser] Processando {xlsx_path}...", flush=True)
        recs = parse_iema_xlsx(xlsx_path)
        print(f"[iema_parser] {y}: {len(recs)} registros extraídos.", flush=True)

        for r in recs:
            st_id = r["station_id"]
            if st_id not in CANONICAL_STATIONS:
                raise ValueError(f"Estação {st_id} fora do contrato canônico de 9 IDs (db/seed.sql)")
            ts = r["timestamp_utc"]

            metrics_dict = {
                "pm25": r.get("pm25"),
                "pm10": r.get("pm10"),
                "o3": r.get("o3"),
                "no2": r.get("no2"),
                "so2": r.get("so2"),
                "co": r.get("co"),
                "temperature_2m": r.get("temperature_2m"),
                "relative_humidity_2m": r.get("relative_humidity_2m"),
                "wind_speed_10m": r.get("wind_speed_10m"),
                "wind_direction_10m": r.get("wind_direction_10m"),
                "pressure_msl": r.get("pressure_msl"),
                "shortwave_radiation": r.get("shortwave_radiation"),
            }
            # R5: Descarta registros 100% vazios para medir cobertura real da estação
            if not any(v is not None for v in metrics_dict.values()):
                continue

            if st_id not in stations_data:
                stations_data[st_id] = {"hourly": {}}
            stations_data[st_id]["hourly"][ts] = metrics_dict

    stats: Dict[str, Any] = {}
    all_timestamps = set()

    for st_id, st_dict in stations_data.items():
        hourly = st_dict["hourly"]
        st_dict["records_count"] = len(hourly)
        all_timestamps.update(hourly.keys())
        st_stats = {
            "total_hours": len(hourly),
            "pm25_valid": sum(1 for h in hourly.values() if h.get("pm25") is not None),
            "pm10_valid": sum(1 for h in hourly.values() if h.get("pm10") is not None),
            "o3_valid": sum(1 for h in hourly.values() if h.get("o3") is not None),
            "no2_valid": sum(1 for h in hourly.values() if h.get("no2") is not None),
            "so2_valid": sum(1 for h in hourly.values() if h.get("so2") is not None),
            "co_valid": sum(1 for h in hourly.values() if h.get("co") is not None),
            "temp_valid": sum(1 for h in hourly.values() if h.get("temperature_2m") is not None),
        }
        stats[st_id] = st_stats

    sorted_ts = sorted(all_timestamps)
    time_coverage = {
        "start": sorted_ts[0] if sorted_ts else None,
        "end": sorted_ts[-1] if sorted_ts else None,
        "total_unique_hours": len(sorted_ts),
    }

    payload = {
        "source": "IEMA-ES RAMQAr planilhas oficiais 2024..2026",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "co_factor_ppm_to_ugm3": CO_PPM_TO_UGM3,
        "time_coverage": time_coverage,
        "stations_summary": stats,
        "stations": stations_data,
    }

    os.makedirs(os.path.dirname(output_json), exist_ok=True)
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(payload, f)

    print(f"[iema_parser] Dados in-situ salvos com sucesso em {output_json}")
    print(f"[iema_parser] Janela temporal: {time_coverage['start']} a {time_coverage['end']} ({time_coverage['total_unique_hours']} horas únicas)")
    for st_id, st_st in stats.items():
        print(f"  - {st_id}: {st_st['total_hours']}h | PM25: {st_st['pm25_valid']} | PM10: {st_st['pm10_valid']} | O3: {st_st['o3_valid']} | NO2: {st_st['no2_valid']} | SO2: {st_st['so2_valid']} | CO: {st_st['co_valid']}")

    return payload


if __name__ == "__main__":
    fetch_and_parse_all_iema()
