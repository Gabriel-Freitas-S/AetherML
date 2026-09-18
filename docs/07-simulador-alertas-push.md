# AetherML — 07 Vigilância Geoespacial e Alertas Push Proativos

O AetherML disponibiliza canais ativos de proteção para a população e gestores públicos por meio do sistema de **Alertas Sanitários Proativos via Web Push API** e modelagem atmosférica baseada em restrições físicas.

---

## 1. Dinâmica dos Cenários Físicos e Restrições Monotônicas

O pipeline de Machine Learning incorpora 4 mecanismos físicos essenciais da Região Metropolitana da Grande Vitória (RMGV):

| Fenômeno Físico | Variáveis Críticas | Mecanismo Físico Modelado | Comportamento Regulatório |
| :--- | :--- | :--- | :--- |
| **Pluma de Tubarão** | Direção do vento ($20^\circ-45^\circ$, NNE) | Dispersão costeira em direção a Camburi e Enseada do Suá. | Restrição monotônica $\partial \hat{y} / \partial \text{emissão} \ge 0$. |
| **Tráfego Viário** | Lentidão e horários de pico (7h-9h, 17h-19h) | Emissão direta veicular nas pontes metropolitanas. | Picos locais de $NO_2$ em Vitória Centro e Paul. |
| **Inversão Térmica** | PBLH (Camada Limite Planetária < 250m) | Supressão da dispersão vertical de poluentes. | Elevação severa das concentrações de particulados e gases. |
| **Onda de Calor e Sol** | Radiação solar global e temperatura elevada | Fotólise de $NO_2$ e síntese fotoquímica acelerada de $O_3$. | Picos de ozônio no período vespertino (14h–17h). |

Graças às restrições monotônicas garantidas no treinamento do LightGBM, as previsões produzem comportamentos estritamente coerentes com a termodinâmica atmosférica.

---

## 2. Alertas Geoespaciais Proativos (Web Push API)

O sistema de alertas atua preventivamente, notificando os cidadãos **antes** que um evento agudo de poluição ocorra:

1. **Associação por Geolocalização**:
   - O usuário concede permissão de localização no navegador.
   - O cliente calcula a menor distância ortodrômica até uma das 9 estações da RAMQAr via fórmula de Haversine ($R = 6371\text{ km}$).
2. **Varredura Automatizada no Cloudflare Workers**:
   - Um Cron Trigger horário inspeciona as previsões de 6 a 24 horas no Cloudflare D1.
   - Caso uma transição para as faixas **Ruim (81–120)**, **Muito Ruim (121–200)** ou **Péssima (> 200)** seja identificada, o Worker envia um push criptografado com chave VAPID.
3. **Prescrições Sanitárias Imediatas**:
   - Alerta direto com ações práticas (ex: *"Previsão de ar Ruim nas próximas 4 horas: asmáticos e crianças devem evitar atividades físicas ao ar livre na orla"*).
