# AetherML — 01 Arquitetura do Sistema

## 1. Diagrama lógico (texto)

```
[Fontes] ──► [Workers Ingestion Cron] ──► [D1 + R2]
RAMQAr/IEMA, OpenAQ, Open-Meteo, INMET,
CETURB/TomTom/HERE, Sentinel-5P, MODIS MAIAC
                        │
                        ▼
              [Workers API + Cron Push]
              /api/stations /forecast /history
              /models /push/subscribe /evaluate
                        │ D1 (Drizzle) / R2 (.onnx + topology.json)
                        ▼
[Pages: Astro + Svelte5 + UnoCSS + Starlight + PWA]
  ├─ Service Worker (CacheFirst shell/modelos, NetworkFirst meteo, SWR telemetria)
  ├─ Web Worker inferência (ort.wasm SIMD-128 + SharedArrayBuffer)
  │    ├─ 5x TreeEnsembleRegressor (pm25, pm10, o3, no2, so2)
  │    ├─ IQAr calculator (CONAMA 491)
  │    └─ Saabas XAI O(K·D) → Waterfall + texto NL
  ├─ Simulator.svelte (contrafactual monotônico)
  └─ Geolocation + Haversine → estação + Push subscription
```

## 2. Decisões por camada

### 2.1 Inferência (cliente)
- **Primário**: WASM + SIMD-128 + threads (`SharedArrayBuffer` exige COOP/COEP headers no Pages).
- **Por que não WebGPU para LightGBM**: divergência SIMT (if-else por limiar), acesso esparso a nós, overhead WGSL >> inferência total. WebGPU reservado a futura CNN/GNN de AOD.
- **Budget**: modelo <1,5MB cada, 48h <2ms, XAI <1ms, memória <50MB, zero rede após cache.

### 2.2 Edge (Cloudflare)
- **Pages**: hospeda Astro SSG + headers COOP/COEP + PWA.
- **Workers API**: REST JSON + Cron `*/30 * * * *` ingestão, `0 * * * *` varredura push 6-24h, `0 6 * * 1` avaliação semanal.
- **D1**: 7 tabelas (ver `specs/03-modelo-dados.md` + `db/schema.sql`). Write-rate baixo: batch upsert horário.
- **R2**: `models/{version}/{target}.onnx` + `{target}.topology.json` + `manifest.json`. Público com hash.
- **Queues (opcional H-II)**: desacoplar ingestão → normalização → D1.

### 2.3 Frontend (Astro + Svelte 5)
- Astro para shell/docs (Starlight em `/docs`), Svelte 5 runes para reatividade fina (mapa, série 48h, waterfall, simulador).
- UnoCSS atômico. Leaflet/MapLibre para mapa RMGV + plumas (setas NNE/SSW).
- PWA: `astro-pwa` ou `vite-plugin-pwa`, manifest, ícones, offline fallback `/offline`.

### 2.4 Modelagem (LightGBM)
- 5 regressores independentes (pm25_24h, pm10_24h, o3_8h, no2_1h, so2_24h) + classificação por regra IQAr (não ML).
- Features (~25): meteo (temp, UR, vento u/v/dir/vel, PBLH, pressão, radiação), temporais cíclicas (hora/dia/semana sin-cos), tráfego (vel média, delay_ratio, índice por ponte), satélite (AOD, coluna NO2, UVAI), lag/rolling 24h.
- Monotonic constraints: `emissao/traffic/AOD +1`, `wind_speed/PBLH -1`.
- Export: `lightgbm → onnxmltools → onnx (opset ai.onnx.ml TreeEnsemble)` + quantização se >1,5MB.

## 3. Fluxos principais

**F1 Inferência online**: SW serve shell → Worker carrega `.onnx` do Cache/R2 → fetch `/api/forecast-features?station&h=48` (ou cache 6h) → infer 5 modelos → calcula IQAr → Saabas → render + log em D1 (fire-and-forget).

**F2 Offline**: tudo do Cache/IndexedDB, banner "dados de HH:MM", horizonte ajustado.

**F3 Push**: Cron Worker lê `prediction_logs` 6-24h → se IQAr≥81 → join `web_push_subscriptions` → Web Push criptografado (VAPID) → prescrição por faixa.

**F4 Simulador**: sliders → modifica features → re-inferência local instantânea (sem rede) → delta IQAr + texto físico.

**F5 Retreino**: Cron semanal compara `observed_pollutants` × `prediction_logs` → `weekly_evaluations` (MAE, accuracy IQAr, FAR, MER, drift PSI/KS) → se drift, flag `retrained=0` + artefato candidato.

## 4. Requisitos não-funcionais

- Latência p95 inferência <5ms (desktop) / <15ms (mobile), XAI <2ms
- Disponibilidade PWA offline total após 1º acesso
- Privacidade: geolocalização nunca sai do dispositivo (só `station_id` na subscription)
- Segurança: VAPID, validação Zod em todo input, COOP/COEP, CSP sem `unsafe-eval` (WASM streaming)
- Observabilidade: `prediction_logs` + `weekly_evaluations` + telemetria anônima (latência, backend usado)
