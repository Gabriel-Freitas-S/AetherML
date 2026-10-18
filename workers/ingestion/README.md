# `@aetherml/ingestion` (`aetherml-ingestion`)

Worker Cloudflare responsável pela ingestão horária e backfill manual de séries atmosféricas (Open-Meteo CAMS + meteorologia) para o banco Cloudflare D1 (`aetherml-db`).

---

## Arquitetura e Contrato de Dados

### Tabelas populadas
1. **`observed_pollutants`** (`UNIQUE(station_id, timestamp)`):
   - Poluentes CAMS: `pm25` (`pm2_5`), `pm10`, `o3` (`ozone`), `no2` (`nitrogen_dioxide`), `so2` (`sulphur_dioxide`) e `co` (`carbon_monoxide`).
   - Cálculo de IQAr: `iqar_index`, `iqar_classification` e `primary_pollutant` calculados exclusivamente via pacote canônico `packages/core-iqar/src/iqar.ts` (CONAMA 491/2018). Se qualquer um dos 5 poluentes do índice estiver ausente (`NULL`), o IQAr permanece `NULL` (sem preenchimento com zero ou valores fabricados).
   - Proveniência explícita (`source`):
     - `'open-meteo-cams-reanalysis'`: horas estritamente anteriores a `dayStart(now)` (`YYYY-MM-DDT00:00` UTC).
     - `'open-meteo-cams-forecast'`: horas a partir de `dayStart(now)` (dia corrente UTC).
     - `'IEMA'`: sentinela reservado para observações in-situ oficiais; nunca emitido por este worker.
2. **`environmental_features`** (`UNIQUE(station_id, timestamp, is_forecast)`):
   - Variáveis meteorológicas Open-Meteo (`/v1/forecast`): `temperature`, `relative_humidity`, `wind_speed` (convertido de km/h para m/s), `wind_direction`, componentes vetoriais `wind_u` e `wind_v`, `boundary_layer_height`, `surface_pressure` e `solar_radiation` (clampada em `>= 0`).
   - Gravadas com `is_forecast = 0` e `source = 'open-meteo-forecast-api'`.

### Isolamento, Idempotência e Limites da Plataforma
- **Subrequests**: 1 requisição HTTP para a API de qualidade do ar (`AQ_URL`) e 1 para a API meteorológica (`METEO_URL`) por estação ativa (`9 estações × 2 serviços = 18 subrequests` por execução, tanto no modo horário quanto em backfill de até 30 dias).
- **Transação por estação**: escritas agrupadas via `env.DB.batch([...])`, garantindo atomicidade por estação e isolamento de falhas (uma estação com erro de rede não interrompe as demais).
- **Idempotência**: upserts via `ON CONFLICT(station_id, timestamp) DO UPDATE` e `ON CONFLICT(station_id, timestamp, is_forecast) DO UPDATE`, preservando `id` e `created_at` e atualizando medições e `source`.

---

## Operação

### Cron Horário
Configurado em `wrangler.jsonc` com `crons = ["30 * * * *"]` (todo minuto `:30`).
- Requisita `past_days=1` e `forecast_days=1` no Open-Meteo.
- Processa uma janela deslizante de `LOOKBACK_HOURS = 3` horas até a hora cheia corrente UTC (`hourWindow(now, 3)`), cobrindo eventuais atrasos de publicação do tick anterior sem reescrever o histórico inteiro a cada hora.

### Disparo Manual e Backfill (`POST /ingest?days=N`)
O handler HTTP aceita requisições em `/ingest`:

- **Janela padrão (3 horas)**:
  ```bash
  curl -sS -X POST "https://aetherml-ingestion.freitassouza26.workers.dev/ingest"
  ```
- **Backfill manual (`1 <= days <= 30`)**:
  Parametriza `past_days=N` e `forecast_days=1` no Open-Meteo e recorta `N * 24` horas até a hora cheia atual UTC (`hourWindow(now, N * 24)`):
  ```bash
  curl -sS -X POST "https://aetherml-ingestion.freitassouza26.workers.dev/ingest?days=7"
  ```
- **Validação**: valores de `days` não inteiros, `<= 0` ou `> 30` (`MAX_BACKFILL_DAYS = 30`) retornam `HTTP 400 Bad Request` com corpo JSON `{"error": "..."}` sem consultar o D1 nem realizar chamadas externas.

### Testes e Deploy
```bash
# Executar suíte de testes unitários e de integração local (node:sqlite + migrations reais)
npm --prefix workers/ingestion test

# Deploy do worker em produção
npx wrangler deploy --config workers/ingestion/wrangler.jsonc
```

---

## Histórico de Incidentes e Evidência de Backfill (2026-10-18)

### Incidente: Worker Stub em Produção (~3 semanas com D1 zerado)
- **Sintoma**: As tabelas `observed_pollutants` e `environmental_features` no D1 remoto permaneceram com `0` linhas durante 3 semanas, apesar do trigger cron `30 * * * *` estar ativo na Cloudflare.
- **Causa raiz**:
  1. No commit inicial do repositório (`10846f8` / `df101bf`), `workers/ingestion/src/index.ts` continha apenas um stub placeholder (`console.log("ingest tick")` no `scheduled` e `new Response("ingestion worker — ver specs/08")` no `fetch`), que foi publicado manualmente no momento da criação do worker.
  2. Embora a implementação completa de ingestão tenha sido adicionada ao repositório em `ffadcde` (e testada em `29627c1`), os workflows de CI (`.github/workflows/ci.yml` e `.github/workflows/refresh.yml`) faziam deploy apenas do frontend no Cloudflare Pages (`wrangler pages deploy apps/web/dist`), sem etapa de `wrangler deploy` para `workers/ingestion`. Consequentemente, a Cloudflare continuou executando a versão placeholder original a cada tick horário.
- **Resolução**:
  1. Deploy do código real do worker (`version 23c2376e`) e validação do `POST /ingest` na janela curta.
  2. Adição do modo de backfill manual `POST /ingest?days=N` (`version b400dfe7`) e execução do backfill de 7 dias para recompor a série histórica exigida pelo pipeline de retreino semanal.

### Evidência de Execução em Produção (2026-10-18)
- **Worker publicado**: `aetherml-ingestion` version `b400dfe7` (`https://aetherml-ingestion.freitassouza26.workers.dev`, schedule `30 * * * *`).
- **Disparo de backfill**: `POST /ingest?days=7` -> `HTTP 200` em `3.2s` (`observedRows = 1512`, `featureRows = 1512`, `failed = 0`, janela `2026-10-11T20:00`..`2026-10-18T19:00` UTC).

#### Contagens no D1 Remoto (`aetherml-db`)

| Etapa | `observed_pollutants` | Detalhamento por `source` | `environmental_features` | Janela UTC coberta |
| :--- | ---: | :--- | ---: | :--- |
| Durante incidente (stub) | 0 | — | 0 | — |
| Após `POST /ingest` inicial (`23c2376e`) | 36 | 36 `open-meteo-cams-forecast` (9 estações × 4h) | 36 | `2026-10-18T16:00` .. `2026-10-18T19:00` |
| Após `POST /ingest?days=7` (`b400dfe7`) | 1512 | 1332 `open-meteo-cams-reanalysis` + 180 `open-meteo-cams-forecast` (9 estações × 168h) | 1512 | `2026-10-11T20:00` .. `2026-10-18T19:00` |

#### Amostra Verificada no D1 (`station_id = 'ramqar_camburi'`, ordem `DESC`)

| `station_id` | `timestamp` (UTC) | `pm25` (µg/m³) | `o3` (µg/m³) | `no2` (µg/m³) | `iqar_index` | `source` |
| :--- | :--- | ---: | ---: | ---: | ---: | :--- |
| `ramqar_camburi` | `2026-10-18T19:00` | 5.8 | 76 | 5.0 | 30 | `open-meteo-cams-forecast` |
| `ramqar_camburi` | `2026-10-18T18:00` | 6.2 | 80 | 3.9 | 32 | `open-meteo-cams-forecast` |
| `ramqar_camburi` | `2026-10-18T17:00` | 6.5 | 88 | 2.9 | 35 | `open-meteo-cams-forecast` |
| `ramqar_camburi` | `2026-10-18T16:00` | 7.8 | 97 | 2.1 | 39 | `open-meteo-cams-forecast` |
