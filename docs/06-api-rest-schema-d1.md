# AetherML — 06 API REST, Schema D1 e Blindagem de Cota Open-Meteo (DB-First)

A infraestrutura serverless do AetherML apoia-se no **Cloudflare D1** (SQLite distribuído na borda) gerenciado via Drizzle ORM e executado através de Cloudflare Workers.

---

## 1. Mecanismo DB-First com Blindagem de Cota para Open-Meteo

Para respeitar as diretrizes de consumo da API [Open-Meteo](https://open-meteo.com/en/docs) e garantir resiliência operacional sem ultrapassar limites, o sistema adota a estratégia **DB-First com Verificação de Dia e Semana**:

```mermaid
flowchart TD
  A[Consulta Meteorológica da Estação] --> B{Verifica DB D1: Dados da Semana / Dia?}
  B -->|Sim & TTL Válido (<3h)| C[Retorna Dados do Banco D1]
  C --> D[0 Chamadas Externas Consumidas]
  B -->|Não ou Expirado| E[Dispara Requisição à Open-Meteo API]
  E --> F[UPSERT no Banco D1: environmental_features]
  F --> G[Retorna Dados e Atualiza Cache]
```

### Regras de Consulta e Validação Prévia:

1. **Verificação da Semana**: Antes de buscar séries históricas retrospectivas, o sistema executa `SELECT * FROM environmental_features WHERE station_id = ? AND timestamp >= startOfWeek AND timestamp <= endOfWeek`. Se os pontos da semana já estiverem consolidados no banco, a API externa não é acionada.
2. **Verificação Diária (TTL de 3h)**: Para o dia corrente, verifica-se a data da última leitura gravada. Caso a última leitura tenha sido realizada há menos de 3 horas, o sistema reutiliza os dados do D1.
3. **Persistência Imediata (UPSERT)**: Quando uma nova requisição à API é estritamente necessária, os dados retornados são salvos em lote no D1 com a instrução:
   ```sql
   INSERT INTO environmental_features (...) VALUES (...)
   ON CONFLICT(station_id, timestamp, is_forecast) DO UPDATE SET
     temperature = excluded.temperature,
     relative_humidity = excluded.relative_humidity,
     wind_speed = excluded.wind_speed,
     wind_direction = excluded.wind_direction,
     ...
   ```
   garantindo que qualquer nova visita no mesmo período seja atendida 100% pelo banco.

---

## 2. Tabelas Canônicas do Cloudflare D1 (7 Tabelas)

1. `monitoring_stations`: Cadastro das 9 estações da RAMQAr (Vitória, Vila Velha, Serra, Cariacica) com coordenadas geodésicas.
2. `observed_pollutants`: Medições oficiais de poluentes ($PM_{2.5}, PM_{10}, SO_2, NO_2, O_3, CO$) do IEMA.
3. `environmental_features`: Variáveis meteorológicas, satelitais e de tráfego das pontes, com suporte a metadados da OpenWeather.
4. `model_registry`: Catálogo de versões de modelos (`vAAAA.SS.N`), hashes SHA-256 e métricas de erro.
5. `prediction_logs`: Histórico das previsões geradas pelo Web Worker na borda para auditoria contínua.
6. `weekly_evaluations`: Métricas de erro semanal (MAE, acurácia IQAr, falso alarme, eventos perdidos e detecção de drift).
7. `web_push_subscriptions`: Assinaturas da Web Push API para alertas de risco sanitário (faixas Ruim e Péssima).

---

## 3. Endpoints REST da Workers API

- `GET /api/stations`: Retorna as 9 estações ativas e sua última leitura consolidada.
- `GET /api/forecast-features?station_id={id}&hours=48`: Retorna o vetor de 25 features horárias protegidas pelo Quota Guard.
- `GET /api/models/manifest`: Retorna o manifesto de modelos ativos e hashes SHA-256.
- `POST /api/push/subscribe`: Registra um novo endpoint Web Push criptografado via VAPID.
- `POST /api/evaluate`: Disparado pelo Cron semanal para auditoria de acurácia e drift.
