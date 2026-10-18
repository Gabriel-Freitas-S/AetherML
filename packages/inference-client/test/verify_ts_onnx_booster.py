#!/usr/bin/env python3
"""
packages/inference-client/test/verify_ts_onnx_booster.py
Verificação forte:
1. Executa o construtor TS (features.ts) via node para gerar os vetores de features reais.
2. Carrega os modelos ONNX (onnxruntime) e os boosters LightGBM (txt).
3. Executa a inferência com as MESMAS features e compara a predição de cada alvo.
4. Reporta a tolerância máxima atingida entre ONNX e LightGBM Booster.
"""

import json
import os
import subprocess
import sys
import numpy as np
import onnxruntime as ort
import lightgbm as lgb

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TARGETS = ["pm25", "pm10", "o3", "no2", "so2"]
MODEL_DIR = os.path.join(ROOT_DIR, "apps", "web", "public", "models")
BOOSTER_DIR = os.path.join(ROOT_DIR, "models", "v2026.38.5")

def get_ts_features():
    """Chama node para rodar o construtor TS e exportar os vetores de features."""
    fixture_path = os.path.join(
        ROOT_DIR, "packages", "inference-client", "test", "fixtures", "features_fixture.json"
    )
    features_ts_path = os.path.join(
        ROOT_DIR, "packages", "inference-client", "src", "features.ts"
    )

    node_script = f"""
    import fs from 'node:fs';
    import {{ buildRowFeatures }} from '{features_ts_path}';

    const fixture = JSON.parse(fs.readFileSync('{fixture_path}', 'utf-8'));
    const reg = JSON.parse(fs.readFileSync('{os.path.join(MODEL_DIR, "registry.json")}', 'utf-8'));
    const featureNames = reg.feature_names_v1;

    const out = [];
    for (const c of fixture.cases) {{
        if (c.order === 'v2') {{
            const feats = buildRowFeatures({{
                meteo: c.meteo,
                aq: c.aq,
                isoTs: c.iso_ts,
                lags: c.lags,
                flags: c.flags,
                order: 'v2',
                lags1: c.lags1,
                featureNames,
            }});
            out.push({{
                description: c.description,
                station_id: c.station_id,
                iso_ts: c.iso_ts,
                features: feats,
            }});
        }}
    }}
    console.log(JSON.stringify(out));
    """

    res = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(res.stdout)

def verify():
    print("=" * 70)
    print("VERIFICAÇÃO FORTE: TS Features -> ONNX Runtime vs LightGBM Booster")
    print("=" * 70)

    # 1. Carrega os modelos ONNX e Boosters
    onnx_sessions = {}
    lgb_boosters = {}
    for t in TARGETS:
        onnx_path = os.path.join(MODEL_DIR, f"{t}.onnx")
        txt_path = os.path.join(BOOSTER_DIR, f"{t}.txt")

        if not os.path.exists(onnx_path):
            raise FileNotFoundError(f"ONNX ausente: {onnx_path}")
        if not os.path.exists(txt_path):
            raise FileNotFoundError(f"Booster txt ausente: {txt_path}")

        onnx_sessions[t] = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        lgb_boosters[t] = lgb.Booster(model_file=txt_path)
        print(f"[{t}] Carregado: {os.path.basename(onnx_path)} e {os.path.basename(txt_path)}")

    # 2. Obtém features geradas pelo construtor TypeScript
    cases = get_ts_features()
    print(f"\nTotal de casos avaliados gerados pelo construtor TS: {len(cases)}\n")

    max_diff_overall = 0.0

    for idx, c in enumerate(cases):
        desc = c["description"]
        feats = np.array([c["features"]], dtype=np.float32)
        print(f"--- Caso {idx + 1}: {desc} ({c['station_id']} @ {c['iso_ts']}) ---")
        print(f"Shape features TS: {feats.shape} (30 features V2)")

        for t in TARGETS:
            # ONNX Runtime
            input_name = onnx_sessions[t].get_inputs()[0].name
            onnx_pred = float(np.squeeze(onnx_sessions[t].run(None, {input_name: feats})[0]))

            # LightGBM Booster
            lgb_pred = float(lgb_boosters[t].predict(feats)[0])

            diff = abs(onnx_pred - lgb_pred)
            max_diff_overall = max(max_diff_overall, diff)

            print(
                f"  Alvo {t:<5} | ONNX: {onnx_pred:8.4f} | LGB: {lgb_pred:8.4f} | "
                f"Diff: {diff:.2e} ({'OK' if diff < 1e-4 else 'WARN'})"
            )

    print("\n" + "=" * 70)
    print(f"TOLERÂNCIA MÁXIMA ATINGIDA (ONNX vs Booster): {max_diff_overall:.2e}")
    if max_diff_overall < 1e-4:
        print("STATUS: VERIFICAÇÃO CONCLUÍDA COM SUCESSO — Fidelidade TS -> ONNX comprovada.")
    else:
        print("STATUS: AVISO — Diferença acima de 1e-4 detectada.")
    print("=" * 70)

    assert max_diff_overall < 1e-4, f"Diferença máxima {max_diff_overall} excede tolerância de 1e-4"

if __name__ == "__main__":
    verify()
