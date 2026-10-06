// apps/web/src/lib/forecast-compare.ts — camada pura da página que compara a
// PREVISÃO do modelo com o Open-Meteo (`forecast-compare.json`).
//
// Deliberadamente separado de `comparison.ts`, que é o HOLDOUT. As duas janelas
// não podem ser trocadas: aqui o CAMS da hora forecast é uma das ENTRADAS do
// modelo que produziu a curva `ml` da mesma hora, então a proximidade entre as
// duas curvas é esperada por construção e não mede erro. O holdout de
// `comparison-data.json` é que mede. Esta distinção mora em código testado, não
// só em texto de tela.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.

import {
	type ComparisonSeries,
	type ComparisonStation,
	POLLUTANT_LABEL,
	POLLUTANT_ORDER,
	type PollutantKey,
} from "./comparison.ts";

/**
 * Métricas por poluente do artefato de forecast.
 *
 * Todos os campos são opcionais: `by_station` não traz `r2` (verificado no JSON)
 * e nenhum campo pode ser lido como 0 quando falta — `formatMetric` devolve "—".
 */
export interface ForecastMetrics {
	n_paired?: number | null;
	coverage_pct?: number | null;
	mae?: number | null;
	rmse?: number | null;
	bias?: number | null;
	r2?: number | null;
}

/**
 * `forecast-compare.json`.
 *
 * A janela chama `window`, não `holdout`, e o arquivo não tem `protocol`: em vez
 * de forjar uma chave para calar o TypeScript, o painel mapeia `window` no lugar
 * de `holdout` e renderiza `validation_note` como o texto que ele é.
 */
export interface ForecastCompareArtifact {
	schema_version: number;
	generated_at: string;
	model_version: string;
	feature_order_version: string;
	is_validation: boolean;
	/** Nota obrigatória do gerador: por que esta janela não mede precisão. */
	validation_note: string;
	window: { from: string; to: string; hours: number };
	source: { ml: string; api: string; raw_file: string; raw_fetched_at: string };
	caveats: string[];
	stations: ComparisonStation[];
	summary: {
		points_total: number;
		by_pollutant: Partial<Record<PollutantKey, ForecastMetrics>>;
		by_station: Record<string, Partial<Record<PollutantKey, ForecastMetrics>>>;
	};
}

function isNum(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

/**
 * Índice da hora "agora" dentro da janela de previsão.
 *
 * Primeira hora igual ou posterior a `nowIso`; se a janela já passou, a última
 * hora dela (é o que resta de verdade, não o zero do índice). `-1` quando não há
 * janela nenhuma.
 */
export function currentHourIndex(
	timestamps: readonly string[],
	nowIso: string,
): number {
	if (timestamps.length === 0) return -1;
	const now = Date.parse(nowIso);
	if (Number.isNaN(now)) return 0;
	let found = -1;
	for (let i = 0; i < timestamps.length; i += 1) {
		const t = Date.parse(timestamps[i]);
		if (Number.isNaN(t)) continue;
		if (t >= now) {
			found = i;
			break;
		}
	}
	return found >= 0 ? found : timestamps.length - 1;
}

/** ML e Open-Meteo da MESMA hora, com o resíduo derivado e a marca de pareamento. */
export interface HourPair {
	index: number;
	timestamp: string;
	ml: number | null;
	api: number | null;
	/** `api − ml`, com sinal. `null` se algum dos lados faltar. */
	residual: number | null;
	/** Só `true` com valor dos DOIS lados. */
	paired: boolean;
}

/**
 * Par de uma hora qualquer da série. Índice fora da série devolve `null`.
 *
 * Ausência vira `null` e `paired: false`: um número faltando nunca é 0, porque
 * 0 é um valor medido e "—" é a única leitura honesta de "não veio".
 */
export function hourPairAt(
	series: ComparisonSeries,
	index: number,
): HourPair | null {
	const timestamp = series.timestamps[index];
	if (index < 0 || timestamp === undefined) return null;
	const ml = isNum(series.ml[index]) ? series.ml[index] : null;
	const api = isNum(series.api[index]) ? series.api[index] : null;
	const paired = ml !== null && api !== null;
	return {
		index,
		timestamp,
		ml,
		api,
		residual: paired ? api - ml : null,
		paired,
	};
}

/** Par da hora corrente. `null` quando a série está vazia. */
export function currentHourPair(
	series: ComparisonSeries,
	nowIso: string,
): HourPair | null {
	const idx = currentHourIndex(series.timestamps, nowIso);
	return idx < 0 ? null : hourPairAt(series, idx);
}

/**
 * Índice da ÚLTIMA hora com valor dos dois lados, ou `-1`.
 *
 * É o que separa "a fonte deixou de responder a partir daqui" de "a fonte nunca
 * respondeu" — as duas coisas produzem `null` no array e significam coisas
 * diferentes para quem lê.
 */
export function lastPairedIndex(series: ComparisonSeries): number {
	for (let i = series.length - 1; i >= 0; i -= 1) {
		if (isNum(series.ml[i]) && isNum(series.api[i])) return i;
	}
	return -1;
}

/** Trecho contíguo de valores ausentes de uma série. */
export interface GapRun {
	/** Timestamp do primeiro ponto ausente. `""` se a série não tem carimbo. */
	from: string;
	/** Timestamp do último ponto ausente. `""` se a série não tem carimbo. */
	to: string;
	hours: number;
}

/**
 * Trechos contíguos de `null`, com as horas e os carimbos de ponta.
 *
 * Derivado do artefato, nunca digitado: o tamanho da lacuna da fonte é um dado
 * medido e muda quando o artefato muda.
 */
export function gapRuns(
	values: readonly (number | null)[],
	timestamps: readonly string[],
): GapRun[] {
	const runs: GapRun[] = [];
	let start = -1;
	for (let i = 0; i <= values.length; i += 1) {
		const missing = i < values.length && !isNum(values[i]);
		if (missing && start < 0) start = i;
		if (!missing && start >= 0) {
			runs.push({
				from: timestamps[start] ?? "",
				to: timestamps[i - 1] ?? "",
				hours: i - start,
			});
			start = -1;
		}
	}
	return runs;
}

/** Uma linha do quadro por poluente, na ordem canônica do registry. */
export interface PollutantRow {
	key: PollutantKey;
	label: string;
	/** `null` quando o poluente não está no artefato — vira "—", nunca 0. */
	metrics: ForecastMetrics | null;
}

/**
 * Linhas por poluente na ordem canônica, com o rótulo da rampa compartilhada.
 *
 * A ordem vem de `POLLUTANT_ORDER`, não da ordem das chaves do JSON.
 */
export function pollutantRows(
	summary: ForecastCompareArtifact["summary"],
): PollutantRow[] {
	const byPollutant = summary?.by_pollutant ?? {};
	return POLLUTANT_ORDER.map((key) => ({
		key,
		label: POLLUTANT_LABEL[key],
		metrics: byPollutant[key] ?? null,
	}));
}

/**
 * O artefato se declara — ou não — como validação de precisão.
 *
 * `false` é o caso deste arquivo, e é o que o painel usa para exibir o aviso
 * grande antes de qualquer número: nesta janela o CAMS da hora forecast é
 * insumo das features do próprio modelo, então a concordância entre `ml` e `api`
 * é verdadeira por construção e não é acerto medido. O erro honesto está no
 * holdout de `comparison-data.json`, em `/comparacao`.
 */
export function declaresAccuracyValidation(
	artifact: Pick<ForecastCompareArtifact, "is_validation"> | null | undefined,
): boolean {
	return artifact?.is_validation === true;
}
