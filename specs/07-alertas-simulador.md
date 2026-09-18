# AetherML — 07 Alertas Geoespaciais + Simulador Contrafactual

## 1. Alertas proativos (Geolocation + Web Push)

### 1.1 Associação de estação (cliente, nunca envia GPS)
```ts
d = 2R·asin(sqrt(sin²(Δφ/2)+cosφ1·cosφ2·sin²(Δλ/2))), R=6371km
nearest = argmin_d(stations)
```
Só `preferred_station_id + min_alert_level` vai ao `POST /push/subscribe` com chaves VAPID.

### 1.2 Varredura serverless (Cron horário `workers/api`)
1. Lê `prediction_logs` próximas 6-24h por estação.
2. Detecta **transição** (último observado Boa/Moderada → previsto Ruim+). Sem transição, sem push.
3. Join `web_push_subscriptions` por estação + nível mínimo.
4. Dispara Web Push (payload enxuto: `{station, iqar, class, primary, hours_ahead, advice}`).

### 1.3 Prescrições CONAMA (payload → notificação)
- **Ruim (81-120)**: "Grupos sensíveis: evite exercício intenso ao ar livre. {primary} elevado em {station} em ~{n}h."
- **Muito Ruim (121-200) / Péssima (>200)**: "Toda a população: reduza atividades externas, ventile ambientes. {primary} em {station}."
- Clique abre `/estacao/{id}`.

## 2. Simulador contrafactual (`Simulator.svelte`)

### 2.1 Garantia física — restrições monotônicas (treino)
```
∂ŷ/∂emissao ≥ 0, ∂ŷ/∂PBLH ≤ 0, ∂ŷ/∂wind_speed ≤ 0
```
Sem isso o slider "menos vento → menos poluição" divergiria. Teste de aceite: varredura monotônica automatizada.

### 2.2 Cenários (sliders → deltas de features → re-inferência local)

| Cenário | Controle | Features afetadas | Esperado |
|---|---|---|---|
| Poeira Tubarão | −10…−50% emissão difusa | `satellite_aod`, `pm10_lag24` | Camburi volta a Boa sob NNE |
| Mobilidade | −40% fluxo pontes | `traffic_*`, `no2_lag24` | some pico NO2 Centro/Suá, atenua O3 vespertino |
| Inversão | PBLH <200m + vento calmo | `boundary_layer_height`, `wind_speed` | alerta inconformidade aguda |
| Onda de calor | +3°C, +200W/m² | `temperature`, `solar_radiation` | pico O3 14-17h interior |

### 2.3 Saída
Delta `IQAr_base → IQAr_cenário`, waterfall do delta, frase: `"−30% tráfego na Terceira Ponte: −{x} NO2 no Suá, IQAr {a}→{b} ({classe})"`.
