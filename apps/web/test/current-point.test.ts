import assert from "node:assert/strict";
import { test } from "node:test";
import { currentPoint } from "../src/lib/current-point.ts";

interface FakePoint {
	timestamp: string;
	iqar: number;
}

/** Relógio congelado: 02/10/2026 17:20Z. */
const NOW = Date.parse("2026-10-02T17:20:00Z");

function point(offsetMinutes: number, iqar: number): FakePoint {
	return {
		timestamp: new Date(NOW + offsetMinutes * 60_000).toISOString(),
		iqar,
	};
}

/** Série horária contígua terminando `offsetMinutes` depois de NOW. */
function hourlySeries(count: number, firstOffsetMinutes: number): FakePoint[] {
	return Array.from({ length: count }, (_, i) =>
		point(firstOffsetMinutes + i * 60, 10 + i),
	);
}

test("currentPoint: escolhe o ponto mais recente com timestamp <= now", () => {
	const series = hourlySeries(6, -300); // -300 min .. +60 min, com um futuro no fim

	const res = currentPoint(series, NOW);

	assert.ok(res, "há pontos no passado, então existe ponto atual");
	assert.equal(
		res.point.iqar,
		15,
		"o ponto exatamente em now (17:20Z) é o último <= now, não o de 18:20Z",
	);
	assert.equal(res.point.timestamp, new Date(NOW).toISOString());
	assert.equal(
		res.isFallback,
		false,
		"não é fallback: existe observação <= now",
	);
});

test("currentPoint: o limite é inclusivo — timestamp exatamente igual a now vale", () => {
	const res = currentPoint([point(-120, 20), point(0, 77), point(60, 30)], NOW);

	assert.equal(res?.point.iqar, 77, "o ponto exatamente em now é o atual");
	assert.equal(res?.isFallback, false);
});

// Regressão de produção: as três telas discordavam porque cada uma escolhia o
// ponto por MENOR DISTÂNCIA ABSOLUTA a partir de Date.now(). Com uma série
// horária, a hora futura (ex. +10 min) fica mais perto de `now` do que a hora
// corrente (ex. -30 min) — o "atual" virava previsão.
test("currentPoint REGRESSÃO: nunca escolhe ponto futuro, mesmo sendo o mais próximo por distância absoluta", () => {
	const series = [point(-90, 17), point(-30, 40), point(10, 20)];

	const nowDistances = series.map((p) =>
		Math.abs(Date.parse(p.timestamp) - NOW),
	);
	assert.ok(
		nowDistances[2] < nowDistances[1],
		"o ponto futuro (+10 min) é o mais próximo por distância absoluta — o bug",
	);

	const res = currentPoint(series, NOW);

	assert.equal(
		res?.point.iqar,
		40,
		"o atual é a última observação, não a previsão",
	);
	assert.equal(res?.point.timestamp, new Date(NOW - 30 * 60_000).toISOString());
	assert.equal(res?.isFallback, false);
});

test("currentPoint: série totalmente no futuro devolve o mais antigo marcado como fallback", () => {
	const series = hourlySeries(4, 60); // +60 min .. +240 min

	const res = currentPoint(series, NOW);

	assert.ok(res, "mesmo sem observação no passado há algo para exibir");
	assert.equal(res.point.iqar, 10, "o fallback é o ponto mais antigo");
	assert.equal(res.point.timestamp, new Date(NOW + 60 * 60_000).toISOString());
	assert.equal(
		res.isFallback,
		true,
		"o chamador precisa saber que não é um valor atual",
	);
});

test("currentPoint: série vazia devolve null", () => {
	assert.equal(currentPoint([], NOW), null);
});

test("currentPoint: timestamps ilegíveis são ignorados, não enriquecidos", () => {
	const mixed = [
		{ timestamp: "não é data", iqar: 999 },
		point(-60, 33),
		{ timestamp: "", iqar: 888 },
	];
	assert.equal(currentPoint(mixed, NOW)?.point.iqar, 33);
	assert.equal(
		currentPoint([{ timestamp: "nope", iqar: 1 }], NOW),
		null,
		"sem nenhum timestamp legível não há ponto",
	);
});

test("currentPoint: não muta o array de entrada", () => {
	const series = hourlySeries(5, -240);
	const snapshot = structuredClone(series);
	const order = series.map((p) => p.timestamp);

	currentPoint(series, NOW);

	assert.deepEqual(series, snapshot, "nenhum ponto foi reordenado ou alterado");
	assert.deepEqual(
		series.map((p) => p.timestamp),
		order,
		"a ordem original é preservada",
	);
	assert.equal(series.length, 5);
});

test("BUG-06 regressão: todas as superfícies (Hero, Faixas CONAMA, Estações) usam rigorosamente o mesmo ponto e IQAr", () => {
	// Simula série horária com 24h passadas e 48h futuras
	const pastAndFutureSeries = [
		point(-120, 35),
		point(-60, 42),
		point(0, 48), // Ponto atual exato
		point(60, 85), // Previsão futura (IQAr bem diferente)
		point(120, 110),
	];

	// Simula a resolução em cada superfície
	const heroPoint = currentPoint(pastAndFutureSeries, NOW)?.point;
	const faixasFirstPoint = currentPoint(pastAndFutureSeries, NOW)?.point;
	const stationDetailPagePoint = currentPoint(pastAndFutureSeries, NOW)?.point;

	assert.ok(heroPoint && faixasFirstPoint && stationDetailPagePoint);
	assert.equal(heroPoint.timestamp, faixasFirstPoint.timestamp);
	assert.equal(heroPoint.timestamp, stationDetailPagePoint.timestamp);
	assert.equal(heroPoint.iqar, 48);
	assert.equal(faixasFirstPoint.iqar, 48);
	assert.equal(stationDetailPagePoint.iqar, 48);
	assert.equal(heroPoint.timestamp, new Date(NOW).toISOString());

	// Quando now está entre pontos (ex. 25 min após o ponto -60, faltando 35 min para o ponto 0)
	const intermediateNow = NOW - 35 * 60_000; // 25 min após point(-60)
	const heroInter = currentPoint(pastAndFutureSeries, intermediateNow)?.point;
	const faixasInter = currentPoint(pastAndFutureSeries, intermediateNow)?.point;

	assert.ok(heroInter && faixasInter);
	assert.equal(heroInter.timestamp, faixasInter.timestamp);
	assert.equal(
		heroInter.iqar,
		42,
		"ambos selecionam o último ponto observado <= now (-60 min), nunca o ponto futuro mais próximo",
	);
});
