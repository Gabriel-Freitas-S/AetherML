# Subagentes por dificuldade (flash 3.8)

Modelo base único: `gemini-3.8-flash` (GA, 1M ctx, `thinking_level` low/medium/high). Dificuldade = effort de reasoning + orçamento de passos + escopo de ferramentas.

## Tabela de roteamento

| Tier | Thinking | Quando usar | OpenCode (`.opencode/agents/`) | Antigravity (`.agents/agents/`) |
|---|---|---|---|---|
| `@flash-low` | low (rápido/barato) | Ajuste 1 arquivo, texto/UI, busca de docs, teste isolado | `steps: 8`, `temp: 0.1`, `bash: ask`, `task: deny` | `model: flash`, tools só-leitura + `replace_file_content`, `sandbox` |
| `@flash-medium` | medium (padrão) | Feature/correção multi-arquivo num subsistema, TDD completo | `steps: 20`, `temp: 0.3`, full tools | `model: flash`, full tools, `auto` |
| `@flash-high` | high (profundo) | Arquitetura, Worker/WASM, cross-cutting, debug complexo | `steps: 40`, `temp: 0.5`, full tools, pode delegar | `model: flash`, full tools, `auto`, pode delegar |

## Delegação
- OpenCode: `@flash-low ...` por menção, ou via Task pelo agente principal (`build`). Invocação entre tiers: só de cima p/ baixo (high→medium→low); `flash-low` com `task: deny` nunca delega.
- Antigravity: `invoke_subagent` com o `name` do tier; mesmos `name`/`description` nos dois mundos p/ roteamento idêntico.
- Regra de escala: atingir limite do tier (arquivos, escopo, protocolo) → parar, reportar e escalar, nunca estourar o orçamento em silêncio.

## Thinking level real (opcional, por máquina)
Os agents usam `model: google/gemini-3.8-flash` (troque `google/` pelo seu provider; confira com `opencode models`). O `thinking_level` efetivo vai no provider, ex.:

```json
{ "provider": { "google": { "models": { "gemini-3.8-flash": { "options": { "thinkingConfig": { "thinkingLevel": "medium" } } } } } } }
```

Sem esse bloco, os tiers já se diferenciam por `steps`/`temperature`/`permission` — verifique o nível efetivo nos logs de debug antes de assumir esforço real.
