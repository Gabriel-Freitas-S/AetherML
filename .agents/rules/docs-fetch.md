# Docs-fetch — nunca adivinhar API de lib (sem Context7)

Context7 foi removido do projeto: nunca sugerir `use context7`, `ctx7`, `resolve-library-id` ou `query-docs`.

## Regra
Para Astro, Svelte 5, UnoCSS, Starlight, `onnxruntime-web`, Wrangler, Workers/Pages/D1/R2: buscar a doc atual ANTES de codar. Treinamento do modelo ≠ API vigente.

## Roteamento
1. **Cloudflare-docs MCP** (plataforma): Workers, Pages, D1 (`wrangler d1 ...`), R2, Cron Triggers, Bindings, `web-push`/VAPID. Sempre primeiro p/ tudo `*.workers.dev`/`wrangler`.
2. **Subagente de pesquisa** (libs gerais: Astro/Svelte/ort): delegar ao tier adequado (`@flash-low` p/ dúvida pontual, `@flash-medium` p/ levantamento amplo) com a tarefa de inspecionar `node_modules/<lib>` + `pnpm-lock.yaml` (versão instalada) e trazer trechos da doc oficial via `webfetch`.
3. **Direto**: `webfetch` na doc oficial da lib ou `websearch` quando a versão instalada divergir do que o modelo conhece.

## Skill
- Skill `docs-fetch`: passo a passo versão-instalada → fonte → citar versão.
