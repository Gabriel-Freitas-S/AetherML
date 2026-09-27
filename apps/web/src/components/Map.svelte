<!-- apps/web/src/components/Map.svelte — Mapa Leaflet com estações RAMQAr, basemap CARTO (rastertiles + ?key=) e GPS inteligente -->
<script lang="ts">
import { getStationCoords, nearestStation } from "@aetherml/geo";
import { onMount } from "svelte";
import {
	BASEMAP_LABELS,
	BASEMAP_STYLES,
	type BasemapStyle,
	DEFAULT_BASEMAP,
	tileUrl,
} from "../lib/basemaps";
import { loadBasemap, saveBasemap } from "../lib/location";

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
}

const {
	stations = [],
	selectedStationId = "ramqar_camburi",
	onSelectStation,
}: {
	stations: StationWithStatus[];
	selectedStationId?: string;
	onSelectStation?: (id: string) => void;
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

function getIqarColor(cls?: string): string {
	switch (cls) {
		case "Boa":
			return "#10b981";
		case "Moderada":
			return "#f59e0b";
		case "Ruim":
			return "#f97316";
		case "Muito Ruim":
			return "#ef4444";
		case "Péssima":
			return "#a855f7";
		default:
			return "#22d3ee";
	}
}

function coordsOf(s: StationWithStatus): [number, number] {
	const c = getStationCoords(s as any);
	return [c.latitude, c.longitude];
}

function markerHtml(s: StationWithStatus, selected: boolean): string {
	const color = getIqarColor(s.classification);
	const label = s.iqar ?? "–";
	return `<div class="aq-pin ${selected ? "aq-pin-selected" : ""}" style="--c:${color}">
    <span class="aq-pin-val">${label}</span>
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
		const color = getIqarColor(s.classification);
		const icon = Leaflet.divIcon({
			className: "aq-pin-wrap",
			html: markerHtml(s, selected),
			iconSize: selected ? [44, 44] : [38, 38],
			iconAnchor: selected ? [22, 22] : [19, 19],
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
        <div class="aq-pop-iqar" style="--c:${color}">
          <strong>${s.iqar ?? "…"}</strong>
          <span>${s.classification ?? "Calculando"}${s.primary ? ` · ${String(s.primary).toUpperCase()}` : ""}</span>
        </div>
        <a class="aq-pop-link" href="/estacao/${s.id}">Ver diagnóstico completo →</a>
      </div>`,
			{ closeButton: false, offset: [0, -6] },
		);
		m.on("click", () => {
			if (onSelectStation) onSelectStation(s.id);
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
		crossOrigin: true,
	}).addTo(map);
}

async function locateUser() {
	locateError = null;
	if (!("geolocation" in navigator)) {
		locateError = "Geolocalização não suportada neste navegador.";
		return;
	}
	locating = true;
	try {
		const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
			navigator.geolocation.getCurrentPosition(resolve, reject, {
				enableHighAccuracy: false,
				timeout: 9000,
				maximumAge: 300000,
			}),
		);
		const { latitude, longitude, accuracy } = pos.coords;
		const nearest = nearestStation(latitude, longitude, stations as any);
		userLocation = {
			lat: latitude,
			lon: longitude,
			nearestId: nearest.station.id,
			distance: Math.round(nearest.distanceKm * 10) / 10,
		};
		if (map && Leaflet) {
			if (userMarker) map.removeLayer(userMarker);
			if (userCircle) map.removeLayer(userCircle);
			userCircle = Leaflet.circle([latitude, longitude], {
				radius: Math.min(Math.max(accuracy ?? 60, 40), 400),
				color: "#38bdf8",
				weight: 1,
				fillColor: "#38bdf8",
				fillOpacity: 0.12,
			}).addTo(map);
			userMarker = Leaflet.marker([latitude, longitude], {
				icon: Leaflet.divIcon({
					className: "aq-user-wrap",
					html: `<div class="aq-user-dot"><span></span></div>`,
					iconSize: [22, 22],
					iconAnchor: [11, 11],
				}),
				zIndexOffset: 2000,
			}).addTo(map);
			map.flyTo([latitude, longitude], 13, { duration: 0.9 });
			const target = markers[nearest.station.id];
			if (target) window.setTimeout(() => target.openPopup(), 950);
		}
		if (onSelectStation) onSelectStation(nearest.station.id);
	} catch {
		locateError =
			"Não foi possível obter sua localização. Verifique a permissão do navegador.";
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

<div class="relative w-full h-[340px] sm:h-[460px] rounded-2xl overflow-hidden glass-card ring-1 ring-slate-200">
  <!-- Container do Leaflet -->
  <div bind:this={mapContainer} class="w-full h-full z-0"></div>

  <!-- Cabeçalho: rede + seletor de basemap -->
  <div class="absolute top-3 left-3 z-[400] flex flex-col gap-2 max-w-[240px]">
    <div class="bg-white/92 border border-slate-200 backdrop-blur-xl rounded-xl px-3 py-2.5 shadow-xl">
      <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-sky-600"></span>
        Rede RAMQAr (IEMA/ES)
      </div>
      <div class="text-slate-500 text-[11px] mt-0.5">9 estações · IQAr CONAMA 491</div>
      <!-- Seletor de basemap CARTO -->
      <div class="flex gap-1 mt-2 bg-slate-100 border border-slate-200 rounded-lg p-1">
        {#each BASEMAP_STYLES as style}
          <button
            onclick={() => setBasemap(style)}
            title="Basemap {BASEMAP_LABELS[style]} (CARTO)"
            class={basemap === style
              ? "flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold bg-sky-700 text-white shadow-sm transition-all min-h-[32px] cursor-pointer"
              : "flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold text-slate-700 hover:bg-white transition-all min-h-[32px] cursor-pointer"}
          >
            {BASEMAP_LABELS[style]}
          </button>
        {/each}
      </div>
    </div>

    <!-- Botão de Geolocalização -->
    <button
      onclick={locateUser}
      disabled={locating}
      class="btn-ghost !bg-white/92 backdrop-blur-xl shadow-xl disabled:opacity-60 min-h-[44px] cursor-pointer"
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
      <div class="bg-red-50 border border-red-200 backdrop-blur-xl rounded-xl px-3 py-2 shadow-xl text-[11px] text-red-700">
        {locateError}
      </div>
    {/if}
  </div>

  <!-- Legenda IQAr -->
  <div class="absolute bottom-3 left-3 z-[400] bg-white/92 border border-slate-200 backdrop-blur-xl rounded-xl px-3 py-2 shadow-xl">
    <div class="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">IQAr</div>
    <div class="flex items-center gap-2.5 text-[10px] font-semibold text-slate-600">
      <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full inline-block" style="background:#10b981"></i>Boa</span>
      <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full inline-block" style="background:#f59e0b"></i>Mod.</span>
      <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full inline-block" style="background:#f97316"></i>Ruim</span>
      <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full inline-block" style="background:#ef4444"></i>M.Ruim</span>
      <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full inline-block" style="background:#a855f7"></i>Pés.</span>
    </div>
  </div>

  <!-- Alerta de Localização do Usuário -->
  {#if userLocation}
    <div class="absolute left-3 right-3 bottom-16 sm:left-auto sm:right-3 sm:bottom-auto sm:top-3 z-[400] bg-sky-50/95 border border-sky-200 backdrop-blur-xl rounded-xl px-3 py-2 shadow-xl text-xs text-sky-900 sm:max-w-[240px]">
      Você está a <strong>{userLocation.distance} km</strong> de
      <strong>{stations.find((s) => s.id === userLocation?.nearestId)?.name}</strong>.
    </div>
  {/if}
</div>

<style>
  :global(.aq-pin-wrap) { background: transparent; border: none; }
  :global(.aq-pin) {
    position: relative;
    width: 38px; height: 38px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255, 255, 255, 0.96);
    border: 2px solid var(--c);
    border-radius: 9999px;
    box-shadow: 0 0 0 3px rgba(255,255,255,.7), 0 0 14px -2px var(--c), 0 8px 18px -6px rgba(15,40,60,.4);
    transition: transform .15s ease;
  }
  :global(.aq-pin:hover) { transform: scale(1.12); }
  :global(.aq-pin-val) { color: #0f172a; font-weight: 800; font-size: 12px; font-family: 'JetBrains Mono', monospace; }
  :global(.aq-pin-selected) { width: 44px; height: 44px; border-color: #fff; }
  :global(.aq-pin-selected .aq-pin-val) { font-size: 13px; }
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
  :global(.aq-pop-link) { display: block; margin-top: 8px; font-size: 11px; color: #0369a1; font-weight: 700; }
  :global(.leaflet-container) { font-family: 'Outfit', sans-serif; background: #e8eef4; }
  @media (prefers-reduced-motion: reduce) {
    :global(.aq-pin-ring) {
      animation: none !important;
    }
  }
</style>
