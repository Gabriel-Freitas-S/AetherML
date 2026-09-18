<!-- apps/web/src/components/Waterfall.svelte — Explicabilidade Algorítmica Saabas (XAI) -->
<script lang="ts">
import type { SaabasContribution } from "@aetherml/inference-client";

const {
	contributions = [],
	stationName = "Estação RMGV",
	primaryPollutant = "pm25",
	baseValue = 15.0,
}: {
	contributions: SaabasContribution[];
	stationName?: string;
	primaryPollutant?: string;
	baseValue?: number;
} = $props();

const maxPhi = $derived.by(() => {
	if (!contributions.length) return 10;
	const maxVal = Math.max(...contributions.map((c) => Math.abs(c.phi)));
	return Math.max(8, Math.ceil(maxVal * 1.2));
});

function getFeatureLabel(feat: string): string {
	const map: Record<string, string> = {
		wind_direction: "Direção do Vento (NNE)",
		wind_speed: "Velocidade do Vento",
		boundary_layer_height: "Camada Limite (PBLH)",
		traffic_congestion_index: "Índice de Tráfego",
		traffic_delay_ratio: "Atraso nas Pontes",
		solar_radiation: "Radiação Solar (UV)",
		temperature: "Temperatura do Ar",
		satellite_aod: "Profundidade Óptica (AOD)",
		satellite_tropomi_no2: "Coluna Vertical NO₂",
		pm25_lag24: "Persistência PM2.5 (24h)",
		pm10_lag24: "Persistência PM10 (24h)",
		o3_lag24: "Persistência Ozônio (24h)",
	};
	return map[feat] || feat;
}

function getNaturalLanguageExplanation(item: SaabasContribution): string {
	const sign = item.phi > 0 ? `+${item.phi}` : `${item.phi}`;
	const unit =
		primaryPollutant === "o3" ||
		primaryPollutant === "no2" ||
		primaryPollutant.startsWith("pm")
			? "µg/m³"
			: "";

	if (item.feature.includes("wind_dir") || item.feature.includes("wind_v")) {
		return item.phi > 0
			? `Vento persistente de NNE transporta a pluma industrial de Tubarão: ${sign} ${unit}.`
			: `Vento do quadrante sul favorece a ventilação e dispersão costeira: ${sign} ${unit}.`;
	}
	if (
		item.feature.includes("boundary_layer") ||
		item.feature.includes("pblh")
	) {
		return item.phi > 0
			? `Camada Limite rebaixada restringe o volume de mistura atmosférica: ${sign} ${unit}.`
			: `Convecção térmica eleva a altura de mistura, promovendo dispersão: ${sign} ${unit}.`;
	}
	if (item.feature.includes("traffic")) {
		return item.phi > 0
			? `Regime "para-e-anda" nas pontes metropolitanas eleva as emissões locais: ${sign} ${unit}.`
			: `Fluxo livre de veículos reduz as emissões veiculares diretas: ${sign} ${unit}.`;
	}
	if (item.feature.includes("solar") || item.feature.includes("temp")) {
		return item.phi > 0
			? `Insolação intensa acelera a síntese fotoquímica de ozônio: ${sign} ${unit}.`
			: `Nebulosidade amortece as reações fotoquímicas de poluentes secundários: ${sign} ${unit}.`;
	}
	return `Contribuição atmosférica de ${getFeatureLabel(item.feature)}: ${sign} ${unit}.`;
}
</script>

<div class="glass-card p-5">
  <div class="mb-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
        Explicabilidade Algorítmica (Saabas XAI)
      </h3>
      <span class="text-xs bg-sky-50 text-sky-700 px-2.5 py-1 rounded-full border border-sky-200 font-mono">
        O(K·D) Linear &bull; sub-1ms
      </span>
    </div>
    <p class="text-xs text-slate-500 mt-1">
      Decomposição aditiva das contribuições físicas na estimativa de <span class="text-sky-700 font-bold uppercase">{primaryPollutant}</span> em {stationName}.
    </p>
  </div>

  <!-- Lista em Cascata de Contribuições -->
  <div class="space-y-3.5 my-4">
    {#each contributions.slice(0, 6) as item}
      {@const isPositive = item.phi > 0}
      {@const barWidthPct = Math.min(100, Math.round((Math.abs(item.phi) / maxPhi) * 100))}
      <div>
        <div class="flex justify-between items-center text-xs mb-1">
          <span class="font-medium text-slate-700">{getFeatureLabel(item.feature)}</span>
          <span class="font-mono font-bold {isPositive ? 'text-orange-600' : 'text-emerald-600'}">
            {isPositive ? `+${item.phi}` : item.phi} µg/m³
          </span>
        </div>

        <!-- Barra Divergente -->
        <div class="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
          <div class="w-1/2 flex justify-end">
            {#if !isPositive}
              <div
                class="h-full bg-gradient-to-l from-emerald-500 to-teal-600 rounded-l-full transition-all duration-300"
                style="width: {barWidthPct}%"
              ></div>
            {/if}
          </div>
          <div class="w-0.5 h-full bg-slate-400"></div>
          <div class="w-1/2">
            {#if isPositive}
              <div
                class="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-r-full transition-all duration-300"
                style="width: {barWidthPct}%"
              ></div>
            {/if}
          </div>
        </div>

        <!-- Frase Explicativa em Linguagem Natural -->
        <p class="text-[11px] text-slate-500 mt-1 italic leading-relaxed">
          {getNaturalLanguageExplanation(item)}
        </p>
      </div>
    {/each}
  </div>

  <!-- Rodapé com Balanço Aditivo -->
  <div class="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
    <span>Valor Basal Médio (Φ₀): <strong class="text-slate-700 font-mono">{baseValue} µg/m³</strong></span>
    <span class="text-slate-500">ŷ = Φ₀ + Σ Φᵢ</span>
  </div>
</div>
