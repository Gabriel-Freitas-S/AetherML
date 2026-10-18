<!-- apps/web/src/components/Map.svelte — Mapa Leaflet com estações RAMQAr, basemap CARTO (rastertiles + ?key=) e GPS inteligente -->
<script lang="ts">
import { getStationCoords } from "@aetherml/geo";
import { onMount } from "svelte";
import {
	BASEMAP_LABELS,
	BASEMAP_STYLES,
	type BasemapStyle,
	DEFAULT_BASEMAP,
	tileUrl,
} from "../lib/basemaps";
import {
	IQAR_BANDS,
	POLLUTANT_LABEL,
	type PollutantKey,
	iqarBand,
} from "../lib/comparison";
import { formatConcentration } from "../lib/dashboard-sections";
import {
	formatGpsError,
	getUserPosition,
	loadBasemap,
	resolveGpsNearest,
	saveBasemap,
	saveStationId,
} from "../lib/location";

interface StationWithStatus {
	id: string;
	name: string;
	municipality: string;
	latitude?: number;
	longitude?: number;
	lat?: number;
	lon?: number;
	iqar?: number;
	classification?: string;
	primary?: string;
	/**
	 * Concentração em µg/m³ do poluente dominante (`primary`), na hora do índice.
	 *
	 * Existe porque o IQAr é inteiro: em horários de pouco movimento o contraste
	 * espacial real do modelo é de décimos de µg/m³ e o arredondamento da
	 * classificação o apaga. Mostrar o número é mostrar o dado; inventar
	 * variação para preencher o mapa seria mentira cartográfica.
	 */
	concentration?: number | null;
}

const {
	stations = [],
	selectedStationId = "ramqar_camburi",
	onSelectStation,
}: {
	stations: StationWithStatus[];
	selectedStationId?: string;
	onSelectStation?: (
		id: string,
		origin?: "manual" | "gps",
		distanceKm?: number | null,
	) => void;
} = $props();

let mapContainer: HTMLDivElement;
let map: any = null;
let tileLayer: any = null;
let userMarker: any = null;
let userCircle: any = null;
const markers: Record<string, any> = {};
let Leaflet: any = null;

let basemap = $state<BasemapStyle>(
	(loadBasemap() as BasemapStyle) || DEFAULT_BASEMAP,
);
let locating = $state(false);
let locateError = $state<string | null>(null);
let userLocation = $state<{
	lat: number;
	lon: number;
	nearestId: string;
	distance: number;
} | null>(null);

/** Rótulo curto do poluente dominante, com a mesma convenção do resto do app. */
function pollutantLabel(primary?: string): string {
	if (!primary) return "—";
	return POLLUTANT_LABEL[primary as PollutantKey] ?? primary.toUpperCase();
}

function coordsOf(s: StationWithStatus): [number, number] {
	const c = getStationCoords(s as any);
	return [c.latitude, c.longitude];
}

/**
 * Pin em duas leituras: o IQAr (faixa) em cima, a concentração real embaixo.
 *
 * A faixa nunca é comunicada só pela cor — o glifo da faixa (`band.icon`) é uma
 * FORMA distinta por faixa, e o popup nomeia a faixa por extenso. A concentração
 * é neutra de propósito: ela não é uma faixa CONAMA e não pode herdar a cor de
 * uma. `title` carrega a frase completa para o leitor de tela e o hover.
 */
function markerHtml(s: StationWithStatus, selected: boolean): string {
	const band = iqarBand(s.classification);
	const label = s.iqar ?? "–";
	const unit = pollutantLabel(s.primary);
	const conc = formatConcentration(s.concentration);
	const concText = conc === "—" ? "" : `${unit} ${conc}`;
	const spoken = `${s.name}: IQAr ${label}, faixa ${s.classification ?? "indeterminada"}. ${
		conc === "—"
			? "Concentração indisponível."
			: `${unit} ${conc} microgramas por metro cúbico.`
	}`;
	return `<div class="aq-pin ${selected ? "aq-pin-selected" : ""}" style="--c:${band.hex}" title="${spoken}" aria-label="${spoken}">
    <span class="aq-pin-iqar"><span class="${band.icon} aq-pin-band"></span>${label}</span>
    <span class="aq-pin-conc">${concText}</span>
    ${selected ? `<span class="aq-pin-ring"></span>` : ""}
  </div>`;
}

function buildMarkers() {
	if (!map || !Leaflet) return;
	for (const id of Object.keys(markers)) {
		map.removeLayer(markers[id]);
		delete markers[id];
	}
	stations.forEach((s) => {
		const selected = s.id === selectedStationId;
		const band = iqarBand(s.classification);
		const unit = pollutantLabel(s.primary);
		const conc = formatConcentration(s.concentration);
		const icon = Leaflet.divIcon({
			className: "aq-pin-wrap",
			html: markerHtml(s, selected),
			iconSize: selected ? [56, 50] : [50, 44],
			iconAnchor: selected ? [28, 25] : [25, 22],
		});
		const m = Leaflet.marker(coordsOf(s), {
			icon,
			title: s.name,
			zIndexOffset: selected ? 1000 : 0,
		}).addTo(map);
		m.bindPopup(
			`<div class="aq-pop">
        <div class="aq-pop-title">${s.name}</div>
        <div class="aq-pop-sub">${s.municipality}</div>
        <div class="aq-pop-iqar" style="--c:${band.hex}">
          <strong>${s.iqar ?? "…"}</strong>
          <span><span class="${band.icon} aq-pop-band" style="color:${band.text}"></span>${s.classification ?? "Calculando"} · ${unit}</span>
        </div>
        ${
					conc === "—"
						? ""
						: `<div class="aq-pop-conc"><span>${unit}</span><strong>${conc}</strong><span>µg/m³</span></div>`
				}
        <p class="aq-pop-note">Concentração do poluente dominante na hora do índice. Não é uma faixa: a faixa é o IQAr acima.</p>
        <a class="aq-pop-link" href="/estacao/${s.id}">Ver diagnóstico completo →</a>
      </div>`,
			{ closeButton: false, offset: [0, -6] },
		);
		m.on("click", () => {
			saveStationId(s.id);
			onSelectStation?.(s.id, "manual", null);
		});
		markers[s.id] = m;
	});
}

function setBasemap(style: BasemapStyle) {
	basemap = style;
	saveBasemap(style);
	if (!map || !Leaflet) return;
	if (tileLayer) map.removeLayer(tileLayer);
	const isOsm = style === "osm";
	tileLayer = Leaflet.tileLayer(tileUrl(style), {
		attribution: isOsm
			? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
			: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
		subdomains: isOsm ? "abc" : "abcd",
		maxZoom: 19,
	}).addTo(map);
}

async function locateUser() {
	locateError = null;
	if (!stations.length) {
		locateError = "Lista de estações ainda não carregada.";
		return;
	}
	locating = true;
	try {
		const pos = await getUserPosition(9000);
		const nearest = resolveGpsNearest(pos, stations);
		if (!nearest) {
			locateError = "Não foi possível determinar a estação mais próxima.";
			return;
		}
		userLocation = {
			lat: pos.lat,
			lon: pos.lon,
			nearestId: nearest.stationId,
			distance: nearest.distanceKm,
		};
		if (map && Leaflet) {
			if (userMarker) map.removeLayer(userMarker);
			if (userCircle) map.removeLayer(userCircle);
			userCircle = Leaflet.circle([pos.lat, pos.lon], {
				radius: Math.min(Math.max(pos.accuracyM ?? 60, 40), 400),
				color: "#38bdf8",
				weight: 1,
				fillColor: "#38bdf8",
				fillOpacity: 0.12,
			}).addTo(map);
			userMarker = Leaflet.marker([pos.lat, pos.lon], {
				icon: Leaflet.divIcon({
					className: "aq-user-wrap",
					html: `<div class="aq-user-dot"><span></span></div>`,
					iconSize: [22, 22],
					iconAnchor: [11, 11],
				}),
				zIndexOffset: 2000,
			}).addTo(map);
			map.flyTo([pos.lat, pos.lon], 13, { duration: 0.9 });
			const target = markers[nearest.stationId];
			if (target) window.setTimeout(() => target.openPopup(), 950);
		}
		saveStationId(nearest.stationId);
		onSelectStation?.(nearest.stationId, "gps", nearest.distanceKm);
	} catch (err: unknown) {
		locateError = formatGpsError(err);
	} finally {
		locating = false;
	}
}

onMount(async () => {
	const L = (await import("leaflet")).default;
	Leaflet = L;
	map = L.map(mapContainer, {
		center: [-20.2976, -40.2981],
		zoom: 12,
		zoomControl: false,
		scrollWheelZoom: true,
	});
	L.control.zoom({ position: "bottomright" }).addTo(map);
	setBasemap(basemap);
	buildMarkers();

	// Garante que o Leaflet calcule as dimensões reais após o render do CSS
	const timer = window.setTimeout(() => {
		if (map) map.invalidateSize();
	}, 150);

	let ro: ResizeObserver | null = null;
	if (typeof ResizeObserver !== "undefined" && mapContainer) {
		ro = new ResizeObserver(() => {
			if (map) map.invalidateSize();
		});
		ro.observe(mapContainer);
	}

	return () => {
		window.clearTimeout(timer);
		if (ro) ro.disconnect();
		if (map) {
			map.remove();
			map = null;
		}
	};
});

// Reconstroi pins quando os dados ou a seleção mudam
$effect(() => {
	// dependências reativas
	void selectedStationId;
	void stations.length;
	if (map && Leaflet) buildMarkers();
});
</script>

<div class="relative w-full h-[380px] sm:h-[460px] rounded-2xl overflow-hidden glass-card ring-1 ring-slate-200">
  <!-- Container do Leaflet -->
  <div bind:this={mapContainer} class="w-full h-full z-0"></div>

  <!-- Cabeçalho: rede + seletor de basemap -->
  <div class="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 z-[400] flex flex-col gap-1.5 sm:gap-2 max-w-[232px] sm:max-w-[244px]">
    <div class="bg-white/94 border border-slate-200 backdrop-blur-xl rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5 shadow-xl">
      <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-sky-600"></span>
        Rede RAMQAr (IEMA/ES)
      </div>
      <div class="hidden sm:block text-slate-500 text-[11px] mt-0.5">9 estações · IQAr CONAMA 491</div>
      <!-- Seletor de basemap CARTO: alvo de toque mínimo de 44px em todas as larguras -->
      <div class="flex gap-1 mt-1.5 sm:mt-2 bg-slate-100 border border-slate-200 rounded-lg p-1">
        {#each BASEMAP_STYLES as style}
          <button
            type="button"
            onclick={() => setBasemap(style)}
            title="Basemap {BASEMAP_LABELS[style]} (CARTO)"
            class={basemap === style
              ? "flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold bg-sky-700 text-white shadow-sm transition-all min-h-[44px] cursor-pointer"
              : "flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold text-slate-700 hover:bg-white transition-all min-h-[44px] cursor-pointer"}
          >
            {BASEMAP_LABELS[style]}
          </button>
        {/each}
      </div>
    </div>

    <!-- Botão de Geolocalização -->
    <button
      type="button"
      onclick={locateUser}
      disabled={locating}
      class="btn-ghost !bg-white/94 backdrop-blur-xl shadow-xl disabled:opacity-60 min-h-[44px] cursor-pointer"
    >
      {#if locating}
        <span class="i-ph-spinner-bold w-4 h-4 animate-spin"></span>
        Localizando…
      {:else}
        <span class="i-ph-crosshair-fill w-4 h-4 text-sky-600"></span>
        <span class="text-sky-700">Estação mais próxima</span>
      {/if}
    </button>
    {#if locateError}
      <div class="bg-amber-50/95 border border-amber-200 backdrop-blur-xl rounded-xl px-2.5 py-2 shadow-xl text-[11px] text-amber-900 flex items-start justify-between gap-1.5" role="alert">
        <div class="flex items-start gap-1.5 min-w-0">
          <span class="i-ph-warning-circle-fill w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5"></span>
          <span class="leading-snug">{locateError}</span>
        </div>
        <button
          type="button"
          onclick={() => (locateError = null)}
          class="text-amber-700 hover:text-amber-950 p-1 rounded hover:bg-amber-100/70 transition-colors cursor-pointer shrink-0"
          aria-label="Dispensar aviso de localização no mapa"
        >
          <span class="i-ph-x-bold w-3 h-3"></span>
        </button>
      </div>
    {/if}
  </div>

  <!-- Legenda IQAr: glifo + cor + nome por faixa (a categoria nunca fica só na cor)
       e, em telas >= sm, a leitura secundária neutra do pin. -->
  <div class="absolute bottom-2.5 left-2.5 sm:bottom-3 sm:left-3 z-[400] bg-white/94 border border-slate-200 backdrop-blur-xl rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-xl max-w-[232px] sm:max-w-none">
    <div class="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">Faixa IQAr</div>
    <div class="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-semibold text-slate-700">
      {#each IQAR_BANDS as band}
        <span class="flex items-center gap-1">
          <span class="{band.icon} w-3 h-3 shrink-0" style="color: {band.text}"></span>
          <i class="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full inline-block shrink-0" style="background:{band.hex}"></i>
          <span>{band.label}</span>
        </span>
      {/each}
    </div>
    <div class="hidden sm:block mt-1.5 pt-1.5 border-t border-slate-200 text-[10px] leading-snug text-slate-500 max-w-[230px]">
      Pin: <strong class="font-mono text-slate-700">IQAr</strong> da faixa ·
      <strong class="font-mono text-slate-700">concentração µg/m³</strong> do poluente dominante, em cinza.
    </div>
  </div>

  <!-- Alerta de Localização do Usuário -->
  {#if userLocation}
    <div class="absolute left-2.5 right-12 bottom-20 sm:left-auto sm:right-3 sm:bottom-auto sm:top-3 z-[400] bg-sky-50/95 border border-sky-200 backdrop-blur-xl rounded-xl px-3 py-2 shadow-xl text-xs text-sky-900 sm:max-w-[240px]">
      Você está a <strong class="font-mono">{userLocation.distance} km</strong> de
      <strong>{stations.find((s) => s.id === userLocation?.nearestId)?.name}</strong>.
    </div>
  {/if}
</div>

<style>
  :global(.aq-pin-wrap) { background: transparent; border: none; }
  /* Lozenge de duas leituras: IQAr (faixa) em cima, concentração real embaixo.
     O halo colorido foi removido de propósito — sombra sem offset não é
     profundidade, é enfeite, e aqui ele competia com o número dentro do pin. */
  :global(.aq-pin) {
    position: relative;
    min-width: 44px; height: 44px;
    padding: 2px 7px 3px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    line-height: 1.05;
    background: rgba(255, 255, 255, 0.97);
    border: 2px solid var(--c);
    border-radius: 12px;
    box-shadow: 0 0 0 3px rgba(255,255,255,.75), 0 10px 20px -8px rgba(15,40,60,.45);
    transition: transform .15s ease;
  }
  :global(.aq-pin:hover) { transform: scale(1.08); }
  :global(.aq-pin-iqar) {
    display: flex; align-items: center; gap: 3px;
    color: #0f172a; font-weight: 800; font-size: 13px;
    font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums;
  }
  /* Cinco glifos de formas distintas = a redundância de FORMA que a cor não
     pode carregar sozinha. */
  :global(.aq-pin-band) { width: 9px; height: 9px; }
  /* Leitura secundária NEUTRA: concentração não é faixa e não veste a cor de
     nenhuma. Só a informação. */
  :global(.aq-pin-conc) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px; font-weight: 600; letter-spacing: -0.01em;
    color: #64748b; white-space: nowrap;
  }
  :global(.aq-pin-selected) {
    height: 50px;
    box-shadow: 0 0 0 3px #fff, 0 0 0 5px color-mix(in srgb, var(--c) 45%, transparent), 0 14px 26px -10px rgba(15,40,60,.5);
  }
  :global(.aq-pin-selected .aq-pin-iqar) { font-size: 15px; }
  :global(.aq-pin-selected .aq-pin-conc) { font-size: 9.5px; }
  /* Tela estreita: o pin encolhe em LARGURA (fonte e padding) e mantém 44px de
     altura, porque a altura é o alvo de toque. */
  @media (max-width: 640px) {
    :global(.aq-pin) { padding: 2px 4px 3px; border-radius: 10px; }
    :global(.aq-pin-iqar) { font-size: 11.5px; }
    :global(.aq-pin-band) { width: 8px; height: 8px; }
    :global(.aq-pin-conc) { font-size: 7.5px; }
    :global(.aq-pin-selected .aq-pin-iqar) { font-size: 13.5px; }
  }
  :global(.aq-pin-ring) {
    position: absolute; inset: -7px;
    border: 2px solid var(--c); border-radius: 9999px;
    opacity: .7; animation: aq-ping 1.8s ease-out infinite;
  }
  @keyframes aq-ping { 0% { transform: scale(.8); opacity: .8; } 100% { transform: scale(1.15); opacity: 0; } }
  :global(.aq-user-wrap) { background: transparent; border: none; }
  :global(.aq-user-dot) {
    width: 22px; height: 22px; border-radius: 9999px;
    background: rgba(56,189,248,.25); border: 2px solid #fff;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 14px rgba(56,189,248,.8);
  }
  :global(.aq-user-dot span) { width: 8px; height: 8px; border-radius: 9999px; background: #38bdf8; }
  :global(.leaflet-popup-content-wrapper) {
    background: rgba(255, 255, 255, 0.97);
    color: #334155;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    box-shadow: 0 20px 40px -12px rgba(15,40,60,.3);
  }
  :global(.leaflet-popup-content) { margin: 12px 14px; line-height: 1.4; }
  :global(.leaflet-popup-tip) { background: rgba(255,255,255,.97); border: 1px solid #e2e8f0; }
  :global(.aq-pop-title) { font-weight: 800; font-size: 13px; color: #0f172a; }
  :global(.aq-pop-sub) { font-size: 11px; color: #64748b; margin-bottom: 8px; }
  :global(.aq-pop-iqar) {
    display: flex; align-items: center; gap: 8px;
    background: color-mix(in srgb, var(--c) 10%, white);
    border: 1px solid color-mix(in srgb, var(--c) 25%, #cbd5e1);
    padding: 6px 10px; border-radius: 8px; font-size: 12px; color: #1e293b;
  }
  :global(.aq-pop-iqar strong) { font-family: 'JetBrains Mono', monospace; font-size: 15px; color: #0f172a; }
  :global(.aq-pop-band) { width: 12px; height: 12px; }
  :global(.aq-pop-conc) {
    display: flex; align-items: baseline; gap: 5px;
    margin-top: 7px; color: #475569; font-size: 11px; font-weight: 600;
  }
  :global(.aq-pop-conc strong) {
    font-family: 'JetBrains Mono', monospace; font-size: 16px; color: #0f172a;
    font-variant-numeric: tabular-nums;
  }
  :global(.aq-pop-note) { margin-top: 6px; font-size: 10.5px; line-height: 1.35; color: #64748b; }
  :global(.aq-pop-link) { display: block; margin-top: 8px; font-size: 11px; color: #0369a1; font-weight: 700; }
  :global(.leaflet-container) { font-family: 'Outfit', sans-serif; background: #e8eef4; }
  @media (prefers-reduced-motion: reduce) {
    :global(.aq-pin-ring) {
      animation: none !important;
    }
  }
</style>
