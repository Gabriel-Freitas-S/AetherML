<!-- apps/web/src/components/ComparisonChart.svelte
     Série ML × Open-Meteo em eixos sobrepostos + painel de resíduo.

     Duas cores, e só duas, em toda a view: ciano = o que o MODELO disse;
     ardósia = o que a FONTE (CAMS/Open-Meteo) disse. O resíduo reaproveita as
     MESMAS duas cores — o resíduo positivo (acima) é a cor da fonte, o
     negativo é a cor do modelo — então a leitura do resíduo é a leitura do
     gráfico de cima, sem legenda nova.

     Nenhuma linha atravessa uma lacuna: as polilinhas vêm de
     `polylineSegments`, e um trecho nunca contém um `null`. Zero e
     interpolação por cima de dado faltante são estruturalmente impossíveis.

     Duas janelas, um componente: `windowKind` diz QUAL é a desta série. Em
     `holdout` a janela é passada e fora do treino, então as frases dizem
     "holdout". Em `previsao` a janela é À FRENTE e o `forecast-compare.json`
     deliberadamente não tem `holdout` nem `protocol`: lá as frases dizem
     "previsão" e nenhuma delas afirma validação, porque `is_validation` é
     `false`. O padrão é `holdout`, então a página que já renderiza não muda.
-->
<script lang="ts">
import {
	CONCENTRATION_UNIT,
	type ComparisonSeries,
	axisTicks,
	describeSeries,
	formatMetric,
	formatSigned,
	niceCeiling,
	polylineSegments,
	residualDirection,
} from "../lib/comparison";

/** A janela da série: passado fora do treino (`holdout`) ou à frente (`previsao`). */
export type ComparisonWindowKind = "holdout" | "previsao";

const {
	series,
	title,
	unit = CONCENTRATION_UNIT,
	windowKind = "holdout",
}: {
	series: ComparisonSeries;
	title: string;
	unit?: string;
	windowKind?: ComparisonWindowKind;
} = $props();

/**
 * As duas frases que dependem da janela.
 *
 * A de previsão nunca diz "validação": `forecast-compare.json` carrega
 * `is_validation: false` porque o CAMS da hora prevista é insumo das features
 * do próprio modelo, então chamar aquilo de acerto medido seria mentir.
 */
const WINDOW_PHRASES: Record<
	ComparisonWindowKind,
	{ hours: string; values: string }
> = {
	holdout: { hours: "horas de holdout", values: "valores horários do holdout" },
	previsao: {
		hours: "horas de previsão",
		values: "valores horários da previsão",
	},
};

const windowPhrases = $derived(WINDOW_PHRASES[windowKind]);

/** Cor do modelo — o acento do produto. */
const ML_COLOR = "#0284c7";
/** Cor da fonte de referência: neutra de propósito, não é "outro modelo". */
const API_COLOR = "#475569";

const W = 800;
const H_MAIN = 230;
const H_RES = 120;
const PAD = { top: 14, right: 14, bottom: 30, left: 52 };

const plotW = $derived(W - PAD.left - PAD.right);
const plotH = $derived(H_MAIN - PAD.top - PAD.bottom);
const resH = $derived(H_RES - PAD.top - 18);
const resMidY = $derived(PAD.top + resH / 2);

const n = $derived(series.length);

let hovered = $state<number | null>(null);

/** Passo "redondo" (1/2/5×10^k) para o eixo não ter 4,37 µg/m³. */
function niceStep(max: number): number {
	const raw = max / 4;
	if (!(raw > 0) || !Number.isFinite(raw)) return 1;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const norm = raw / mag;
	const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
	return mult * mag;
}

function extentOf(
	values: (number | null)[],
): { min: number; max: number } | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (typeof v !== "number" || !Number.isFinite(v)) continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return min === Number.POSITIVE_INFINITY ? null : { min, max };
}

/** Eixo único para as DUAS séries: comparar em eixos separados é inventar diferença. */
const mainExtent = $derived.by(() => {
	const a = extentOf(series.ml);
	const b = extentOf(series.api);
	if (!a && !b) return null;
	return {
		min: Math.min(
			a?.min ?? Number.POSITIVE_INFINITY,
			b?.min ?? Number.POSITIVE_INFINITY,
		),
		max: Math.max(
			a?.max ?? Number.NEGATIVE_INFINITY,
			b?.max ?? Number.NEGATIVE_INFINITY,
		),
	};
});
const resExtent = $derived(extentOf(series.residual));

const mainStep = $derived.by(() => niceStep(Math.max(mainExtent?.max ?? 0, 1)));
const mainMax = $derived(
	niceCeiling(Math.max(mainExtent?.max ?? 0, 0), mainStep) || mainStep,
);
const mainTicks = $derived(axisTicks(mainMax, mainStep));

const resStep = $derived.by(() => {
	const a = resExtent
		? Math.max(Math.abs(resExtent.min), Math.abs(resExtent.max))
		: 0;
	return niceStep(Math.max(a, 0.5));
});
const resMax = $derived.by(() => {
	const a = resExtent
		? Math.max(Math.abs(resExtent.min), Math.abs(resExtent.max))
		: 0;
	const c = niceCeiling(a, resStep);
	return c > 0 ? c : resStep;
});

function x(i: number): number {
	return PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
}
function yMain(v: number): number {
	const clamped = Math.min(Math.max(v, 0), mainMax);
	return PAD.top + plotH - (clamped / mainMax) * plotH;
}
function yRes(v: number): number {
	const clamped = Math.min(Math.max(v, -resMax), resMax);
	return resMidY - (clamped / resMax) * (resH / 2);
}

function pathOf(
	segments: { index: number; value: number }[],
	y: (v: number) => number,
): string {
	return segments
		.map((seg) =>
			seg
				.map(
					(p, k) =>
						`${k === 0 ? "M" : "L"} ${x(p.index).toFixed(2)} ${y(p.value).toFixed(2)}`,
				)
				.join(" "),
		)
		.join(" ");
}

const mlSegments = $derived(polylineSegments(series.ml));
const apiSegments = $derived(polylineSegments(series.api));
const resSegments = $derived(polylineSegments(series.residual));
const mlPath = $derived(pathOf(mlSegments, yMain));
const apiPath = $derived(pathOf(apiSegments, yMain));
const resPath = $derived(pathOf(resSegments, yRes));

/** Cobertura separada por lado: uma lacuna da fonte não é uma lacuna do modelo. */
const mlDesc = $derived(describeSeries(series.ml));
const apiDesc = $derived(describeSeries(series.api));
const direction = $derived(residualDirection(series.residual));

function shortLabel(iso: string): string {
	return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 13)}h`;
}

const xTicks = $derived.by(() => {
	const stride = Math.max(1, Math.ceil(n / 5));
	const out: number[] = [];
	for (let i = 0; i < n; i += stride) out.push(i);
	if (out[out.length - 1] !== n - 1) out.push(n - 1);
	return [...new Set(out)];
});

const mlAt = $derived(hovered != null ? series.ml[hovered] : undefined);
const apiAt = $derived(hovered != null ? series.api[hovered] : undefined);
const resAt = $derived(hovered != null ? series.residual[hovered] : undefined);

function indexFromEvent(e: MouseEvent | TouchEvent): void {
	const target = e.currentTarget as SVGRectElement | null;
	const svg = target?.ownerSVGElement;
	if (!svg || n === 0) return;
	const r = svg.getBoundingClientRect();
	if (r.width === 0) return;
	const clientX =
		"touches" in e && e.touches.length > 0
			? e.touches[0].clientX
			: (e as MouseEvent).clientX;
	const sx = ((clientX - r.left) / r.width) * W;
	hovered = Math.max(
		0,
		Math.min(n - 1, Math.round(((sx - PAD.left) / plotW) * (n - 1))),
	);
}

function onKey(e: KeyboardEvent): void {
	if (n === 0) return;
	if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
		e.preventDefault();
		const delta = e.key === "ArrowLeft" ? -1 : 1;
		hovered = Math.max(
			0,
			Math.min(n - 1, (hovered ?? (delta > 0 ? -1 : n)) + delta),
		);
	} else if (e.key === "Escape") {
		hovered = null;
	} else if (e.key === "Home") {
		e.preventDefault();
		hovered = 0;
	} else if (e.key === "End") {
		e.preventDefault();
		hovered = n - 1;
	}
}

const ariaLabel = $derived(
	`${title}. ${n} ${windowPhrases.hours}. Modelo (linha sólida) contra Open-Meteo (linha tracejada), em ${unit}. Cobertura do modelo ${mlDesc.present} de ${mlDesc.total} horas, da fonte ${apiDesc.present} de ${apiDesc.total}. Resíduo acima de zero em ${direction.above} horas e abaixo em ${direction.below}. Os valores exatos estão na tabela "Ver tabela de dados" logo abaixo do gráfico.`,
);
</script>

<div class="glass-card p-5">
	<div class="flex items-center justify-between flex-wrap gap-2 mb-3">
		<h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
			<span class="i-ph-chart-line-bold w-4 h-4 text-sky-600"></span>
			{title}
			<span class="text-xs font-medium text-slate-500">· {unit}</span>
		</h3>
		<div class="flex items-center gap-4 text-xs font-semibold" role="group" aria-label="Legenda das séries">
			<span class="flex items-center gap-1.5 text-sky-700">
				<i class="inline-block w-6 h-0.5 rounded" style="background:{ML_COLOR}"></i> Modelo (ML)
			</span>
			<span class="flex items-center gap-1.5 text-slate-600">
				<i class="inline-block w-6 border-t-2 border-dashed" style="border-color:{API_COLOR}"></i> Open-Meteo (API)
			</span>
		</div>
	</div>

	<div class="relative w-full overflow-x-auto">
		<!-- O wrapper é focável para a leitura ser operável por teclado: setas movem a
		     hora, Home/End vão às pontas, Escape solta. O SVG continua sendo `img`
		     (uma imagem com descrição) — sem um alvo focável o único caminho até os
		     valores seria o mouse. -->
		<div
			role="group"
			tabindex="0"
			aria-label="Leitura por teclado: setas esquerda e direita movem a hora, Home e End vão ao início e ao fim, Escape solta."
			onkeydown={onKey}
			onblur={() => (hovered = null)}
		>
		<svg
			viewBox="0 0 {W} {H_MAIN + H_RES}"
			class="w-full h-auto min-w-[620px] select-none"
			role="img"
			aria-label={ariaLabel}
		>
			<!-- Grade + eixo Y de concentração -->
			{#each mainTicks as t}
				<line x1="{PAD.left}" y1="{yMain(t)}" x2="{W - PAD.right}" y2="{yMain(t)}" stroke="#cbd5e1" stroke-dasharray="3 3" stroke-width="1" />
				<text x="{PAD.left - 8}" y="{yMain(t) + 4}" fill="#64748b" text-anchor="end" style="font-size:11px;font-weight:600">{t}</text>
			{/each}

			{#each xTicks as i}
				<text x="{x(i)}" y="{H_MAIN - PAD.bottom + 20}" fill="#64748b" text-anchor="middle" style="font-size:11px;font-weight:600">
					{shortLabel(series.timestamps[i] ?? "")}
				</text>
			{/each}

			<!-- Referência da API: tracejada e por baixo. `d` traz um "M" por trecho,
			     então as lacunas são cortes de verdade, não pontes. -->
			<path d="{apiPath}" fill="none" stroke={API_COLOR} stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round" />
			<!-- Modelo: sólida e por cima -->
			<path d="{mlPath}" fill="none" stroke={ML_COLOR} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

			<!-- ── Painel de resíduo (API − ML), escala própria e simétrica ── -->
			<line
				x1="{PAD.left}"
				y1="{H_MAIN + resMidY}"
				x2="{W - PAD.right}"
				y2="{H_MAIN + resMidY}"
				stroke="#0f172a"
				stroke-width="1.5"
				opacity="0.55"
			/>
			<text x="{PAD.left - 8}" y="{H_MAIN + resMidY + 4}" fill="#0f172a" text-anchor="end" style="font-size:11px;font-weight:700">0</text>
			{#each [-resMax, resMax] as r}
				<text x="{PAD.left - 8}" y="{H_MAIN + yRes(r) + 4}" fill="#64748b" text-anchor="end" style="font-size:10px;font-weight:600">
					{formatSigned(r, 1)}
				</text>
			{/each}
			<text x="{PAD.left}" y="{H_MAIN + 10}" fill="#475569" style="font-size:11px;font-weight:700">
				Resíduo Open-Meteo − Modelo ({unit}) · acima = fonte mais alta
			</text>

			{#each resSegments as seg}
				<path
					d="{pathOf([seg], (v) => H_MAIN + yRes(v))}"
					fill="none"
					stroke={seg.every((p) => p.value >= 0) ? API_COLOR : ML_COLOR}
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					opacity="0.9"
				/>
			{/each}

			{#if hovered != null && n > 0}
				<line x1="{x(hovered)}" y1="{PAD.top}" x2="{x(hovered)}" y2="{H_MAIN + H_RES - 18}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 2" opacity="0.8" pointer-events="none" />
				{#if typeof mlAt === "number"}
					<circle cx="{x(hovered)}" cy="{yMain(mlAt)}" r="4.5" fill={ML_COLOR} stroke="#fff" stroke-width="2" pointer-events="none" />
				{/if}
				{#if typeof apiAt === "number"}
					<circle cx="{x(hovered)}" cy="{yMain(apiAt)}" r="4.5" fill="#fff" stroke={API_COLOR} stroke-width="2.5" stroke-dasharray="2 1" pointer-events="none" />
				{/if}
				{#if typeof resAt === "number"}
					<circle cx="{x(hovered)}" cy="{H_MAIN + yRes(resAt)}" r="4" fill={resAt >= 0 ? API_COLOR : ML_COLOR} stroke="#fff" stroke-width="2" pointer-events="none" />
				{/if}
			{/if}

			<!-- Overlay único de hover/touch (mesmo motivo do CompareChart) -->
			<rect
				x="{PAD.left}"
				y="{PAD.top}"
				width="{plotW}"
				height="{H_MAIN - PAD.bottom + H_RES - PAD.top}"
				fill="transparent"
				style="cursor: crosshair; touch-action: pan-y;"
				onmousemove={indexFromEvent}
				onmouseleave={() => (hovered = null)}
				onclick={indexFromEvent}
				ontouchstart={indexFromEvent}
				ontouchmove={indexFromEvent}
			/>
		</svg>

		{#if hovered != null && n > 0}
			<div class="absolute top-2 right-4 bg-white/95 border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-xl backdrop-blur-md">
				<div class="font-bold text-slate-800">{shortLabel(series.timestamps[hovered] ?? "")}</div>
				<div class="font-mono mt-0.5 text-slate-600">
					Modelo <strong style="color:{ML_COLOR}">{formatMetric(mlAt, 1)}</strong> · API
					<strong style="color:{API_COLOR}">{formatMetric(apiAt, 1)}</strong> {unit}
				</div>
				<div class="font-mono text-slate-700">
					Resíduo <strong style="color:{(resAt ?? 0) >= 0 ? API_COLOR : ML_COLOR}">{formatSigned(resAt, 2)}</strong>
				</div>
			</div>
		{/if}
		</div>
	</div>

	<p class="sr-only" aria-live="polite">
		{#if hovered != null && n > 0}
			{shortLabel(series.timestamps[hovered] ?? "")}: modelo {formatMetric(mlAt, 1)}, Open-Meteo {formatMetric(apiAt, 1)}, resíduo {formatSigned(resAt, 2)} {unit}.
		{/if}
	</p>

	<!-- Cobertura separada: lacuna da fonte não é lacuna do modelo -->
	<div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
		<span class="chip bg-slate-100 border-slate-200">
			<span class="i-ph-clock-bold w-3.5 h-3.5 text-sky-600"></span>
			<span>Modelo: <strong class="font-mono text-slate-800">{mlDesc.present}/{mlDesc.total}</strong> h</span>
		</span>
		<span class="chip bg-slate-100 border-slate-200">
			<span class="i-ph-cloud-bold w-3.5 h-3.5 text-slate-600"></span>
			<span>Fonte: <strong class="font-mono text-slate-800">{apiDesc.present}/{apiDesc.total}</strong> h</span>
		</span>
		<span class="chip bg-slate-100 border-slate-200">
			<span class="i-ph-arrows-vertical-bold w-3.5 h-3.5 text-slate-600"></span>
			<span>Acima: <strong class="font-mono" style="color:{API_COLOR}">{direction.above}h</strong> · abaixo: <strong class="font-mono" style="color:{ML_COLOR}">{direction.below}h</strong></span>
		</span>
		{#if mlDesc.missing > 0 || apiDesc.missing > 0}
			<span class="chip bg-amber-50 border-amber-200 text-amber-800">
				<span class="i-ph-warning-fill w-3.5 h-3.5"></span>
				<span>Lacunas desenhadas como corte, nunca como zero</span>
			</span>
		{/if}
	</div>

	<details class="mt-3 group">
		<summary class="cursor-pointer text-xs font-semibold text-sky-700 hover:underline select-none">
			Ver tabela de dados ({n} horas)
		</summary>
		<div class="mt-2 max-h-[320px] overflow-y-auto rounded-xl border border-slate-200">
			<table class="w-full text-xs">
				<caption class="sr-only">{title} — {windowPhrases.values} em {unit}</caption>
				<thead class="sticky top-0 bg-slate-50 text-slate-600">
					<tr class="text-left">
						<th scope="col" class="px-2 py-1.5 font-bold">Hora (UTC)</th>
						<th scope="col" class="px-2 py-1.5 font-bold text-right">Modelo</th>
						<th scope="col" class="px-2 py-1.5 font-bold text-right">Open-Meteo</th>
						<th scope="col" class="px-2 py-1.5 font-bold text-right">Resíduo</th>
					</tr>
				</thead>
				<tbody class="font-mono">
					{#each series.timestamps as ts, i}
						<tr class="border-t border-slate-100">
							<td class="px-2 py-1 text-slate-600 whitespace-nowrap">{ts}</td>
							<td class="px-2 py-1 text-right" style="color:{ML_COLOR}">{formatMetric(series.ml[i], 1)}</td>
							<td class="px-2 py-1 text-right" style="color:{API_COLOR}">{formatMetric(series.api[i], 1)}</td>
							<td class="px-2 py-1 text-right text-slate-700">{formatSigned(series.residual[i], 2)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</div>

<style>
	svg text {
		font-family: 'Outfit', system-ui, sans-serif;
		letter-spacing: 0;
	}
</style>
