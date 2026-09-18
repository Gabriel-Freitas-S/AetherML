---
name: wasm-inference
description: Implementa e depura a inferencia ONNX de 48h no Web Worker do AetherML com ort.wasm SIMD, contrato de mensagens e XAI Saabas.
---

# Inferência WASM (Web Worker)

Código: `apps/web/src/workers/inference.worker.ts` + `packages/inference-client`. Contrato: `specs/05-inferencia-xai.md`.

## Restrições duras
- Árvores LightGBM SEMPRE em `ort.wasm` com SIMD-128 + `SharedArrayBuffer`; exigir headers COOP/COEP (`specs/06`).
- 5 sessões (`pm25/pm10/o3/no2/so2`), entrada na ordem `FEATURE_ORDER_V1` (25). Reordenar = bump de versão.
- XAI via Saabas `O(K·D)` (<1ms). TreeSHAP proibido no cliente. WebGPU só p/ futura CNN AOD.
- Metas: 48h <2ms, XAI <1ms; modelos `.onnx` <1,5MB, SHA-256 verificado contra manifest.

## Protocolo de mensagens
- `init {manifestUrl}` → `ready {version, backend}` · `predict {stationId, featureNames, rows}` → `result {version, points[48], saabas, latencyMs}` · `simulate {deltas}` → `result` com delta · qualquer falha → `error {message}`.
- Versão ativa `vAAAA.SS.N` de `models/registry.json` (gerado por `ml/training/registry.py`).

## TDD
- Testar o Worker com `InferenceSession` mockada: contrato, ordem de features, latência reportada, fallback `wasm-simd → wasm`. Nunca exigir R2/GPU real em teste.
- Doc de API de `ort` sempre via skill `docs-fetch` antes de codar.
