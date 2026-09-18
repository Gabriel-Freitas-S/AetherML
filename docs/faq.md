# Perguntas frequentes

## Os dados são reais?
Sim. Desde a v2026.38.2, alvos e meteorologia vêm do Open-Meteo/CAMS (sem chave). Tráfego e satélite ainda são proxies determinísticos documentados — não há aleatoriedade no pipeline. O histórico sintético foi aposentado (guia 09).

## Qual a precisão da IA?
**91,9% de acerto na faixa IQAr** em 7 dias nunca vistos no treino (1.512 horas × 9 estações). Erro médio de ±2,8 pontos no índice. Detalhes, por poluente e por horizonte, na página Precisão IA.

## Por que o número muda quando troco de estação?
Cada estação tem microclima e fontes próprios (orla, centro, interior, indústria). O modelo prevê por coordenada — Camburi numa hora pode estar Boa e Cariacica Moderada. É o comportamento esperado, não um bug.

## Por que o hero, a média do dia e o pico são diferentes?
São três leituras da mesma curva: valor da hora atual, média das 24h e o pior momento do dia. Divergir é normal — o pico avisa o horário crítico.

## Funciona offline?
Parcialmente: a interface e os últimos dados carregados ficam em cache (PWA). Previsões novas exigem conexão para buscar meteorologia atualizada.

## O GPS é obrigatório?
Não. Sem GPS o app usa a última estação salva (ou Camburi como padrão). O GPS só serve para escolher a estação mais próxima automaticamente — sua posição nunca sai do aparelho.

## De quanto em quanto tempo atualiza?
Os dados exibidos vêm da última ingestão (lotes de 120h). O selo "DB-First · 0 cotas" indica que a leitura usou o banco local, sem gastar cota da API externa.

## Quem mantém as estações RAMQAr?
O IEMA/ES. O app usa as 9 estações oficiais como referência geográfica; os valores previstos são do modelo AetherML sobre grade CAMS, não a leitura instantânea do sensor.
