# AetherML — 00 Visão Geral e Escopo

> Fonte normativa: `AetherML_Instrucoes_Arquitetura.md`
> Região: RMGV — Vitória, Vila Velha, Serra, Cariacica
> Padrão regulatório: CONAMA 491/2018 + diretrizes IEMA/ES (RAMQAr)

## 1. Objetivo

Plataforma inteligente e descentralizada para **previsão horária (horizonte 48h)** da qualidade do ar:

- Poluentes: `PM2.5`, `PM10`, `SO2`, `NO2` (1h), `O3` (média móvel 8h), `CO` (8h, observacional)
- Saída consolidada: **IQAr global = max(I_p)** por interpolação linear por faixa
- Inferência 100% **client-side** (WASM SIMD-128 + SharedArrayBuffer, <2ms/48h)
- Backend serverless apenas para ingestão, persistência, distribuição de modelos e push

## 2. Princípios arquiteturais

| # | Princípio | Decisão |
|---|-----------|---------|
| P1 | Inferência na borda do cliente | ONNX Runtime Web (`ort.wasm`) em Web Worker dedicado. Sem GPU para árvores |
| P2 | Custo zero de inferência | Cloudflare Pages + Workers + D1 + R2. Sem cluster de inferência |
| P3 | Offline-first | PWA + Service Worker + CacheStorage/IndexedDB |
| P4 | Multipoluente + física | O3/NO2 fotoquímica, titulação, advecção costeira, PBLH, tráfego contínuo, satélite |
| P5 | Explicabilidade local | Saabas O(K·D) no Worker, <1ms. TreeSHAP proibido no cliente |
| P6 | Coerência física | Restrições monotônicas LightGBM: emissão ≥0, PBLH/vento ≤0 |
| P7 | Tokens cirúrgicos | Nunca carregar pastas inteiras; TDD Red-Green-Refactor; biome/ruff em hooks |

## 3. Stakeholders e usos

- **População RMGV**: mapa, série 48h, alerta push, recomendação sanitária
- **Grupos de risco**: alerta Ruim+ (idosos, crianças, asmáticos, cardiopatas)
- **Defesa Civil / IEMA**: auditoria semanal, drift, falsos alarmes/eventos perdidos
- **Pesquisa**: simulador contrafactual (Tubarão, pontes, inversão, onda de calor)

## 4. Horizontes (resumo — detalhe em `08-pipeline-ml-roadmap.md`)

- **H-I (1-3m)**: PWA + WASM SIMD + Saabas + Waterfall Svelte 5
- **H-II (3-6m)**: O3/NO2 + tráfego contínuo + enquadramento multipoluente
- **H-III (6-12m)**: MODIS AOD + TROPOMI + monotonic constraints + Simulator + Push geoespacial

## 5. Definições críticas

- `I_p = I_ini + (I_fim - I_ini)/(C_fim - C_ini) * (C_p - C_ini)`
- `IQAr_global = max_p{I_p}`
- Haversine com R=6371km para estação mais próxima (9 estações RAMQAr)
- Modelos <1,5MB `.onnx`, hash SHA-256 imutável, versionados `vAAAA.SS.N`
