// apps/web/test/forecast-compare.test.ts — camada pura da página que compara a
// PREVISÃO do modelo com o Open-Meteo (`forecast-compare.json`).
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.
//
// A janela aqui é de PREVISÃO, não de holdout. O módulo existe justamente para
// que essa diferença fique em código testado e não só em texto de tela.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type ComparisonSeries,
	POLLUTANT_ORDER,
	buildResidual,
} from "../src/lib/comparison.ts";
import {
	type ForecastCompareArtifact,
	currentHourIndex,
	currentHourPair,
	declaresAccuracyValidation,
	gapRuns,
	hourPairAt,
	lastPairedIndex,
	pollutantRows,
} from "../src/lib/forecast-compare.ts";

const T0 = Date.parse("2026-10-02T17:00:00Z");

function iso(i: number): string {
	return new Date(T0 + i * 3_600_000).toISOString().replace(".000Z", "Z");
}

function seriesOf(
	ml: (number | null)[],
	api: (number | null)[],
	timestamps?: string[],
): ComparisonSeries {
	const ts = timestamps ?? Array.from({ length: ml.length }, (_, i) => iso(i));
	const n = Math.min(ts.length, ml.length, api.length);
	return {
		timestamps: ts.slice(0, n),
		ml: ml.slice(0, n),
		api: api.slice(0, n),
		residual: buildResidual(api, ml),
		length: n,
	};
}

function artifactOf(
	overrides: Partial<ForecastCompareArtifact> = {},
): ForecastCompareArtifact {
	return {
		schema_version: 1,
		generated_at: "2026-10-02T17:05:00Z",
		model_version: "v2026.38.5",
		feature_order_version: "v2",
		is_validation: false,
		validation_note: "Isto NÃO é validação de precisão do modelo.",
		window: { from: iso(0), to: iso(119), hours: 120 },
		source: {
			ml: "stations-data.json",
			api: "Open-Meteo air-quality API (CAMS)",
			raw_file: "ml/data/openmeteo_raw.json",
			raw_fetched_at: "2026-10-02T16:44:49Z",
		},
		caveats: [],
		stations: [],
		summary: {
			points_total: 1080,
			by_pollutant: {},
			by_station: {},
		},
		...overrides,
	};
}

// ─── Hora corrente ─────────────────────────────────────────────────────────

test("currentHourIndex: agora no início da janela devolve a primeira hora", () => {
	assert.equal(currentHourIndex([iso(0), iso(1), iso(2)], iso(0)), 0);
});

test("currentHourIndex: devolve a primeira hora igual ou posterior a agora", () => {
	const stamps = Array.from({ length: 48 }, (_, i) => iso(i));
	const agora = new Date(T0 + 30 * 3_600_000).toISOString();
	assert.equal(
		currentHourIndex(stamps, agora),
		30,
		"agora é 30h após o início",
	);
});

test("currentHourIndex: sem hora igual ou posterior a agora devolve a última da janela", () => {
	assert.equal(currentHourIndex([iso(0), iso(1), iso(2)], iso(99)), 2);
});

test("currentHourIndex: série vazia devolve -1", () => {
	assert.equal(currentHourIndex([], iso(0)), -1);
});

test("currentHourIndex: agora ilegível devolve a primeira hora, não a última", () => {
	assert.equal(currentHourIndex([iso(0), iso(1), iso(2)], ""), 0);
});

// ─── Par da hora ───────────────────────────────────────────────────────────

test("hourPairAt: traz ML, API e resíduo com sinal da hora pedida", () => {
	const p = hourPairAt(seriesOf([10, 12], [14, 11]), 1);
	assert.deepEqual(p, {
		index: 1,
		timestamp: iso(1),
		ml: 12,
		api: 11,
		residual: -1,
		paired: true,
	});
});

test("hourPairAt: lado ausente vira null e paired false — o lado presente continua", () => {
	const semFonte = hourPairAt(seriesOf([10, null], [14, 7]), 1);
	assert.equal(semFonte?.ml, null, "ML faltante vira null, não 0");
	assert.equal(semFonte?.api, 7, "o valor que veio continua visível");
	assert.equal(semFonte?.residual, null);
	assert.equal(semFonte?.paired, false);

	const semModelo = hourPairAt(seriesOf([10, 12], [14, null]), 1);
	assert.equal(semModelo?.api, null, "fonte faltante vira null, não 0");
	assert.equal(semModelo?.ml, 12);
	assert.equal(semModelo?.paired, false);
});

test("hourPairAt: índice fora da série devolve null", () => {
	assert.equal(hourPairAt(seriesOf([10], [14]), 5), null);
	assert.equal(hourPairAt(seriesOf([10], [14]), -1), null);
});

test("currentHourPair: junta a hora corrente ao par ML/API da mesma hora", () => {
	const p = currentHourPair(seriesOf([10, 12], [14, 11]), iso(1));
	assert.equal(p?.index, 1);
	assert.equal(p?.timestamp, iso(1));
	assert.equal(p?.paired, true);
});

// ─── Última hora pareada ───────────────────────────────────────────────────

test("lastPairedIndex: devolve a última hora com valor dos dois lados", () => {
	// A API termina 16 h antes: o índice 104 é o último pareado.
	const ml = Array.from({ length: 120 }, (_, i) => 10 + i);
	const api = Array.from({ length: 120 }, (_, i) => (i < 104 ? 10 + i : null));
	assert.equal(lastPairedIndex(seriesOf(ml, api)), 103);
});

test("lastPairedIndex: sem nenhuma hora pareada devolve -1", () => {
	assert.equal(lastPairedIndex(seriesOf([null, null], [10, 10])), -1);
});

// ─── Lacunas da fonte ──────────────────────────────────────────────────────

test("gapRuns: lacuna contígua vira um trecho com from, to e horas", () => {
	const api = Array.from({ length: 10 }, (_, i) => (i < 4 ? i : null));
	const runs = gapRuns(
		api,
		Array.from({ length: 10 }, (_, i) => iso(i)),
	);
	assert.equal(runs.length, 1);
	assert.deepEqual(runs[0], { from: iso(4), to: iso(9), hours: 6 });
});

test("gapRuns: série sem lacuna devolve lista vazia", () => {
	const api = Array.from({ length: 5 }, (_, i) => i);
	assert.deepEqual(
		gapRuns(
			api,
			Array.from({ length: 5 }, (_, i) => iso(i)),
		),
		[],
	);
});

test("gapRuns: duas lacunas separadas viram dois trechos distintos", () => {
	const api = [null, 5, 6, null, null, 9];
	const runs = gapRuns(
		api,
		Array.from({ length: 6 }, (_, i) => iso(i)),
	);
	assert.equal(runs.length, 2);
	assert.deepEqual(runs[0], { from: iso(0), to: iso(0), hours: 1 });
	assert.deepEqual(runs[1], { from: iso(3), to: iso(4), hours: 2 });
});

// ─── Quadro por poluente ───────────────────────────────────────────────────

test("pollutantRows: uma linha por poluente na ordem canônica, com o rótulo compartilhado", () => {
	const rows = pollutantRows({
		points_total: 1080,
		by_pollutant: { pm25: { n_paired: 936, coverage_pct: 86.67 } },
		by_station: {},
	});
	assert.deepEqual(
		rows.map((r) => r.key),
		[...POLLUTANT_ORDER],
		"a ordem canônica do registry, não a ordem das chaves do JSON",
	);
	assert.equal(rows[0].label, "PM₂.₅");
	assert.equal(rows[0].metrics?.n_paired, 936);
});

test('pollutantRows: poluente ausente devolve metrics null — vira "—", não 0', () => {
	const rows = pollutantRows({
		points_total: 1080,
		by_pollutant: { pm25: { n_paired: 936 } },
		by_station: {},
	});
	const pm10 = rows.find((r) => r.key === "pm10");
	assert.equal(pm10?.metrics, null);
});

// ─── Semântica da janela ───────────────────────────────────────────────────

test("declaresAccuracyValidation: is_validation false devolve false", () => {
	assert.equal(
		declaresAccuracyValidation(artifactOf({ is_validation: false })),
		false,
	);
});

test("declaresAccuracyValidation: is_validation true devolve true", () => {
	assert.equal(
		declaresAccuracyValidation(artifactOf({ is_validation: true })),
		true,
	);
});
