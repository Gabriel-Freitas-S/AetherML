# AetherML — 06 PWA e Operação Offline

## 1. Manifest + SW

- `manifest.webmanifest`: nome AetherML, display standalone, theme verde-azulado costeiro, ícones 192/512 maskable, `start_url: /`, `scope: /`.
- SW (`apps/web/src/service-worker.ts`, Workbox ou nativo):
  | Ativo | Estratégia | TTL | Offline |
  |---|---|---|---|
  | Shell HTML/JS/CSS (hash build) | CacheFirst | persistente até deploy | boot instantâneo |
  | `.onnx` + `topology.json` (SHA-256) | CacheFirst | imutável/versão | inferência zero-rede |
  | Open-Meteo (`forecast-features`) | NetworkFirst | 6h | usa último + ajusta horizonte + banner |
  | RAMQAr/D1 (`history`) | StaleWhileRevalidate | 1h | exibe último in-situ |
  | Map tiles | CacheFirst (limite 200) | 7d | mapa degradado mas navegável |

## 2. Headers Pages (`apps/web/public/_headers`)

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Content-Security-Policy: default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' https://api.* https://api.open-meteo.com https://*.r2.cloudflarestorage.com; img-src 'self' data: https://tile.*
```

## 3. UX offline

- Badge persistente `"Offline — dados de {HH:MM} · horizonte {N}h"`.
- Fila IndexedDB `pending_prediction_logs` sincronizada via Background Sync.
- Página `/offline` fallback; botão "tentar de novo".

## 4. Critérios de aceite H-I

- Lighthouse PWA 100, instalável Android/desktop.
- 2º acesso com rede desligada: mapa + última previsão + inferência local funcionam.
- Troca de modelo semanal invalida só o hash antigo (versionamento por URL).
