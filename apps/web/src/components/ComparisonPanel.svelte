<!-- apps/web/src/components/ComparisonPanel.svelte
     ML × Open-Meteo no HOLDOUT — 168h de PASSADO que o modelo nunca viu no treino.

     Proveniência na TELA, não em tooltip: versão do modelo, versão da ordem de
     features, janela do holdout, `generated_at`, `protocol` e a fonte da API saem
     todos do artefato em runtime. Nenhuma dessas strings é digitada aqui.

     Ressalvas são texto medido do artefato, não decoração: as que citam o
     poluente selecionado aparecem ao lado do gráfico dele (via
     `caveatsMentioning`) e TODAS as outras ficam numa lista no rodapé do painel.

     Cor: duas séries (modelo = ciano, fonte = ardósia) e a rampa IQAr
     compartilhada de `comparison.ts` para qualquer leitura de faixa. Não existe
     uma segunda paleta de qualidade do ar nesta view.
-->
<script lang="ts">
import { onMount } from "svelte";
import {
	CONCENTRATION_UNIT,
	type ComparisonStation,
	IQAR_BANDS,
	POLLUTANT_LABEL,
	POLLUTANT_LONG_LABEL,
	POLLUTANT_ORDER,
	type PollutantKey,
	buildSeries,
	caveatsMentioning,
	formatHoldoutRange,
	formatMetric,
	formatSigned,
	iqarAdvice,
	iqarIcon,
	isRenderable,
} from "../lib/comparison";
import ComparisonChart from "./ComparisonChart.svelte";
import StationPicker from "./StationPicker.svelte";

/**
 * Métricas do artefato. `by_station` NÃO traz `r2` (verificado no JSON:
 * `by_station[...].pm25` = {mae, rmse, bias, n}); por isso todo campo é
 * opcional e `formatMetric`/`formatSigned` devolvem "—" no lugar de 0.
 */
interface StationMetric {
	mae?: number | null;
	rmse?: number | null;
	bias?: number | null;
	r2?: number | null;
	n?: number | null;
}

interface ComparisonArtifact {
	schema_version: number;
	generated_at: string;
	model_version: string;
	feature_order_version: string;
	protocol: string;
	holdout: { from: string; to: string; hours: number };
	source: { api: string; raw_file: string; raw_fetched_at: string };
	caveats: string[];
	stations: ComparisonStation[];
	summary: {
		by_pollutant: Partial<Record<PollutantKey, StationMetric>>;
		by_station: Record<string, Partial<Record<PollutantKey, StationMetric>>>;
	};
}

const ML_COLOR = "#0284c7";
const API_COLOR = "#475569";

let data = $state<ComparisonArtifact | null>(null);
let loadError = $state<string | null>(null);
let pollutant = $state<PollutantKey>("pm25");
let stationId = $state<string>("");

onMount(async () => {
	try {
		const res = await fetch("/data/comparison-data.json");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const payload = (await res.json()) as ComparisonArtifact;
		if (!payload?.stations?.length) {
			throw new Error("O artefato não traz nenhuma estação.");
		}
		data = payload;
		if (!stationId) stationId = payload.stations[0].id;
	} catch (err) {
		// Nenhum gráfico vazio "saudável" depois de um fetch que falhou.
		loadError =
			err instanceof Error && err.message.startsWith("HTTP")
				? `Falha ao carregar o artefato de comparação (${err.message}).`
				: "Falha ao carregar o artefato de comparação. Verifique sua conexão.";
	}
});

const activeStation = $derived.by(() => {
	if (!data) return null;
	return data.stations.find((s) => s.id === stationId) ?? data.stations[0];
});

const series = $derived(buildSeries(activeStation, pollutant));
const renderable = $derived(isRenderable(series));

const pollutantMetrics = $derived(
	data?.summary.by_pollutant?.[pollutant] ?? null,
);
const stationMetrics = $derived(
	activeStation
		? (data?.summary.by_station?.[activeStation.id]?.[pollutant] ?? null)
		: null,
);

/** Ressalvas que citam o poluente selecionado vs. as demais. */
const pollutantCaveats = $derived(
	data ? caveatsMentioning(data.caveats, pollutant) : [],
);
const otherCaveats = $derived(
	(data?.caveats ?? []).filter((c) => !pollutantCaveats.includes(c)),
);

const stationOptions = $derived(
	(data?.stations ?? []).map((s) => ({
		id: s.id,
		name: s.name,
		municipality: s.municipality,
	})),
);

function fmtStamp(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("pt-BR", {
		timeZone: "America/Sao_Paulo",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(d);
}
</script>

{#if loadError}
	<div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-2xl px-4 py-3 flex items-start gap-2.5" role="alert">
		<span class="i-ph-warning-octagon-fill w-4 h-4 text-red-600 shrink-0 mt-0.5"></span>
		<span>
			<strong>Não foi possível carregar a comparação.</strong>
			{loadError}
			O holdout é um artefato estático; sem ele não há nada honesto a desenhar aqui.
		</span>
	</div>
{/if}

{#if !data}
	<div class="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse" aria-hidden="true">
		<div class="lg:col-span-2 glass-card p-8">
			<div class="h-4 w-48 bg-slate-200 rounded mb-3"></div>
			<div class="h-4 w-80 bg-slate-200 rounded mb-6"></div>
			<div class="h-52 w-full bg-slate-200 rounded"></div>
		</div>
		<div class="glass-card p-6 space-y-3">
			<div class="h-16 w-full bg-slate-200 rounded"></div>
			<div class="h-16 w-full bg-slate-200 rounded"></div>
			<div class="h-16 w-full bg-slate-200 rounded"></div>
		</div>
	</div>
	<p class="sr-only" aria-live="polite">Carregando o artefato de comparação do holdout…</p>
{:else}
	<!-- ─── Hero + proveniência (na tela, não em tooltip) ─── -->
	<section class="glass-card p-6 md:p-8 relative overflow-hidden bg-gradient-to-br from-white via-sky-50/60 to-emerald-50/60 anim-fade-up">
		<div class="absolute top-0 inset-x-0 h-1 bg-sky-600"></div>
		<div class="flex items-center gap-2 text-[11px] font-bold tracking-widest text-sky-800 uppercase mb-2">
			<span class="i-ph-scales-fill w-3.5 h-3.5 text-sky-600"></span>
			<span>
				Holdout · {data.model_version} · {data.holdout.hours}h de PASSADO fora do treino
			</span>
		</div>
		<h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
			Modelo <span class="text-sky-700">vs</span> Open-Meteo
		</h1>
		<p class="text-sm text-slate-600 mt-2 max-w-3xl leading-relaxed">
			Horas que o modelo <strong>nunca viu no treino</strong>: de
			<strong class="text-slate-800">{fmtStamp(data.holdout.from)}</strong> a
			<strong class="text-slate-800">{fmtStamp(data.holdout.to)}</strong>
			({data.holdout.hours}h em {data.stations.length} estações).
			A curva "Open-Meteo" é a re-análise CAMS da mesma hora — a referência, não uma estação
			de monitoramento independente.
		</p>

		<dl class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
			<div class="bg-white border border-slate-200 rounded-xl px-3 py-2">
				<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Modelo</dt>
				<dd class="font-mono text-sm font-bold text-slate-900">{data.model_version}</dd>
			</div>
			<div class="bg-white border border-slate-200 rounded-xl px-3 py-2">
				<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Ordem de features</dt>
				<dd class="font-mono text-sm font-bold text-slate-900">{data.feature_order_version}</dd>
			</div>
			<div class="bg-white border border-slate-200 rounded-xl px-3 py-2">
				<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Janela do holdout</dt>
				<dd class="font-mono text-xs font-bold text-slate-900 leading-tight">
					{formatHoldoutRange(data.holdout.from, data.holdout.to)}
				</dd>
			</div>
			<div class="bg-white border border-slate-200 rounded-xl px-3 py-2">
				<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Artefato gerado em</dt>
				<dd class="font-mono text-xs font-bold text-slate-900 leading-tight">{fmtStamp(data.generated_at)}</dd>
			</div>
			<div class="bg-white border border-slate-200 rounded-xl px-3 py-2">
				<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Schema</dt>
				<dd class="font-mono text-sm font-bold text-slate-900">v{data.schema_version}</dd>
			</div>
		</dl>

		<div class="mt-3 flex flex-wrap gap-2 text-[11px]">
			<span class="chip bg-slate-100 border-slate-200 text-slate-700">
				<span class="i-ph-cloud-bold w-3.5 h-3.5 text-slate-600"></span>
				<span>Referência: {data.source.api}</span>
			</span>
			<span class="chip bg-slate-100 border-slate-200 text-slate-700">
				<span class="i-ph-database-fill w-3.5 h-3.5 text-slate-600"></span>
				<span>Bruto: <span class="font-mono">{data.source.raw_file}</span></span>
			</span>
			<span class="chip bg-slate-100 border-slate-200 text-slate-700">
				<span class="i-ph-clock-bold w-3.5 h-3.5 text-slate-600"></span>
				<span>Coletado: {fmtStamp(data.source.raw_fetched_at)}</span>
			</span>
		</div>

		<details class="mt-3 group">
			<summary class="cursor-pointer text-xs font-semibold text-sky-700 hover:underline select-none">
				Protocolo de avaliação (texto do artefato)
			</summary>
			<p class="mt-2 text-xs text-slate-700 leading-relaxed bg-white border border-slate-200 rounded-xl px-3 py-2.5">
				{data.protocol}
			</p>
		</details>
	</section>

	<!-- ─── Métricas por poluente (agregado das 9 estações) ─── -->
	<section class="mt-8 anim-fade-up-d1">
		<div class="mb-3 flex items-center justify-between gap-3 flex-wrap">
			<h2 class="section-title"><span class="section-dot"></span>Métricas medidas no holdout</h2>
			<span class="text-xs text-slate-500">
				Agregado das {data.stations.length} estações · erro em {CONCENTRATION_UNIT}
			</span>
		</div>
		<div class="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory">
			{#each POLLUTANT_ORDER as key, idx}
				{@const m = data.summary.by_pollutant?.[key] ?? null}
				{@const active = pollutant === key}
				<button
					type="button"
					onclick={() => (pollutant = key)}
					aria-pressed={active}
					class="glass-card p-4 relative overflow-hidden min-w-[150px] sm:min-w-0 snap-start text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-500 {active
						? '!border-sky-400'
						: ''}"
					style="animation: fadeSlideUp 0.38s cubic-bezier(0.16, 1, 0.3, 1) {0.05 + 0.05 * idx}s both"
				>
					<div class="absolute top-0 inset-x-0 h-1" style="background:{active ? ML_COLOR : '#cbd5e1'}"></div>
					<div class="flex items-center justify-between gap-1">
						<span class="text-[11px] font-bold uppercase tracking-widest text-slate-700">
							{POLLUTANT_LABEL[key]}
						</span>
						{#if active}
							<span class="text-[9px] uppercase font-bold tracking-widest text-sky-700">visto</span>
						{/if}
					</div>
					<div class="mt-1 flex items-baseline gap-1.5">
						<span class="text-2xl font-black font-mono text-slate-900 tabular-nums">
							±{formatMetric(m?.mae, 3)}
						</span>
						<span class="text-[10px] text-slate-500 font-sans">MAE</span>
					</div>
					<div class="mt-2 space-y-1 font-mono text-[11px] text-slate-500">
						<div class="flex justify-between"><span>RMSE</span><strong class="text-slate-700">{formatMetric(m?.rmse, 3)}</strong></div>
						<div class="flex justify-between"><span>R²</span><strong class="text-slate-700">{formatMetric(m?.r2, 4)}</strong></div>
						<div class="flex justify-between"><span>Viés</span><strong class="text-slate-700">{formatSigned(m?.bias, 3)}</strong></div>
						<div class="flex justify-between"><span>n</span><strong class="text-slate-700">{formatMetric(m?.n, 0)}</strong></div>
					</div>
				</button>
			{/each}
		</div>
		<p class="text-xs text-slate-500 mt-2 leading-relaxed">
			Viés é <strong class="font-mono text-slate-700">Open-Meteo − modelo</strong>, com sinal: positivo
			(<span class="font-mono" style="color:{API_COLOR}">+</span>) significa que a fonte estava
			acima do modelo. Um módulo aqui esconderia exatamente o que a coluna mostra.
			"n" conta horas com valor dos dois lados — hora sem dado não entra como zero.
		</p>
	</section>

	<!-- ─── Séries ─── -->
	<section class="mt-8 anim-fade-up-d2">
		<div class="mb-3 flex flex-wrap items-center gap-2 relative z-30">
			<h2 class="section-title mr-auto">
				<span class="section-dot !bg-sky-600"></span>
				Curvas horárias · holdout de {data.holdout.hours}h
			</h2>
			<div class="w-full sm:w-auto sm:min-w-[240px]">
				<StationPicker
					stations={stationOptions}
					activeId={activeStation?.id ?? ""}
					onChange={(id) => (stationId = id)}
					label="Estação da comparação"
				/>
			</div>
		</div>

		<div
			class="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs mb-4 w-fit max-w-full overflow-x-auto"
			role="tablist"
			aria-label="Selecionar poluente da comparação"
		>
			{#each POLLUTANT_ORDER as key}
				<button
					type="button"
					role="tab"
					aria-selected={pollutant === key}
					class={pollutant === key
						? 'px-3 py-2 rounded-lg font-bold text-white shadow-sm transition-all cursor-pointer min-h-[38px]'
						: 'px-3 py-2 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-white transition-all cursor-pointer min-h-[38px]'}
					style={pollutant === key ? `background:${ML_COLOR}` : ''}
					onclick={() => (pollutant = key)}
				>
					{POLLUTANT_LABEL[key]}
				</button>
			{/each}
		</div>

		{#if !activeStation}
			<div class="glass-card p-6 text-sm text-slate-600 flex items-center gap-2">
				<span class="i-ph-map-pin-line-fill w-4 h-4 text-slate-400"></span>
				Nenhuma estação selecionada.
			</div>
		{:else if !renderable}
			<div class="glass-card p-6 text-sm text-slate-600 flex items-start gap-2">
				<span class="i-ph-warning-fill w-4 h-4 text-amber-500 shrink-0 mt-0.5"></span>
				<span>
					<strong>Sem dado para {POLLUTANT_LABEL[pollutant]} em {activeStation.name}.</strong>
					O artefato não traz nem a curva do modelo nem a da fonte para este par
					estação × poluente. Não desenhamos um gráfico vazio: "sem dado" e "erro zero"
					são coisas diferentes.
				</span>
			</div>
		{:else}
			{@const sm = stationMetrics}
			<ComparisonChart
				series={series}
				title={`${POLLUTANT_LONG_LABEL[pollutant]} · ${activeStation.name}`}
				unit={CONCENTRATION_UNIT}
			/>

			<!-- Métricas da estação selecionada + ressalvas do poluente -->
			<div class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
				<div class="glass-card p-5">
					<h3 class="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
						<span class="i-ph-map-pin-fill w-4 h-4 text-sky-600"></span>
						{activeStation.name} · {activeStation.municipality}
					</h3>
					<dl class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
						<div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
							<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">MAE</dt>
							<dd class="font-mono text-base font-bold text-slate-900">±{formatMetric(sm?.mae, 3)}</dd>
						</div>
						<div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
							<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">RMSE</dt>
							<dd class="font-mono text-base font-bold text-slate-900">{formatMetric(sm?.rmse, 3)}</dd>
						</div>
						<div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
							<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Viés (com sinal)</dt>
							<dd class="font-mono text-base font-bold text-slate-900">{formatSigned(sm?.bias, 3)}</dd>
						</div>
					</dl>
					<p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
						{formatMetric(sm?.n, 0)} horas avaliadas nesta estação ·
						{activeStation.lat.toFixed(4)}, {activeStation.lon.toFixed(4)} ·
						O R² por estação não é calculado pelo gerador do artefato, então não aparece aqui
						— o que existe é a média de R² por poluente no quadro acima.
					</p>
				</div>

				<div class="glass-card p-5 border-l-4 border-l-amber-400">
					<h3 class="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
						<span class="i-ph-warning-fill w-4 h-4 text-amber-600"></span>
						Ressalvas que citam {POLLUTANT_LABEL[pollutant]}
					</h3>
					{#if pollutantCaveats.length === 0}
						<p class="text-xs text-slate-500">
							Nenhuma ressalva do artefato menciona este poluente.
						</p>
					{:else}
						<ul class="space-y-2 text-xs text-slate-700 leading-relaxed">
							{#each pollutantCaveats as c}
								<li class="flex items-start gap-2">
									<span class="i-ph-arrow-bend-down-right-fill w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5"></span>
									<span>{c}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<!-- ─── Ramp IQAr compartilhada + ressalvas gerais ─── -->
	<section class="mt-8 mb-8 anim-fade-up-d3">
		<div class="mb-3 flex items-center justify-between gap-3 flex-wrap">
			<h2 class="section-title">
				<span class="section-dot !bg-emerald-600"></span>
				Como ler {CONCENTRATION_UNIT}
			</h2>
			<span class="text-xs text-slate-500">
				Faixas CONAMA 491/2018 · rampa compartilhada do app
			</span>
		</div>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
			{#each IQAR_BANDS as band}
				<div class="glass-card p-4 relative overflow-hidden">
					<div class="absolute top-0 inset-x-0 h-1" style="background:{band.hex}"></div>
					<div class="flex items-center gap-2">
						<span class="{band.icon} w-5 h-5" style="color:{band.text}"></span>
						<span class="text-sm font-bold" style="color:{band.text}">{band.label}</span>
					</div>
					<p class="text-[11px] text-slate-600 mt-2 leading-relaxed">{band.advice}</p>
				</div>
			{/each}
		</div>
		<p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
			A rampa de cor vem de <span class="font-mono">lib/comparison.ts</span> — a mesma que o
			dashboard, o mapa e a página da estação usam. Esta view não define uma segunda paleta:
			cor de faixa significa exatamente a mesma coisa aqui que no resto do produto.
		</p>

		<div class="mt-4 glass-card p-5">
			<h3 class="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
				<span class="i-ph-info-fill w-4 h-4 text-slate-600"></span>
				Todas as ressalvas do artefato ({data.caveats.length})
			</h3>
			<ul class="space-y-2 text-xs text-slate-700 leading-relaxed">
				{#each otherCaveats as c}
					<li class="flex items-start gap-2">
						<span class="i-ph-info-fill w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5"></span>
						<span>{c}</span>
					</li>
				{/each}
			</ul>
			{#if otherCaveats.length === 0}
				<p class="text-xs text-slate-500">Nenhuma outra ressalva além das exibidas acima.</p>
			{/if}
		</div>

		<!-- Aviso de janela: holdout e previsão são coisas diferentes. -->
		<div class="mt-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-2xl px-4 py-3 flex items-start gap-2.5" role="alert">
			<span class="i-ph-warning-fill w-4 h-4 text-amber-600 shrink-0 mt-0.5"></span>
			<span>
				<strong>Esta página é só holdout (passado).</strong>
				A previsão de 120h à frente do produto é outra janela, no futuro, e vem de outro
				artefato — ela não é avaliada aqui nem valida o holdout. Nada nesta tela é
				projeção: são horas já decorridas.
			</span>
		</div>
	</section>
{/if}
