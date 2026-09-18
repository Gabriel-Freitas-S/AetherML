# AetherML — 04 Explicabilidade Algorítmica no Navegador (Saabas XAI)

Apresentar apenas valores numéricos de poluição sem justificativa física limita o impacto da tomada de decisão pública. O AetherML implementa interpretabilidade transparente no lado do cliente utilizando a **Decomposição Aditiva de Saabas** (Tree Interpreter).

---

## 1. Por que Saabas em vez de TreeSHAP no Navegador?

O cálculo exato de valores SHAP em árvores de decisão (TreeSHAP) possui complexidade computacional da ordem de:

$$\mathcal{O}(K \cdot L \cdot D^2)$$

onde $K$ é o número de árvores, $L$ o número de folhas e $D$ a profundidade máxima. Em smartphones ou dispositivos com bateria limitada, calcular TreeSHAP para séries de 48 horas causa travamento na interface e drena energia.

Em contrapartida, o método aditivo de Saabas possui complexidade estritamente **linear com a profundidade percorrida**:

$$\mathcal{O}(K \cdot D)$$

Isso possibilita a decomposição instantânea das contribuições de todas as variáveis no próprio Web Worker em **menos de 1 milissegundo**.

---

## 2. Formulação Matemática

Em cada nó interno $v$ da árvore de decisão com valor esperado condicional $\bar{y}_v$, a transição de um exemplo $x$ para o nó filho $child(v, x)$ após avaliação da feature $f$ gera uma contribuição local:

$$\Delta_v(x, f) = \bar{y}_{child(v, x)} - \bar{y}_v$$

A contribuição aditiva total $\Phi_f(x)$ da variável $f$ para a estimativa pontual $\hat{y}(x)$ é a soma acumulada de todos os nós particionados por $f$ nas $K$ árvores do ensemble:

$$\Phi_f(x) = \sum_{k=1}^{K} \sum_{v \in P_k(x) \land split(v) = f} \Delta_v(x, f)$$

Cumprindo a propriedade fundamental de **aditividade local**:

$$\hat{y}(x) = \Phi_0 + \sum_{f=1}^{M} \Phi_f(x)$$

onde $\Phi_0$ representa o valor basal médio populacional da raiz.

---

## 3. Topologia Serializada (`topology.json`)

Para que o Web Worker execute Saabas sem precisar do binário ONNX para a interpretabilidade, a esteira de treino extrai a topologia das árvores em um formato compacto:

```json
{
  "target": "pm25",
  "base_value": 14.85,
  "tree_count": 120,
  "trees": [
    {
      "tree_index": 0,
      "root": {
        "leaf": false,
        "feature": "wind_direction",
        "feature_index": 3,
        "threshold": 48.5,
        "value": 14.85,
        "left": { "leaf": false, "feature": "traffic_delay_ratio", ... },
        "right": { "leaf": true, "value": 26.4 }
      }
    }
  ]
}
```

---

## 4. Tradução em Linguagem Natural na Interface

O componente `Waterfall.svelte` converte os valores brutos de $\Phi_f$ em narrativas compreensíveis para os cidadãos e operadores ambientais:

- **Vento NNE persistente**: *"A direção do vento proveniente do Complexo Industrial de Tubarão é responsável por +14,2 µg/m³ no particulado em Camburi."*
- **Inversão Térmica**: *"Camada Limite Planetária rebaixada (< 220 m) restringe a dispersão vertical, adicionando +6,8 µg/m³ na concentração de poluentes."*
- **Tráfego nas Pontes**: *"Congestionamento intenso na Terceira Ponte contribui com +12,5 µg/m³ no NO₂ na Enseada do Suá."*
