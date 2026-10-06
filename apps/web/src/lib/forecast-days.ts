// apps/web/src/lib/forecast-days.ts — fonte única da verdade sobre dia local, rótulo de
// cartão, idade do dado e estado "desatualizado". Dashboard.svelte e estacao/[id].astro
// importam daqui para que as duas telas nunca voltem a divergir.

import { classifyIndex } from "@aetherml/core-iqar";

/** Fuso de operação da rede RAMQAr/ES (defeito 1 e 3 dependem desta data local). */
export const STATION_TIME_ZONE = "America/Sao_Paulo";

/** Espaço inseparável: o parser XML de SVG <text> remove espaços comuns. */
export const NBSP = "\u00A0";

export interface DayPoint {
	timestamp: string;
	iqar: number;
	classification: string;
	primary: string;
}

export interface DayCard {
	dayNumber: number;
	/** Data local em `YYYY-MM-DD`. */
	date: string;
	label: string;
	/** Verdadeiro apenas quando a data local do card é a data local de agora. */
	isToday: boolean;
	/** Verdadeiro apenas quando o dia ainda contém alguma hora no futuro. */
	isForecast: boolean;
	maxIqar: number;
	avgIqar: number;
	classification: string;
	primary: string;
}

export interface DataAge {
	/** Horário local do dado mais recente, ou null se não há dado. */
	observedAt: string | null;
	/** Idade do dado mais recente em ms, ou null se não há dado. Negativo = à frente. */
	ageMs: number | null;
	/** "há 6 dias" / "há 3 h" / "agora mesmo" / "em 3 dias"; string vazia sem dado. */
	ageText: string;
}

export interface DayCardsResult {
	cards: DayCard[];
	/** Verdadeiro quando existe ao menos um ponto no futuro. */
	hasFuture: boolean;
	/** Verdadeiro quando não existe nenhum ponto no futuro: a série é só histórico. */
	isStale: boolean;
	newestTimestamp: string | null;
	newestMs: number | null;
}

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
	timeZone: STATION_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

type PartType = Intl.DateTimeFormatPart["type"];

function partsIn(date: Date, options: Intl.DateTimeFormatOptions) {
	return new Intl.DateTimeFormat("pt-BR", {
		...options,
		timeZone: STATION_TIME_ZONE,
	}).formatToParts(date);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: PartType): string {
	return parts.find((p) => p.type === type)?.value ?? "";
}

function weekdayLabel(date: Date): string {
	const wd = partValue(partsIn(date, { weekday: "short" }), "weekday").replace(
		".",
		"",
	);
	return wd.charAt(0).toUpperCase() + wd.slice(1);
}

/** Data local (`YYYY-MM-DD`) de um instante, no fuso da rede. */
export function getLocalDateStr(date: Date): string {
	return DATE_FMT.format(date);
}

/** Rótulo do cartão: "Sex 02/10", prefixado com "Hoje · " só no dia corrente. */
export function formatDayCardLabel(dateStr: string, isToday: boolean): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
	const parts = partsIn(date, { day: "2-digit", month: "2-digit" });
	const label = `${weekdayLabel(date)} ${partValue(parts, "day")}/${partValue(parts, "month")}`;
	return isToday ? `Hoje · ${label}` : label;
}

/** "02/10 03:00" no fuso da rede. */
export function formatObservedAt(timestamp: string): string {
	const parts = partsIn(new Date(timestamp), {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	return `${partValue(parts, "day")}/${partValue(parts, "month")} ${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

/** Rótulo do eixo X do SVG. Usa NBSP porque <text> SVG descarta espaço comum. */
export function formatAxisTickLabel(
	timestamp: string,
	isFirst: boolean,
): string {
	const date = new Date(timestamp);
	const parts = partsIn(date, { day: "2-digit", month: "2-digit" });
	const ddmm = `${partValue(parts, "day")}/${partValue(parts, "month")}`;
	return isFirst ? `Hoje${NBSP}${ddmm}` : `${weekdayLabel(date)}${NBSP}${ddmm}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Idade do dado, com o sinal preservado: "agora mesmo" / "há 5 min" / "há 3 h" /
 * "há 6 dias" para o passado, e "em 5 min" / "em 3 h" / "em 6 dias" para o futuro.
 *
 * `ageMs` é `now - timestamp`, então NEGATIVO significa que o ponto está À FRENTE
 * de agora — é o caso normal na cauda de uma série de previsão. Dizer "há 4 dias"
 * de um ponto 4 dias à frente afirmaria um dado velho que não existe.
 */
export function formatAge(ageMs: number): string {
	const abs = Math.abs(ageMs);
	if (abs < MINUTE_MS) return "agora mesmo";
	// Os ramos só são alcançados com |Δ| >= 1 da própria unidade, então nenhuma
	// escala imprime zero ("em 0 min" seria tão falso quanto "há 0 min").
	let value: number;
	let unit: string;
	if (abs < HOUR_MS) {
		value = Math.floor(abs / MINUTE_MS);
		unit = "min";
	} else if (abs < DAY_MS) {
		value = Math.floor(abs / HOUR_MS);
		unit = "h";
	} else {
		value = Math.floor(abs / DAY_MS);
		unit = "dias";
	}
	return ageMs < 0 ? `em ${value} ${unit}` : `há ${value} ${unit}`;
}

/** Idade do dado mais recente, derivada do timestamp — nunca do horário do fetch. */
export function describeDataAge(
	newestTimestamp: string | null | undefined,
	now: Date = new Date(),
): DataAge {
	if (!newestTimestamp) return { observedAt: null, ageMs: null, ageText: "" };
	const observedMs = Date.parse(newestTimestamp);
	// Timestamp ilegível é dado AUSENTE, não dado de agora: sem esta guarda a idade
	// seria NaN e o `Intl` de `formatObservedAt` lançaria RangeError na tela.
	if (Number.isNaN(observedMs)) {
		return { observedAt: null, ageMs: null, ageText: "" };
	}
	const ageMs = now.getTime() - observedMs;
	return {
		observedAt: formatObservedAt(newestTimestamp),
		ageMs,
		ageText: formatAge(ageMs),
	};
}

export interface StaleNotice {
	title: string;
	body: string;
}

/** Texto único do aviso de dados desatualizados (evita divergência entre telas). */
export function formatStaleNotice(age: DataAge): StaleNotice {
	return {
		title: "Dados desatualizados",
		body: `A série mais recente disponível é de ${age.observedAt} (${age.ageText}). As horas abaixo são histórico observado, não previsão.`,
	};
}

/**
 * Agrupa os pontos por dia local e monta até `maxDays` cartões.
 *
 * Regra central: um dia só recebe o prefixo "Hoje" quando a sua data local é
 * realmente a data local de `now`, e só é marcado como previsão quando contém
 * alguma hora no futuro. Nada aqui converte histórico em previsão.
 */
export function buildFiveDayCards(
	points: DayPoint[],
	opts: { now?: Date; maxDays?: number } = {},
): DayCardsResult {
	const now = opts.now ?? new Date();
	const nowMs = now.getTime();
	const maxDays = opts.maxDays ?? 5;
	const todayStr = getLocalDateStr(now);

	const groups = new Map<string, DayPoint[]>();
	let newestMs: number | null = null;
	let hasFuture = false;
	for (const p of points) {
		const ms = Date.parse(p.timestamp);
		if (Number.isNaN(ms)) continue;
		if (newestMs === null || ms > newestMs) newestMs = ms;
		if (ms >= nowMs) hasFuture = true;
		const key = getLocalDateStr(new Date(ms));
		const bucket = groups.get(key);
		if (bucket) bucket.push(p);
		else groups.set(key, [p]);
	}

	const cards = Array.from(groups.keys())
		.sort()
		.slice(0, maxDays)
		.map((dateStr, dayIdx) => {
			const dayPoints = groups.get(dateStr) ?? [];
			const maxIqar = Math.max(...dayPoints.map((p) => p.iqar));
			const avgIqar = Math.round(
				dayPoints.reduce((acc, p) => acc + p.iqar, 0) /
					Math.max(1, dayPoints.length),
			);
			const peakPoint =
				dayPoints.find((p) => p.iqar === maxIqar) ?? dayPoints[0];
			const isToday = dateStr === todayStr;
			return {
				dayNumber: dayIdx + 1,
				date: dateStr,
				label: formatDayCardLabel(dateStr, isToday),
				isToday,
				isForecast: dayPoints.some((p) => Date.parse(p.timestamp) >= nowMs),
				maxIqar,
				avgIqar,
				// A faixa vem da MESMA estatística que o card exibe como número
				// (avgIqar). Derivá-la do pico fazia o card ler "43 · Moderada" com
				// uma faixa ("Ruim") calculada a partir de um pico de 59.
				classification: classifyIndex(avgIqar),
				// `primary` acompanha a linha "Pico {maxIqar}", logo é o do pico.
				primary: String(peakPoint.primary).toUpperCase(),
			};
		});

	return {
		cards,
		hasFuture,
		isStale: points.length > 0 && !hasFuture,
		newestTimestamp:
			newestMs === null ? null : new Date(newestMs).toISOString(),
		newestMs,
	};
}
