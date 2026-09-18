# AetherML — 05 Progressive Web App (PWA) e Resiliência Offline

A operação em campo por técnicos de controle ambiental (IEMA) ou o acesso por moradores em zonas portuárias e industriais sujeitas a instabilidade de rede exige funcionamento **100% offline-first**.

---

## 1. Estratégias Multinível de Cache no Service Worker

O Service Worker (`apps/web/src/service-worker.ts`) orquestra o ciclo de vida dos recursos em quatro políticas complementares:

| Tipo de Recurso | Estratégia de Cache | TTL / Validade | Comportamento Offline |
| :--- | :--- | :--- | :--- |
| **Modelos .onnx e .wasm** | `CacheFirst` | Imutável por SHA-256 | Carregamento imediato do ArrayBuffer; zero requisições externas. |
| **Shell HTML/JS/CSS** | `CacheFirst` | Hash de build (deploy) | Inicialização instantânea do Astro e Svelte 5 sem sinal de internet. |
| **Previsões e Features** | `NetworkFirst` | 6 horas | Chaveia para o último prognóstico armazenado ajustando o horizonte temporal. |
| **Tiles do Mapa Leaflet** | `CacheFirst` | 7 dias (teto 200 tiles) | Mapa navegável mesmo em modo avião nos perímetros visitados. |
| **Navegação Não Cacheada**| Fallback | — | Exibe `offline.html` com botão de reconexão sem travar o app. |

---

## 2. Isolamento de Origem: Headers COOP e COEP

O suporte a multithreading no WebAssembly via `SharedArrayBuffer` exige isolamento estrito contra ataques de canal lateral (Spectre/Meltdown). No Cloudflare Pages, esses cabeçalhos são fixados em `public/_headers`:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Com esses headers, o navegador permite que o ONNX Runtime Web utilize threads paralelas na CPU (`ort.env.wasm.numThreads`), acelerando a inferência de 48h para menos de 2ms.

---

## 3. Manifesto e Instalação PWA

O arquivo `manifest.webmanifest` define o AetherML como aplicativo nativo instalável:

- **Modo de Exibição**: `standalone` (sem barra de URL ou elementos de navegador).
- **Orientação**: Responsiva para mobile e desktop.
- **Cores do Tema**: Fundo `#090d16` e destaque ciano costeiro `#06b6d4`.
- **Ícones**: Adaptáveis e maskable nos formatos 192x192 e 512x512.
