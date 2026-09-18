# AetherML — Sistema de Previsão de Qualidade do Ar da Grande Vitória (ES)

#### Documento Mestre de Especificação Técnica, Arquitetura e Diretrizes de Desenvolvimento (Versão Evoluída)

---

1\. Visão Geral do Projeto e Diagnóstico da Arquitetura VigenteO AetherML é uma plataforma inteligente e descentralizada para previsão horária da qualidade do ar (concentração de partículas $PM\_{2.5}$, $PM\_{10}$, e gases fotoquímicos $SO\_2$, $NO\_2$, $O\_3$) e classificação regulatória do Índice de Qualidade do Ar (IQAr, conforme Resolução CONAMA 491/2018 e diretrizes do IEMA/ES) na Região Metropolitana da Grande Vitória (RMGV), abrangendo os municípios de Vitória, Vila Velha, Serra e Cariacica.A arquitetura do AetherML adota o paradigma de inferência no lado do cliente (client-side inference) via WebAssembly (Wasm) e ONNX Runtime Web (\<rich-text font-family="Roboto Mono"\>ort.wasm\</rich-text\>), encapsulados em um Web Worker dedicado. Esse modelo elimina a dependência de clusters de servidores caros para inferência, garante privacidade total e viabiliza respostas interativas sub-milissegundo. A infraestrutura serverless apoia-se no ecossistema Cloudflare:Cloudflare Pages & Workers: Hospedagem, roteamento e tarefas agendadas (Cron Triggers).Cloudflare D1 (SQLite na Borda): Persistência relacional de histórico, predições, métricas e telemetria, operado via Drizzle ORM.Cloudflare R2: Distribuição de modelos serializados .onnx (otimizados para \< 1,5 MB) e metadados de interpretabilidade.Matriz Diagnóstica da Arquitetura Vigente e Vetores de Evolução

| Camada do Sistema | Componente Tecnológico | Função Primária | Limitações Identificadas | Evolução Arquitetural Implementada |
| :---- | :---- | :---- | :---- | :---- |
| Inferência na Borda | ONNX Runtime Web (ort.wasm) em Web Worker | Execução client-side de modelos tabulares LightGBM. | Confinamento a Wasm genérico; risco de sobrecarga caso se tente WebGPU para árvores de decisão. | Otimização estrita com WebAssembly SIMD-128 \+ SharedArrayBuffer (\< 2ms de latência para 48h); WebGPU reservado a redes neurais. |
| Pilha Serverless / Edge | Cloudflare Pages, Workers, D1 e R2 | Roteamento, persistência relacional leve e entrega de artefatos. | Limites de taxa de escrita e ausência de orquestração de alertas proativos para a população. | Modelagem refinada no D1, filas assíncronas e Web Push API disparado por Workers para alertas de risco sanitário. |
| Interface de Usuário | Monorepo Astro, Svelte 5, UnoCSS e Starlight | Exibição cartográfica interativa, séries de 48h e simulação. | Ausência de ciclo de vida para operação offline resiliente em conectividade degradada ou sombra. | Arquitetura Progressive Web App (PWA) com Service Worker e estratégias de cache multinível (CacheFirst / StaleWhileRevalidate). |
| Camada de Modelagem | LightGBM Regressor e Classifier (\< 1,5 MB) | Estimativa contínua e categorização do IQAr (CONAMA 491/2018). | Foco quase exclusivo em particulados ($PM\_{2.5}, PM\_{10}$), omitindo a fotoquímica de $O\_3$ e $NO\_2$. | Modelagem multipoluente completa ($PM\_{2.5}, PM\_{10}, O\_3, NO\_2, SO\_2$), restrições monotônicas e explicabilidade aditiva (Saabas XAI). |
| Pipeline de Ingestão | RAMQAr (IEMA), OpenAQ, Open-Meteo, INMET | Captura horária de poluentes e previsões meteorológicas. | Marcadores temporais discretos (útil/feriado) sem dados de fluxo viário; sem visão contínua de plumas. | Integração de telemetria contínua de tráfego (pontes e artérias) e sensoriamento orbital (Sentinel-5P TROPOMI e MODIS MAIAC AOD). |

---

### 2\. Expansão do Espectro Preditivo: Fotoquímica, Sensoriamento Remoto e Mobilidade Urbana

#### 2.1. Inclusão de Poluentes Fotoquímicos e Cálculo Rigoroso do IQAr (CONAMA 491/2018)

A dinâmica costeira da Grande Vitória combina emissões industriais complexas e tráfego veicular denso, tornando imprescindível a previsão conjunta de:

* Dióxido de Nitrogênio ($NO\_2$): Poluente primário e precursor fotoquímico gerado principalmente pela combustão veicular e industrial.  
* Ozônio Troposférico ($O\_3$): Poluente secundário decorrente do ciclo fotoquímico entre $NO\_x$ e Compostos Orgânicos Voláteis (COVs) ativado por radiação solar ultravioleta ($\\lambda \< 424\\text{ nm}$).  
  - Fenômeno de Titulação Fotoquímica: Próximo a eixos de tráfego intenso (Vitória Centro, Reta da Penha), altas emissões de $NO$ consomem localmente o $O\_3$ ($NO \+ O\_3 \\to NO\_2 \+ O\_2$).  
  - Advecção Costeira: A brisa marítima transporta a massa precursora para bairros e municípios interiores (Cariacica, interior de Vila Velha e Serra), onde a insolação e temperaturas vespertinas elevadas geram picos severos de $O\_3$.

##### Formulação Matemática do IQAr Individual e Global

Conforme a Resolução CONAMA nº 491/2018, para cada poluente $p$, o índice individual $I\_p$ é obtido por interpolação linear na respectiva faixa:

$$I\_p \= I\_{ini} \+ \\frac{I\_{fim} \- I\_{ini}}{C\_{fim} \- C\_{ini}} \\cdot (C\_p \- C\_{ini})$$

Onde:

* $C\_p$: concentração observada ou prevista do poluente $p$.  
* $C\_{ini}, C\_{fim}$: limites inferior e superior da faixa de concentração em que $C\_p$ se enquadra.  
* $I\_{ini}, I\_{fim}$: pontuações regulatórias inicial e final da respectiva faixa.

O IQAr consolidado da estação é determinado obrigatoriamente pelo pior caso (maior valor):

$$IQAr\_{global} \= \\max\_{p} \\{ I\_p \\}$$

##### Tabela Regulamentar das Faixas do IQAr (CONAMA 491/2018)

| Faixa Qualitativa | Pontuação ($I$) | $PM\_{2.5}$ (24h) ($\\mu g/m^3$) | $PM\_{10}$ (24h) ($\\mu g/m^3$) | $O\_3$ (méd. móvel 8h) ($\\mu g/m^3$) | $NO\_2$ (horária) ($\\mu g/m^3$) | $SO\_2$ (24h) ($\\mu g/m^3$) |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| Boa | 0 a 40 | 0 a 15 | 0 a 50 | 0 a 100 | 0 a 200 | 0 a 20 |
| Moderada | 41 a 80 | \> 15 a 25 | \> 50 a 100 | \> 100 a 130 | \> 200 a 240 | \> 20 a 40 |
| Ruim | 81 a 120 | \> 25 a 50 | \> 100 a 150 | \> 130 a 160 | \> 240 a 320 | \> 40 a 365 |
| Muito Ruim | 121 a 200 | \> 50 a 75 | \> 150 a 250 | \> 160 a 200 | \> 320 a 1130 | \> 365 a 800 |
| Péssima | \> 200 | \> 75 | \> 250 | \> 200 | \> 1130 | \> 800 |

#### 2.2. Sensoriamento Remoto Orbital e Caracterização Espacial de Plumas

Para preencher vazios observacionais entre as 9 estações da RAMQAr:

* Sentinel-5P (Espectrômetro TROPOMI / Copernicus):  
  - Fornece colunas verticais troposféricas integradas diárias de $NO\_2, SO\_2, CO$, formaldeído e índice UV de aerossóis (UVAI) em resolução espacial de $3,5 \\times 5,5\\text{ km}$.  
  - Utilizado para calibração de fundo regional e detecção de transporte transfronteiriço.  
* MODIS (Satélites Terra e Aqua / Produto MAIAC):  
  - Entrega Profundidade Óptica de Aerossóis ($AOD\_{550}$) em alta resolução espacial de $1\\text{ km}$.  
  - Permite interpolação contínua da concentração de particulados ao longo da costa e do Complexo Industrial de Tubarão.  
* Dinâmica Local de Plumas na RMGV:  
  - Ventos de Norte-Nordeste (NNE): Advectam as emissões industriais pontuais e difusas diretamente para a Praia de Camburi, Praia do Canto e norte de Vila Velha.  
  - Incursões Frontais de Sul-Sudoeste (SSW): Direcionam emissões industriais e veiculares para os vales confinados de Cariacica e bacia interna de Vila Velha, onde o relevo acentua o aprisionamento de poluentes.

#### 2.3. Telemetria Dinâmica de Tráfego e Mobilidade Metropolitana

Substituição de flags estáticas de calendário por variáveis contínuas de circulação:

* Pontos Críticos de Estrangulamento: Terceira Ponte (Vitória – Vila Velha), Segunda Ponte, Cinco Pontes e Ponte Florentino Avidos.  
* Variáveis Ingeridas: Velocidade média de fluxo ($km/h$), tempo de atraso relativo (congestion\_delay\_ratio) e índice de congestionamento horário em trechos arteriais (dados abertos CETURB-ES e APIs de tráfego como TomTom/HERE).  
* Impacto Físico: O regime "para-e-anda" multiplica as emissões de $CO, NO\_x$ e $PM\_{2.5}$ devido ao ciclo transitório dos motores e desgaste de freios/pneus, refinando previsões nas estações Vitória-Centro, Enseada do Suá e Paul.

---

### 3\. Otimização do Runtime de Inferência: WebAssembly SIMD vs. WebGPU e Resiliência PWA

#### 3.1. Análise Técnica: Por que WebAssembly SIMD é Superior ao WebGPU para Árvores LightGBM

Embora o ONNX Runtime Web tenha estabelecido o WebGPU como backend prioritário para modelos neurais profundos (visão computacional e transformadores com matrizes densas), para modelos tabulares baseados em árvores de decisão (LightGBM exportado via operador ai.onnx.ml:TreeEnsembleRegressor), o WebGPU introduz severas ineficiências:

* Divergência de Threads em Arquiteturas SIMT: Árvores de decisão realizam desvios condicionais dinâmicos (if-else) baseados nos limiares de cada amostra. Em GPUs, fios no interior do mesmo agrupamento (warp ou subgroup) que tomam ramos diferentes sofrem serialização forçada, destruindo o paralelismo massivo.  
* Acesso Esparso à Memória: A navegação por nós de árvores demanda saltos de memória heterogêneos, penalizando o subsistema de memória de vídeo.  
* Overhead de Shaders WGSL e Alocação: A criação de buffers de dispositivo e compilação de pipelines WebGPU Shading Language (WGSL) gera uma sobrecarga de dezenas de milissegundos — muito superior ao tempo total de inferência do modelo (\< 1,5 MB).

Diretriz Arquitetural:

* Backend Primário: WebAssembly (WASM) com extensões vetoriais SIMD de 128 bits e suporte multi-thread via SharedArrayBuffer.  
* Desempenho Comprovado: Inferência da série completa de 48 horas realizada em menos de 2 milissegundos no cliente, com consumo insignificante de bateria e memória.  
* WebGPU como Fallback Condicional: Reservado exclusivamente para futuros modelos neurais auxiliares (ex: reconstrução espacial de matrizes AOD orbitais via CNN/GNN), inspecionando navigator.gpu em tempo de execução.

#### 3.2. Arquitetura Progressive Web App (PWA) e Modos de Operação Offline

Para garantir disponibilidade durante interrupções de telecomunicações ou trabalho de campo em áreas portuárias/industriais:

| Recurso / Componente | Mecanismo de Cache | Política de Validade | Comportamento em Modo Offline |
| :---- | :---- | :---- | :---- |
| Modelos .onnx e Topologias | CacheFirst (CacheStorage / IndexedDB) | Imutável por hash criptográfico SHA-256 da versão; atualizado no deploy semanal. | Carregamento imediato do ArrayBuffer local; zero requisições externas ao Cloudflare R2. |
| Projeções Meteorológicas (Open-Meteo) | NetworkFirst com fallback em cache | Expiração parametrizada em 6 horas para séries micrometeorológicas. | Caso offline, recupera o prognóstico armazenado mais recente e ajusta o horizonte temporal. |
| Telemetria de Superfície (RAMQAr/D1) | StaleWhileRevalidate | Exibe histórico local imediato enquanto busca novidades em segundo plano. | Apresenta a última telemetria in-situ registrada sem travar a navegação do usuário. |
| Shell da Aplicação (HTML/JS/CSS) | CacheFirst com hash no build | Persistente; invalidado somente a cada novo deploy no Cloudflare Pages. | Inicialização instantânea do Astro/Svelte e dos Web Workers sem sinal de internet. |

---

### 4\. Explicabilidade Algorítmica no Navegador (Client-Side XAI)

#### 4.1. Decomposição Aditiva de Saabas (Tree Interpreter) vs. TreeSHAP

Apresentar apenas o número previsto de poluição sem justificativa física limita o valor da plataforma para tomadores de decisão e para a população.

* TreeSHAP: Complexidade temporal $O(K \\cdot L \\cdot D^2)$ (onde $K$ \= número de árvores, $L$ \= folhas, $D$ \= profundidade máxima). Torna-se lento e drena a bateria quando executado localmente em smartphones.  
* Decomposição Aditiva de Saabas: Complexidade estritamente linear $O(K \\cdot D)$, permitindo execução instantânea (\< 1ms) dentro do próprio Web Worker da inferência.

##### Formulação Matemática do Método de Saabas

Em cada nó interno $v$ com valor esperado condicional $\\bar{y}\_v$, a transição de um exemplo $x$ para o nó filho $child(v, x)$ após avaliação da feature $f$ gera um ganho local:

$$\\Delta\_v(x, f) \= \\bar{y}\_{child(v, x)} \- \\bar{y}\_v$$

A contribuição aditiva total $\\Phi\_f(x)$ da feature $f$ para a predição pontual $\\hat{y}(x)$ é a soma acumulada de todos os nós particionados por $f$ nas $K$ árvores do ensemble:

$$\\Phi\_f(x) \= \\sum\_{k=1}^{K} \\sum\_{v \\in P\_k(x) \\land split(v) \= f} \\Delta\_v(x, f)$$

Garantindo a propriedade de aditividade local:

$$\\hat{y}(x) \= \\Phi\_0 \+ \\sum\_{f=1}^{M} \\Phi\_f(x)$$

onde $\\Phi\_0$ é o valor basal (média populacional da raiz).

#### 4.2. Implementação Reativa em Svelte 5 e Tradução para Linguagem Natural

A topologia e limiares das árvores são serializados na esteira de CI/CD em formato JSON compacto / FlatBuffers. Na interface Svelte 5:

* Gráficos em Cascata (Waterfall Charts): Demonstram claramente como a velocidade do vento, a altura da camada limite e o tráfego elevaram ou reduziram a concentração.  
* Explicações Textuais Automatizadas:  
  - Vento NNE persistente: "A direção do vento oriunda do Complexo de Tubarão é responsável por \+14,2 µg/m³ na estimativa de PM10 na Praia de Camburi."  
  - Inversão Térmica: "Camada Limite Planetária rebaixada (\< 220 m) restringe a dispersão vertical, adicionando \+8,5 µg/m³ na concentração de poluentes."  
  - Tráfego de Pico: "Congestionamento intenso na Terceira Ponte contribui com \+28 µg/m³ no NO2 na estação Enseada do Suá."

---

### 5\. Alertas Geoespaciais Proativos e Simulação Contrafactual

#### 5.1. Notificações Preditivas Proativas (Geolocation \+ Web Push API)

1. 1\. Associação Espacial da Estação:

O cliente utiliza a Geolocation API do navegador e calcula a menor distância ortodrômica até as 9 estações da RAMQAr via fórmula de Haversine:

$$d \= 2 R \\arcsin \\left( \\sqrt{\\sin^2\\left(\\frac{\\Delta \\phi}{2}\\right) \+ \\cos(\\phi\_1)\\cos(\\phi\_2)\\sin^2\\left(\\frac{\\Delta \\lambda}{2}\\right)} \\right)$$

com $R \= 6371\\text{ km}$.

2. 2\. Monitoramento Serverless no Cloudflare Workers:

Uma rotina Cron no Worker inspeciona as previsões das próximas 6 a 24 horas armazenadas no Cloudflare D1.

- Se houver transição prevista para faixas Ruim (IQAr 81–120), Muito Ruim (121–200) ou Péssima (\> 200), o Worker emite disparos criptografados via Web Push API.  
3. 3\. Prescrições Sanitárias Automatizadas (CONAMA 491):  
   - Faixa Ruim: Alerta direcionado a grupos de risco (idosos, crianças, cardiopatas e asmáticos) para restringir exercícios físicos intensos ao ar livre.  
   - Faixas Muito Ruim e Péssima: Recomendação geral a toda a população para reduzir atividades externas e manter ambientes ventilados.

#### 5.2. Simulação Contrafactual Interativa com Restrições Monotônicas (Simulator.svelte)

Para que o componente de simulação produza cenários fisicamente coerentes (e não extrapolações matemáticas inválidas), os regressores LightGBM são treinados com restrições monotônicas estritas:

$$\\frac{\\partial \\hat{y}}{\\partial \\text{emissao}} \\ge 0 \\quad (\\text{monotonia positiva})$$

$$\\frac{\\partial \\hat{y}}{\\partial \\text{PBLH}} \\le 0, \\quad \\frac{\\partial \\hat{y}}{\\partial \\text{wind\\\_speed}} \\le 0 \\quad (\\text{monotonia negativa})$$

##### Matriz de Cenários Contrafactuais no Simulador

| Cenário Contrafactual | Manipulação no Simulador | Mecanismo Físico Modelado | Comportamento Esperado do Modelo |
| :---- | :---- | :---- | :---- |
| Mitigação de Poeira em Tubarão | Redução de 10% a 50% na emissão difusa industrial. | Menor injeção de massa particulada na camada limite costeira. | Retração do IQAr em Camburi para a faixa "Boa" sob ventos de quadrante NNE. |
| Intervenção em Mobilidade Urbana | Redução de até 40% no fluxo veicular de pontes/artérias. | Menor emissão direta de $NO\_x$ e $PM\_{2.5}$ automotivos. | Supressão de picos de $NO\_2$ no Centro de Vitória e atenuação do $O\_3$ vespertino. |
| Estagnação por Inversão Térmica | Fixação da PBLH em cotas \< 200 m com vento calmo. | Supressão do volume de mistura e dispersão turbulenta. | Sinalização antecipada de eventos agudos de inconformidade regulatória. |
| Insolação Intensa e Onda de Calor | Aumento de \+3°C e \+200 W/m² na radiação solar. | Aceleração da fotólise de $NO\_2$ e síntese fotoquímica de $O\_3$. | Antecipação de picos severos de ozônio no período das 14h às 17h no interior conurbado. |

---

### 6\. Estrutura de Dados Atualizada (Cloudflare D1 / SQLite)

```sql
-- 1. Estações de Monitoramento da RMGV
CREATE TABLE IF NOT EXISTS monitoring_stations (
    id TEXT PRIMARY KEY,                       -- 'ramqar_ibes', 'ramqar_camburi', etc.
    name TEXT NOT NULL,                         -- 'IBES - Vila Velha'
    municipality TEXT NOT NULL,                 -- 'Vila Velha', 'Vitória', 'Serra', 'Cariacica'
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL,
    is_active INTEGER DEFAULT 1,
    source TEXT DEFAULT 'IEMA',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Observações Oficiais Multipoluentes (Ground Truth IEMA)
CREATE TABLE IF NOT EXISTS observed_pollutants (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    timestamp DATETIME NOT NULL,
    pm25 REAL,                                  -- µg/m³ (24h)
    pm10 REAL,                                  -- µg/m³ (24h)
    so2 REAL,                                   -- µg/m³ (24h)
    no2 REAL,                                   -- µg/m³ (1h)
    o3 REAL,                                    -- µg/m³ (méd móvel 8h)
    co REAL,                                    -- ppm (8h)
    iqar_index INTEGER,                         -- IQAr consolidado (0-300+)
    iqar_classification TEXT,                   -- 'Boa', 'Moderada', 'Ruim', 'Muito Ruim', 'Péssima'
    primary_pollutant TEXT,                     -- Poluente crítico determinante
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(station_id, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_observed_station_time ON observed_pollutants(station_id, timestamp);

-- 3. Variáveis Meteorológicas, Orbitais e de Mobilidade
CREATE TABLE IF NOT EXISTS environmental_features (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    timestamp DATETIME NOT NULL,
    is_forecast INTEGER DEFAULT 0,              -- 0 = histórico, 1 = previsão
    temperature REAL,
    relative_humidity REAL,
    wind_speed REAL,
    wind_direction REAL,
    wind_u REAL,                                -- componente zonal
    wind_v REAL,                                -- componente meridional
    boundary_layer_height REAL,                 -- metros (PBLH)
    surface_pressure REAL,
    solar_radiation REAL,
    satellite_aod REAL,                         -- MODIS MAIAC 550nm
    satellite_tropomi_no2 REAL,                 -- Sentinel-5P coluna vertical
    traffic_congestion_index REAL,              -- telemetria viária contínua
    source TEXT DEFAULT 'Open-Meteo+Orbital',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(station_id, timestamp, is_forecast)
);

-- 4. Registro de Modelos e Metadados de Interpretabilidade
CREATE TABLE IF NOT EXISTS model_registry (
    version TEXT PRIMARY KEY,                   -- 'v2026.38.1'
    target_pollutant TEXT NOT NULL,             -- 'pm25', 'pm10', 'o3', 'no2'
    architecture TEXT NOT NULL,                 -- 'LightGBM-WASM-SIMD'
    onnx_file_path TEXT NOT NULL,
    onnx_hash_sha256 TEXT NOT NULL,
    saabas_topology_path TEXT NOT NULL,         -- arquivo de topologia para XAI
    training_start_date DATETIME NOT NULL,
    training_end_date DATETIME NOT NULL,
    test_mae REAL NOT NULL,
    test_rmse REAL NOT NULL,
    test_r2 REAL NOT NULL,
    is_active INTEGER DEFAULT 1,
    metadata_json TEXT,                         -- hiperparâmetros e monotonic constraints
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Logs de Previsões Executadas
CREATE TABLE IF NOT EXISTS prediction_logs (
    id TEXT PRIMARY KEY,
    model_version TEXT NOT NULL REFERENCES model_registry(version),
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    forecast_generated_at DATETIME NOT NULL,
    target_timestamp DATETIME NOT NULL,
    predicted_pm25 REAL,
    predicted_pm10 REAL,
    predicted_o3 REAL,
    predicted_no2 REAL,
    predicted_iqar INTEGER,
    predicted_classification TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_version, station_id, forecast_generated_at, target_timestamp)
);

-- 6. Auditoria Semanal de Erros, Acertos e Drift
CREATE TABLE IF NOT EXISTS weekly_evaluations (
    id TEXT PRIMARY KEY,
    week_code TEXT NOT NULL,                   -- '2026-W38'
    station_id TEXT NOT NULL REFERENCES monitoring_stations(id),
    model_version TEXT NOT NULL REFERENCES model_registry(version),
    total_eval_points INTEGER NOT NULL,
    mae_pm25 REAL NOT NULL,
    mae_o3 REAL NOT NULL,
    mae_no2 REAL NOT NULL,
    iqar_accuracy_percentage REAL NOT NULL,
    false_alarm_rate REAL NOT NULL,
    missed_event_rate REAL NOT NULL,
    drift_detected INTEGER DEFAULT 0,
    retrained INTEGER DEFAULT 0,
    evaluation_report_md TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Assinaturas para Alertas Web Push
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    preferred_station_id TEXT REFERENCES monitoring_stations(id),
    min_alert_level TEXT DEFAULT 'Ruim',        -- 'Moderada', 'Ruim', 'Muito Ruim'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### 7\. Configuração de MCPs, Skills e Regras para Antigravity e OpenCode

#### 7.1. Ferramentas Integradas via Docker MCP Toolkit

- mcp/docker-fetch: Acesso enxuto e sanitizado a documentações de APIs (Open-Meteo, Astro, Svelte 5, ONNX Runtime Web).  
- mcp/docker-cloudflare: Execução de comandos do Wrangler para deploy de Workers e migrações no Cloudflare D1.  
- mcp/docker-sqlite: Validação estática de queries e testes de integridade do schema SQL localmente.  
- mcp/docker-ast-grep: Varredura estruturada por nós sintáticos, reduzindo o tráfego de arquivos completos no prompt.

#### 7.2. Regras Estritas de Otimização de Tokens

1. Regra de Contexto Cirúrgico: Proibido carregar pastas inteiras no prompt do assistente. Restringir a leitura aos ranges de linhas (start\_line, end\_line) das funções e interfaces em edição.  
2. Automação Pré-Prompt: Formatação e tipagem automática via ruff check \--fix (Python) e biome check \--write (TypeScript) em ganchos locais, impedindo que tokens da IA sejam gastos com correções sintáticas triviais.  
3. Fluxo TDD Rígido (Red-Green-Refactor):  
   - Fornecer apenas o teste falhando (test\_\*.py ou \*.test.ts) e a assinatura de tipos da função.  
   - O assistente deve implementar estritamente a menor quantidade de código necessária para o teste passar.

---

### 9\. Roteiro de Execução Estratégica em Três Horizontes

4. Horizonte I: Otimização de Borda, PWA e XAI (1 a 3 meses):  
   - Arquitetura PWA resiliente com Service Worker e cache multinível offline.  
   - Otimização do runtime ONNX WebAssembly SIMD-128 (\< 2ms de latência).  
   - Explicabilidade aditiva de Saabas no Web Worker (\< 1ms).  
   - Componentes reativos de Waterfall e texto em Svelte 5\.  
5. Horizonte II: Multipoluentes Fotoquímicos e Mobilidade (3 a 6 meses):  
   - Modelagem dedicada de $O\_3$ (média móvel 8h) e $NO\_2$ (horário) conforme Resolução CONAMA 491/2018.  
   - Ingestão de telemetria contínua de tráfego nas pontes e artérias metropolitanas.  
   - Pipeline de interpolação e enquadramento regulatório multipoluente.  
6. Horizonte III: Sensoriamento Orbital e Simulação (6 a 12 meses):  
   - Assimilação de dados de satélite MODIS AOD (1km) e Sentinel-5P TROPOMI.  
   - Restrições monotônicas formais no treinamento do LightGBM.  
   - Simulador contrafactual interativo de emissões (Simulator.svelte).  
   - Alertas geoespaciais proativos via Web Push API no Cloudflare Workers.

&nbsp;