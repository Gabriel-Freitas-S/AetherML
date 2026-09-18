# Index-freshness — manter CodeGraph e Graphify atualizados

Carregada via glob (OpenCode `instructions`, Antigravity `.agents/rules/`). Vale para sessões com ou sem git (o projeto hoje NÃO é git repo — hooks só valem se virar).

## Quando refrescar (batch no fim da tarefa, nunca a cada edição)
- Fim de tarefa que criou/deletou/renomeou arquivos, ou implementou stubs (`Simulator.svelte`, Workers).
- `codegraph status` acusar stale, ou query arquitetural importante após código ter mudado.
- NUNCA `codegraph uninit`, `graphify uninstall --purge`, nem rebuild full sem motivo.

## CodeGraph (incremental)
1. `codegraph sync` — sincroniza só o que mudou desde o último índice.
2. Lock travado → `codegraph unlock` e repete o `sync`.
3. Só se o `sync` corromper: `codegraph index` (full rebuild).

## Graphify (incremental, sem LLM)
1. `graphify check-update .` — checagem cron-safe da flag `needs_update`; nada pendente → parar.
2. Pendente → `graphify update .` (re-extrai só código, sem key).
3. Após refactor que DELETA código: `graphify update . --force` (sem `--force` o rebuild menor é rejeitado).
4. Docs `specs/*.md` NÃO entram no auto-refresh (exigem `GEMINI_API_KEY` + `graphify extract .` manual).

## Automação sem agente (opcional, manual)
- `graphify watch .` — processo foreground que rebuilda a cada mudança (não rodar em background pelo agente).
- Com git: `graphify hook install` (post-commit/post-checkout) + hook chamando `codegraph sync -q`.
