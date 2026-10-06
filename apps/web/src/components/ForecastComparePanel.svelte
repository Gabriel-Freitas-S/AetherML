<!-- apps/web/src/components/ForecastComparePanel.svelte
     PREVISÃO do modelo vs Open-Meteo (CAMS) — janela de 120 h À FRENTE.

     Reaproveita ComparisonChart (curvas sobrepostas + painel de resíduo) e
     StationPicker. Não existe um segundo componente de gráfico nesta view, e
     não existe uma segunda paleta: as faixas de saúde vêm da rampa IQAr
     compartilhada de `lib/comparison.ts`.

     O que muda em relação a ComparisonPanel, e por quê:

       1. SHAPE — este artefato (`forecast-compare.json`) tem `window` +
          `validation_note` + `is_validation`, e NÃO tem `protocol` nem
          `holdout`. A janela é mapeada de `window`, e a nota do gerador entra
          no lugar do protocolo. Nenhuma chave foi forjada no JSON para calar o
          TypeScript.

       2. SEMÂNTICA — ComparisonPanel diz "holdout / passado / fora do treino".
         Aqui cada uma dessas afirmações seria falsa. Esta é uma janela de
         PREVISÃO, e o CAMS da hora forecast é uma das ENTRADAS das features do
         modelo que produziu a curva `ml` da mesma hora: a proximidade entre as
         duas curvas é verdadeira por construção e não é acerto medido. Por isso
         o aviso aparece no topo, com o texto do artefato, ANTES de qualquer
         número — não como nota de rodapé.

     Nada de `stations-data.json` aqui: esta página não divide eixo de tempo com
     o dashboard da previsão, senão a previsão validaria a si mesma.
-->
<script lang="ts">
import { onMount } from "svelte";
import {
	CONCENTRATION_UNIT,
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
	isRenderable,
} from "../lib/comparison";
import {
	type ForecastCompareArtifact,
	currentHourPair,
	declaresAccuracyValidation,
	gapRuns,
	hourPairAt,
	lastPairedIndex,
	pollutantRows,
} from "../lib/forecast-compare";
import { formatObservedAt } from "../lib/forecast-days";
import ComparisonChart from "./ComparisonChart.svelte";
import StationPicker from "./StationPicker.svelte";

/** As mesmas duas cores de série do ComparisonChart: modelo e fonte. */
const ML_COLOR = "#0284c7";
const API_COLOR = "#475569";

/** Artefato desta janela. Único fetch da página. */
const ARTIFACT_URL = "/data/forecast-compare.json";

/**
 * "Agora" é congelado na montagem: a série é estática e reagir ao relógio
 * mudaria o par exibido sem que o artefato tivesse mudado.
 */
const nowIso = new Date().toISOString();

let data = $state<ForecastCompareArtifact | null>(null);
let loadError = $state<string | null>(null);
let pollutant = $state<PollutantKey>("pm25");
let stationId = $state<string>("");

onMount(async () => {
	try {
		const res = await fetch(ARTIFACT_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const payload = (await res.json()) as ForecastCompareArtifact;
		if (!payload?.stations?.length) {
			throw new Error("O artefato não traz nenhuma estação.");
		}
		data = payload;
		if (!stationId) stationId = payload.stations[0].id;
	} catch (err) {
		// Nenhum gráfico vazio "saudável" depois de um fetch que falhou.
		loadError =
			err instanceof Error && err.message.startsWith("HTTP")
				? `Falha ao carregar a comparação da previsão (${err.message}).`
				: "Falha ao carregar a comparação da previsão. Verifique sua conexão.";
	}
});

const activeStation = $derived.by(() => {
	if (!data) return null;
	return data.stations.find((s) => s.id === stationId) ?? data.stations[0];
});

const series = $derived(buildSeries(activeStation, pollutant));
const renderable = $derived(isRenderable(series));

/** `false` para esta janela: aciona o aviso grande antes de qualquer número. */
const isValidation = $derived(data ? declaresAccuracyValidation(data) : false);

const rows = $derived(data ? pollutantRows(data.summary) : []);

/** Hora corrente e última hora pareada: o par exibido vem do artefato. */
const hourPair = $derived(currentHourPair(series, nowIso));
const lastPaired = $derived.by(() => {
	const idx = lastPairedIndex(series);
	return idx < 0 ? null : hourPairAt(series, idx);
});

/** Lacunas da fonte: derivadas do array `api`, nunca digitadas. */
const apiGaps = $derived(gapRuns(series.api, series.timestamps));

/** Ressalvas que citam o poluente selecionado — a lista completa já está acima. */
const pollutantCaveats = $derived(
	data ? caveatsMentioning(data.caveats, pollutant) : [],
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

/** Rótulo de uma hora da série: carimbo UTC do artefato, sem reinterpretar. */
function fmtHour(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : formatObservedAt(d.toISOString());
}
</script>

{#if loadError}
	<div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-2xl px-4 py-3 flex items-start gap-2.5" role="alert">
		<span class="i-ph-warning-octagon-fill w-4 h-4 text-red-600 shrink-0 mt-0.5"></span>
		<span>
			<strong>Não foi possível carregar a comparação da previsão.</strong>
			{loadError}
			A janela de previsão é um artefato estático; sem ele não há nada honesto a desenhar
			aqui.
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
	<p class="sr-only" aria-live="polite">Carregando a comparação da janela de previsão…</p>
{:else}
	<!-- ═══ Aviso de semântica: PRIMEIRO, antes de qualquer número ═══ -->
	{#if !isValidation}
		<section
			class="mb-6 bg-amber-50 border-2 border-amber-300 text-amber-950 rounded-2xl px-4 py-4 sm:px-5 sm:py-5 anim-fade-up"
			role="note"
			aria-labelledby="fc-semantica"
		>
			<div class="flex items-start gap-3">
				<span class="i-ph-warning-octagon-fill w-6 h-6 text-amber-600 shrink-0 mt-0.5"></span>
				<div class="min-w-0">
					<h2 id="fc-semantica" class="text-base sm:text-lg font-extrabold tracking-tight">
						Isto não é validação de precisão.
					</h2>
					<p class="mt-1.5 text-sm leading-relaxed">
						O valor do Open-Meteo (CAMS) na hora prevista é um insumo das features do
						próprio modelo — a hora entra em <code class="font-mono">row_to_features</code>
						e sai em <code class="font-mono">ml</code> na mesma hora. Quando as duas curvas
						se seemelham, isso é <strong>esperado por construção</strong>, não é um acerto
						medido: o modelo está sendo comparado com a própria entrada. Nada nesta tela
						mede erro de previsão.
					</p>
					<p class="mt-2.5 text-sm leading-relaxed font-medium border-t border-amber-300 pt-2.5">
						Para medir erro de verdade:
						<a href="/comparacao" class="underline decoration-2 underline-offset-2 hover:text-amber-800">
							Holdout — Modelo vs Open-Meteo
						</a>, onde a hora avaliada é anterior à coleta e o valor CAMS dela nunca
						entrou em nenhum treino.
					</p>
					<p class="mt-2.5 text-xs leading-relaxed bg-white/70 border border-amber-200 rounded-xl px-3 py-2.5">
						<strong class="uppercase tracking-[0.14em] text-[10px] block mb-1">Nota do gerador do artefato</strong>
						{data.validation_note}
					</p>
				</div>
			</div>
		</section>
	{/if}

	<!-- ─── Hero + proveniência (na tela, não em tooltip) ─── -->
	<section class="glass-card p-6 md:p-8 relative overflow-hidden bg-gradient-to-br from-white via-sky-50/60 to-emerald-50/60 anim-fade-up">
		<div class="absolute top-0 inset-x-0 h-1 bg-sky-600"></div>
		<div class="flex items-center gap-2 text-[11px] font-bold tracking-widest text-sky-800 uppercase mb-2">
			<span class="i-ph-calendar-dots-fill w-3.5 h-3.5 text-sky-600"></span>
			<span>
				Previsão · {data.model_version} · {data.window.hours}h À FRENTE
			</span>
		</div>
		<h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
			Previsão do modelo <span class="text-sky-700">vs</span> Open-Meteo
		</h1>
		<p class="text-sm text-slate-600 mt-2 max-w-3xl leading-relaxed">
			A mesma hora prevista pelo modelo e a mesma hora reportada pelo Open-Meteo, de
			<strong class="text-slate-800">{fmtStamp(data.window.from)}</strong> a
			<strong class="text-slate-800">{fmtStamp(data.window.to)}</strong>
			({data.window.hours}h em {data.stations.length} estações). A curva "Open-Meteo" é a
			re-análise CAMS da mesma hora — e, como o aviso acima explica, ela entra como
			insumo do modelo. Serve para comparar as DUAS leituras, não para atestar o modelo.
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
				<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Janela de previsão</dt>
				<dd class="font-mono text-xs font-bold text-slate-900 leading-tight">
					{formatHoldoutRange(data.window.from, data.window.to)}
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
				<span class="i-ph-brain-fill w-3.5 h-3.5 text-slate-600"></span>
				<span>Modelo: <span class="font-mono">{data.source.ml}</span></span>
			</span>
			<span class="chip bg-slate-100 border-slate-200 text-slate-700">
				<span class="i-ph-database-fill w-3.5 h-3.5 text-slate-600"></span>
				<span>Bruto: <span class="font-mono">{data.source.raw_file}</span></span>
			</span>
			<span class="chip bg-slate-100 border-slate-200 text-slate-700">
				<span class="i-ph-clock-bold w-3.5 h-3.5 text-slate-600"></span>
				<span>Coletado: {fmtStamp(data.source.raw_fetched_at)}</span>
			</span>
			<span class="chip {isValidation ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}">
				<span class="i-ph-scales-fill w-3.5 h-3.5"></span>
				<span>Validação de precisão: <strong>{isValidation ? "sim" : "não"}</strong></span>
			</span>
		</div>
	</section>

	<!-- ─── Hora corrente: ML e Open-Meteo lado a lado ─── -->
	<section class="mt-8 anim-fade-up-d1">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
			<h2 class="section-title"><span class="section-dot"></span>Hora corrente</h2>
			<span class="text-xs text-slate-500">
				{activeStation ? `${activeStation.name} · ${POLLUTANT_LABEL[pollutant]}` : "—"} ·
				erro em {CONCENTRATION_UNIT}
			</span>
		</div>

		{#if hourPair}
			<div class="glass-card p-5 md:p-6">
				<div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
					<div class="font-mono text-sm font-bold text-slate-800">
						{hourPair.timestamp}
						<span class="font-sans text-xs font-normal text-slate-500">({fmtHour(hourPair.timestamp)} no fuso da rede)</span>
					</div>
					<span class="chip {hourPair.paired ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-amber-50 border-amber-200 text-amber-800'}">
						<span class="{hourPair.paired ? 'i-ph-check-circle-fill' : 'i-ph-warning-fill'} w-3.5 h-3.5"></span>
						<span>{hourPair.paired ? "Hora pareada (ML e Open-Meteo)" : "Hora sem valor da fonte"}</span>
					</span>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
					<div class="relative overflow-hidden rounded-2xl bg-white border-2 p-4" style="border-color:{ML_COLOR}">
						<div class="absolute top-0 inset-x-0 h-1" style="background:{ML_COLOR}"></div>
						<div class="text-[11px] font-bold uppercase tracking-widest text-slate-700">
							Modelo (ML)
						</div>
						<div class="mt-1 text-3xl font-black font-mono tabular-nums text-slate-900">
							{formatMetric(hourPair.ml, 1)}
						</div>
						<div class="text-[11px] text-slate-500">µg/m³</div>
					</div>
					<div class="relative overflow-hidden rounded-2xl bg-white border-2 p-4" style="border-color:{API_COLOR}">
						<div class="absolute top-0 inset-x-0 h-1" style="background:{API_COLOR}"></div>
						<div class="text-[11px] font-bold uppercase tracking-widest text-slate-700">
							Open-Meteo (CAMS)
						</div>
						<div class="mt-1 text-3xl font-black font-mono tabular-nums text-slate-900">
							{formatMetric(hourPair.api, 1)}
						</div>
						<div class="text-[11px] text-slate-500">µg/m³</div>
					</div>
					<div class="relative overflow-hidden rounded-2xl bg-white border border-slate-300 p-4">
						<div class="text-[11px] font-bold uppercase tracking-widest text-slate-700">
							Resíduo (Open-Meteo − ML)
						</div>
						<div class="mt-1 text-3xl font-black font-mono tabular-nums text-slate-900">
							{formatSigned(hourPair.residual, 2)}
						</div>
						<div class="text-[11px] text-slate-500">com sinal, em µg/m³</div>
					</div>
				</div>

				<p class="mt-3 text-xs text-slate-600 leading-relaxed">
					{#if hourPair.paired}
						Resíduo positivo = o Open-Meteo estava acima do modelo nesta hora. A
						diferença entre as duas leituras nesta janela é informativa, não é erro
						medido: o CAMS da hora entrou como feature do próprio modelo.
					{:else}
						Um dos lados não veio nesta hora, então o resíduo é <strong>—</strong>, não
						zero. Hora sem dado não é hora de erro nulo.
					{/if}
				</p>
			</div>
		{:else}
			<div class="glass-card p-6 text-sm text-slate-600 flex items-center gap-2">
				<span class="i-ph-clock-bold w-4 h-4 text-slate-400"></span>
				Sem horas nesta combinação de estação e poluente.
			</div>
		{/if}
	</section>

	<!-- ─── Quadro por poluente (agregado das estações) ─── -->
	<section class="mt-8 anim-fade-up-d2">
		<div class="mb-3 flex items-center justify-between gap-3 flex-wrap">
			<h2 class="section-title"><span class="section-dot !bg-sky-600"></span>Comparação hora a hora por poluente</h2>
			<span class="text-xs text-slate-500">
				Agregado das {data.stations.length} estações · {formatMetric(data.summary.points_total, 0)} pontos pareados possíveis
			</span>
		</div>
		<div class="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory">
			{#each rows as row, idx}
				{@const m = row.metrics}
				{@const active = pollutant === row.key}
				<button
					type="button"
					onclick={() => (pollutant = row.key)}
					aria-pressed={active}
					class="glass-card p-4 relative overflow-hidden min-w-[150px] sm:min-w-0 snap-start text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-500 {active
						? '!border-sky-400'
						: ''}"
					style="animation: fadeSlideUp 0.38s cubic-bezier(0.16, 1, 0.3, 1) {0.05 + 0.05 * idx}s both"
				>
					<div class="absolute top-0 inset-x-0 h-1" style="background:{active ? ML_COLOR : '#cbd5e1'}"></div>
					<div class="flex items-center justify-between gap-1">
						<span class="text-[11px] font-bold uppercase tracking-widest text-slate-700">
							{row.label}
						</span>
						{#if active}
							<span class="text-[9px] uppercase font-bold tracking-widest text-sky-700">visto</span>
						{/if}
					</div>
					<div class="mt-1 flex items-baseline gap-1.5">
						<span class="text-2xl font-black font-mono text-slate-900 tabular-nums">
							{formatMetric(m?.coverage_pct, 2)}%
						</span>
						<span class="text-[10px] text-slate-500 font-sans">cobertura pareada</span>
					</div>
					<div class="mt-2 space-y-1 font-mono text-[11px] text-slate-500">
						<div class="flex justify-between"><span>n pareado</span><strong class="text-slate-700">{formatMetric(m?.n_paired, 0)}</strong></div>
						<div class="flex justify-between"><span>|dif| média</span><strong class="text-slate-700">{formatMetric(m?.mae, 3)}</strong></div>
						<div class="flex justify-between"><span>RMSE</span><strong class="text-slate-700">{formatMetric(m?.rmse, 3)}</strong></div>
						<div class="flex justify-between"><span>Viés</span><strong class="text-slate-700">{formatSigned(m?.bias, 3)}</strong></div>
						<div class="flex justify-between"><span>R²</span><strong class="text-slate-700">{formatMetric(m?.r2, 4)}</strong></div>
					</div>
				</button>
			{/each}
		</div>
		<p class="text-xs text-slate-500 mt-2 leading-relaxed">
			"Cobertura pareada" é a fração de pontos com valor dos DOIS lados — hora sem dado não
			entra como zero e não é contada como acerto. Viés é
			<strong class="font-mono text-slate-700">Open-Meteo − modelo</strong>, com sinal:
			positivo significa que a fonte estava acima do modelo. Um módulo aqui esconderia
			exatamente o que a coluna mostra. O R² aqui é sobre dados de forecast e mede a
			linearidade entre as duas leituras, não a qualidade preditiva do modelo.
		</p>
	</section>

	<!-- ─── Séries ─── -->
	<section class="mt-8 anim-fade-up-d3">
		<div class="mb-3 flex flex-wrap items-center gap-2 relative z-30">
			<h2 class="section-title mr-auto">
				<span class="section-dot !bg-sky-600"></span>
				Curvas horárias · previsão de {data.window.hours}h
			</h2>
			<div class="w-full sm:w-auto sm:min-w-[240px]">
				<StationPicker
					stations={stationOptions}
					activeId={activeStation?.id ?? ""}
					onChange={(id) => (stationId = id)}
					label="Estação da comparação da previsão"
				/>
			</div>
		</div>

		<div
			class="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs mb-4 w-fit max-w-full overflow-x-auto"
			role="tablist"
			aria-label="Selecionar poluente da comparação da previsão"
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
			<ComparisonChart
				{series}
				title={`${POLLUTANT_LONG_LABEL[pollutant]} · ${activeStation.name}`}
				unit={CONCENTRATION_UNIT}
				/** Esta janela é de PREVISÃO: o gráfico não pode dizer "holdout". */
				windowKind="previsao"
			/>

			<!-- Situação da fonte nesta série, derivada do próprio array `api` -->
			<div class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
				<div class="glass-card p-5">
					<h3 class="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
						<span class="i-ph-map-pin-fill w-4 h-4 text-sky-600"></span>
						{activeStation.name} · {activeStation.municipality}
					</h3>
					<dl class="grid grid-cols-2 gap-2.5">
						<div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
							<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Horas na janela</dt>
							<dd class="font-mono text-base font-bold text-slate-900">{formatMetric(series.length, 0)}</dd>
						</div>
						<div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
							<dt class="text-[10px] uppercase font-bold tracking-[0.14em] text-slate-500">Métricas</dt>
							<dd class="text-xs text-slate-600 leading-snug">
								Por poluente e agregadas na rede (quadro acima). Este artefato não traz MAE,
								RMSE ou viés por estação.
							</dd>
						</div>
					</dl>
					<p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
						{activeStation.lat.toFixed(4)}, {activeStation.lon.toFixed(4)} ·
						Última hora com valor dos dois lados:
						<strong class="font-mono text-slate-700">{fmtHour(lastPaired?.timestamp)}</strong>
						{#if lastPaired}
							({lastPaired.timestamp})
						{/if}.
					</p>
				</div>

				<div class="glass-card p-5 border-l-4 border-l-amber-400">
					<h3 class="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
						<span class="i-ph-cloud-slash-fill w-4 h-4 text-amber-600"></span>
						Horas sem valor da fonte
					</h3>
					{#if apiGaps.length === 0}
						<p class="text-xs text-slate-600">
							A fonte reportou as {series.length} horas desta série. Sem lacuna.
						</p>
					{:else}
						<ul class="space-y-2 text-xs text-slate-700 leading-relaxed">
							{#each apiGaps as gap}
								<li class="flex items-start gap-2">
									<span class="i-ph-minus-bold w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5"></span>
									<span>
										<strong class="font-mono">{gap.hours}h</strong> sem CAMS, de
										{fmtHour(gap.from)} a {fmtHour(gap.to)}
										<span class="font-mono text-slate-500">({gap.from} → {gap.to})</span>.
									</span>
								</li>
							{/each}
						</ul>
					{/if}
					<p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
						Nessas horas a curva do modelo continua completa — foi prevista sem o dado de
						referência, que é exatamente o caso de uso do forecast. No gráfico a lacuna é
						um corte, nunca zero nem interpolação.
					</p>
				</div>
			</div>
		{/if}
	</section>

	<!-- ─── Ressalvas do artefato, em destaque ─── -->
	<section class="mt-8 anim-fade-up-d4">
		<h2 class="section-title mb-3"><span class="section-dot !bg-amber-500"></span>Ressalvas do artefato ({data.caveats.length})</h2>

		<ul class="space-y-2.5 text-xs sm:text-sm text-slate-700 leading-relaxed">
			{#each data.caveats as c}
				<li class="glass-card p-4 flex items-start gap-2.5">
					<span class="i-ph-warning-fill w-4 h-4 text-amber-600 shrink-0 mt-0.5"></span>
					<span>{c}</span>
				</li>
			{/each}
		</ul>

		<div class="mt-4">
			<div class="glass-card p-5 border-l-4 border-l-amber-400">
				<h3 class="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
					<span class="i-ph-scales-fill w-4 h-4 text-amber-600"></span>
					Ressalvas que citam {POLLUTANT_LABEL[pollutant]} ({pollutantCaveats.length} de {data.caveats.length})
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
	</section>

	<!-- ─── Rampa IQAr compartilhada + fecho ─── -->
	<section class="mt-8 mb-8 anim-fade-up-d5">
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

		<!-- Fecho: previsão e validação são janelas diferentes, e só uma das
		     duas mede erro. O link vai para a página que de fato mede. -->
		<div class="mt-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-2xl px-4 py-3 flex items-start gap-2.5" role="note">
			<span class="i-ph-warning-fill w-4 h-4 text-amber-600 shrink-0 mt-0.5"></span>
			<span>
				<strong>Esta página é a janela de previsão — ela não atesta o modelo.</strong>
				Tudo aqui é projeção para as próximas {data.window.hours} horas, do mesmo modelo
				que o dashboard mostra. A medição de erro fica no
				<a href="/comparacao" class="underline decoration-2 underline-offset-2 hover:text-amber-800">
					holdout
				</a>, em outro artefato e em outra janela; e ela não valida esta previsão, nem
				esta previsão valida o holdout.
			</span>
		</div>
	</section>
{/if}
