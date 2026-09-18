# AetherML — 05 Inferência WASM + XAI Saabas

## 1. Runtime (por que WASM SIMD)

- Artefato: `ai.onnx.ml:TreeEnsembleRegressor` (LightGBM via onnxmltools).
- WASM SIMD-128 + `SharedArrayBuffer` (multithread): exige headers Pages `_headers`: `COOP: same-origin`, `COEP: require-corp`.
- Config `ort`: `executionProviders:['wasm']`, `numThreads: min(4, hardwareConcurrency)`, `simd:true`.
- Budget: 5 modelos × 48 linhas <2ms total; fallback `wasm` single-thread se COOP/COEP ausente; WebGPU **nunca** para árvores (só futura CNN AOD via `navigator.gpu`).

## 2. Contrato do Web Worker (`apps/web/src/workers/inference.worker.ts`)

Mensagens:
```ts
// main → worker
{type:'init', manifestUrl:string}
{type:'predict', stationId:string, featureNames:string[], rows:number[][], meta?:object}
{type:'simulate', base:number[], deltas:Record<string,number>, featureNames:string[]}
// worker → main
{type:'ready', version:string, backend:'wasm-simd'|'wasm'}
{type:'result', version:string, points:PredictionPoint[], saabas:SaabasContribution[], latencyMs:number}
{type:'error', message:string}
```
```ts
type PredictionPoint = {hour:number; pm25:number; pm10:number; o3:number; no2:number; so2:number; iqar:number; classification:string; primary:string};
type SaabasContribution = {feature:string; phi:number}; // soma por hora 0 (hora corrente) + média 48h
```

Pipeline por `predict`: `ort.InferenceSession ×5` → array 48×5 → `core-iqar` → Saabas (topology.json) → post.

## 3. Saabas (Tree Interpreter)

- Por nó interno `v`: `Δ = ȳ_child − ȳ_v`; `Φ_f(x) = Σ_k Σ_{v∈P_k(x),split=f} Δ`; `ŷ = Φ_0 + Σ Φ_f`.
- Complexidade O(K·D) vs TreeSHAP O(K·L·D²) — único viável <1ms no Worker.
- `topology.json` gerado no treino: `{target, base_value:Φ_0, trees:[{nodes:[{id,feature,threshold,left,right,value}]}]}`.
- UI: Waterfall (base → +vento NNE → +PBLH baixa → +tráfego → predição) + frase NL por template:
  - `"Vento NNE de Tubarão: +{x} µg/m³ PM10 em Camburi"`, `"PBLH <220m: +{x}"`, `"Terceira Ponte: +{x} NO2 no Suá"`.

## 4. Feature order canônica (25 — v1)

```
temperature, relative_humidity, wind_speed, wind_direction,
wind_u, wind_v, boundary_layer_height, surface_pressure, solar_radiation,
hour_sin, hour_cos, dow_sin, dow_cos, is_weekend,
traffic_speed_avg, traffic_delay_ratio, traffic_congestion_index,
satellite_aod, satellite_tropomi_no2, satellite_uvai,
pm25_lag24, pm10_lag24, no2_lag24, o3_lag24, pblh_rolling6
```
Versões futuras só **acrescentam ao fim** (compatibilidade ONNX).

## 5. Testes TDD (primeiros)

- `core-iqar.test.ts`: interpolação em borda de faixa + max + primary (5 casos CONAMA).
- `haversine.test.ts`: Vitória↔Vila Velha ≈ 5-15km.
- `inference.worker.test.ts` (mock ort): shape 48×5, latência reportada.
- `saabas.test.ts`: aditividade `ŷ == Φ_0+ΣΦ` com árvore dummy.
