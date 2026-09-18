# CodeGraph — usar antes de Read/Grep

## Quando
Quase toda pergunta estrutural ou edição: como X funciona, arquitetura, bug, onde/o que é X, levantamento de área, fluxo "como X chega a Y", ou leitura de arquivo/símbolo nomeável.

## Como (MCP `codegraph_explore` — equivale a Read)
- Query com pergunta em linguagem natural OU nomes de símbolos/arquivos (ex.: `mutateElement renderScene`, `inference.worker predict`).
- UMA chamada retorna fonte verbatim com linhas agrupada por arquivo + caminho de chamadas (inclui dispatch dinâmico que grep não segue) + blast-radius. Tratar o retorno como já lido — NÃO reabrir os mesmos arquivos.
- Precisou de mais? Chamar de novo com nomes mais específicos, não com loop grep+Read.

## Projetos sem índice
- Se a ferramenta disser que não há `.codegraph/` no projeto, parar de chamar codegraph ali na sessão e usar ferramentas built-in. Indexação é decisão do usuário — sugerir `codegraph init`, nunca rodar por conta própria.
- Monorepo: passar `projectPath` p/ o subprojeto indexado.

## Instalação (uma vez por máquina)
- MCP declarado em `opencode.json` (`mcp.codegraph`) e `.agents/mcp_config.json` (`codegraph`). Requer CLI `codegraph` no PATH.
