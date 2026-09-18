# AetherML — 09 Dados Reais, Backtest e Precisão da IA

Como os números exibidos no app são produzidos, de onde vêm os dados e qual o nível de precisão medido — sem marketing.

---

## 1. Fonte dos dados (sem chave de API)

- **Qualidade do ar (alvos):** CAMS via Open-Meteo Air Quality API (`pm2_5`, `pm10`, `ozone`, `nitrogen_dioxide`, `sulphur_dioxide`), horário, por coordenada das 9 estações.
- **Meteorologia (features):** Open-Meteo Forecast/Archive (`temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `wind_direction_10m`, `pressure_msl`, `shortwave_radiation`, `boundary_layer_height`).
- **Janela histórica:** 92 dias de passado (limite da API) + 6 dias de forecast.
- **Proxies determinísticos (declarados):** tráfego (curva dia/noite + pico útil, boost em pontes/centro) e satélite (AOD ~ PM10 de 24h atrás, TROPOMI ~ NO2 de 24h atrás). Zero `random` no pipeline: todo o resto é medido ou derivado.
- **O que ainda NÃO é real:** telemetria de tráfego ao vivo (CETURB/TomTom) e AOD/TROPOMI orbitais — itens do ingestion (guia 06). Quando chegarem, substituem os proxies sem mudar o contrato de features.

> Histórico: até a v2026.38.1 o dataset era **sintético** (`random.gauss`, seed 42). Sintomas: SO₂ com R² = −1,27 e O₃ com R² = 0,99 (decorou a fórmula). Tudo foi substituído a partir da v2026.38.2.

---

## 2. Recursos de engenharia que importam

- **FEATURE_ORDER_V1 (25):** ordem canônica imutável (`db/schema.ts`).
- **FEATURE_ORDER_V2 (30):** V1 intacta + 5 lags autoregressivos de 1h (`pm25_lag1`, `pm10_lag1`, `no2_lag1`, `o3_lag1`, `so2_lag1`). Episódios evoluem em horas; só lag24 era cego à escalada intradiária. Regra: nunca reordenar, só anexar com bump de versão.
- **Calibração (só treino):** viés médio por alvo + pesos ×3 nas amostras de fronteira Boa/Moderada + recalibração isotônica (PAVA) na cauda de validação.
- **Anti-vazamento:** treino só no passado; forecast nunca entra no treino; satélite usa valores de 24h atrás (usar a hora atual seria vazar o alvo para dentro da feature — detectado e corrigido no ciclo v38.2).

---

## 3. Histórico de versões e resultados (mesmo holdout de 7d, 1.512 pontos)

| Versão | Mudança | Faixa IQAr | MAE índice | PM2.5 (MAE/R²) |
|---|---|---|---|---|
| v2026.38.1 | Dataset sintético | — (não medido) | — | 1,98 / 0,85 (ilusório) |
| v2026.38.2 | Dados reais, 25 feats | 80,8% | ±8,2 | 3,04 / 0,09 |
| v2026.38.3 | Holdout honesto (treino sem os 7d) | 80,8% | ±8,2 | 3,04 / 0,09 |
| v2026.38.4 | Capacidade + pesos + viés | 80,2% | ±8,3 | 3,24 / −0,07 |
| **v2026.38.5** | **FEATURE_ORDER_V2 (30 feats)** | **91,9%** | **±2,8** | **0,92 / 0,90** |

Experimentos descartados no mesmo holdout (registrados para não repetir): isotonic isolada 77,5%, quantil-α 79,2%, detector binário (AUC 0,93 no valid, recall 0% no holdout — a semana era imprevisível para essas features).

---

## 4. Protocolo do backtest (página Precisão IA)

1. **Holdout:** últimas 168h de passado, 9 estações, nunca vistas no treino.
2. **1 passo:** prevê cada hora com lags reais → MAE/RMSE/R²/MAPE/viés por poluente + acerto de faixa + baseline de persistência ("ontem = hoje").
3. **Rollout 120h:** a partir da última hora de treino, recursivo com meteorologia real futura → MAE em +24/+48/+72/+120h (mede a degradação operacional).
4. **Reprodutível:** `python ml/training/fetch_openmeteo.py` → `build_real_dataset.py` → `retrain_real.py` → `predict_forecast.py` → `ml/evaluation/eval_holdout.py`. Artefato: `apps/web/public/data/model-eval.json`.

---

## 5. Limites conhecidos

- CAMS é modelo regional (~0,4°), não medição de rua: estações vizinhas recebem valores próximos.
- O rollout degrada com o horizonte (+48h tem pico de erro no O₃ vespertino) — use a **faixa**, não o número, além de 72h.
- PM2.5 ainda varia menos que o real em eventos extremos; o próximo salto depende de tráfego/satélite ao vivo.
- Re-treino é manual hoje (scripts acima); o cron de ingestion + avaliação semanal (`ml/evaluation/evaluate_weekly.py`) é o caminho para automatizar.
