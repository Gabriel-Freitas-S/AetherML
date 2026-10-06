// apps/web/src/lib/comparison.ts — lógica pura da comparação ML × Open-Meteo.
//
// Lê `public/data/comparison-data.json`, um artefato de HOLDOUT (passado, nunca
// visto no treino) — deliberadamente distinto de `stations-data.json`, que é o
// prognóstico de 120h À FRENTE. Misturar os dois num mesmo eixo seria mentira.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.

import { formatObservedAt } from "./forecast-days.ts";

/**
 * Rampa de IQAr — fonte ÚNICA da cor por faixa CONAMA 491/2018.
 *
 * Dashboard, mapa, página da estação e a comparação importam daqui. Uma segunda
 * cópia da rampa é uma segunda verdade sobre saúde, e duas verdades sobre saúde
 * divergem. `hex` é a cor de preenchimento (faixa, halo); `text` é o par escuro
 * escolhido para contraste AA sobre branco — nunca use `hex` para texto.
 */
export interface IqarBand {
	hex: string;
	text: string;
	badge: string;
	icon: string;
	label: string;
	advice: string;
}

/** Ordem canônica das faixas, da melhor para a pior. */
export const IQAR_BANDS = [
	{
		cls: "Boa",
		hex: "#10b981",
		text: "#047857",
		badge: "badge-boa",
		icon: "i-ph-check-circle-fill",
		label: "Boa",
		advice: "Ar satisfatório. Atividades ao ar livre liberadas para todos.",
	},
	{
		cls: "Moderada",
		hex: "#f59e0b",
		text: "#b45309",
		badge: "badge-moderada",
		icon: "i-ph-warning-circle-fill",
		label: "Moderada",
		advice:
			"Sensíveis (crianças, idosos, asmáticos) devem moderar esforço prolongado ao ar livre.",
	},
	{
		cls: "Ruim",
		hex: "#f97316",
		text: "#c2410c",
		badge: "badge-ruim",
		icon: "i-ph-warning-fill",
		label: "Ruim",
		advice:
			"Evite esforço intenso ao ar livre. Sensíveis devem permanecer em ambientes ventilados.",
	},
	{
		cls: "Muito Ruim",
		hex: "#ef4444",
		text: "#b91c1c",
		badge: "badge-muitoruim",
		icon: "i-ph-warning-octagon-fill",
		label: "Muito Ruim",
		advice:
			"Evite sair. Mantenha janelas fechadas e use máscara PFF2 se precisar se deslocar.",
	},
	{
		cls: "Péssima",
		hex: "#a855f7",
		text: "#7e22ce",
		badge: "badge-pessima",
		icon: "i-ph-shield-warning-fill",
		label: "Péssima",
		advice:
			"Emergência: permaneça em local fechado. Siga orientações da defesa civil e do IEMA.",
	},
] as const satisfies readonly IqarBand[];

const BANDS_BY_CLS = new Map(IQAR_BANDS.map((b) => [b.cls, b]));

/** Faixa desconhecida ou ausente cai em Péssima — o pior caso, nunca o melhor. */
const FALLBACK_BAND: IqarBand = IQAR_BANDS[IQAR_BANDS.length - 1];

export function iqarBand(cls: string | null | undefined): IqarBand {
	if (!cls) return FALLBACK_BAND;
	return BANDS_BY_CLS.get(cls) ?? FALLBACK_BAND;
}

/**
 * Ícone da faixa. A categoria NUNCA é comunicada só por cor: o par
 * ícone + palavra carrega o significado, a cor só reforça. (Ver PRODUCT.md,
 * "Air-quality category must never be conveyed by color alone".)
 */
export function iqarIcon(cls: string | null | undefined): string {
	return iqarBand(cls).icon;
}

/** Cor de preenchimento da faixa (halo, barra do topo, acento de cartão). */
export function iqarHex(cls: string | null | undefined): string {
	return iqarBand(cls).hex;
}

/** Par de texto escuro com contraste AA sobre branco. */
export function iqarTextColor(cls: string | null | undefined): string {
	return iqarBand(cls).text;
}

/** Classe de badge já existente no uno.config — não criar uma segunda. */
export function badgeClass(cls: string | null | undefined): string {
	return iqarBand(cls).badge;
}

/** Orientação de saúde da faixa, em pt-BR. */
export function iqarAdvice(cls: string | null | undefined): string {
	return iqarBand(cls).advice;
}

/** Os 5 alvos modelados, na ordem canônica do registry. */
export const POLLUTANT_ORDER = ["pm25", "pm10", "o3", "no2", "so2"] as const;

export type PollutantKey = (typeof POLLUTANT_ORDER)[number];

/** Rótulo curto com subscrito unicode — mesma convenção de `formatPollutantName`. */
export const POLLUTANT_LABEL: Record<PollutantKey, string> = {
	pm25: "PM₂.₅",
	pm10: "PM₁₀",
	o3: "O₃",
	no2: "NO₂",
	so2: "SO₂",
};

/** Nome por extenso, para o rótulo acessível do seletor e do cabeçalho. */
export const POLLUTANT_LONG_LABEL: Record<PollutantKey, string> = {
	pm25: "Material particulado fino (PM₂.₅)",
	pm10: "Material particulado grosso (PM₁₀)",
	o3: "Ozônio (O₃)",
	no2: "Dióxido de nitrogênio (NO₂)",
	so2: "Dióxido de enxofre (SO₂)",
};

/** Todos os 5 alvos estão em µg/m³; nenhum exige outra unidade. */
export const CONCENTRATION_UNIT = "µg/m³";

export interface ComparisonPair {
	/** Previsão calibrada do modelo, ou `null` quando genuinely ausente. */
	ml: (number | null)[];
	/** Valor que o Open-Meteo reportou na mesma hora, ou `null`. */
	api: (number | null)[];
}

export interface ComparisonStation {
	id: string;
	name: string;
	municipality: string;
	lat: number;
	lon: number;
	timestamps: string[];
	pollutants: Partial<Record<PollutantKey, ComparisonPair>>;
}

export interface MetricSummary {
	mae: number;
	rmse: number;
	bias: number;
	r2: number;
	n: number;
}

export interface ComparisonArtifact {
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
		by_pollutant: Partial<Record<PollutantKey, MetricSummary>>;
		by_station: Record<string, Partial<Record<PollutantKey, MetricSummary>>>;
	};
}

/** Série tripla já alinhada: timestamps, ML, API e o resíduo derivado. */
export interface ComparisonSeries {
	timestamps: string[];
	ml: (number | null)[];
	api: (number | null)[];
	/** `api − ml`, com sinal. `null` onde qualquer lado falta. */
	residual: (number | null)[];
	length: number;
}

const EMPTY_SERIES: ComparisonSeries = {
	timestamps: [],
	ml: [],
	api: [],
	residual: [],
	length: 0,
};

function isNum(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

/**
 * Comprimento comum de arrays paralelos: o MENOR deles.
 *
 * Uma hora só existe se `timestamps[i]`, `ml[i]` e `api[i]` existirem juntos.
 * Alongar até o maior inventaria horas que o artefato não tem.
 */
export function alignLengths(...arrays: readonly unknown[][]): number {
	if (arrays.length === 0) return 0;
	return arrays.reduce(
		(min, a) => Math.min(min, a.length),
		Number.POSITIVE_INFINITY,
	);
}

/**
 * Monta a série de um poluente numa estação, já alinhada e com o resíduo.
 *
 * Poluente ausente, estação ausente ou artefato vazio devolvem série vazia —
 * nunca `undefined`, nunca exceção. O chamador decide o que renderizar.
 */
export function buildSeries(
	station: ComparisonStation | null | undefined,
	pollutant: string,
): ComparisonSeries {
	const pair = station?.pollutants?.[pollutant as PollutantKey];
	if (!station || !pair) return EMPTY_SERIES;
	const length = alignLengths(station.timestamps, pair.ml, pair.api);
	if (length <= 0) return EMPTY_SERIES;
	const timestamps = station.timestamps.slice(0, length);
	const ml = pair.ml.slice(0, length);
	const api = pair.api.slice(0, length);
	return { timestamps, ml, api, residual: buildResidual(api, ml), length };
}

/**
 * Resíduo `api − ml`, com sinal preservado.
 *
 * Positivo = o Open-Meteo estava ACIMA do modelo (o modelo subestimou).
 * Negativo = o modelo estava acima do Open-Meteo.
 *
 * `null` em qualquer lado propaga: uma lacuna de um lado não vira zero (que
 * fingiria erro nulo) nem é preenchida pelo valor do outro lado.
 */
export function buildResidual(
	api: readonly (number | null)[],
	ml: readonly (number | null)[],
): (number | null)[] {
	const n = Math.min(api.length, ml.length);
	const out: (number | null)[] = new Array(n);
	for (let i = 0; i < n; i += 1) {
		const a = api[i];
		const m = ml[i];
		out[i] = isNum(a) && isNum(m) ? a - m : null;
	}
	return out;
}

/**
 * Quebra uma série em polilinhas disjuntas nos indices com `null`.
 *
 * Devolve `{ index, value }[]` por trecho. O consumidor só precisa mapear
 * `index` para x e `value` para y: o zero e a interpolação ficam
 * estruturalmente impossíveis porque um trecho nunca atravessa a lacuna.
 */
export function polylineSegments(
	values: readonly (number | null)[],
): { index: number; value: number }[][] {
	const segments: { index: number; value: number }[][] = [];
	let current: { index: number; value: number }[] = [];
	for (let i = 0; i < values.length; i += 1) {
		const v = values[i];
		if (isNum(v)) {
			current.push({ index: i, value: v });
		} else if (current.length > 0) {
			segments.push(current);
			current = [];
		}
	}
	if (current.length > 0) segments.push(current);
	return segments;
}

/** Fração de posições com valor real (0 a 1). Série vazia cobre 0, não 1. */
export function coverageOf(values: readonly (number | null)[]): number {
	if (values.length === 0) return 0;
	let present = 0;
	for (const v of values) if (isNum(v)) present += 1;
	return present / values.length;
}

export interface SeriesDescription {
	total: number;
	present: number;
	missing: number;
	coverage: number;
}

export function describeSeries(
	values: readonly (number | null)[],
): SeriesDescription {
	const total = values.length;
	const missing = values.reduce((acc, v) => acc + (isNum(v) ? 0 : 1), 0);
	return {
		total,
		present: total - missing,
		missing,
		coverage: coverageOf(values),
	};
}

/**
 * Há algo a desenhar? Exige pelo menos um valor real em QUALQUER um dos lados.
 *
 * `ml: null, api: 12` é informação (a lacuna é da fonte, não do modelo) e
 * desenha. `ml: null, api: null` não é nada, e a UI precisa dizer "sem dados"
 * em vez de desenhar um gráfico vazio e healthy.
 */
export function isRenderable(series: ComparisonSeries): boolean {
	return series.ml.some(isNum) || series.api.some(isNum);
}

/** Menor e maior valor real, ou `null` se não houver nenhum. */
export function extent(
	values: readonly (number | null)[],
): { min: number; max: number } | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (!isNum(v)) continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return min === Number.POSITIVE_INFINITY ? null : { min, max };
}

/** Teto do eixo arredondado para um múltiplo do passo. Nunca abaixo do valor. */
export function niceCeiling(value: number, step: number): number {
	if (!isNum(value) || value <= 0 || step <= 0) return 0;
	return Math.round(Math.ceil(value / step) * step * 1e6) / 1e6;
}

/** Marcas do eixo de 0 ao teto, em passos iguais, com o teto sempre incluído. */
export function axisTicks(max: number, step: number): number[] {
	if (!isNum(max) || max <= 0 || step <= 0) return [0];
	const ticks: number[] = [];
	for (let v = 0; v <= max + step / 2; v += step) {
		ticks.push(Math.round(v * 1e6) / 1e6);
	}
	return ticks;
}

const DASH = "\u2014"; // —

/**
 * Número ou `—` quando ausente.
 *
 * `Math.abs` NÃO é aplicado aqui: viés é um número com sinal e o sinal é o dado.
 * Separadores de milhar seguem o padrão en-US (ponto), igual ao artefato JSON e à
 * página `/precisao`, para o leitor não ver duas convenções na mesma tela.
 */
export function formatMetric(
	value: number | null | undefined,
	digits = 2,
): string {
	if (!isNum(value)) return DASH;
	return value.toFixed(digits);
}

/** Como `formatMetric`, mas com `+` explícito nos positivos. Viés nunca em módulo. */
export function formatSigned(
	value: number | null | undefined,
	digits = 3,
): string {
	if (!isNum(value)) return DASH;
	if (value === 0) return (0).toFixed(digits);
	return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export interface ResidualDirection {
	above: number;
	below: number;
	atZero: number;
	total: number;
	aboveShare: number;
	belowShare: number;
}

/**
 * Para que lado o erro foi: quantas horas o modelo ficou abaixo e acima da API.
 *
 * Só as horas com resíduo real entram — uma lacuna não é "erro zero".
 */
export function residualDirection(
	residual: readonly (number | null)[],
): ResidualDirection {
	let above = 0;
	let below = 0;
	let atZero = 0;
	for (const r of residual) {
		if (!isNum(r)) continue;
		if (r > 0) above += 1;
		else if (r < 0) below += 1;
		else atZero += 1;
	}
	const total = above + below + atZero;
	return {
		above,
		below,
		atZero,
		total,
		aboveShare: total === 0 ? 0 : above / total,
		belowShare: total === 0 ? 0 : below / total,
	};
}

/**
 * Ressalvas do artefato que citam um poluente.
 *
 * O texto não é indexado por poluente no JSON, então a seleção é por menção no
 * próprio texto. É deliberadamente rasa: a alternativa é inventar metadado que o
 * gerador Python não produz, e a UI precisa mostrar a frase medida como está.
 */
export function caveatsMentioning(
	caveats: readonly string[] | null | undefined,
	pollutant: string,
): string[] {
	if (!caveats || caveats.length === 0) return [];
	const needle = pollutant.toLowerCase();
	return caveats.filter((c) => c.toLowerCase().includes(needle));
}

/** Janela do holdout no fuso da rede: "25/09 14:00 → 02/10 13:00". */
export function formatHoldoutRange(
	from: string | null | undefined,
	to: string | null | undefined,
): string {
	const left = from ? formatObservedAt(from) : DASH;
	const right = to ? formatObservedAt(to) : DASH;
	if (!from && !to) return DASH;
	return `${left} \u2192 ${right}`;
}
