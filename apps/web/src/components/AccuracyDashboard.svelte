<!-- apps/web/src/components/AccuracyDashboard.svelte — Precisão IA vs Real (holdout 7d) -->
<script lang="ts">
import { onMount } from "svelte";
import {
	CLASS_ACCURACY_FIELD,
	DASH,
	classAccuracyByName,
	evaluationPointClaim,
	formatClassAccuracy,
	holdoutHoursClaim,
	holdoutSpanClaim,
	modelCountClaim,
	rolloutClaim,
} from "../lib/eval-claims";
import CompareChart from "./CompareChart.svelte";
import StationPicker from "./StationPicker.svelte";

interface EvalPayload {
	model_version: string;
	protocol: string;
	holdout: {
		start: string;
		end: string;
		hours: number;
		stations: number;
		points: number;
	};
	metrics: Record<
		string,
		{
			mae: number;
			rmse: number;
			r2: number;
			mape: number;
			bias: number;
			n: number;
		}
	>;
	persistence_baseline_pm25: { mae: number; r2: number };
	iqar: {
		class_accuracy: number;
		mae_index: number;
		within_5pts: number;
		within_10pts: number;
		by_class: Record<string, { n: number; acc: number | null }>;
	};
	horizons_mae: Record<string, { pm25: number; o3: number; iqar: number }>;
	series: Record<
		string,
		{
			name: string;
			time: string[];
			pm25_real: number[];
			pm25_pred: number[];
			o3_real: number[];
			o3_pred: number[];
			iqar_real: number[];
			iqar_pred: number[];
		}
	>;
	generated_at: string;
}

const {
	initialData = null,
}: {
	initialData?: EvalPayload | null;
} = $props();

let data = $state<EvalPayload | null>(initialData);
let loadError = $state<string | null>(null);
let stationId = $state("ramqar_camburi");
let pollutant = $state<"pm25" | "o3" | "iqar">("pm25");

const COLORS: Record<string, string> = {
	pm25: "#059669",
	pm10: "#d97706",
	o3: "#7c3aed",
	no2: "#ea580c",
	so2: "#db2777",
	iqar: "#0284c7",
};
const UNITS: Record<string, string> = {
	pm25: "µg/m³",
	pm10: "µg/m³",
	o3: "µg/m³",
	no2: "µg/m³",
	so2: "µg/m³",
	iqar: "índice",
};
const NAMES: Record<string, string> = {
	pm25: "PM₂.₅",
	pm10: "PM₁₀",
	o3: "Ozônio (O₃)",
	no2: "NO₂",
	so2: "SO₂",
	iqar: "IQAr Global",
};
const TARGET_ICONS: Record<string, string> = {
	pm25: "i-ph-wind-fill",
	pm10: "i-ph-cloud-fog-fill",
	o3: "i-ph-sun-fill",
	no2: "i-ph-car-fill",
	so2: "i-ph-factory-fill",
	iqar: "i-ph-gauge-fill",
};

function skillBadge(r2: number): { label: string; cls: string; icon: string } {
	if (r2 >= 0.7)
		return { label: "Alta", cls: "badge-boa", icon: "i-ph-check-circle-fill" };
	if (r2 >= 0.5)
		return { label: "Boa", cls: "badge-boa", icon: "i-ph-check-circle-fill" };
	if (r2 >= 0.3)
		return {
			label: "Moderada",
			cls: "badge-moderada",
			icon: "i-ph-warning-circle-fill",
		};
	return {
		label: "Em evolução",
		cls: "badge-ruim",
		icon: "i-ph-warning-fill",
	};
}

const stationIds = $derived.by(() => (data ? Object.keys(data.series) : []));
const active = $derived.by(() => data?.series[stationId] || null);

onMount(async () => {
	try {
		const res = await fetch("/data/model-eval.json");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const payload: EvalPayload = await res.json();
		data = payload;
		if (!payload.series[stationId]) stationId = Object.keys(payload.series)[0];
	} catch {
		if (!data) {
			loadError = "Falha ao carregar o backtest. Verifique sua conexão.";
		}
	}
});

function fmtDate(iso: string): string {
	const d = new Date(iso);
	return new Intl.DateTimeFormat("pt-BR", {
		timeZone: "America/Sao_Paulo",
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(d);
}
</script>

{#if loadError}
  <div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-2xl px-4 py-3 flex items-center gap-2">
    <span class="i-ph-warning-octagon-fill w-4 h-4 text-red-600 shrink-0"></span>
    <span>{loadError}</span>
  </div>
{/if}

{#if !data}
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
    {#each [1, 2, 3] as _}
      <div class="glass-card p-6"><div class="h-4 w-32 bg-slate-200 rounded mb-3"></div><div class="h-10 w-20 bg-slate-200 rounded"></div></div>
    {/each}
  </div>
{:else}
  <!-- Hero -->
  <section class="glass-card p-6 md:p-8 relative overflow-hidden bg-gradient-to-br from-white via-emerald-50/60 to-sky-50/60 anim-fade-up">
    <div class="absolute top-0 inset-x-0 h-1 bg-emerald-600"></div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
      <div class="lg:col-span-2">
        <div class="flex items-center gap-2 text-[11px] font-bold tracking-widest text-emerald-800 uppercase mb-2">
          <span class="i-ph-cpu-fill w-3.5 h-3.5 text-emerald-600"></span>
          <span>Backtest · {data.model_version} · holdout de {holdoutSpanClaim(data) ?? DASH} fora do treino</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
          Precisão da IA <span class="text-emerald-700">vs dados reais</span>
        </h1>
        <p class="text-sm text-slate-600 mt-2 max-w-2xl leading-relaxed">
          {evaluationPointClaim(data) ?? DASH} em {holdoutHoursClaim(data) ?? DASH} · {data.holdout.stations} estações
          ({fmtDate(data.holdout.start)} → {fmtDate(data.holdout.end)}).
          Referência: CAMS/Open-Meteo. O modelo nunca viu esse período no treino.
        </p>
        <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span class="chip bg-slate-100 border-slate-200 text-slate-700 flex items-center gap-1.5">
            <span class="i-ph-check-circle-fill w-3.5 h-3.5 text-emerald-600"></span>
            <span>±5 pts do índice: <strong class="font-mono text-slate-900">{(data.iqar.within_5pts * 100).toFixed(0)}%</strong></span>
          </span>
          <span class="chip bg-slate-100 border-slate-200 text-slate-700 flex items-center gap-1.5">
            <span class="i-ph-check-circle-fill w-3.5 h-3.5 text-emerald-600"></span>
            <span>±10 pts: <strong class="font-mono text-slate-900">{(data.iqar.within_10pts * 100).toFixed(0)}%</strong></span>
          </span>
          <span class="chip bg-slate-100 border-slate-200 text-slate-700 flex items-center gap-1.5">
            <span class="i-ph-chart-line-up-bold w-3.5 h-3.5 text-sky-600"></span>
            <span>Erro médio do índice: <strong class="font-mono text-slate-900">±{data.iqar.mae_index}</strong></span>
          </span>
        </div>
      </div>
      <div class="bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-lg">
        <div class="text-[10px] uppercase font-bold tracking-[0.16em] text-slate-500 flex items-center justify-center gap-1.5">
          <span class="i-ph-target-bold w-3.5 h-3.5 text-emerald-600"></span>
          <span>Acerto da faixa IQAr</span>
        </div>
        <!-- A procedência vai no `title`: o número vem de `iqar.class_accuracy`,
             nunca de uma constante no copy. -->
        <div class="text-5xl sm:text-6xl font-black font-mono text-emerald-700 tabular-nums my-1" title={CLASS_ACCURACY_FIELD}>{(data.iqar.class_accuracy * 100).toFixed(1)}%</div>
        <div class="text-[11px] text-slate-600">Boa <strong class="text-slate-800">{formatClassAccuracy(classAccuracyByName(data, "Boa"))}</strong> · Moderada <strong class="text-slate-800">{formatClassAccuracy(classAccuracyByName(data, "Moderada"))}</strong></div>
      </div>
    </div>
  </section>

  <!-- Métricas por poluente -->
  <section class="mt-8 anim-fade-up-d1">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="section-title"><span class="section-dot"></span>Erro por poluente · 1 passo à frente</h2>
      <span class="text-xs text-slate-500">{modelCountClaim(data) ?? DASH}</span>
    </div>
    <div class="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory">
      {#each Object.entries(data.metrics) as [target, m], idx}
        {@const b = skillBadge(m.r2)}
        <div class="glass-card glass-card-hover p-4 relative overflow-hidden min-w-[150px] sm:min-w-0 snap-start flex-1" style="animation: fadeSlideUp 0.38s cubic-bezier(0.16, 1, 0.3, 1) {0.05 + 0.05 * idx}s both">
          <div class="absolute top-0 inset-x-0 h-1" style="background:{COLORS[target] ?? '#0284c7'}"></div>
          <div class="flex items-center justify-between gap-1">
            <span class="text-[11px] font-bold uppercase tracking-widest text-slate-600">{NAMES[target] ?? target.toUpperCase()}</span>
            <span class="{TARGET_ICONS[target] ?? 'i-ph-wind-fill'} w-4 h-4 text-slate-400"></span>
          </div>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-2xl font-black font-mono text-slate-900 tabular-nums">±{m.mae}</span>
            <span class="text-[10px] text-slate-500 font-sans">{UNITS[target] ?? 'µg/m³'} MAE</span>
          </div>
          <div class="mt-2 space-y-1 font-mono text-[11px] text-slate-500">
            <div class="flex justify-between"><span>RMSE</span><strong class="text-slate-700">{m.rmse}</strong></div>
            <div class="flex justify-between"><span>R²</span><strong class="text-slate-700">{m.r2}</strong></div>
            <div class="flex justify-between"><span>Viés</span><strong class="text-slate-700">{m.bias > 0 ? "+" : ""}{m.bias}</strong></div>
          </div>
          <span class={`chip mt-2.5 !text-[10px] font-bold ${b.cls} flex items-center justify-center gap-1`}>
            <span class={`${b.icon} w-3 h-3`}></span>
            <span>{b.label}</span>
          </span>
        </div>
      {/each}
    </div>
    <p class="text-xs text-slate-500 mt-3 leading-relaxed">
      vs baseline de persistência ("ontem = hoje") no PM2.5: MAE <strong class="font-mono text-slate-700">{data.persistence_baseline_pm25.mae}</strong>
      → modelo MAE <strong class="font-mono text-emerald-700">{data.metrics.pm25.mae}</strong>
      ({Math.round((1 - data.metrics.pm25.mae / data.persistence_baseline_pm25.mae) * 100)}% menos erro).
      R² do PM2.5 ainda baixo ({data.metrics.pm25.r2}): o modelo acerta o nível médio, mas varia menos que o real — próximo ganho virá de dados de tráfego/satélite reais.
    </p>
  </section>

  <!-- Degradação por horizonte -->
  <section class="mt-8 anim-fade-up-d2">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="section-title"><span class="section-dot !bg-amber-600"></span>Degradação por horizonte · {rolloutClaim(data) ?? DASH}</h2>
      <span class="text-xs text-slate-500">Validação multi-step</span>
    </div>
    <div class="glass-card p-5 overflow-x-auto">
      <table class="w-full text-sm min-w-[520px]">
        <thead>
          <tr class="text-[11px] uppercase tracking-widest text-slate-500 text-left">
            <th class="pb-2 font-bold">Horizonte</th>
            <th class="pb-2 font-bold">PM₂.₅ MAE</th>
            <th class="pb-2 font-bold">O₃ MAE</th>
            <th class="pb-2 font-bold">IQAr MAE</th>
            <th class="pb-2 font-bold">Leitura & Nível de Confiança</th>
          </tr>
        </thead>
        <tbody class="font-mono text-slate-700">
          {#each Object.entries(data.horizons_mae) as [h, v]}
            <tr class="border-t border-slate-200">
              <td class="py-2.5 font-bold text-sky-700">+{h}h</td>
              <td class="py-2.5">±{v.pm25}</td>
              <td class="py-2.5">±{v.o3}</td>
              <td class="py-2.5">±{v.iqar}</td>
              <td class="py-2.5 font-sans text-xs text-slate-600">
                <span class="inline-flex items-center gap-1.5">
                  {#if +h <= 24}
                    <span class="i-ph-check-circle-fill w-3.5 h-3.5 text-emerald-600 shrink-0"></span>
                    <span>Alta confiança</span>
                  {:else if +h <= 72}
                    <span class="i-ph-warning-circle-fill w-3.5 h-3.5 text-amber-600 shrink-0"></span>
                    <span>Boa, revise O₃ à tarde</span>
                  {:else}
                    <span class="i-ph-warning-fill w-3.5 h-3.5 text-orange-600 shrink-0"></span>
                    <span>Tendência (use a faixa, não o número)</span>
                  {/if}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Comparativo série temporal -->
  <section class="mt-8 mb-8 anim-fade-up-d3">
    <div class="mb-3 flex flex-wrap items-center gap-2 relative z-30">
      <h2 class="section-title mr-auto"><span class="section-dot !bg-emerald-600"></span>Curva Real vs IA · {holdoutSpanClaim(data) ?? DASH}</h2>
      <div class="w-full sm:w-auto sm:min-w-[240px]">
        <StationPicker
          stations={stationIds.map((id) => ({ id, name: data.series[id].name, municipality: "" }))}
          activeId={stationId}
          onChange={(id) => (stationId = id)}
          label="Estação do comparativo"
        />
      </div>
      <div class="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs" role="tablist" aria-label="Selecionar poluente do comparativo">
        {#each ["pm25", "o3", "iqar"] as p}
          <button
            role="tab"
            aria-selected={pollutant === p}
            class={pollutant === p
              ? "px-3 py-2 rounded-lg font-bold text-white shadow-sm transition-all cursor-pointer min-h-[38px] sm:min-h-0"
              : "px-3 py-2 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-white transition-all cursor-pointer min-h-[38px] sm:min-h-0"}
            style={pollutant === p ? `background:${COLORS[p]}` : ""}
            onclick={() => (pollutant = p as typeof pollutant)}
          >
            {NAMES[p] ?? p}
          </button>
        {/each}
      </div>
    </div>
    {#if active}
      <CompareChart
        labels={active.time}
        real={active[`${pollutant}_real` as keyof typeof active] as number[]}
        pred={active[`${pollutant}_pred` as keyof typeof active] as number[]}
        unit={UNITS[pollutant]}
        color={COLORS[pollutant]}
        title={`${NAMES[pollutant]} · ${active.name}`}
        version={data.model_version}
      />
    {/if}
    <p class="text-xs text-slate-500 mt-3 leading-relaxed">
      Metodologia: treino até {fmtDate(data.holdout.start)}, avaliação em {evaluationPointClaim(data) ?? DASH}
      ({holdoutHoursClaim(data) ?? DASH}) sem re-treino.
      Alvos e lags de referência: CAMS via Open-Meteo (modelo regional — não é medição de rua). Tráfego e satélite seguem como proxies determinísticos documentados.
    </p>
  </section>
{/if}
