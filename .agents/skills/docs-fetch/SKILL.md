---
name: docs-fetch
description: Pesquisa documentacao vigente de bibliotecas e da Cloudflare sem Context7, via Cloudflare-docs MCP, subagente de pesquisa, node_modules e webfetch, citando a versao instalada.
---

# Docs-fetch (sem Context7)

Regra mãe: `.agents/rules/docs-fetch.md`. Context7 removido — nunca sugerir `use context7`, `ctx7` ou `resolve-library-id`.

## Passo a passo
1. **Versão instalada**: conferir `package.json` + `pnpm-lock.yaml`. A doc consultada deve ser dessa versão.
2. **Cloudflare** (Workers/Pages/D1/R2/Cron/Bindings/wrangler): MCP `cloudflare-docs` primeiro.
3. **Libs gerais** (Astro, Svelte 5, UnoCSS, `onnxruntime-web`): inspecionar `node_modules/<lib>` (tipos/README) e buscar a doc oficial com `webfetch`; tarefa ampla → delegar a subagente de pesquisa (`@flash-low` / `@flash-medium`) em vez de ler arquivos um a um.
4. **Entrega**: citar versão da lib + URL/fonte da doc usada. Repetir a busca se a versão divergir.
