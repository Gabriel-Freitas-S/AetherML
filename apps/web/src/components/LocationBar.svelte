<!-- apps/web/src/components/LocationBar.svelte — Seletor de estação + GPS inteligente -->
<script lang="ts">
import { nearestStation } from "@aetherml/geo";
import { getUserPosition } from "../lib/location";

import StationPicker from "./StationPicker.svelte";

interface StationMeta {
	id: string;
	name: string;
	municipality: string;
	latitude?: number;
	longitude?: number;
	lat?: number;
	lon?: number;
}

const {
	stations = [],
	activeId = "ramqar_camburi",
	source = "default",
	distanceKm = null as number | null,
	onChange,
}: {
	stations: StationMeta[];
	activeId?: string;
	source?: "saved" | "gps" | "default" | "fallback" | "manual";
	distanceKm?: number | null;
	onChange?: (id: string, origin: "manual" | "gps") => void;
} = $props();

let gpsLoading = $state(false);
let gpsError = $state<string | null>(null);

function coordsOf(s: StationMeta): { latitude: number; longitude: number } {
	return {
		latitude: s.latitude ?? s.lat ?? 0,
		longitude: s.longitude ?? s.lon ?? 0,
	};
}

async function useGps() {
	gpsError = null;
	gpsLoading = true;
	try {
		const pos = await getUserPosition();
		const list = stations.map((s) => ({ ...s, ...coordsOf(s) }));
		const nearest = nearestStation(pos.lat, pos.lon, list as any);
		if (onChange) onChange(nearest.station.id, "gps");
	} catch (err: any) {
		if (err?.code === 1) {
			gpsError =
				"Permissão de localização bloqueada no navegador. Escolha uma estação na lista ao lado.";
		} else if (err?.code === 3 || err?.message?.includes("Tempo esgotado")) {
			gpsError =
				"Tempo limite para obter GPS esgotado. Tente novamente ou selecione sua estação na lista.";
		} else {
			gpsError =
				"Não foi possível obter sua localização atual. Selecione sua estação na lista.";
		}
	} finally {
		gpsLoading = false;
	}
}

const sourceLabel: Record<string, string> = {
	saved: "Estação salva",
	gps: "Via GPS",
	manual: "Seleção manual",
	default: "Estação padrão",
	fallback: "Estação padrão",
};
</script>

<div class="glass-card relative z-30 p-4 flex flex-col md:flex-row md:items-center gap-3">
  <div class="flex items-center gap-2.5 min-w-0">
    <div class="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center shrink-0">
      <span class="i-ph-map-pin-fill w-5 h-5 text-sky-600"></span>
    </div>
    <div class="min-w-0">
      <div class="text-xs font-bold text-slate-800 truncate">
        {stations.find((s) => s.id === activeId)?.name ?? "Selecione a estação"}
      </div>
      <div class="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
        <span class="chip !py-0.5 !px-2 bg-sky-50 border-sky-200 text-sky-700">{sourceLabel[source] ?? source}</span>
        {#if distanceKm != null}
          <span class="font-mono">a {distanceKm} km de você</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- `min-w-0` + `shrink-0` + um TETO QUE NÃO CONTRADIZ O PISO do seletor.

       `StationPicker` declara `sm:min-w-[260px]` no próprio elemento. `max-width`
       num pai de bloco NÃO limita o `min-width` do filho: os dois se resolvem
       contra larguras diferentes. Com o teto em 240px, a caixa encolhia para 240
       e o seletor, de piso 260px, transbordava 20px para fora dela. O `gap-2`
       inteiro virava −12px: o botão azul ficava 12px POR CIMA da borda direita
       do select (medido: −12px de 768px em diante; com o anel de foco de 4px,
       −16px). Dois controles viravam uma massa só.

       O teto agora é `sm:max-w-[260px]`, igual ao piso do seletor: nunca há
       transbordo, e sobra para o `gap-3` — 12px MEDIDOS de folga real entre as
       duas bordas pintadas, de 320px a 1440px, sem exceção.

       O anel de foco não consome essa folga até o zero. Com o teclado, o
       `:focus-visible` global (2px de traço com `outline-offset: 2px`) põe 4px
       do lado de FORA da caixa; o `focus:ring-2` do seletor (2px) fica dentro
       desses mesmos 4px. O caso reportado — o botão focado, o seletor ocioso —
       deixa 8px de branco entre as duas bordas. Focar os dois ao mesmo tempo
       daria 4px, ainda positivo: o defeito era de 12px de SOBREPOSIÇÃO, não de
       falta de folga.

       Abaixo de `sm` a linha já é `flex-col` com `stretch`: select em cima e
       botão embaixo, ambos na largura inteira (medido a 360px: 280px e 280px,
       12px de folga vertical). `min-w-0` e `shrink-0` continuam de pé — são eles
       que impedem o overflow horizontal de 30px que a sessão anterior corrigiu. -->
  <div class="flex flex-col sm:flex-row gap-3 md:ml-auto w-full md:w-auto min-w-0">
    <div class="min-w-0 sm:max-w-[260px]">
      <StationPicker
        stations={stations}
        activeId={activeId}
        onChange={(id) => {
          gpsError = null;
          onChange?.(id, "manual");
        }}
        label="Selecionar estação de monitoramento"
      />
    </div>
    <button onclick={useGps} disabled={gpsLoading} class="btn-primary w-full sm:w-auto whitespace-nowrap min-h-[44px] shrink-0 disabled:opacity-60 cursor-pointer">
      {#if gpsLoading}
        <span class="i-ph-spinner-bold w-4 h-4 animate-spin"></span>
        Localizando…
      {:else}
        Usar minha localização
      {/if}
    </button>
  </div>

  {#if gpsError}
    <div class="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 md:basis-full flex items-center justify-between gap-2" role="alert">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="i-ph-warning-circle-fill w-4 h-4 text-amber-600 shrink-0"></span>
        <span>{gpsError}</span>
      </div>
      <button onclick={() => (gpsError = null)} class="text-amber-700 hover:text-amber-950 p-1 rounded hover:bg-amber-100/60 transition-colors cursor-pointer shrink-0" aria-label="Dispensar aviso de GPS">
        <span class="i-ph-x-bold w-3.5 h-3.5"></span>
      </button>
    </div>
  {/if}
</div>
