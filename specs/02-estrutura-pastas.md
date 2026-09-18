# AetherML — 02 Estrutura de Pastas (Monorepo)

## 1. Árvore oficial

```
AetherML/
├── AetherML_Instrucoes_Arquitetura.md  # documento mestre (imutável)
├── specs/                              # este conjunto (contratos vivos)
│   ├── 00-visao-geral.md
│   ├── 01-arquitetura.md
│   ├── 02-estrutura-pastas.md          # este arquivo
│   ├── 03-modelo-dados.md
│   ├── 04-contratos-api.md
│   ├── 05-inferencia-xai.md
│   ├── 06-pwa-offline.md
│   ├── 07-alertas-simulador.md
│   └── 08-pipeline-ml-roadmap.md
├── docs/                               # Starlight (publicado em /docs via Astro)
├── apps/
│   └── web/                            # Astro + Svelte5 + UnoCSS + PWA (Cloudflare Pages)
│       ├── astro.config.mjs
│       ├── src/
│       │   ├── pages/                  # index, mapa, estacao/[id], simular, docs
│       │   ├── components/             # Map.svelte, ForecastChart.svelte, Waterfall.svelte, Simulator.svelte
│       │   ├── workers/                # inference.worker.ts (ort.wasm + Saabas + IQAr)
│       │   ├── lib/                    # iqar, geo, onnx-loader, db-client, push-client
│       │   └── service-worker.ts       # estratégias CacheFirst/NetworkFirst/SWR
│       └── public/                     # manifest.webmanifest, ícones, offline.html
├── workers/
│   ├── api/                            # Cloudflare Worker REST + Cron push (D1 + R2)
│   │   ├── wrangler.toml
│   │   └── src/index.ts
│   └── ingestion/                      # Cron ingestão RAMQAr/OpenAQ/Open-Meteo/INMET/satélite/tráfego
│       ├── wrangler.toml
│       └── src/index.ts
├── packages/
│   ├── core-iqar/src/                  # cálculo CONAMA 491 puro (testável, sem I/O)
│   ├── geo/src/                        # haversine + estações + tipos
│   ├── inference-client/src/           # loader ONNX + tipos de features + Saabas
│   └── ui/src/                         # componentes Svelte compartilhados
├── db/
│   ├── schema.sql                      # DDL canônico D1 (7 tabelas)
│   ├── seed.sql                        # 9 estações RAMQAr
│   ├── schema.ts                       # Drizzle ORM (espelho do SQL)
│   └── migrations/                     # 0001_init.sql, 0002_... (wrangler d1 migrations)
├── ml/
│   ├── training/                       # Python LightGBM → ONNX + topology.json
│   └── evaluation/                     # drift, métricas semanais
├── models/
│   └── registry.json                   # espelho local de model_registry
├── public/models/                      # cache local de .onnx p/ dev (git-lfs, nunca commit >1.5MB sem quantizar)
├── package.json                        # workspaces pnpm
└── pnpm-workspace.yaml
```

## 2. Convenções

- **Package manager**: pnpm + workspaces. `packages/*` sem dependência de `apps/*`.
- **Nomes**: `ramqar_<slug>` para `station.id` (ex: `ramqar_camburi`, `ramqar_ibes`).
- **Versão modelo**: `vAAAA.SS.N` (ex: `v2026.38.1`) — pasta R2 + PK `model_registry.version`.
- **Migrations**: `wrangler d1 migrations`; nunca editar `schema.sql` aplicado — criar `000N_*.sql`.
- **Regra de tokens**: editar apenas ranges de função; `biome check --write` (TS) e `ruff check --fix` (PY) antes de pedir IA; TDD com `*.test.ts` / `test_*.py`.

## 3. O que já foi scaffoldado neste commit

- `db/schema.sql`, `db/seed.sql`, `db/schema.ts`
- `packages/core-iqar`, `packages/geo` (implementação + tipos)
- `packages/inference-client` (tipos de features + loader)
- `apps/web/src/workers/inference.worker.ts` (esqueleto)
- `workers/api/src/index.ts` + `workers/ingestion/src/index.ts` (esqueletos)
- Root `package.json`, `pnpm-workspace.yaml`
