"""
ml/training/test_fetch_iema_insitu.py — Testes TDD para o parser XLSX in-situ IEMA/PRODEST.

Cobre as 7 surpresas mapeadas na auditoria técnica:
1. Dois layouts (Legado 8 cabeçalhos vs Novo 3 cabeçalhos).
2. Strings inline (`c[@t="inlineStr"]/is/t` e `c[@t="str"]/v`) vs sharedStrings.xml.
3. Timestamps: serial float do Excel com :30 (Legado) e ISO local BRT :00 (Novo) -> UTC (+3h).
4. "Temperatura Interna" (abrigo do sensor) descartada; apenas TempAr mantida.
5. Fator CO: 1145.6 reconciliado (CO_ppm em 2025.2 convertido para ug/m3).
6. Gaps de estações mantidos como None (sem imputação IDW no alvo Y).
7. Flags válidas ("", " ", "VU", "VR", "VI", "VC") e descarte de sentinelas (-9999, 99999, "!").
"""

import csv
import io
import math
import os
import unittest
import zipfile
from datetime import datetime, timezone

from ml.training.fetch_iema_insitu import (
    CANONICAL_STATIONS,
    CO_PPM_TO_UGM3,
    IEMA_STATION_MAP,
    excel_serial_to_utc_iso,
    iso_brt_to_utc_iso,
    is_valid_flag,
    normalize_station_name,
    parse_iema_xlsx,
)


def parse_iema_csv_sample(csv_path: str) -> list:
    """Lê CSV de amostra salvo em docs/research/amostras/ e normaliza medições (código de teste)."""
    records = []
    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            st_name = row.get("station_iema") or row.get("estacao") or ""
            st_id = normalize_station_name(st_name)
            if not st_id:
                continue

            ts_raw = row.get("timestamp") or row.get("timestamp_iso_brt") or ""
            if not ts_raw:
                continue
            ts_utc = iso_brt_to_utc_iso(ts_raw)

            def _clean(val_k: str, flag_k: str = None):
                if flag_k and not is_valid_flag(row.get(flag_k)):
                    return None
                val = row.get(val_k)
                if val is None or val == "":
                    return None
                try:
                    num = float(val)
                    if not math.isfinite(num) or num < 0 or num in (99999, 9999, -9999):
                        return None
                    return num
                except ValueError:
                    return None

            co_val = _clean("CO_ugm3", "Flag_CO")
            if co_val is None:
                co_ppm = _clean("CO_ppm", "Flag_CO")
                if co_ppm is not None:
                    co_val = round(co_ppm * CO_PPM_TO_UGM3, 3)

            vel_ms = _clean("VelVento_ms")
            rec = {
                "station_id": st_id,
                "timestamp_utc": ts_utc,
                "pm25": _clean("PM25_ugm3", "Flag_PM25"),
                "pm10": _clean("PM10_ugm3", "Flag_PM10"),
                "o3": _clean("O3_ugm3", "Flag_O3"),
                "no2": _clean("NO2_ugm3", "Flag_NO2"),
                "so2": _clean("SO2_ugm3", "Flag_SO2"),
                "co": co_val,
                "temperature_2m": _clean("TempAr_C"),
                "relative_humidity_2m": _clean("RH_pct"),
                "wind_speed_10m": round(vel_ms * 3.6, 2) if vel_ms is not None else None,
                "wind_direction_10m": _clean("DirVento_deg"),
                "pressure_msl": _clean("Press_Ar"),
                "shortwave_radiation": _clean("Radiação"),
            }
            records.append(rec)
    return records


def _build_minimal_xlsx(sheet_xml: str, shared_strings_xml: str = None) -> bytes:
    """Helper que monta um arquivo .xlsx mínimo em memória para testes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            + (
                '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
                if shared_strings_xml
                else ""
            )
            + "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>'
            "</workbook>",
        )
        zf.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            + (
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
                if shared_strings_xml
                else ""
            )
            + "</Relationships>",
        )
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        if shared_strings_xml:
            zf.writestr("xl/sharedStrings.xml", shared_strings_xml)
    return buf.getvalue()


class TestFetchIemaInsitu(unittest.TestCase):
    def test_co_factor_reconciliation(self):
        """Verifica que o fator físico e empírico é 1145.6 (única constante no módulo)."""
        self.assertAlmostEqual(CO_PPM_TO_UGM3, 1145.6, places=1)
        # Teste empírico: 0.113 ppm * 1145.6 ≈ 129.45 ug/m3 (na amostra 2025.1 é 129.49)
        ugm3 = 0.113 * CO_PPM_TO_UGM3
        self.assertAlmostEqual(ugm3, 129.45, delta=0.5)

    def test_timestamp_conversions(self):
        """Verifica conversão de serial float :30 (Legado) e ISO local :00 (Novo) para UTC."""
        # Legado: 45292.8125 -> 2024-01-01 19:30 BRT -> truncado para 19:00 BRT -> +3h UTC = 22:00
        utc_legado = excel_serial_to_utc_iso(45292.8125)
        self.assertEqual(utc_legado, "2024-01-01T22:00")

        # Novo: 2026-09-30 18:00:00 BRT -> +3h UTC = 2026-09-30T21:00
        utc_novo = iso_brt_to_utc_iso("2026-09-30 18:00:00")
        self.assertEqual(utc_novo, "2026-09-30T21:00")

    def test_valid_flags_and_sentinels(self):
        """Verifica flags aceitas e sentinelas descartadas."""
        self.assertTrue(is_valid_flag(""))
        self.assertTrue(is_valid_flag(" "))
        self.assertTrue(is_valid_flag("VU"))
        self.assertTrue(is_valid_flag("VR"))
        self.assertTrue(is_valid_flag("VI"))
        self.assertTrue(is_valid_flag("VC"))

        self.assertFalse(is_valid_flag("!"))
        self.assertFalse(is_valid_flag("IU"))
        self.assertFalse(is_valid_flag("IT"))
        self.assertFalse(is_valid_flag("ID"))
        self.assertFalse(is_valid_flag("IF"))

    def test_station_mapping(self):
        """Verifica o mapeamento explícito das 10 estações das planilhas IEMA (R3)."""
        # 6 estações físicas mapeadas para o contrato canônico
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV1 - Laranjeiras"], "ramqar_serra_laranjeiras")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV1 (Laranjeiras)"], "ramqar_serra_laranjeiras")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV3 - Jardim Camburi"], "ramqar_camburi")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV4 - Enseada do Sua"], "ramqar_enseada_sua")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV5 - Vitória-Centro"], "ramqar_vitoria_centro")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV6 - Vila Velha-IBES"], "ramqar_ibes")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV8 - Vila Capixaba"], "ramqar_cariacica")
        self.assertEqual(IEMA_STATION_MAP["EMQAr - RGV9 - Cidade Continental"], "ramqar_serra_jacupemba")

        # 4 estações descartadas explicitamente com None (fora do seed.sql ou inativas)
        self.assertIsNone(IEMA_STATION_MAP["EMQAr - RGV2 - Carapina"])
        self.assertIsNone(IEMA_STATION_MAP["EMQAr - RGV2 (Carapina)"])
        self.assertIsNone(IEMA_STATION_MAP["EMQAr - RGV7 - Vila Velha-Centro"])
        self.assertIsNone(IEMA_STATION_MAP["EMQAr - RGV7 (Vila Velha-Centro)"])
        self.assertIsNone(IEMA_STATION_MAP["EMQAr - RGV10 - Ponta Formosa"])
        self.assertIsNone(IEMA_STATION_MAP["EMQAr - RGV10 (Ponta Formosa)"])

        # Todas as estações não-nulas mapeadas devem pertencer ao contrato canônico
        for st_key, mapped_id in IEMA_STATION_MAP.items():
            if mapped_id is not None:
                self.assertIn(mapped_id, CANONICAL_STATIONS)

        # Normalização com retorno de descarte e validação
        self.assertEqual(normalize_station_name("EMQAr - RGV1 - Laranjeiras"), "ramqar_serra_laranjeiras")
        self.assertIsNone(normalize_station_name("EMQAr - RGV2 - Carapina"))
        self.assertIsNone(normalize_station_name("EMQAr - RGV10 (Ponta Formosa)"))
        self.assertIsNone(normalize_station_name("Estação Desconhecida Qualquer"))

    def test_parse_sample_csv_files(self):
        """Lê os CSVs de amostra reais salvos em docs/research/amostras/ com assert explícito."""
        csv_2026 = "docs/research/amostras/iema_ramqar_2026_horaria_sample.csv"
        self.assertTrue(os.path.exists(csv_2026), f"Amostra CSV {csv_2026} é obrigatória")
        records = parse_iema_csv_sample(csv_2026)
        self.assertGreater(len(records), 0)
        # RGV4 Enseada do Suá às 18h BRT de 2026-09-30 -> UTC 21:00
        rgv4_rec = next(
            (r for r in records if r["station_id"] == "ramqar_enseada_sua" and r["timestamp_utc"] == "2026-09-30T21:00"),
            None,
        )
        self.assertIsNotNone(rgv4_rec)
        self.assertAlmostEqual(rgv4_rec["pm25"], 8.08, delta=0.01)
        self.assertAlmostEqual(rgv4_rec["pm10"], 56.12, delta=0.01)
        self.assertAlmostEqual(rgv4_rec["o3"], 1.59, delta=0.01)
        self.assertAlmostEqual(rgv4_rec["temperature_2m"], 27.89, delta=0.01)

        # RGV8 em 2026 tem PM25 sentinela -9999 -> deve ser None (sem IDW!)
        rgv8_rec = next(
            (r for r in records if r["station_id"] == "ramqar_cariacica" and r["timestamp_utc"] == "2026-09-30T21:00"),
            None,
        )
        self.assertIsNotNone(rgv8_rec)
        self.assertIsNone(rgv8_rec["pm25"])
        self.assertIsNone(rgv8_rec["pm10"])
        self.assertAlmostEqual(rgv8_rec["o3"], 12.50, delta=0.01)

        # RGV9 em 2026 não tem meteo -> temperature_2m deve ser None
        rgv9_rec = next(
            (r for r in records if r["station_id"] == "ramqar_serra_jacupemba" and r["timestamp_utc"] == "2026-09-30T21:00"),
            None,
        )
        self.assertIsNotNone(rgv9_rec)
        self.assertIsNone(rgv9_rec["temperature_2m"])
        self.assertAlmostEqual(rgv9_rec["pm25"], 3.50, delta=0.01)

    def test_parse_xlsx_novo_inlinestr(self):
        """Simula XLSX no Layout Novo (3 cabeçalhos, inlineStr, ISO BRT, TempAr vs TempInterna, CO_ppm)."""
        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            # Linha 1: Título / metadados
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Relatório Horário</t></is></c></row>'
            # Linha 2: Estações (repetidas nas colunas)
            '<row r="2">'
            '<c r="A2" t="inlineStr"><is><t>DataHora</t></is></c>'
            '<c r="B2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="C2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="D2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="E2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="F2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="G2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="H2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="I2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            "</row>"
            # Linha 3: Parâmetros e Status
            '<row r="3">'
            '<c r="A3" t="inlineStr"><is><t>Data</t></is></c>'
            '<c r="B3" t="inlineStr"><is><t>PM25 (ug/m3)</t></is></c>'
            '<c r="C3" t="inlineStr"><is><t>Status PM25</t></is></c>'
            '<c r="D3" t="inlineStr"><is><t>Temperatura Interna (C°)</t></is></c>'
            '<c r="E3" t="inlineStr"><is><t>Status TempInt</t></is></c>'
            '<c r="F3" t="inlineStr"><is><t>TempAr (C°)</t></is></c>'
            '<c r="G3" t="inlineStr"><is><t>Status TempAr</t></is></c>'
            '<c r="H3" t="inlineStr"><is><t>CO_ppm (ppm)</t></is></c>'
            '<c r="I3" t="inlineStr"><is><t>Status CO</t></is></c>'
            "</row>"
            # Linha 4: Dados horários
            '<row r="4">'
            '<c r="A4" t="inlineStr"><is><t>2025-12-14 15:00:00</t></is></c>'
            '<c r="B4"><v>13.511</v></c>'
            '<c r="C4" t="inlineStr"><is><t>VI</t></is></c>'
            '<c r="D4"><v>35.0</v></c>'  # Temperatura interna de abrigo (deve ser ignorada!)
            '<c r="E4" t="inlineStr"><is><t>VI</t></is></c>'
            '<c r="F4"><v>27.934</v></c>'  # TempAr real
            '<c r="G4" t="inlineStr"><is><t>VI</t></is></c>'
            '<c r="H4"><v>0.11167</v></c>'  # CO em ppm
            '<c r="I4" t="inlineStr"><is><t>VU</t></is></c>'
            "</row>"
            # Linha 5: Dados com sentinela de erro (-9999 e flag "!")
            '<row r="5">'
            '<c r="A5" t="inlineStr"><is><t>2025-12-14 16:00:00</t></is></c>'
            '<c r="B5"><v>-9999</v></c>'
            '<c r="C5" t="inlineStr"><is><t>!</t></is></c>'
            '<c r="D5"><v>35.0</v></c>'
            '<c r="E5" t="inlineStr"><is><t>VI</t></is></c>'
            '<c r="F5"><v>27.163</v></c>'
            '<c r="G5" t="inlineStr"><is><t>VI</t></is></c>'
            '<c r="H5"><v>-9999</v></c>'
            '<c r="I5" t="inlineStr"><is><t>!</t></is></c>'
            "</row>"
            "</sheetData>"
            "</worksheet>"
        )
        xlsx_bytes = _build_minimal_xlsx(sheet_xml)
        records = parse_iema_xlsx(xlsx_bytes)
        self.assertEqual(len(records), 2)

        rec1 = records[0]
        self.assertEqual(rec1["station_id"], "ramqar_enseada_sua")
        self.assertEqual(rec1["timestamp_utc"], "2025-12-14T18:00")
        self.assertAlmostEqual(rec1["pm25"], 13.511, places=3)
        self.assertAlmostEqual(rec1["temperature_2m"], 27.934, places=3)
        # CO convertido com fator 1145.6
        self.assertAlmostEqual(rec1["co"], 0.11167 * 1145.6, places=1)

        rec2 = records[1]
        self.assertEqual(rec2["station_id"], "ramqar_enseada_sua")
        self.assertEqual(rec2["timestamp_utc"], "2025-12-14T19:00")
        self.assertIsNone(rec2["pm25"])  # Sentinela -9999 descartada!
        self.assertIsNone(rec2["co"])  # Sentinela descartada!
        self.assertAlmostEqual(rec2["temperature_2m"], 27.163, places=3)

    def test_parse_xlsx_legado_sharedstrings(self):
        """Simula XLSX no Layout Legado (8 cabeçalhos, sharedStrings.xml, float serial :30)."""
        shared_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="10">'
            "<si><t>Data</t></si>"  # 0
            "<si><t>EMQAr - RGV1 (Laranjeiras)</t></si>"  # 1
            "<si><t>Partículas Respiráveis (&lt;2,5µm)</t></si>"  # 2
            "<si><t>Valor [µg/m³]</t></si>"  # 3
            "<si><t>Flag</t></si>"  # 4
            "<si><t>VU</t></si>"  # 5
            "<si><t>IF</t></si>"  # 6
            "<si><t>Temperatura</t></si>"  # 7
            "<si><t>Valor [°C]</t></si>"  # 8
            "<si><t>Monóxido de Carbono</t></si>"  # 9
            "</sst>"
        )
        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            '<row r="1"><c r="A1"><v>1</v></c></row>'
            '<row r="2">'
            '<c r="A2" t="s"><v>0</v></c>'
            '<c r="B2" t="s"><v>1</v></c>'
            '<c r="C2" t="s"><v>1</v></c>'
            '<c r="D2" t="s"><v>1</v></c>'
            '<c r="E2" t="s"><v>1</v></c>'
            "</row>"
            '<row r="3"/><row r="4"/>'
            '<row r="5">'
            '<c r="A5"><v>0</v></c>'
            '<c r="B5" t="s"><v>2</v></c>'
            # Na planilha legado real, a coluna C (flag) não repete o nome do parâmetro na linha 5
            '<c r="D5" t="s"><v>7</v></c>'
            # A coluna E (flag) também é vazia na linha 5
            "</row>"
            '<row r="6"/><row r="7"/>'
            '<row r="8">'
            '<c r="A8"><v>0</v></c>'
            '<c r="B8" t="s"><v>3</v></c>'  # Valor [µg/m³]
            '<c r="C8" t="s"><v>4</v></c>'  # Flag
            '<c r="D8" t="s"><v>8</v></c>'  # Valor [°C]
            '<c r="E8" t="s"><v>4</v></c>'  # Flag
            "</row>"
            # Linha 9: Dados com serial float 45292.8125 (:30) -> deve truncar para :00 e somar +3h
            '<row r="9">'
            '<c r="A9"><v>45292.8125</v></c>'
            '<c r="B9"><v>2.9</v></c>'
            '<c r="C9" t="s"><v>5</v></c>'  # Flag VU
            '<c r="D9"><v>23.7</v></c>'
            '<c r="E9" t="s"><v>5</v></c>'  # Flag VU
            "</row>"
            # Linha 10: Dados com flag inválida "IF"
            '<row r="10">'
            '<c r="A10"><v>45292.85416666667</v></c>'  # 20:30 BRT -> 23:00 UTC
            '<c r="B10"><v>99999</v></c>'  # Sentinela 99999
            '<c r="C10" t="s"><v>6</v></c>'  # Flag IF
            '<c r="D10"><v>23.5</v></c>'
            '<c r="E10" t="s"><v>5</v></c>'  # Flag VU
            "</row>"
            "</sheetData>"
            "</worksheet>"
        )
        xlsx_bytes = _build_minimal_xlsx(sheet_xml, shared_strings_xml=shared_xml)
        records = parse_iema_xlsx(xlsx_bytes)
        self.assertEqual(len(records), 2)

        rec1 = records[0]
        self.assertEqual(rec1["station_id"], "ramqar_serra_laranjeiras")
        self.assertEqual(rec1["timestamp_utc"], "2024-01-01T22:00")
        self.assertAlmostEqual(rec1["pm25"], 2.9, places=2)
        self.assertAlmostEqual(rec1["temperature_2m"], 23.7, places=2)

        rec2 = records[1]
        self.assertEqual(rec2["station_id"], "ramqar_serra_laranjeiras")
        self.assertEqual(rec2["timestamp_utc"], "2024-01-01T23:00")
        self.assertIsNone(rec2["pm25"])  # Descartado (sentinela 99999 e flag IF)
        self.assertAlmostEqual(rec2["temperature_2m"], 23.5, places=2)

    def test_bloqueante_c1_unmapped_block_in_middle_not_inherited(self):
        """
        BLOQUEANTE C1:
        Verifica que um bloco não-mapeado ou descartado no meio da planilha (ex.: RGV10 ou RGV7)
        NÃO é atribuído à estação anterior (herança por last-station) e NÃO sobrescreve medições.
        Layout: Col B/C (RGV1) -> Col D/E (RGV10 - Ponta Formosa) -> Col F/G (RGV3 - Camburi).
        """
        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Relatório</t></is></c></row>'
            '<row r="2">'
            '<c r="A2" t="inlineStr"><is><t>DataHora</t></is></c>'
            '<c r="B2" t="inlineStr"><is><t>EMQAr - RGV1 - Laranjeiras</t></is></c>'
            '<c r="C2" t="inlineStr"><is><t>EMQAr - RGV1 - Laranjeiras</t></is></c>'
            '<c r="D2" t="inlineStr"><is><t>EMQAr - RGV10 - Ponta Formosa</t></is></c>'
            '<c r="E2" t="inlineStr"><is><t>EMQAr - RGV10 - Ponta Formosa</t></is></c>'
            '<c r="F2" t="inlineStr"><is><t>EMQAr - RGV3 - Jardim Camburi</t></is></c>'
            '<c r="G2" t="inlineStr"><is><t>EMQAr - RGV3 - Jardim Camburi</t></is></c>'
            "</row>"
            '<row r="3">'
            '<c r="A3" t="inlineStr"><is><t>Data</t></is></c>'
            '<c r="B3" t="inlineStr"><is><t>PM25 (ug/m3)</t></is></c>'
            '<c r="C3" t="inlineStr"><is><t>Status PM25</t></is></c>'
            '<c r="D3" t="inlineStr"><is><t>PM25 (ug/m3)</t></is></c>'
            '<c r="E3" t="inlineStr"><is><t>Status PM25</t></is></c>'
            '<c r="F3" t="inlineStr"><is><t>PM25 (ug/m3)</t></is></c>'
            '<c r="G3" t="inlineStr"><is><t>Status PM25</t></is></c>'
            "</row>"
            '<row r="4">'
            '<c r="A4" t="inlineStr"><is><t>2026-09-30 18:00:00</t></is></c>'
            '<c r="B4"><v>15.5</v></c>'
            '<c r="C4" t="inlineStr"><is><t>VU</t></is></c>'
            '<c r="D4"><v>8.8</v></c>'   # RGV10 tem 8.8 (NÃO pode sobrescrever Laranjeiras 15.5!)
            '<c r="E4" t="inlineStr"><is><t>VU</t></is></c>'
            '<c r="F4"><v>22.0</v></c>'  # Camburi tem 22.0
            '<c r="G4" t="inlineStr"><is><t>VU</t></is></c>'
            "</row>"
            "</sheetData>"
            "</worksheet>"
        )
        records = parse_iema_xlsx(_build_minimal_xlsx(sheet_xml))
        st_ids = {r["station_id"] for r in records}

        # RGV10 foi descartada (None), apenas RGV1 e RGV3 devem existir
        self.assertIn("ramqar_serra_laranjeiras", st_ids)
        self.assertIn("ramqar_camburi", st_ids)
        self.assertNotIn("ramqar_carapina", st_ids)
        self.assertNotIn("EMQAr - RGV10 - Ponta Formosa", st_ids)

        # Laranjeiras DEVE ter 15.5 e NUNCA 8.8 de Ponta Formosa
        rec_rgv1 = next(r for r in records if r["station_id"] == "ramqar_serra_laranjeiras")
        self.assertAlmostEqual(rec_rgv1["pm25"], 15.5, places=2)

        # Camburi DEVE ter 22.0
        rec_rgv3 = next(r for r in records if r["station_id"] == "ramqar_camburi")
        self.assertAlmostEqual(rec_rgv3["pm25"], 22.0, places=2)

    def test_bloqueante_c2_legacy_flag_invalidation_discards_measurement(self):
        """
        BLOQUEANTE C2:
        No layout legado, a coluna de flag (linha 8 == 'Flag') não tem o nome do parâmetro na linha 5.
        O parser deve herdar o parâmetro da coluna de valor à esquerda e DESCARTAR a medição
        quando a flag for inválida ('IF', 'IU', 'IT', etc.).
        """
        shared_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="10">'
            "<si><t>Data</t></si>"  # 0
            "<si><t>EMQAr - RGV1 (Laranjeiras)</t></si>"  # 1
            "<si><t>Partículas Respiráveis (&lt;2,5µm)</t></si>"  # 2
            "<si><t>Valor [µg/m³]</t></si>"  # 3
            "<si><t>Flag</t></si>"  # 4
            "<si><t>VU</t></si>"  # 5
            "<si><t>IT</t></si>"  # 6 - Flag de teste inválida
            "</sst>"
        )
        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            '<row r="1"><c r="A1"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>1</v></c></row>'
            '<row r="3"/><row r="4"/>'
            '<row r="5"><c r="A5"><v>0</v></c><c r="B5" t="s"><v>2</v></c></row>'  # Col C vazio na linha 5!
            '<row r="6"/><row r="7"/>'
            '<row r="8"><c r="A8"><v>0</v></c><c r="B8" t="s"><v>3</v></c><c r="C8" t="s"><v>4</v></c></row>'
            # Linha 9: Medição válida com Flag VU
            '<row r="9"><c r="A9"><v>45292.8125</v></c><c r="B9"><v>14.2</v></c><c r="C9" t="s"><v>5</v></c></row>'
            # Linha 10: Medição INVÁLIDA com Flag IT
            '<row r="10"><c r="A10"><v>45292.85416666667</v></c><c r="B10"><v>85.0</v></c><c r="C10" t="s"><v>6</v></c></row>'
            "</sheetData>"
            "</worksheet>"
        )
        records = parse_iema_xlsx(_build_minimal_xlsx(sheet_xml, shared_strings_xml=shared_xml))
        self.assertEqual(len(records), 2)
        # Linha válida: retém 14.2
        self.assertAlmostEqual(records[0]["pm25"], 14.2, places=1)
        # Linha com flag IT: descartada (None)
        self.assertIsNone(records[1]["pm25"])

    def test_required_r4_wind_speed_unit_conversion_kmh(self):
        """
        REQUIRED R4:
        Planilhas IEMA gravam velocidade do vento em m/s.
        O parser deve converter para km/h (* 3.6), compatível com row_to_features que faz / 3.6.
        """
        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Relatório</t></is></c></row>'
            '<row r="2">'
            '<c r="A2" t="inlineStr"><is><t>DataHora</t></is></c>'
            '<c r="B2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="C2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            "</row>"
            '<row r="3">'
            '<c r="A3" t="inlineStr"><is><t>Data</t></is></c>'
            '<c r="B3" t="inlineStr"><is><t>VelVento (m/s)</t></is></c>'
            '<c r="C3" t="inlineStr"><is><t>Status VelVento</t></is></c>'
            "</row>"
            '<row r="4">'
            '<c r="A4" t="inlineStr"><is><t>2026-09-30 18:00:00</t></is></c>'
            '<c r="B4"><v>2.5</v></c>'  # 2.5 m/s * 3.6 = 9.0 km/h
            '<c r="C4" t="inlineStr"><is><t>VU</t></is></c>'
            "</row>"
            "</sheetData>"
            "</worksheet>"
        )
        records = parse_iema_xlsx(_build_minimal_xlsx(sheet_xml))
        self.assertEqual(len(records), 1)
        # Assert de unidade: 2.5 m/s -> 9.0 km/h
        self.assertAlmostEqual(records[0]["wind_speed_10m"], 9.0, places=2)

    def test_required_f1_dual_value_column_flag_pairing_discards_invalid(self):
        """
        REQUIRED F1:
        Quando (estação, parâmetro) possui DUAS colunas de valor (ex.: sensor primário e redundante):
        Col B (valor: 36.3 m/s = 130.8 km/h), Col C (flag: 'IT' inválida)
        Col D (valor: ''), Col E (flag: '' vazia)
        A flag vazia da Col E NÃO pode sobrescrever a flag da Col B e liberar o valor inválido de 130.8.
        O valor da Col B deve ser descartado com base na sua flag própria (Col C).
        """
        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Relatório</t></is></c></row>'
            '<row r="2">'
            '<c r="A2" t="inlineStr"><is><t>DataHora</t></is></c>'
            '<c r="B2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="C2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="D2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            '<c r="E2" t="inlineStr"><is><t>EMQAr - RGV4 - Enseada do Sua</t></is></c>'
            "</row>"
            '<row r="3">'
            '<c r="A3" t="inlineStr"><is><t>Data</t></is></c>'
            '<c r="B3" t="inlineStr"><is><t>VelVento (m/s)</t></is></c>'
            '<c r="C3" t="inlineStr"><is><t>Status VelVento</t></is></c>'
            '<c r="D3" t="inlineStr"><is><t>VelVento (m/s)</t></is></c>'
            '<c r="E3" t="inlineStr"><is><t>Status VelVento</t></is></c>'
            "</row>"
            '<row r="4">'
            '<c r="A4" t="inlineStr"><is><t>2024-02-21 14:00:00</t></is></c>'
            '<c r="B4"><v>36.333</v></c>'  # 36.333 m/s * 3.6 ≈ 130.8 km/h com flag IT
            '<c r="C4" t="inlineStr"><is><t>IT</t></is></c>'
            '<c r="D4" t="inlineStr"><is><t></t></is></c>'  # Coluna redundante vazia
            '<c r="E4" t="inlineStr"><is><t></t></is></c>'  # Flag vazia que não pode liberar Col B
            "</row>"
            # Linha 5: Col B tem flag inválida 'IT', mas Col D tem valor VÁLIDO com flag 'VU'
            '<row r="5">'
            '<c r="A5" t="inlineStr"><is><t>2024-02-21 15:00:00</t></is></c>'
            '<c r="B5"><v>36.333</v></c>'  # Flag IT inválida
            '<c r="C5" t="inlineStr"><is><t>IT</t></is></c>'
            '<c r="D5"><v>5.0</v></c>'     # 5.0 m/s * 3.6 = 18.0 km/h com flag VU válida
            '<c r="E5" t="inlineStr"><is><t>VU</t></is></c>'
            "</row>"
            "</sheetData>"
            "</worksheet>"
        )
        records = parse_iema_xlsx(_build_minimal_xlsx(sheet_xml))
        self.assertEqual(len(records), 2)
        # Linha 4: valor com flag IT deve ser descartado (None), não aceitar 130.8 km/h!
        self.assertIsNone(records[0]["wind_speed_10m"], "Valor com flag IT não pode ser liberado por flag vazia da coluna redundante")
        # Linha 5: valor da coluna redundante válida deve ser aceito (18.0 km/h), descartando o valor inválido de Col B
        self.assertIsNotNone(records[1]["wind_speed_10m"])
        self.assertAlmostEqual(records[1]["wind_speed_10m"], 18.0, places=2)


if __name__ == "__main__":
    unittest.main()

