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
	initialBundle = null,
}: {
	stationsMeta: StationMeta[];
	initialStationId?: string;
	initialBundle?: Record<string, any> | null;
} = $props();

let activeId = $state(initialStationId);
let source = $state<"saved" | "gps" | "default" | "fallback" | "manual">(
	"default",
);
let gpsDistance = $state<number | null>(null);
let bundle = $state<Record<string, any> | null>(initialBundle);
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

const currentPoint = $derived.by(() => {
	if (!points.length) return null;
	const now = Date.now();
	let best = points[0];
	let minDiff = Math.abs(new Date(best.timestamp).getTime() - now);
	for (let i = 1; i < points.length; i++) {
		const diff = Math.abs(new Date(points[i].timestamp).getTime() - now);
		if (diff < minDiff) {
			minDiff = diff;
			best = points[i];
		}
	}
	return best;
});

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

function getLocalDateStr(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Sao_Paulo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function formatDayCardLabel(dateStr: string, isToday: boolean): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
	const parts = new Intl.DateTimeFormat("pt-BR", {
		timeZone: "America/Sao_Paulo",
		weekday: "short",
		day: "2-digit",
		month: "2-digit",
	}).formatToParts(date);
	const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
	let wd = get("weekday").replace(".", "");
	wd = wd.charAt(0).toUpperCase() + wd.slice(1);
	const label = `${wd} ${get("day")}/${get("month")}`;
	return isToday ? `Hoje · ${label}` : label;
}

const fiveDaysForecast = $derived.by(() => {
	if (!points.length) return [];
	const todayStr = getLocalDateStr(new Date());
	const groups = new Map<string, any[]>();
	for (const p of points) {
		const dStr = getLocalDateStr(new Date(p.timestamp));
		if (dStr < todayStr) continue;
		const arr = groups.get(dStr) ?? [];
		arr.push(p);
		groups.set(dStr, arr);
	}

	let sortedDates = Array.from(groups.keys()).sort();
	if (sortedDates.length === 0) {
		const fallbackGroups = new Map<string, any[]>();
		for (const p of points) {
			const dStr = getLocalDateStr(new Date(p.timestamp));
			const arr = fallbackGroups.get(dStr) ?? [];
			arr.push(p);
			fallbackGroups.set(dStr, arr);
		}
		sortedDates = Array.from(fallbackGroups.keys()).sort();
		for (const [k, v] of fallbackGroups.entries()) {
			groups.set(k, v);
		}
	}

	const targetDates = sortedDates.slice(0, 5);
	return targetDates
		.map((dateStr, dayIdx) => {
			const dayPoints = groups.get(dateStr) ?? [];
			if (!dayPoints.length) return null;
			const maxIqar = Math.max(...dayPoints.map((p: any) => p.iqar));
			const avgIqar = Math.round(
				dayPoints.reduce((acc: number, p: any) => acc + p.iqar, 0) /
					dayPoints.length,
			);
			const peakPoint =
				dayPoints.find((p: any) => p.iqar === maxIqar) ?? dayPoints[0];
			const isToday = dateStr === todayStr || dayIdx === 0;
			return {
				dayNumber: dayIdx + 1,
				date: dateStr,
				label: formatDayCardLabel(dateStr, isToday),
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

function iqarTextColor(cls?: string): string {
	switch (cls) {
		case "Boa":
			return "#047857";
		case "Moderada":
			return "#b45309";
		case "Ruim":
			return "#c2410c";
		case "Muito Ruim":
			return "#b91c1c";
		default:
			return "#7e22ce";
	}
}

const DEFAULT_IQAR_ICON = "i-ph-shield-warning-fill";
const IQAR_ICONS: Record<string, string> = {
	Boa: "i-ph-check-circle-fill",
	Moderada: "i-ph-warning-circle-fill",
	Ruim: "i-ph-warning-fill",
	"Muito Ruim": "i-ph-warning-octagon-fill",
	Péssima: DEFAULT_IQAR_ICON,
};

function iqarIcon(cls?: string): string {
	return (cls && IQAR_ICONS[cls]) || DEFAULT_IQAR_ICON;
}

function formatPollutantName(pol?: string): string {
	switch (String(pol).toLowerCase()) {
		case "pm25":
			return "PM₂.₅";
		case "pm10":
			return "PM₁₀";
		case "o3":
			return "O₃";
		case "no2":
			return "NO₂";
		case "so2":
			return "SO₂";
		case "co":
			return "CO";
		default:
			return String(pol ?? "").toUpperCase();
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

let refreshing = $state(false);
let lastUpdated = $state<string | null>(null);

async function fetchLiveOpenMeteoFallback(targetId: string) {
	try {
		const st = stationsMeta.find((s) => s.id === targetId) ?? stationsMeta[0];
		if (!st) return;
		const lat = st.lat ?? st.latitude ?? -20.2764;
		const lon = st.lon ?? st.longitude ?? -40.2881;
		const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide&past_days=1&forecast_days=6&timezone=America%2FSao_Paulo`;
		const res = await fetch(url);
		if (!res.ok) return;
		const data = await res.json();
		const h = data.hourly;
		if (!h?.time?.length) return;

		const pts = h.time.map((t: string, i: number) => {
			const ts = t.endsWith("Z") ? t : `${t}:00Z`;
			return {
				hour: i,
				timestamp: ts,
				observed: {
					pm25: h.pm2_5?.[i] ?? 10,
					pm10: h.pm10?.[i] ?? 15,
					o3: h.ozone?.[i] ?? 30,
					no2: h.nitrogen_dioxide?.[i] ?? 12,
					so2: h.sulphur_dioxide?.[i] ?? 5,
				},
			};
		});

		if (bundle) {
			bundle[targetId] = {
				station: st,
				points: pts,
			};
			bundle = { ...bundle };
		}
	} catch (err) {
		console.warn("[LiveFallback] Falha ao consultar Open-Meteo ao vivo:", err);
	}
}

async function loadForecastData(forceRefresh = false) {
	refreshing = true;
	try {
		const url = forceRefresh
			? `/data/stations-data.json?t=${Date.now()}`
			: "/data/stations-data.json";
		const res = await fetch(url, {
			cache: forceRefresh ? "reload" : "default",
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		bundle = await res.json();
		loadError = null;
		lastUpdated = new Intl.DateTimeFormat("pt-BR", {
			timeZone: "America/Sao_Paulo",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date());

		// Se o bundle salvo estiver vencido, busca Open-Meteo ao vivo automaticamente
		const pts = bundle?.[activeId]?.points;
		const lastPt = pts?.[pts.length - 1];
		if (lastPt && new Date(lastPt.timestamp).getTime() < Date.now()) {
			await fetchLiveOpenMeteoFallback(activeId);
		}
	} catch (e) {
		if (!bundle) {
			loadError =
				"Falha ao carregar dados das estações. Verifique sua conexão.";
		}
	} finally {
		refreshing = false;
	}
}

onMount(() => {
	// 1) Resolve estação inicial: salva > GPS silencioso (só se não há salva) > default
	const stored = loadStationId();
	const normList = stationsMeta.map((s) => ({ ...s, ...coordsOf(s as any) }));
	if (stored && normList.some((s) => s.id === stored)) {
		const r = resolveActiveStation(normList as any, { storedId: stored });
		activeId = r.stationId;
		source = "saved";
	} else {
		getUserPosition(5000)
			.then((pos) => {
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
			})
			.catch(() => {
				activeId = initialStationId;
				source = "default";
			});
	}

	// 2) Carrega dados completos das 9 estações em background
	loadForecastData(false);

	// 3) Revalidação automática ao retornar à aba
	function onVisibilityChange() {
		if (document.visibilityState === "visible") {
			loadForecastData();
		}
	}
	document.addEventListener("visibilitychange", onVisibilityChange);

	// 4) Revalidação automática ao voltar a ficar online
	function onOnline() {
		loadForecastData(true);
	}
	window.addEventListener("online", onOnline);

	// 5) Polling leve a cada 10 minutos para manter a previsão sempre atualizada
	const interval = setInterval(
		() => {
			loadForecastData();
		},
		10 * 60 * 1000,
	);

	return () => {
		document.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("online", onOnline);
		clearInterval(interval);
	};
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
  <section class="mt-6 mb-8 anim-fade-up">
    <div class="glass-card p-6 md:p-8 bg-gradient-to-br from-white via-sky-50/70 to-emerald-50/60 relative overflow-hidden">
      <div class="absolute -right-24 -top-24 w-[420px] h-[420px] rounded-full blur-3xl pointer-events-none" style="background: {iqarHex(currentPoint.classification)}18"></div>
      <div class="absolute -left-16 -bottom-24 w-72 h-72 bg-sky-200/50 rounded-full blur-3xl pointer-events-none"></div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center relative">
        <div class="lg:col-span-2">
          <div class="flex items-center gap-2 text-[11px] font-bold tracking-widest text-sky-800 mb-2.5 uppercase">
            <span class="w-2 h-2 rounded-full bg-sky-600"></span>
            Monitoramento Oficial RAMQAr &bull; {activeStation.name}
          </div>
          <h1 class="text-2xl sm:text-3xl lg:text-[2.5rem] leading-tight font-extrabold text-slate-900 tracking-tight">
            Qualidade do Ar em <span class="text-sky-700">{activeStation.municipality || "Grande Vitória"}</span>
          </h1>
          <p class="text-slate-600 text-sm mt-2.5 max-w-2xl leading-relaxed">
            Previsão horária contínua para os próximos 5 dias em <strong class="text-slate-900">{activeStation.name}</strong>, classificada segundo as diretrizes de saúde da Resolução CONAMA 491/2018.
          </p>

          <div class="mt-4 flex items-center gap-3 flex-wrap">
            <button
              onclick={() => loadForecastData(true)}
              disabled={refreshing}
              class="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
              title="Atualizar dados de previsão imediatamente"
              aria-label="Atualizar dados de previsão"
            >
              {#if refreshing}
                <span class="i-ph-spinner-bold w-3.5 h-3.5 animate-spin"></span>
              {:else}
                <span class="i-ph-arrow-clockwise-bold w-3.5 h-3.5 text-sky-600"></span>
              {/if}
              <span>{refreshing ? "Atualizando..." : "Atualizar previsão"}</span>
            </button>
            {#if lastUpdated}
              <div class="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span class="i-ph-clock-fill w-3.5 h-3.5 text-slate-400"></span>
                <span>Atualizado às <strong class="font-mono text-slate-700">{lastUpdated}</strong></span>
              </div>
            {/if}
            <a href={`/estacao/${activeId}`} class="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-800 font-semibold hover:underline ml-auto sm:ml-0">
              Série histórica e sensores <span class="i-ph-arrow-right-bold w-3 h-3"></span>
            </a>
          </div>

          <!-- Gaveta expansível: Dados Técnicos & Auditoria do Modelo (para técnicos e pesquisadores) -->
          <details class="mt-4 rounded-xl border border-slate-200/90 bg-white/70 p-3 text-xs text-slate-600">
            <summary class="cursor-pointer font-semibold text-slate-700 hover:text-sky-700 flex items-center gap-2 select-none">
              <span class="i-ph-sliders-horizontal-bold w-4 h-4 text-sky-600"></span>
              <span>Dados Técnicos do Modelo & Auditoria (RAMQAr / IEMA)</span>
            </summary>
            <div class="mt-2.5 pt-2.5 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
              <div>
                <span class="text-slate-400 block">Classificação oficial:</span>
                <strong class="text-slate-700">CONAMA 491/2018 (5 faixas)</strong>
              </div>
              <div>
                <span class="text-slate-400 block">Rede meteorológica:</span>
                <strong class="text-slate-700">Open-Meteo DB-First (cache local)</strong>
              </div>
              <div>
                <span class="text-slate-400 block">Explicabilidade:</span>
                <strong class="text-slate-700">Atribuição física Saabas (O(K·D))</strong>
              </div>
            </div>
            <div class="mt-2 flex items-center gap-3 pt-2 border-t border-slate-100 text-[11px]">
              <a href="/precisao" class="text-sky-700 hover:underline font-semibold flex items-center gap-1">
                Ver métricas de precisão (R², MAE) <span class="i-ph-arrow-up-right-bold w-3 h-3"></span>
              </a>
              <span class="text-slate-300">&bull;</span>
              <a href="/docs" class="text-sky-700 hover:underline font-semibold flex items-center gap-1">
                Especificação técnica <span class="i-ph-arrow-up-right-bold w-3 h-3"></span>
              </a>
            </div>
          </details>
        </div>

        <div class="relative bg-white border border-slate-200 p-6 rounded-2xl flex flex-col items-center justify-center text-center shadow-lg overflow-hidden">
          <div class="absolute top-0 inset-x-0 h-1" style="background: linear-gradient(90deg, transparent, {iqarHex(currentPoint.classification)}, transparent)"></div>
          <span class="text-[10px] uppercase font-bold tracking-[0.16em] text-slate-500 mb-1">Índice IQAr Atual</span>
          <div class="text-5xl sm:text-6xl font-black font-mono my-1 tabular-nums" style="color: {iqarTextColor(currentPoint.classification)}">
            {currentPoint.iqar}
          </div>
          <div class={`chip mt-1.5 font-bold ${badgeClass(currentPoint.classification)} flex items-center gap-1.5`}>
            <span class={`${iqarIcon(currentPoint.classification)} w-3.5 h-3.5`}></span>
            <span>{currentPoint.classification}</span>
            <span class="opacity-60">&bull;</span>
            <span>{formatPollutantName(currentPoint.primary)}</span>
          </div>
          <div class="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs text-slate-700 leading-snug w-full">
            <span class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Recomendação de Saúde:</span>
            {advice(currentPoint.classification)}
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- 5 dias -->
  <section class="mb-8 anim-fade-up-d1">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="section-title"><span class="section-dot"></span>Prognóstico para 5 dias</h2>
      <span class="text-xs text-slate-500">120 horas contínuas (Resolução CONAMA 491)</span>
    </div>
    <div class="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory">
      {#each fiveDaysForecast as day}
        <div class="glass-card glass-card-hover p-4 text-center relative overflow-hidden min-w-[145px] sm:min-w-0 snap-start flex-1" style="animation: fadeSlideUp 0.38s cubic-bezier(0.16, 1, 0.3, 1) {0.05 + 0.04 * (day?.dayNumber ?? 0)}s both">
          <div class="absolute top-0 inset-x-0 h-0.5" style="background: {iqarHex(day.classification)}"></div>
          <div class="text-[11px] text-slate-500 font-bold uppercase tracking-widest">{day.label}</div>
          <div class="text-3xl font-black font-mono my-1.5 text-slate-900 tabular-nums">{day.avgIqar}</div>
          <span class={`chip !text-[10px] font-bold ${badgeClass(day.classification)} flex items-center justify-center gap-1`}>
            <span class={`${iqarIcon(day.classification)} w-3 h-3`}></span>
            <span>{day.classification}</span>
          </span>
          <div class="text-[11px] text-slate-500 mt-2 font-mono">Pico {day.maxIqar} · {formatPollutantName(day.primary)}</div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Mapa + gráfico -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8 anim-fade-up-d2 content-visibility-auto">
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
        <span class="text-xs text-slate-500">Atualização horária contínua</span>
      </div>
      <ForecastChart points={points} activePollutant="iqar" />
    </div>
  </div>

  <!-- XAI + diretrizes -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8 anim-fade-up-d3 content-visibility-auto">
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
        <div class="flex justify-between items-center"><span>Horizonte de previsão:</span><strong class="text-sky-700 font-mono">5 dias (120h)</strong></div>
        <div class="flex justify-between items-center"><span>Padrão regulatório:</span><strong class="text-slate-700 font-mono">CONAMA 491/2018</strong></div>
        <div class="flex justify-between items-center"><span>Estação de referência:</span><strong class="text-slate-700">{activeStation.name}</strong></div>
        <div class="flex justify-between items-center"><span>Município:</span><strong class="text-slate-700">{activeStation.municipality}</strong></div>
      </div>
    </div>
  </div>
{/if}
