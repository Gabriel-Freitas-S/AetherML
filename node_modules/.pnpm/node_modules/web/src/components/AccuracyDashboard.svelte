<!-- apps/web/src/components/AccuracyDashboard.svelte — Precisão IA vs Real (holdout 7d) -->
<script lang="ts">
import { onMount } from "svelte";
import CompareChart from "./CompareChart.svelte";
import StationPicker from "./StationPicker.svelte";

interface EvalPayload {
	model_version: string;
	protocol: string;
	holdout: { start: string; end: string; hours: number; stations: number; points: number };
	metrics: Record<string, { mae: number; rmse: number; r2: number; mape: number; bias: number; n: number }>;
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

let data = $state<EvalPayload | null>(null);
let loadError = $state<string | null>(null);
let stationId = $state("ramqar_camburi");
let pollutant = $state<"pm25" | "o3" | "iqar">("pm25");

const COLORS: Record<string, string> = { pm25: "#059669", o3: "#7c3aed", iqar: "#0284c7" };
const UNITS: Record<string, string> = { pm25: "µg/m³", o3: "µg/m³", iqar: "índice" };
const NAMES: Record<string, string> = { pm25: "PM2.5", o3: "Ozônio (O₃)", iqar: "IQAr global" };

function skillBadge(r2: number): { label: string; cls: string } {
	if (r2 >= 0.7) return { label: "Alta", cls: "badge-boa" };
	if (r2 >= 0.5) return { label: "Boa", cls: "badge-boa" };
	if (r2 >= 0.3) return { label: "Moderada", cls: "badge-moderada" };
	return { label: "Em evolução", cls: "badge-ruim" };
}

const stationIds = $derived.by(() => (data ? Object.keys(data.series) : []));
const active = $derived.by(() => (data && data.series[stationId]) || null);

onMount(async () => {
	try {
		const res = await fetch("/data/model-eval.json");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const payload: EvalPayload = await res.json();
		data = payload;
		if (!payload.series[stationId]) stationId = Object.keys(payload.series)[0];
	} catch {
		loadError = "Falha ao carregar o backtest. Verifique sua conexão.";
	}
});

function fmtDate(iso: string): string {
	return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 13)}h`;
}
</script>

{#if loadError}
  <div class="bg-red-500/10 border border-red-500/30 text-red-200 text-sm rounded-2xl px-4 py-3">{loadError}</div>
{/if}

{#if !data}
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
    {#each [1, 2, 3] as _}
      <div class="glass-card p-6"><div class="h-4 w-32 bg-slate-200 rounded mb-3"></div><div class="h-10 w-20 bg-slate-200 rounded"></div></div>
    {/each}
  </div>
{:else}
  <!-- Hero -->
  <section class="glass-card p-6 md:p-8 relative overflow-hidden bg-gradient-to-br from-white via-emerald-50/60 to-sky-50/60">
    <div class="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"></div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
      <div class="lg:col-span-2">
        <div class="text-[11px] font-bold tracking-widest text-emerald-700 uppercase mb-2">Backtest · {data.model_version} · holdout de 7 dias fora do treino</div>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Precisão da IA <span class="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-sky-600">vs dados reais</span></h1>
        <p class="text-sm text-slate-600 mt-2 max-w-2xl leading-relaxed">
          {data.holdout.points} horas avaliadas em {data.holdout.stations} estações
          ({fmtDate(data.holdout.start)} → {fmtDate(data.holdout.end)}).
          Referência: CAMS/Open-Meteo. O modelo nunca viu esse período no treino.
        </p>
        <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span class="chip bg-slate-100 border-slate-200 text-slate-600">±5 pts do índice: <strong class="font-mono">{(data.iqar.within_5pts * 100).toFixed(0)}%</strong></span>
          <span class="chip bg-slate-100 border-slate-200 text-slate-600">±10 pts: <strong class="font-mono">{(data.iqar.within_10pts * 100).toFixed(0)}%</strong></span>
          <span class="chip bg-slate-100 border-slate-200 text-slate-600">Erro médio do índice: <strong class="font-mono">±{data.iqar.mae_index}</strong></span>
        </div>
      </div>
      <div class="bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-xl">
        <div class="text-[10px] uppercase font-bold tracking-[0.18em] text-slate-500">Acerto da faixa IQAr</div>
        <div class="text-5xl sm:text-6xl font-black font-mono text-emerald-600 tabular-nums my-1">{(data.iqar.class_accuracy * 100).toFixed(1)}%</div>
        <div class="text-[11px] text-slate-500">Boa {((data.iqar.by_class.Boa?.acc ?? 0) * 100).toFixed(1)}% · Moderada {((data.iqar.by_class.Moderada?.acc ?? 0) * 100).toFixed(1)}%</div>
      </div>
    </div>
  </section>

  <!-- Métricas por poluente -->
  <section class="mt-8">
    <h2 class="section-title mb-3"><span class="section-dot"></span>Erro por poluente · 1 passo à frente</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
      {#each Object.entries(data.metrics) as [target, m]}
        {@const b = skillBadge(m.r2)}
        <div class="glass-card glass-card-hover p-4 relative overflow-hidden">
          <div class="absolute top-0 inset-x-0 h-0.5" style="background:{COLORS[target] ?? '#22d3ee'}"></div>
          <div class="text-[11px] font-bold uppercase tracking-widest text-slate-500">{target.toUpperCase()}</div>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-2xl font-black font-mono text-slate-50 tabular-nums">±{m.mae}</span>
            <span class="text-[10px] text-slate-500">µg/m³ MAE</span>
          </div>
          <div class="mt-2 space-y-1 font-mono text-[11px] text-slate-500">
            <div class="flex justify-between"><span>RMSE</span><strong class="text-slate-700">{m.rmse}</strong></div>
            <div class="flex justify-between"><span>R²</span><strong class="text-slate-700">{m.r2}</strong></div>
            <div class="flex justify-between"><span>Viés</span><strong class="text-slate-700">{m.bias > 0 ? "+" : ""}{m.bias}</strong></div>
          </div>
          <span class={`chip mt-2.5 !text-[10px] font-bold ${b.cls}`}>{b.label}</span>
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
  <section class="mt-8">
    <h2 class="section-title mb-3"><span class="section-dot !bg-amber-500"></span>Degradação por horizonte · rollout 120h recursivo</h2>
    <div class="glass-card p-5 overflow-x-auto">
      <table class="w-full text-sm min-w-[520px]">
        <thead>
          <tr class="text-[11px] uppercase tracking-widest text-slate-500 text-left">
            <th class="pb-2 font-bold">Horizonte</th>
            <th class="pb-2 font-bold">PM2.5 MAE</th>
            <th class="pb-2 font-bold">O₃ MAE</th>
            <th class="pb-2 font-bold">IQAr MAE</th>
            <th class="pb-2 font-bold">Leitura</th>
          </tr>
        </thead>
        <tbody class="font-mono text-slate-700">
          {#each Object.entries(data.horizons_mae) as [h, v]}
            <tr class="border-t border-slate-200">
              <td class="py-2.5 font-bold text-sky-700">+{h}h</td>
              <td class="py-2.5">±{v.pm25}</td>
              <td class="py-2.5">±{v.o3}</td>
              <td class="py-2.5">±{v.iqar}</td>
              <td class="py-2.5 font-sans text-xs text-slate-500">{+h <= 24 ? "Alta confiança" : +h <= 72 ? "Boa, revise O₃ à tarde" : "Tendência (use a faixa, não o número)"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Comparativo série temporal -->
  <section class="mt-8 mb-8">
    <div class="mb-3 flex flex-wrap items-center gap-2 relative z-30">
      <h2 class="section-title mr-auto"><span class="section-dot !bg-emerald-500"></span>Curva Real vs IA · 7 dias</h2>
      <div class="w-full sm:w-auto sm:min-w-[240px]">
        <StationPicker
          stations={stationIds.map((id) => ({ id, name: data.series[id].name, municipality: "" }))}
          activeId={stationId}
          onChange={(id) => (stationId = id)}
          label="Estação do comparativo"
        />
      </div>
      <div class="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
        {#each ["pm25", "o3", "iqar"] as p}
          <button class="px-2.5 py-1.5 rounded-lg transition-all font-bold {pollutant === p ? 'text-white shadow' : 'text-slate-600 hover:bg-white'}" style={pollutant === p ? `background:${COLORS[p]}` : ""} onclick={() => pollutant = p as typeof pollutant}>
            {NAMES[p]}
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
      Metodologia: treino até {fmtDate(data.holdout.start)} (13.977 amostras), avaliação nas 168h seguintes sem re-treino.
      Alvos e lags de referência: CAMS via Open-Meteo (modelo regional — não é medição de rua). Tráfego e satélite seguem como proxies determinísticos documentados.
    </p>
  </section>
{/if}
