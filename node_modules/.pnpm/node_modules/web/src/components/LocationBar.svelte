<!-- apps/web/src/components/LocationBar.svelte — Seletor de estação + GPS inteligente -->
<script lang="ts">
import { nearestStation } from "@aetherml/geo";
import { getUserPosition } from "../lib/location";
import Icon from "./Icon.svelte";
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
	} catch {
		gpsError = "GPS indisponível — escolha uma estação abaixo.";
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
      <Icon name="pin" cls="w-5 h-5 text-sky-600" />
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

  <div class="flex flex-col sm:flex-row gap-2 md:ml-auto w-full md:w-auto">
    <StationPicker
      stations={stations}
      activeId={activeId}
      onChange={(id) => onChange?.(id, "manual")}
      label="Selecionar estação de monitoramento"
    />
    <button onclick={useGps} disabled={gpsLoading} class="btn-primary whitespace-nowrap min-h-[44px] disabled:opacity-60">
      {#if gpsLoading}
        <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        Localizando…
      {:else}
        Usar minha localização
      {/if}
    </button>
  </div>

  {#if gpsError}
    <div class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 md:basis-full">{gpsError}</div>
  {/if}
</div>
