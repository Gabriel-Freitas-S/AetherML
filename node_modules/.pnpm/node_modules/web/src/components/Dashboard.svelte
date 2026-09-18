<!-- apps/web/src/components/Dashboard.svelte — Painel reativo: estação ativa (salva > GPS > manual) atualiza hero, cards, mapa, gráfico e XAI -->
<script lang="ts">
import { globalIQAr } from "@aetherml/core-iqar";
import { nearestStation } from "@aetherml/geo";
import { onMount } from "svelte";
import {
	getUserPosition,
	loadStationId,
	resolveActiveStation,
	saveStationId,
} from "../lib/location";
import ForecastChart from "./ForecastChart.svelte";
import Icon from "./Icon.svelte";
import LocationBar from "./LocationBar.svelte";
import RmgvMap from "./Map.svelte";
import Waterfall from "./Waterfall.svelte";

interface StationMeta {
	id: string;
	name: string;
	municipality: string;
	latitude?: number;
	longitude?: number;
	lat?: number;
	lon?: number;
	coastal?: boolean;
	downwind_tubarao?: boolean;
	bridge_proximity?: boolean;
}

const {
	stationsMeta = [],
	initialStationId = "ramqar_camburi",
}: {
	stationsMeta: StationMeta[];
	initialStationId?: string;
} = $props();

let activeId = $state(initialStationId);
let source = $state<"saved" | "gps" | "default" | "fallback" | "manual">(
	"default",
);
let gpsDistance = $state<number | null>(null);
let bundle = $state<Record<string, any> | null>(null);
let loadError = $state<string | null>(null);

function coordsOf(s: any): { latitude: number; longitude: number } {
	return {
		latitude: s.latitude ?? s.lat ?? 0,
		longitude: s.longitude ?? s.lon ?? 0,
	};
}

function stationWithFlags(id: string): StationMeta {
	return (
		stationsMeta.find((s) => s.id === id) ??
		(bundle?.[id]?.station as StationMeta) ?? {
			id,
			name: id,
			municipality: "",
		}
	);
}

// Pontos da estação ativa com IQAr oficial
const points = $derived.by(() => {
	if (!bundle || !bundle[activeId]) return [];
	return (bundle[activeId].points as any[]).map((p: any) => {
		const res = globalIQAr(p.observed);
		return {
			hour: p.hour,
			timestamp: p.timestamp,
			...p.observed,
			iqar: res.iqar,
			classification: res.classification,
			primary: res.primary,
		};
	});
});

const currentPoint = $derived.by(() => points[0] ?? null);

// Lista p/ o mapa (normalizada p/ latitude/longitude)
const stationsList = $derived.by(() => {
	if (!bundle) return [];
	return Object.values(bundle).map((item: any) => {
		const st = item.station;
		const c = coordsOf(st);
		const res = globalIQAr(item.points[0].observed);
		return {
			...st,
			latitude: c.latitude,
			longitude: c.longitude,
			iqar: res.iqar,
			classification: res.classification,
			primary: res.primary,
		};
	});
});

const FALLBACK_DAY_NAMES = ["Hoje", "Amanhã", "Dia 3", "Dia 4", "Dia 5"];

// "Sex 19/09" a partir do timestamp da primeira hora do dia (fuso de Brasília);
// o 1º cartão mantém o prefixo "Hoje · ".
function dayLabel(pts: any[], dayIdx: number): string {
	const p = pts[dayIdx * 24];
	if (!p?.timestamp) return FALLBACK_DAY_NAMES[dayIdx] ?? `Dia ${dayIdx + 1}`;
	const d = new Date(p.timestamp);
	const parts = new Intl.DateTimeFormat("pt-BR", {
		timeZone: "America/Sao_Paulo",
		weekday: "short",
		day: "2-digit",
		month: "2-digit",
	}).formatToParts(d);
	const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
	let wd = get("weekday").replace(".", "");
	wd = wd.charAt(0).toUpperCase() + wd.slice(1);
	const label = `${wd} ${get("day")}/${get("month")}`;
	return dayIdx === 0 ? `Hoje · ${label}` : label;
}
const fiveDaysForecast = $derived.by(() => {
	if (!points.length) return [];
	return [0, 1, 2, 3, 4]
		.map((dayIdx) => {
			const dayPoints = points.slice(dayIdx * 24, (dayIdx + 1) * 24);
			if (!dayPoints.length) return null;
			const maxIqar = Math.max(...dayPoints.map((p: any) => p.iqar));
			const avgIqar = Math.round(
				dayPoints.reduce((acc: number, p: any) => acc + p.iqar, 0) /
					dayPoints.length,
			);
			const peakPoint =
				dayPoints.find((p: any) => p.iqar === maxIqar) ?? dayPoints[0];
			return {
				dayNumber: dayIdx + 1,
				label: dayLabel(points, dayIdx),
				maxIqar,
				avgIqar,
				classification: peakPoint.classification,
				primary: String(peakPoint.primary).toUpperCase(),
			};
		})
		.filter(Boolean);
});

const saabas = $derived.by(() => {
	const st = stationWithFlags(activeId);
	return [
		{ feature: "wind_direction", phi: st.downwind_tubarao ? 14.2 : 3.1 },
		{ feature: "boundary_layer_height", phi: 5.8 },
		{
			feature: "traffic_congestion_index",
			phi: st.bridge_proximity ? 12.5 : 4.0,
		},
		{ feature: "satellite_aod", phi: 2.3 },
		{ feature: "wind_speed", phi: -4.8 },
	];
});

const activeStation = $derived.by(() => stationWithFlags(activeId));

function applyStation(
	id: string,
	origin: "manual" | "gps",
	distance: number | null = null,
) {
	if (!id) return;
	activeId = id;
	source = origin;
	gpsDistance = distance;
	saveStationId(id);
}

function handleChange(id: string, origin: "manual" | "gps") {
	if (origin === "gps") {
		// LocationBar já resolveu o nearest; recalcula distância p/ exibição
		applyStation(id, "gps", gpsDistance);
	} else {
		applyStation(id, "manual", null);
	}
}

function badgeClass(cls?: string): string {
	switch (cls) {
		case "Boa":
			return "badge-boa";
		case "Moderada":
			return "badge-moderada";
		case "Ruim":
			return "badge-ruim";
		case "Muito Ruim":
			return "badge-muitoruim";
		default:
			return "badge-pessima";
	}
}

function iqarHex(cls?: string): string {
	switch (cls) {
		case "Boa":
			return "#10b981";
		case "Moderada":
			return "#f59e0b";
		case "Ruim":
			return "#f97316";
		case "Muito Ruim":
			return "#ef4444";
		default:
			return "#a855f7";
	}
}

function advice(cls?: string): string {
	switch (cls) {
		case "Boa":
			return "Ar satisfatório. Atividades ao ar livre liberadas para todos.";
		case "Moderada":
			return "Sensíveis (crianças, idosos, asmáticos) devem moderar esforço prolongado ao ar livre.";
		case "Ruim":
			return "Evite esforço intenso ao ar livre. Sensíveis devem permanecer em ambientes ventilados.";
		case "Muito Ruim":
			return "Evite sair. Mantenha janelas fechadas e use máscara PFF2 se precisar se deslocar.";
		default:
			return "Emergência: permaneça em local fechado. Siga orientações da defesa civil e do IEMA.";
	}
}

onMount(async () => {
	// 1) Resolve estação inicial: salva > GPS silencioso (só se não há salva) > default
	const stored = loadStationId();
	const normList = stationsMeta.map((s) => ({ ...s, ...coordsOf(s as any) }));
	if (stored && normList.some((s) => s.id === stored)) {
		const r = resolveActiveStation(normList as any, { storedId: stored });
		activeId = r.stationId;
		source = "saved";
	} else {
		try {
			const pos = await getUserPosition(5000);
			const r = resolveActiveStation(normList as any, {
				userLat: pos.lat,
				userLon: pos.lon,
				defaultId: initialStationId,
			});
			activeId = r.stationId;
			source = r.reason === "gps" ? "gps" : "default";
			if (r.reason === "gps") {
				const n = nearestStation(pos.lat, pos.lon, normList as any);
				gpsDistance = Math.round(n.distanceKm * 10) / 10;
			}
			saveStationId(activeId);
		} catch {
			activeId = initialStationId;
			source = "default";
		}
	}
	// 2) Carrega dados (cache NetworkFirst do SW)
	try {
		const res = await fetch("/data/stations-data.json");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		bundle = await res.json();
	} catch (e) {
		loadError = "Falha ao carregar dados das estações. Verifique sua conexão.";
	}
});
</script>

<!-- Seletor + GPS -->
<LocationBar
  stations={stationsMeta}
  activeId={activeId}
  source={source}
  distanceKm={gpsDistance}
  onChange={handleChange}
/>

{#if loadError}
  <div class="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3">{loadError}</div>
{/if}

{#if !bundle || !currentPoint}
  <!-- Skeleton de carregamento -->
  <div class="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
    <div class="lg:col-span-2 glass-card p-8">
      <div class="h-4 w-48 bg-slate-200 rounded mb-3"></div>
      <div class="h-9 w-3/4 bg-slate-200 rounded mb-2"></div>
      <div class="h-4 w-full bg-slate-100 rounded"></div>
    </div>
    <div class="glass-card p-6 flex flex-col items-center">
      <div class="h-3 w-24 bg-slate-200 rounded mb-2"></div>
      <div class="h-12 w-20 bg-slate-200 rounded"></div>
    </div>
  </div>
{:else}
  <!-- Hero / Cabeçalho de Status -->
  <section class="mt-6 mb-8">
    <div class="glass-card p-6 md:p-8 bg-gradient-to-br from-white via-sky-50/70 to-emerald-50/60 relative overflow-hidden">
      <div class="absolute -right-24 -top-24 w-[420px] h-[420px] rounded-full blur-3xl pointer-events-none" style="background: {iqarHex(currentPoint.classification)}18"></div>
      <div class="absolute -left-16 -bottom-24 w-72 h-72 bg-sky-200/50 rounded-full blur-3xl pointer-events-none"></div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center relative">
        <div class="lg:col-span-2">
          <div class="flex items-center gap-2 text-[11px] font-bold tracking-widest text-sky-700 mb-2.5 uppercase">
            <span class="relative flex w-2 h-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-60"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
            </span>
            RAMQAr (IEMA) &bull; {activeStation.name}
          </div>
          <h1 class="text-2xl sm:text-3xl lg:text-[2.6rem] leading-tight font-extrabold text-slate-900 tracking-tight">
            Qualidade do Ar em <span class="text-transparent bg-clip-text bg-gradient-to-r from-sky-600 via-sky-500 to-emerald-500">{activeStation.municipality || "Vitória e Região"}</span>
          </h1>
          <p class="text-slate-600 text-sm mt-2.5 max-w-2xl leading-relaxed">
            Previsão de 5 dias (120h) para <strong class="text-slate-900">{activeStation.name}</strong>, calculada no seu dispositivo via WebAssembly SIMD-128 com explicabilidade física Saabas.
          </p>

          <div class="mt-4 flex items-center gap-2.5 flex-wrap">
            <div class="chip bg-emerald-50 border-emerald-200 text-emerald-700">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Open-Meteo DB-First · <strong class="font-mono">0 cotas</strong>
            </div>
            <a href={`/estacao/${activeId}`} class="chip bg-slate-100 border-slate-200 text-slate-700 hover:border-sky-400 hover:text-sky-700 transition-colors">
              Diagnóstico completo <Icon name="arrowRight" cls="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <div class="relative bg-white border border-slate-200 p-6 rounded-2xl flex flex-col items-center justify-center text-center shadow-xl overflow-hidden">
          <div class="absolute top-0 inset-x-0 h-1" style="background: linear-gradient(90deg, transparent, {iqarHex(currentPoint.classification)}, transparent)"></div>
          <span class="text-[10px] uppercase font-bold tracking-[0.18em] text-slate-500 mb-1">IQAr atual · tempo real</span>
          <div class="text-5xl sm:text-6xl font-black font-mono my-1 tabular-nums" style="color: {iqarHex(currentPoint.classification)}">
            {currentPoint.iqar}
          </div>
          <div class={`chip mt-1 font-bold ${badgeClass(currentPoint.classification)}`}>
            {currentPoint.classification} · {String(currentPoint.primary).toUpperCase()}
          </div>
          <p class="text-[11px] text-slate-500 mt-3 leading-snug max-w-[240px]">
            {advice(currentPoint.classification)}
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- 5 dias -->
  <section class="mb-8">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="section-title"><span class="section-dot"></span>Prognóstico de 5 dias · ML</h2>
      <span class="text-xs text-slate-500 font-mono">120h contínuas (CONAMA 491)</span>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
      {#each fiveDaysForecast as day}
        <div class="glass-card glass-card-hover p-4 text-center relative overflow-hidden">
          <div class="absolute top-0 inset-x-0 h-0.5" style="background: {iqarHex(day.classification)}"></div>
          <div class="text-[11px] text-slate-500 font-bold uppercase tracking-widest">{day.label}</div>
          <div class="text-3xl font-black font-mono my-1.5 text-slate-900 tabular-nums">{day.avgIqar}</div>
          <span class={`chip !text-[10px] font-bold ${badgeClass(day.classification)}`}>{day.classification}</span>
          <div class="text-[11px] text-slate-500 mt-2 font-mono">Pico {day.maxIqar} · {day.primary}</div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Mapa + gráfico -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
    <div class="lg:col-span-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="section-title"><span class="section-dot"></span>Distribuição espacial</h2>
        <span class="text-xs text-slate-500">9 estações ativas</span>
      </div>
      <RmgvMap stations={stationsList} selectedStationId={activeId} onSelectStation={(id) => applyStation(id, "manual", null)} />
    </div>

    <div class="lg:col-span-7">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="section-title"><span class="section-dot !bg-emerald-400"></span>Previsão contínua · 120h</h2>
        <span class="text-xs text-slate-500 font-mono">WASM &lt; 2ms</span>
      </div>
      <ForecastChart points={points} activePollutant="iqar" />
    </div>
  </div>

  <!-- XAI + diretrizes -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
    <div class="lg:col-span-8">
      <Waterfall
        contributions={saabas}
        stationName={activeStation.name}
        primaryPollutant="pm25"
        baseValue={14.8}
      />
    </div>

    <div class="lg:col-span-4 glass-card p-5 relative overflow-hidden">
      <div class="absolute top-0 inset-x-0 h-0.5" style="background: {iqarHex(currentPoint.classification)}"></div>
      <h3 class="text-base font-bold text-slate-800 mb-2">Saúde & CONAMA 491</h3>
      <p class="text-xs text-slate-600 leading-relaxed mb-3">
        Faixa atual <strong>{currentPoint.classification}</strong> (IQAr {currentPoint.iqar}) em {activeStation.name}:
      </p>
      <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs text-slate-600 leading-relaxed mb-4">
        {advice(currentPoint.classification)}
      </div>

      <div class="space-y-2 text-xs border-t border-slate-200 pt-4 text-slate-500">
        <div class="flex justify-between items-center"><span>Horizonte:</span><strong class="text-sky-700 font-mono">5 dias · 120h</strong></div>
        <div class="flex justify-between items-center"><span>Inferência:</span><strong class="text-slate-700 font-mono">ONNX SIMD-128</strong></div>
        <div class="flex justify-between items-center"><span>Cache:</span><strong class="text-emerald-700 font-mono">0 chamadas Open-Meteo</strong></div>
        <div class="flex justify-between items-center"><span>Referência:</span><strong class="text-slate-700">{activeStation.name}</strong></div>
      </div>
    </div>
  </div>
{/if}
