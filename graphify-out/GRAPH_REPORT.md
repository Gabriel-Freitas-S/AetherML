# Graph Report - AetherML  (2026-09-18)

## Corpus Check
- 152 files · ~7,105,408 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 642 nodes · 739 edges · 75 communities (65 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- scripts
- schema.ts
- command
- 0001_init.sql
- schema.sql
- calibrate.py
- inference.worker.ts
- dependencies
- AetherML — Sistema de Previsão de Qualidade do Ar da Grande Vitória (ES)
- inference-client/package.json
- api/src/index.ts
- ingestion/src/index.ts
- Dashboard.svelte
- graphify.js
- weather-cache.ts
- service-worker.ts
- location.ts
- 1. Endpoints
- core-iqar/package.json
- geo/package.json
- 2. Decisões por camada
- 1. Alertas proativos (Geolocation + Web Push)
- AetherML — AGENTS.md
- TDD AetherML
- AetherML — 00 Visão Geral e Escopo
- AetherML — 03 Modelo de Dados (D1 / SQLite)
- AetherML — 05 Inferência WASM + XAI Saabas
- Convenções AetherML (resumo executável)
- CodeGraph — usar antes de Read/Grep
- Index-freshness — manter CodeGraph e Graphify atualizados
- TDD — regra obrigatória AetherML
- AetherML — 02 Resolução CONAMA 491/2018 e Cálculo do IQAr
- AetherML — 04 Explicabilidade Algorítmica no Navegador (Saabas XAI)
- AetherML — 06 API REST, Schema D1 e Blindagem de Cota Open-Meteo (DB-First)
- AetherML — 06 PWA e Operação Offline
- AetherML — 08 Pipeline ML, Avaliação e Roadmap
- Docs-fetch — nunca adivinhar API de lib (sem Context7)
- Subagentes por dificuldade (flash 3.8)
- Cloudflare AetherML
- IQAr CONAMA 491/2018
- Inferência WASM (Web Worker)
- AetherML — 01 Visão Geral e Arquitetura do Sistema
- AetherML — 03 Pipeline de Machine Learning e Ordem Canônica de Features
- AetherML — 05 Progressive Web App (PWA) e Resiliência Offline
- AetherML — 08 Guia do Desenvolvedor e Fluxo TDD
- AetherML — RMGV Air Quality Forecasting
- AetherML — 02 Estrutura de Pastas (Monorepo)
- AetherML — 07 Vigilância Geoespacial e Alertas Push Proativos
- .opencode/opencode.json
- Docs-fetch (sem Context7)
- /tdd-feature
- flash-high/agent.md
- flash-low/agent.md
- flash-medium/agent.md
- rules/graphify.md
- workflows/graphify.md
- eval_holdout.py
- AetherML — 09 Dados Reais, Backtest e Precisão da IA
- fetch_openmeteo.py
- inference-client/src/index.ts
- Perguntas frequentes
- Leia o app em 2 minutos
- evaluate_weekly.py
- saude-por-faixa.md

## God Nodes (most connected - your core abstractions)
1. `row_to_features()` - 13 edges
2. `train_models()` - 10 edges
3. `1. Endpoints` - 10 edges
4. `AetherML — Sistema de Previsão de Qualidade do Ar da Grande Vitória (ES)` - 9 edges
5. `Perguntas frequentes` - 9 edges
6. `run_backtest()` - 7 edges
7. `build_synthetic_dataset()` - 7 edges
8. `export_to_onnx()` - 7 edges
9. `export_saabas_topologies()` - 7 edges
10. `command` - 7 edges

## Surprising Connections (you probably didn't know these)
- `predict()` --calls--> `globalIQAr()`  [EXTRACTED]
  apps/web/src/workers/inference.worker.ts → packages/core-iqar/src/iqar.ts
- `test_regression_metrics_known_values()` --calls--> `regression_metrics()`  [EXTRACTED]
  ml/evaluation/test_eval_holdout.py → ml/evaluation/eval_holdout.py
- `test_regression_metrics_perfect_prediction()` --calls--> `regression_metrics()`  [EXTRACTED]
  ml/evaluation/test_eval_holdout.py → ml/evaluation/eval_holdout.py
- `test_satellite_proxy_uses_lagged_values_not_current()` --calls--> `satellite_proxy()`  [EXTRACTED]
  ml/training/test_feature_mapping.py → ml/training/build_real_dataset.py
- `test_mapping_is_deterministic()` --calls--> `row_to_features()`  [EXTRACTED]
  ml/training/test_feature_mapping.py → ml/training/build_real_dataset.py

## Import Cycles
- None detected.

## Communities (75 total, 10 thin omitted)

### Community 0 - "scripts"
Cohesion: 0.10
Nodes (19): @biomejs/biome, devDependencies, @biomejs/biome, typescript, typescript, name, packageManager, private (+11 more)

### Community 1 - "schema.ts"
Cohesion: 0.20
Nodes (9): environmentalFeatures, FEATURE_ORDER_V1, FEATURE_ORDER_V2, modelRegistry, monitoringStations, observedPollutants, predictionLogs, webPushSubscriptions (+1 more)

### Community 2 - "command"
Cohesion: 0.08
Nodes (23): enabled, type, url, command, enabled, timeout, type, formatter (+15 more)

### Community 3 - "0001_init.sql"
Cohesion: 0.50
Nodes (7): environmental_features, model_registry, monitoring_stations, observed_pollutants, prediction_logs, web_push_subscriptions, weekly_evaluations

### Community 4 - "schema.sql"
Cohesion: 0.50
Nodes (7): environmental_features, model_registry, monitoring_stations, observed_pollutants, prediction_logs, web_push_subscriptions, weekly_evaluations

### Community 5 - "calibrate.py"
Cohesion: 0.07
Nodes (45): datetime, build_synthetic_dataset(), check_db_for_data(), generate_calibrated_row(), Any, ml/training/build_dataset.py — Gerador de Dataset Calibrado com DB-First Quota…, Gera o dataset de treino completo com histórico de 45 dias para as 9 estações., Consulta SQLite local / D1 para verificar se a semana/dia já possui registros… (+37 more)

### Community 6 - "inference.worker.ts"
Cohesion: 0.12
Nodes (20): computeSaabas(), init(), InitMsg, InMsg, predict(), PredictMsg, SaabasTopology, sessions (+12 more)

### Community 7 - "dependencies"
Cohesion: 0.06
Nodes (31): @aetherml/inference-client, dependencies, @aetherml/core-iqar, @aetherml/geo, @aetherml/inference-client, astro, @astrojs/svelte, leaflet (+23 more)

### Community 8 - "AetherML — Sistema de Previsão de Qualidade do Ar da Grande Vitória (ES)"
Cohesion: 0.08
Nodes (24): 2.1. Inclusão de Poluentes Fotoquímicos e Cálculo Rigoroso do IQAr (CONAMA 491/2018), 2.2. Sensoriamento Remoto Orbital e Caracterização Espacial de Plumas, 2.3. Telemetria Dinâmica de Tráfego e Mobilidade Metropolitana, 2\. Expansão do Espectro Preditivo: Fotoquímica, Sensoriamento Remoto e Mobilidade Urbana, 3.1. Análise Técnica: Por que WebAssembly SIMD é Superior ao WebGPU para Árvores LightGBM, 3.2. Arquitetura Progressive Web App (PWA) e Modos de Operação Offline, 3\. Otimização do Runtime de Inferência: WebAssembly SIMD vs. WebGPU e Resiliência PWA, 4.1. Decomposição Aditiva de Saabas (Tree Interpreter) vs. TreeSHAP (+16 more)

### Community 9 - "inference-client/package.json"
Cohesion: 0.11
Nodes (17): dependencies, @aetherml/core-iqar, @aetherml/geo, devDependencies, tsx, typescript, @aetherml/core-iqar, @aetherml/geo (+9 more)

### Community 10 - "api/src/index.ts"
Cohesion: 0.50
Nodes (3): Env, fetch(), json()

### Community 11 - "ingestion/src/index.ts"
Cohesion: 0.50
Nodes (3): Env, ingest(), scheduled()

### Community 12 - "Dashboard.svelte"
Cohesion: 0.08
Nodes (11): BASEMAP_LABELS, BASEMAP_STYLES, BasemapStyle, CARTO_API_KEY, DEFAULT_BASEMAP, tileUrl(), Guide, GUIDES (+3 more)

### Community 14 - "weather-cache.ts"
Cohesion: 0.23
Nodes (11): CacheCheckResult, calcWindComponents(), checkDayCache(), checkWeekCache(), EnvironmentalRecord, getWeatherDataWithQuotaGuard(), OpenMeteoHourly, OpenMeteoResponse (+3 more)

### Community 17 - "location.ts"
Cohesion: 0.18
Nodes (9): GpsResult, getStationCoords(), haversineKm(), nearestStation(), resolveActiveStation(), Station, StationResolutionReason, STATIONS (+1 more)

### Community 18 - "1. Endpoints"
Cohesion: 0.14
Nodes (13): 1. Endpoints, 2. Crons (wrangler.toml), 3. Regras, AetherML — 04 Contratos de API (Workers), DELETE /api/push/unsubscribe, GET /api/evaluations?week={AAAA-WSS}&station={id}, GET /api/forecast-features?station={id}&h={1..48}, GET /api/forecast?station={id}&h=48 (+5 more)

### Community 19 - "core-iqar/package.json"
Cohesion: 0.15
Nodes (12): devDependencies, tsx, typescript, tsx, typescript, main, name, scripts (+4 more)

### Community 20 - "geo/package.json"
Cohesion: 0.15
Nodes (12): devDependencies, tsx, typescript, tsx, typescript, main, name, scripts (+4 more)

### Community 21 - "2. Decisões por camada"
Cohesion: 0.20
Nodes (9): 1. Diagrama lógico (texto), 2.1 Inferência (cliente), 2.2 Edge (Cloudflare), 2.3 Frontend (Astro + Svelte 5), 2.4 Modelagem (LightGBM), 2. Decisões por camada, 3. Fluxos principais, 4. Requisitos não-funcionais (+1 more)

### Community 22 - "1. Alertas proativos (Geolocation + Web Push)"
Cohesion: 0.20
Nodes (9): 1.1 Associação de estação (cliente, nunca envia GPS), 1.2 Varredura serverless (Cron horário `workers/api`), 1.3 Prescrições CONAMA (payload → notificação), 1. Alertas proativos (Geolocation + Web Push), 2.1 Garantia física — restrições monotônicas (treino), 2.2 Cenários (sliders → deltas de features → re-inferência local), 2.3 Saída, 2. Simulador contrafactual (`Simulator.svelte`) (+1 more)

### Community 23 - "AetherML — AGENTS.md"
Cohesion: 0.25
Nodes (7): AetherML — AGENTS.md, Convenções AetherML, Roteamento de ferramentas (nesta ordem), Setup de skills/MCP (uma vez por máquina), Stack, Subagentes por dificuldade (`.opencode/agents/`, `.agents/agents/`), TDD (obrigatório)

### Community 24 - "TDD AetherML"
Cohesion: 0.29
Nodes (6): 1. Escopo (2 min), 2. Red, 3. Green, 4. Refactor + lint, 5. Entrega, TDD AetherML

### Community 25 - "AetherML — 00 Visão Geral e Escopo"
Cohesion: 0.29
Nodes (6): 1. Objetivo, 2. Princípios arquiteturais, 3. Stakeholders e usos, 4. Horizontes (resumo — detalhe em `08-pipeline-ml-roadmap.md`), 5. Definições críticas, AetherML — 00 Visão Geral e Escopo

### Community 26 - "AetherML — 03 Modelo de Dados (D1 / SQLite)"
Cohesion: 0.29
Nodes (6): 1. ER (resumo), 2. Tabelas e rationale, 3. Tabela CONAMA 491 (referência normativa — ver `packages/core-iqar`), 4. Índices e performance D1, 5. Seed — 9 estações RAMQAr (`db/seed.sql`), AetherML — 03 Modelo de Dados (D1 / SQLite)

### Community 27 - "AetherML — 05 Inferência WASM + XAI Saabas"
Cohesion: 0.29
Nodes (6): 1. Runtime (por que WASM SIMD), 2. Contrato do Web Worker (`apps/web/src/workers/inference.worker.ts`), 3. Saabas (Tree Interpreter), 4. Feature order canônica (25 — v1), 5. Testes TDD (primeiros), AetherML — 05 Inferência WASM + XAI Saabas

### Community 28 - "Convenções AetherML (resumo executável)"
Cohesion: 0.33
Nodes (5): Convenções AetherML (resumo executável), Domínio (não negociar sem spec), Edição, Restrições de inferência, Stack e pastas

### Community 29 - "CodeGraph — usar antes de Read/Grep"
Cohesion: 0.33
Nodes (5): CodeGraph — usar antes de Read/Grep, Como (MCP `codegraph_explore` — equivale a Read), Instalação (uma vez por máquina), Projetos sem índice, Quando

### Community 30 - "Index-freshness — manter CodeGraph e Graphify atualizados"
Cohesion: 0.33
Nodes (5): Automação sem agente (opcional, manual), CodeGraph (incremental), Graphify (incremental, sem LLM), Index-freshness — manter CodeGraph e Graphify atualizados, Quando refrescar (batch no fim da tarefa, nunca a cada edição)

### Community 31 - "TDD — regra obrigatória AetherML"
Cohesion: 0.33
Nodes (5): Ciclo Red → Green → Refactor, Comandos, Gates por área, Skill e workflow, TDD — regra obrigatória AetherML

### Community 32 - "AetherML — 02 Resolução CONAMA 491/2018 e Cálculo do IQAr"
Cohesion: 0.33
Nodes (5): 1. Formulação Matemática do Índice Individual, 2. Determinação do IQAr Consolidado Global, 3. Tabela Regulamentar de Faixas e Limiares, 4. Prescrições de Saúde Pública por Faixa, AetherML — 02 Resolução CONAMA 491/2018 e Cálculo do IQAr

### Community 33 - "AetherML — 04 Explicabilidade Algorítmica no Navegador (Saabas XAI)"
Cohesion: 0.33
Nodes (5): 1. Por que Saabas em vez de TreeSHAP no Navegador?, 2. Formulação Matemática, 3. Topologia Serializada (`topology.json`), 4. Tradução em Linguagem Natural na Interface, AetherML — 04 Explicabilidade Algorítmica no Navegador (Saabas XAI)

### Community 34 - "AetherML — 06 API REST, Schema D1 e Blindagem de Cota Open-Meteo (DB-First)"
Cohesion: 0.33
Nodes (5): 1. Mecanismo DB-First com Blindagem de Cota para Open-Meteo, 2. Tabelas Canônicas do Cloudflare D1 (7 Tabelas), 3. Endpoints REST da Workers API, AetherML — 06 API REST, Schema D1 e Blindagem de Cota Open-Meteo (DB-First), Regras de Consulta e Validação Prévia:

### Community 35 - "AetherML — 06 PWA e Operação Offline"
Cohesion: 0.33
Nodes (5): 1. Manifest + SW, 2. Headers Pages (`apps/web/public/_headers`), 3. UX offline, 4. Critérios de aceite H-I, AetherML — 06 PWA e Operação Offline

### Community 36 - "AetherML — 08 Pipeline ML, Avaliação e Roadmap"
Cohesion: 0.33
Nodes (5): 1. Pipeline de treino (`ml/training/`), 2. Avaliação semanal (`ml/evaluation/` + Cron seg 06h), 3. Roadmap executável, 4. MCPs / Skills / regras (Antigravity + OpenCode), AetherML — 08 Pipeline ML, Avaliação e Roadmap

### Community 37 - "Docs-fetch — nunca adivinhar API de lib (sem Context7)"
Cohesion: 0.40
Nodes (4): Docs-fetch — nunca adivinhar API de lib (sem Context7), Regra, Roteamento, Skill

### Community 38 - "Subagentes por dificuldade (flash 3.8)"
Cohesion: 0.40
Nodes (4): Delegação, Subagentes por dificuldade (flash 3.8), Tabela de roteamento, Thinking level real (opcional, por máquina)

### Community 39 - "Cloudflare AetherML"
Cohesion: 0.40
Nodes (4): Bindings e crons, Cloudflare AetherML, Comandos (nesta ordem), TDD e docs

### Community 40 - "IQAr CONAMA 491/2018"
Cohesion: 0.40
Nodes (4): Checklist TDD, Fórmulas (nunca trocar), IQAr CONAMA 491/2018, Quando usar

### Community 41 - "Inferência WASM (Web Worker)"
Cohesion: 0.40
Nodes (4): Inferência WASM (Web Worker), Protocolo de mensagens, Restrições duras, TDD

### Community 42 - "AetherML — 01 Visão Geral e Arquitetura do Sistema"
Cohesion: 0.40
Nodes (4): 1. Paradigma: Inferência no Cliente (Client-Side Edge), 2. Por que WebAssembly SIMD vs. WebGPU para Árvores de Decisão?, 3. Matriz Tecnológica do Monorepo, AetherML — 01 Visão Geral e Arquitetura do Sistema

### Community 43 - "AetherML — 03 Pipeline de Machine Learning e Ordem Canônica de Features"
Cohesion: 0.29
Nodes (6): 1.1. Extensão V2 — Lags Autoregressivos de 1h (FEATURE_ORDER_V2), 1. Ordem Canônica das 25 Features (FEATURE_ORDER_V1), 2. Restrições Monotônicas (Monotonic Constraints), 3. Gates de Qualidade para Deploy, 4. Calibração e Pesos (só treino, nunca holdout), AetherML — 03 Pipeline de Machine Learning e Ordem Canônica de Features

### Community 44 - "AetherML — 05 Progressive Web App (PWA) e Resiliência Offline"
Cohesion: 0.40
Nodes (4): 1. Estratégias Multinível de Cache no Service Worker, 2. Isolamento de Origem: Headers COOP e COEP, 3. Manifesto e Instalação PWA, AetherML — 05 Progressive Web App (PWA) e Resiliência Offline

### Community 45 - "AetherML — 08 Guia do Desenvolvedor e Fluxo TDD"
Cohesion: 0.40
Nodes (4): 1. Estrutura do Monorepo pnpm, 2. Comandos Essenciais de Desenvolvimento, 3. Ciclo TDD Red-Green-Refactor (Obrigatório), AetherML — 08 Guia do Desenvolvedor e Fluxo TDD

### Community 46 - "AetherML — RMGV Air Quality Forecasting"
Cohesion: 0.40
Nodes (4): AetherML — RMGV Air Quality Forecasting, Estrutura, Quickstart (H-I), Regras

### Community 47 - "AetherML — 02 Estrutura de Pastas (Monorepo)"
Cohesion: 0.40
Nodes (4): 1. Árvore oficial, 2. Convenções, 3. O que já foi scaffoldado neste commit, AetherML — 02 Estrutura de Pastas (Monorepo)

### Community 48 - "AetherML — 07 Vigilância Geoespacial e Alertas Push Proativos"
Cohesion: 0.50
Nodes (3): 1. Dinâmica dos Cenários Físicos e Restrições Monotônicas, 2. Alertas Geoespaciais Proativos (Web Push API), AetherML — 07 Vigilância Geoespacial e Alertas Push Proativos

### Community 49 - ".opencode/opencode.json"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 67 - "eval_holdout.py"
Cohesion: 0.10
Nodes (32): band_class(), band_index(), global_iqar(), _meteo_row(), ml/evaluation/eval_holdout.py — Backtest honesto do AetherML. Protocolo: -…, regression_metrics(), run_backtest(), Teste das métricas do backtest (puro, sem rede/modelo). Roda: `python… (+24 more)

### Community 68 - "AetherML — 09 Dados Reais, Backtest e Precisão da IA"
Cohesion: 0.29
Nodes (6): 1. Fonte dos dados (sem chave de API), 2. Recursos de engenharia que importam, 3. Histórico de versões e resultados (mesmo holdout de 7d, 1.512 pontos), 4. Protocolo do backtest (página Precisão IA), 5. Limites conhecidos, AetherML — 09 Dados Reais, Backtest e Precisão da IA

### Community 69 - "fetch_openmeteo.py"
Cohesion: 0.60
Nodes (4): fetch_all(), fetch_station(), get_json(), ml/training/fetch_openmeteo.py — Download de dados REAIS (Open-Meteo, sem API…

### Community 70 - "inference-client/src/index.ts"
Cohesion: 0.14
Nodes (7): AetherInferenceClient, PredictionPoint, SaabasContribution, WorkerErrorMsg, WorkerOutMsg, WorkerReadyMsg, WorkerResultMsg

### Community 71 - "Perguntas frequentes"
Cohesion: 0.20
Nodes (9): De quanto em quanto tempo atualiza?, Funciona offline?, O GPS é obrigatório?, Os dados são reais?, Perguntas frequentes, Por que o hero, a média do dia e o pico são diferentes?, Por que o número muda quando troco de estação?, Qual a precisão da IA? (+1 more)

### Community 72 - "Leia o app em 2 minutos"
Cohesion: 0.29
Nodes (6): "De onde vem esse número?", Leia o app em 2 minutos, O gráfico, O mapa, O número grande (IQAr), Os 5 cartões de dias

### Community 73 - "evaluate_weekly.py"
Cohesion: 0.50
Nodes (3): evaluate_predictions(), Any, ml/evaluation/evaluate_weekly.py — Auditoria Semanal de Erros, Acertos e Drift…

## Knowledge Gaps
- **283 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `name`, `version`, `type` (+278 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `globalIQAr()` connect `inference.worker.ts` to `Dashboard.svelte`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `name` to the rest of the system?**
  _283 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `command` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `calibrate.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06936026936026936 - nodes in this community are weakly interconnected._
- **Should `inference.worker.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1225296442687747 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._