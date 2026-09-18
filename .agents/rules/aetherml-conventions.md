# Convenções AetherML (resumo executável)

Fonte normativa: `AetherML_Instrucoes_Arquitetura.md`. Specs: `specs/00..08`.

## Stack e pastas
- `apps/web` (Astro + Svelte 5 + UnoCSS + Starlight, PWA), `packages/core-iqar`, `packages/geo`, `packages/inference-client`, `workers/api`, `workers/ingestion`, `ml/training`, `db/`, `models/`.
- pnpm workspaces. Nunca `npm install` na raiz; respeitar `pnpm-workspace.yaml`.

## Domínio (não negociar sem spec)
- `monitoring_stations.id` = `ramqar_*`, 9 estações (`db/seed.sql`).
- IQAr CONAMA 491/2018: `I_p = I_ini + (I_fim-I_ini)/(C_fim-C_ini)*(C_p-C_ini)`, `IQAr_global = max_p{I_p}`. Implementação canônica: `packages/core-iqar/src/iqar.ts` (skill `iqar-conama`).
- `FEATURE_ORDER_V1` com 25 features em `db/schema.ts` — ordem imutável sem bump de versão do modelo.
- Haversine `R=6371km` em `packages/geo/src/geo.ts`.
- Versão de modelo `vAAAA.SS.N`; `.onnx` <1,5MB com SHA-256 no manifest.

## Restrições de inferência
- Árvores (LightGBM) SEMPRE via WASM SIMD-128 em Web Worker; TreeSHAP proibido no cliente (usar Saabas `O(K·D)`); WebGPU reservado à futura CNN AOD.
- Metas: inferência 48h <2ms, XAI <1ms; PWA offline-first (CacheFirst shell/modelos, NetworkFirst meteo 6h).

## Edição
- Cirúrgica: alterar só o range pedido, preservar o resto. `biome` (TS) / `ruff` (`ml/`) antes de cada entrega.
