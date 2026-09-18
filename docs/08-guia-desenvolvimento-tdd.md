# AetherML — 08 Guia do Desenvolvedor e Fluxo TDD

O desenvolvimento do AetherML adota o padrão rigoroso de **Test-Driven Development (TDD: Red-Green-Refactor)** e regras estritas de preservação de contexto e otimização de tokens para engenharia assistida por IA.

---

## 1. Estrutura do Monorepo pnpm

```
AetherML/
├── apps/
│   └── web/                # Astro + Svelte 5 + UnoCSS (PWA Cloudflare Pages)
├── packages/
│   ├── core-iqar/          # Cálculo CONAMA 491 puro (zero I/O)
│   ├── geo/                # Haversine geodésico e estações RAMQAr
│   └── inference-client/   # Wrapper do Web Worker e DB-First Quota Guard
├── ml/
│   ├── training/           # Pipeline LightGBM, ONNX e Saabas XAI
│   └── evaluation/         # Auditoria semanal e drift
├── db/
│   ├── schema.sql          # DDL canônico D1 (7 tabelas)
│   ├── seed.sql            # 9 estações RAMQAr
│   └── schema.ts           # Drizzle ORM
├── docs/                   # Documentação técnica e guias regulatórios
└── public/models/          # Artefatos .onnx e topology.json ativos
```

---

## 2. Comandos Essenciais de Desenvolvimento

```bash
# Instalação de todas as dependências do monorepo
pnpm install

# Iniciar o servidor de desenvolvimento local da interface web
pnpm dev

# Executar a suíte de testes de todos os pacotes
pnpm -r test

# Compilar todos os pacotes e a aplicação estática
pnpm -r build

# Formatação e verificação estrita de linter (TypeScript / Svelte)
pnpm lint

# Aplicar migrações no banco local Cloudflare D1
pnpm db:migrate

# Executar o pipeline de Machine Learning (treino, ONNX e Saabas)
python -m ml.training.pipeline v2026.38.1
```

---

## 3. Ciclo TDD Red-Green-Refactor (Obrigatório)

Qualquer nova funcionalidade ou alteração de algoritmo no AetherML deve seguir o fluxo:

1. **Red**: Criar o teste unitário falhando primeiro (`test/**/*.test.ts` ou `tests/test_*.py`).
2. **Green**: Implementar a menor quantidade necessária de código para o teste passar.
3. **Refactor**: Otimizar a arquitetura preservando a integridade dos testes e rodando `biome check --write` e `ruff check --fix`.
