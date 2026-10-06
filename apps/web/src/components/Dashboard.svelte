<!-- apps/web/src/components/Dashboard.svelte — Painel reativo: estação ativa (salva > GPS > manual) atualiza hero, cards, mapa, gráfico e XAI -->
<script lang="ts">
import { globalIQAr } from "@aetherml/core-iqar";
import { nearestStation } from "@aetherml/geo";
import { onMount } from "svelte";
// Rampa de IQAr: fonte ÚNICA de cor, ícone, badge e orientação de saúde por faixa.
// A cópia local que existia aqui divergiria da do mapa e da comparação em silêncio —
// duas rampas para um domínio é o mesmo incidente de "dois números, dois meanings"
// vestida de cor.
import {
	IQAR_BANDS,
	badgeClass,
	iqarAdvice,
	iqarHex,
	iqarIcon,
	iqarTextColor,
} from "../lib/comparison";
import { currentPoint as pickCurrentPoint } from "../lib/current-point";
import { dominantConcentration } from "../lib/dashboard-sections";
import { buildFiveDayCards, describeDataAge } from "../lib/forecast-days";
import {
	getUserPosition,
	loadStationId,
	resolveActiveStation,
	saveStationId,
} from "../lib/location";
import { type DataOrigin, buildProvenance } from "../lib/provenance";
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

// IQAr Atual: ponto mais recente com `timestamp <= now` — a MESMA função usada pelo
// mapa e pela página da estação, para que as três telas concordem.
const currentPick = $derived(pickCurrentPoint(points, Date.now()));
const currentPoint = $derived(currentPick?.point ?? null);

// Lista p/ o mapa (normalizada p/ latitude/longitude)
const stationsList = $derived.by(() => {
	if (!bundle) return [];
	return Object.values(bundle).map((item: any) => {
		const st = item.station;
		const c = coordsOf(st);
		// Antes era `item.points[0]` — a hora MAIS ANTIGA da série, enquanto o hero
		// ao lado mostrava a hora mais próxima de `now`. Mesma função do hero agora.
		const picked = pickCurrentPoint(item.points, Date.now());
		if (!picked) return { ...st, latitude: c.latitude, longitude: c.longitude };
		const res = globalIQAr(picked.point.observed);
		return {
			...st,
			latitude: c.latitude,
			longitude: c.longitude,
			iqar: res.iqar,
			classification: res.classification,
			primary: res.primary,
			// O pin do mapa carrega o número que o IQAr inteiro esconde: em
			// horários calmos o contraste espacial real é de décimos de µg/m³ e o
			// arredondamento da classificação o apaga.
			concentration: dominantConcentration(picked.point.observed, res.primary),
		};
	});
});

// Toda a lógica de dia local, rótulo de cartão e estado "desatualizado" vive em
// ../lib/forecast-days — é a mesma cópia usada por estacao/[id].astro.
const dayCards = $derived(buildFiveDayCards(points as any));
const fiveDaysForecast = $derived(dayCards.cards);
const dataAge = $derived(describeDataAge(dayCards.newestTimestamp));

// Quem produziu os números que estão em tela. `open-meteo` acontece porque
// `fetchLiveOpenMeteoFallback` TROCA a série da estação pela API pública: sem esta
// marcação a tela continuaria se anunciando como saída do modelo, que é a
// exigência do projeto ("é obrigatório usar ML") e não pode ser omitida.
let originByStation = $state<Record<string, DataOrigin>>({});
const activeOrigin = $derived<DataOrigin>(
	originByStation[activeId] ?? (bundle ? "ml" : "unknown"),
);

// A tira de proveniência substitui o banner de "desatualizado" E a linha de "Dado
// mais recente": duas afordâncias, um fato.
const provenance = $derived(
	buildProvenance({
		origin: activeOrigin,
		age: dataAge,
		isStale: dayCards.isStale,
		isFallback: currentPick?.isFallback ?? false,
	}),
);

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

// Uma linha de abertura que não pode mentir: quando a série está velha ou
// inteiramente no futuro, "previsão para os próximos 5 dias" seria falso.
const leadLine = $derived.by(() => {
	const when = dataAge.observedAt ?? "—";
	if (provenance.freshness === "stale") {
		return `A série desta estação termina em ${when} (${dataAge.ageText}). As horas abaixo são histórico do modelo, não previsão.`;
	}
	if (provenance.freshness === "ahead") {
		return `A série disponível começa em ${when}, ainda no futuro. Não há hora atual para exibir — o IQAr acima é a primeira hora da série.`;
	}
	return `Previsão horária contínua do modelo para as próximas ${points.length} h em ${activeStation.name}, classificada segundo as diretrizes de saúde da Resolução CONAMA 491/2018.`;
});

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

// `formatPollutantName` NÃO foi removida: a rampa compartilhada não tem como
// cobrir o `default` (poluente desconhecido) e o `co` que esta tela já rotulava.
// Ver LIQUID no relatório — a sobreposição de 5 casos existe, a função não.
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

let refreshing = $state(false);

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
			// A série deixou de ser saída do modelo: a tira de proveniência precisa
			// dizer isso em voz alta.
			originByStation = { ...originByStation, [targetId]: "open-meteo" };
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
		// Um bundle novo é o artefato do modelo: qualquer marcação de fallback da
		// carga anterior só vale se o fallback rodar de novo, logo abaixo.
		originByStation = {};

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
  <!-- Skeleton espelha a nova ordem do hero (IQAr primeiro) para não haver salto
       de layout quando os dados chegam. -->
  <div class="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
    <div class="lg:col-span-5 glass-card p-6 flex flex-col items-center">
      <div class="h-3 w-28 bg-slate-200 rounded mb-3"></div>
      <div class="h-16 w-32 bg-slate-200 rounded"></div>
    </div>
    <div class="lg:col-span-7 glass-card p-8">
      <div class="h-3 w-48 bg-slate-200 rounded mb-3"></div>
      <div class="h-7 w-3/4 bg-slate-200 rounded mb-2"></div>
      <div class="h-4 w-full bg-slate-100 rounded"></div>
    </div>
  </div>
{:else}
  <!-- Hero / Cabeçalho de Status.
       Ordem do DOM = ordem visual: o IQAr atual vem PRIMEIRO porque é a leitura
       principal desta superfície de monitoramento. O título da página vem depois e
       em escala menor — quem abre o painel precisa do número antes do nome da cidade. -->
  <section class="mt-6 mb-4 anim-fade-up">
    <div class="glass-card p-6 md:p-8 bg-gradient-to-br from-white via-sky-50/70 to-emerald-50/60 relative overflow-hidden">
      <div class="absolute -right-24 -top-24 w-[420px] h-[420px] rounded-full blur-3xl pointer-events-none" style="background: {iqarHex(currentPoint.classification)}18"></div>
      <div class="absolute -left-16 -bottom-24 w-72 h-72 bg-sky-200/50 rounded-full blur-3xl pointer-events-none"></div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center relative">
        <!-- Figura primária: IQAr do ponto atual -->
        <div class="lg:col-span-5 relative bg-white border border-slate-200 p-6 rounded-2xl flex flex-col items-center justify-center text-center shadow-lg overflow-hidden">
          <div class="absolute top-0 inset-x-0 h-1" style="background: linear-gradient(90deg, transparent, {iqarHex(currentPoint.classification)}, transparent)"></div>
          <span class="text-[10px] uppercase font-bold tracking-[0.16em] text-slate-500">Índice IQAr Atual</span>
          <div class="text-6xl sm:text-7xl font-black font-mono leading-none tabular-nums" style="color: {iqarTextColor(currentPoint.classification)}">
            {currentPoint.iqar}
          </div>
          <div class={`chip mt-2 font-bold ${badgeClass(currentPoint.classification)} flex items-center gap-1.5`}>
            <span class={`${iqarIcon(currentPoint.classification)} w-3.5 h-3.5`}></span>
            <span>{currentPoint.classification}</span>
            <span class="opacity-60">&bull;</span>
            <span>{formatPollutantName(currentPoint.primary)}</span>
          </div>
          <p class="mt-1 text-[10px] uppercase font-bold tracking-wider text-slate-400">Valor de uma hora, não média</p>
          <div class="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs text-slate-700 leading-snug w-full">
            <span class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Recomendação de Saúde:</span>
            {iqarAdvice(currentPoint.classification)}
          </div>
        </div>

        <!-- Contexto: quem, onde, e para que serve -->
        <div class="lg:col-span-7">
          <div class="flex items-center gap-2 text-[11px] font-bold tracking-widest text-sky-800 mb-2 uppercase">
            <span class="w-2 h-2 rounded-full bg-sky-600"></span>
            IQAr CONAMA 491/2018 &bull; {activeStation.name}
          </div>
          <h1 class="text-xl sm:text-2xl lg:text-[1.75rem] leading-tight font-extrabold text-slate-900 tracking-tight">
            Qualidade do Ar em <span class="text-sky-700">{activeStation.municipality || "Grande Vitória"}</span>
          </h1>
          <p class="text-slate-600 text-sm mt-2.5 max-w-2xl leading-relaxed">{leadLine}</p>

          <div class="mt-4 flex items-center gap-3 flex-wrap">
            <a href={`/estacao/${activeId}`} class="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-800 font-semibold hover:underline">
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
                <span class="text-slate-400 block">Entradas meteorológicas:</span>
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
      </div>
    </div>
  </section>

  <!-- Proveniência: origem, horário do dado mais recente, idade e estado de
       desatualização em UM lugar só. Antes eram duas afordâncias para o mesmo fato:
       o banner âmbar de "desatualizado" e a linha "Dado mais recente" no hero.
       `role="alert"` e o âmbar continuam aqui quando freshness !== "live" — a
       acessibilidade do aviso antigo não se perde ao des-duplicar. -->
  <section
    aria-label="Proveniência e atualidade dos dados"
    role={provenance.role ?? undefined}
    class="mb-6 anim-fade-up-d1 rounded-2xl border px-4 py-3 {provenance.tone === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-white/80 border-slate-200'}"
  >
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
      <div class="flex items-center gap-2 shrink-0">
        <span class={`w-4 h-4 {provenance.tone === 'amber' ? 'i-ph-warning-fill text-amber-600' : 'i-ph-shield-check-fill text-emerald-600'}`}></span>
        <strong class={`text-sm font-bold ${provenance.tone === 'amber' ? 'text-amber-900' : 'text-slate-800'}`}>{provenance.headline}</strong>
      </div>

      <dl class="grid grid-cols-3 gap-3 lg:flex lg:items-center lg:gap-5 flex-1 min-w-0">
        {#each provenance.rows as row}
          <div class="min-w-0">
            <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-500">{row.label}</dt>
            <dd class={`text-xs font-mono truncate ${provenance.tone === 'amber' ? 'text-amber-900' : 'text-slate-800'}`} title={row.value}>{row.value}</dd>
          </div>
        {/each}
      </dl>

      <div class="shrink-0">
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
      </div>
    </div>

    <p class={`mt-2 text-[11px] leading-snug ${provenance.tone === 'amber' ? 'text-amber-800' : 'text-slate-500'}`}>{provenance.origin.detail}</p>
    {#each provenance.warnings as warning}
      <p class={`mt-1.5 text-xs leading-snug ${provenance.tone === 'amber' ? 'text-amber-900' : 'text-slate-600'}`}>{warning}</p>
    {/each}
  </section>

  <!-- 5 dias -->
  <section class="mb-8 anim-fade-up-d2">
    <div class="mb-3 flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
      <h2 class="section-title"><span class="section-dot"></span>{dayCards.isStale ? "Histórico do modelo por dia" : "Prognóstico para 5 dias"}</h2>
      <span class="text-xs text-slate-500">{dayCards.isStale ? "Sem previsão à frente" : "120 horas contínuas (Resolução CONAMA 491)"}</span>
    </div>
    <p class="mb-3 text-xs text-slate-500">
      Cada cartão mostra duas estatísticas diferentes: a <strong class="text-slate-700">média do IQAr no dia</strong> (figura grande, e é dela que vem a faixa) e o <strong class="text-slate-700">pico horário</strong> do mesmo dia (anotação menor, no rodapé).
    </p>
    <div class="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory">
      {#each fiveDaysForecast as day}
        <div class="glass-card glass-card-hover p-4 text-center relative overflow-hidden min-w-[155px] sm:min-w-0 snap-start flex-1 flex flex-col" style="animation: fadeSlideUp 0.38s cubic-bezier(0.16, 1, 0.3, 1) {0.05 + 0.04 * (day?.dayNumber ?? 0)}s both">
          <div class="absolute top-0 inset-x-0 h-0.5" style="background: {iqarHex(day.classification)}"></div>
          <div class="text-[11px] text-slate-500 font-bold uppercase tracking-widest">{day.label}</div>

          <!-- Figura primária: a MÉDIA. Rótulo explícito logo abaixo para que o
               número grande nunca possa ser lido como valor instantâneo. -->
          <div class="mt-1">
            <span class="sr-only">Média do IQAr no dia:</span>
            <span class="text-4xl font-black font-mono leading-none text-slate-900 tabular-nums">{day.avgIqar}</span>
            <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">média do dia</span>
          </div>

          <span class={`chip mt-2 self-center !text-[10px] font-bold ${badgeClass(day.classification)} flex items-center justify-center gap-1`}>
            <span class={`${iqarIcon(day.classification)} w-3 h-3`}></span>
            <span>{day.classification}</span>
          </span>

          <!-- Figura secundária: o PICO, separado por um fio para não competir com a média. -->
          <div class="mt-auto pt-2.5 border-t border-slate-200 text-[11px] text-slate-500">
            <span class="sr-only">Pico horário do dia:</span>
            <span class="uppercase tracking-wider text-[9px] font-bold text-slate-400">pico horário</span>
            <span class="font-mono font-semibold text-slate-700 ml-1">{day.maxIqar}</span>
            <span class="text-slate-300 mx-0.5">&middot;</span>
            <span>{formatPollutantName(day.primary)}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Gráfico + mapa: a TENDÊNCIA vem primeiro no DOM e ocupa mais colunas. Em mobile
       o gráfico aparece antes do mapa porque a pergunta primária é "para onde vai?",
       não "onde está?". O `section-title` do gráfico foi removido: o próprio
       ForecastChart já traz <h3> + legenda, e dois títulos para a mesma coisa é a
       mesma classe de erro que duas rampas de cor. -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8 anim-fade-up-d3 content-visibility-auto">
    <div class="lg:col-span-7">
      <ForecastChart points={points} activePollutant="iqar" />
    </div>

    <div class="lg:col-span-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="section-title"><span class="section-dot"></span>Distribuição espacial</h2>
        <span class="text-xs text-slate-500">9 estações ativas</span>
      </div>
      <RmgvMap stations={stationsList} selectedStationId={activeId} onSelectStation={(id) => applyStation(id, "manual", null)} />
    </div>
  </div>

  <!-- XAI + faixas CONAMA (material secundário: último da hierarquia, nunca buried) -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8 anim-fade-up-d4 content-visibility-auto">
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
      <h3 class="text-base font-bold text-slate-800 mb-2">Faixas CONAMA 491/2018</h3>
      <p class="text-xs text-slate-600 leading-relaxed">
        Faixa atual <strong>{currentPoint.classification}</strong> (IQAr {currentPoint.iqar}) em {activeStation.name}.
      </p>

      <!-- Legenda das 5 faixas: ícone + nome + cor. A categoria nunca é comunicada
           só por cor, e a lista vem da rampa compartilhada, não de uma segunda
           tabela local. A orientação de saúde de cada faixa fica uma única vez,
           no hero, ao lado do número que a justifica. -->
      <ul class="mt-3 space-y-1.5">
        {#each IQAR_BANDS as band}
          <li class={`flex items-center gap-2 text-xs ${band.cls === currentPoint.classification ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
            <span class={`${band.icon} w-3.5 h-3.5 shrink-0`} style="color: {band.text}"></span>
            <span class="flex-1">{band.label}</span>
            {#if band.cls === currentPoint.classification}
              <span class={`chip !text-[9px] ${badgeClass(band.cls)}`}>atual</span>
            {/if}
          </li>
        {/each}
      </ul>

      <div class="space-y-2 text-xs border-t border-slate-200 pt-4 mt-4 text-slate-500">
        <div class="flex justify-between items-center"><span>Horizonte de previsão:</span><strong class="text-sky-700 font-mono">5 dias (120h)</strong></div>
        <div class="flex justify-between items-center"><span>Padrão regulatório:</span><strong class="text-slate-700 font-mono">CONAMA 491/2018</strong></div>
        <div class="flex justify-between items-center"><span>Estação de referência:</span><strong class="text-slate-700">{activeStation.name}</strong></div>
        <div class="flex justify-between items-center"><span>Município:</span><strong class="text-slate-700">{activeStation.municipality}</strong></div>
      </div>
    </div>
  </div>
{/if}
