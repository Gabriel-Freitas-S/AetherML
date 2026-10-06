import assert from "node:assert/strict";
import { test } from "node:test";
import {
	NBSP,
	STATION_TIME_ZONE,
	buildFiveDayCards,
	describeDataAge,
	formatAge,
	formatAxisTickLabel,
	formatDayCardLabel,
	formatStaleNotice,
	getLocalDateStr,
} from "../src/lib/forecast-days.ts";

interface FakePoint {
	timestamp: string;
	iqar: number;
	classification: string;
	primary: string;
}

/** Série horária idêntica em forma ao bundle de `public/data/stations-data.json`. */
function hourlySeries(startIso: string, count: number): FakePoint[] {
	const start = Date.parse(startIso);
	return Array.from({ length: count }, (_, i) => {
		const iqar = 20 + ((i * 7) % 60);
		return {
			timestamp: new Date(start + i * 60 * 60 * 1000).toISOString(),
			iqar,
			classification: iqar <= 40 ? "Boa" : iqar <= 80 ? "Moderada" : "Ruim",
			primary: "pm25",
		};
	});
}

// Artefato realmente publicado: 2026-09-27T07:00Z .. 2026-10-02T06:00Z.
const SHIPPED_SERIES = hourlySeries("2026-09-27T07:00:00Z", 120);
const AFTER_SERIES_END = new Date("2026-10-10T12:00:00Z");

test("getLocalDateStr: usa o fuso da rede RAMQAr, não o fuso do navegador", () => {
	assert.equal(STATION_TIME_ZONE, "America/Sao_Paulo");
	assert.equal(
		getLocalDateStr(new Date("2026-10-02T06:00:00Z")),
		"2026-10-02",
		"06:00Z é 03:00 em São Paulo, ou seja, o mesmo dia local",
	);
});

test("formatDayCardLabel: prefixa 'Hoje' apenas quando o dia é genuinamente hoje", () => {
	assert.match(formatDayCardLabel("2026-10-02", true), /^Hoje · /);
	assert.doesNotMatch(formatDayCardLabel("2026-09-27", false), /Hoje/);
});

// Defeito 1: `|| dayIdx === 0` rotulava o primeiro ponto como "Hoje" mesmo
// cinco dias depois da coleta.
test("buildFiveDayCards: dataset desatualizado não produz nenhum rótulo 'Hoje'", () => {
	const { cards } = buildFiveDayCards(SHIPPED_SERIES, {
		now: AFTER_SERIES_END,
	});

	assert.ok(cards.length > 0, "os cards continuam sendo renderizados");
	assert.equal(cards[0].date, "2026-09-27");
	for (const card of cards) {
		assert.equal(card.isToday, false, `${card.date} não é hoje`);
		assert.doesNotMatch(
			card.label,
			/Hoje/,
			`card de ${card.date} não pode dizer "Hoje" (label: ${card.label})`,
		);
	}
});

// Defeito 3: o fallback reagrupava todo o histórico e o rotulava como dias futuros.
test("buildFiveDayCards: histórico não é reagrupado nem rotulado como previsão", () => {
	const { cards, isStale } = buildFiveDayCards(SHIPPED_SERIES, {
		now: AFTER_SERIES_END,
	});

	assert.equal(isStale, true, "nenhum ponto do bundle está no futuro");
	for (const card of cards) {
		assert.equal(
			card.isForecast,
			false,
			`card de ${card.date} é histórico, não previsão`,
		);
	}
	assert.deepEqual(
		cards.map((c) => c.date),
		["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"],
		"os cinco primeiros dias observados continuam agrupados",
	);
});

test("buildFiveDayCards: expõe o timestamp mais recente do bundle", () => {
	const { newestTimestamp, newestMs } = buildFiveDayCards(SHIPPED_SERIES, {
		now: AFTER_SERIES_END,
	});
	assert.equal(newestTimestamp, "2026-10-02T06:00:00.000Z");
	assert.equal(newestMs, Date.parse("2026-10-02T06:00:00Z"));
});

test("buildFiveDayCards: bundle vazio devolve estado neutro", () => {
	const { cards, isStale, newestTimestamp, newestMs } = buildFiveDayCards([], {
		now: AFTER_SERIES_END,
	});
	assert.deepEqual(cards, []);
	assert.equal(
		isStale,
		false,
		"sem dados não há nada a declarar desatualizado",
	);
	assert.equal(newestTimestamp, null);
	assert.equal(newestMs, null);
});

test("buildFiveDayCards: série com pontos futuros não é marcada como desatualizada", () => {
	const now = new Date("2026-10-02T12:00:00Z");
	const series = hourlySeries("2026-10-02T07:00:00Z", 48);
	const { cards, isStale } = buildFiveDayCards(series, { now });

	assert.equal(isStale, false);
	assert.equal(cards[0].date, "2026-10-02");
	assert.equal(cards[0].isToday, true, "o dia corrente é genuinamente hoje");
	assert.match(cards[0].label, /^Hoje · /);
	assert.equal(
		cards.find((c) => c.date === "2026-10-04")?.isForecast,
		true,
		"o dia 04/10 ainda tem horas previstas",
	);
});

// Defeito 2: `lastUpdated` era o horário do fetch, não a idade do dado.
test("describeDataAge: deriva a idade do timestamp do dado, não do momento do fetch", () => {
	const age = describeDataAge("2026-10-02T06:00:00Z", AFTER_SERIES_END);

	assert.equal(
		age.observedAt,
		"02/10 03:00",
		"03:00 é o horário local do dado",
	);
	assert.equal(age.ageText, "há 8 dias");
	assert.equal(
		age.ageMs,
		Date.parse(AFTER_SERIES_END.toISOString()) -
			Date.parse("2026-10-02T06:00:00Z"),
	);
});

test("describeDataAge: sem timestamp devolve estado vazio em vez de 'agora'", () => {
	const age = describeDataAge(null, AFTER_SERIES_END);
	assert.equal(age.observedAt, null);
	assert.equal(age.ageMs, null);
	assert.equal(age.ageText, "");
});

test("formatAge: escolhe a unidade correta", () => {
	assert.equal(formatAge(30_000), "agora mesmo");
	assert.equal(formatAge(5 * 60_000), "há 5 min");
	assert.equal(formatAge(3 * 3_600_000), "há 3 h");
	assert.equal(formatAge(6 * 86_400_000), "há 6 dias");
});

// Regressão real: em 02/10/2026 18:16Z a tira de proveniência mostrava
// "Mais recente 07/10 13:00" + "há 4 dias" para o MESMO ponto — a cauda de uma
// previsão que está ~4,9 dias À FRENTE. `Math.abs` com "|Δ| dias" + "há" apagava
// o sinal e transformava previsão em dado velho.
const BUG_NOW = new Date("2026-10-02T18:16:00Z");
const BUG_TAIL = "2026-10-07T16:00:00Z";

test("describeDataAge: timestamp no passado devolve idade positiva, redigida com 'há'", () => {
	const ts = "2026-10-02T17:00:00Z";
	const age = describeDataAge(ts, BUG_NOW);

	assert.ok((age.ageMs ?? 0) > 0, "passado tem delta positivo por convenção");
	assert.equal(age.ageText, "há 1 h");
	assert.equal(age.ageMs, BUG_NOW.getTime() - Date.parse(ts));
});

test("describeDataAge: cauda de previsão à frente não é redigida como dado velho", () => {
	const age = describeDataAge(BUG_TAIL, BUG_NOW);

	assert.equal(age.observedAt, "07/10 13:00");
	assert.ok((age.ageMs ?? 0) < 0, "ponto futuro tem delta negativo");
	assert.equal(age.ageText, "em 4 dias");
	assert.doesNotMatch(
		age.ageText,
		/há/,
		"'há' afirma passado; aqui o ponto está à frente",
	);
});

test("formatAge: no futuro a unidade é a mesma, mas a preposição é a do futuro", () => {
	assert.equal(formatAge(-5 * 60_000), "em 5 min");
	assert.equal(formatAge(-3 * 3_600_000), "em 3 h");
	assert.equal(formatAge(-5 * 86_400_000), "em 5 dias");
});

test("describeDataAge: dentro da janela de agora é 'agora mesmo', nos dois sentidos", () => {
	assert.equal(
		describeDataAge("2026-10-02T18:15:30Z", BUG_NOW).ageText,
		"agora mesmo",
		"30 s no passado",
	);
	assert.equal(
		describeDataAge("2026-10-02T18:16:30Z", BUG_NOW).ageText,
		"agora mesmo",
		"30 s à frente ainda é presente, não futuro",
	);
	assert.equal(
		describeDataAge("2026-10-02T18:17:30Z", BUG_NOW).ageText,
		"em 1 min",
		"90 s à frente arredonda para 1 min, nunca para 'em 0 min'",
	);
});

test("describeDataAge: timestamp ilegível devolve estado vazio, nunca 'agora'", () => {
	const age = describeDataAge("ontem", BUG_NOW);

	assert.equal(age.observedAt, null);
	assert.equal(age.ageMs, null);
	assert.equal(age.ageText, "", "vazio é o que a tira converte em '—'");
});

test("formatStaleNotice: o aviso cita o horário do dado e a idade", () => {
	const notice = formatStaleNotice(
		describeDataAge("2026-10-02T06:00:00Z", AFTER_SERIES_END),
	);
	assert.match(notice.title, /desatualizados/i);
	assert.ok(notice.body.includes("02/10 03:00"));
	assert.ok(notice.body.includes("há 8 dias"));
});

// Defeito 4: SVG <text> colapsa o espaço comum de "Hoje 27/09".
test("formatAxisTickLabel: separa com espaço inseparável, que o SVG não colapsa", () => {
	const first = formatAxisTickLabel("2026-09-27T07:00:00Z", true);
	assert.ok(first.startsWith("Hoje"), first);
	assert.ok(first.includes(NBSP), "precisa conter espaço inseparável");
	assert.doesNotMatch(first, / /, "nenhum espaço comum pode sobrar");

	const other = formatAxisTickLabel("2026-09-28T07:00:00Z", false);
	assert.ok(other.includes(NBSP));
	assert.doesNotMatch(other, / /);
});
