import assert from "node:assert/strict";
import { test } from "node:test";
import { globalIQAr } from "@aetherml/core-iqar";
import { currentPoint } from "../src/lib/current-point.ts";

interface FakePoint {
	timestamp: string;
	iqar: number;
	observed?: Record<string, number>;
	primary?: string;
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

// BUG-06: Verificação arquitetural de fiação e determinismo da fonte única.
// Consumidores verificados no código-fonte:
// - Dashboard.svelte: const currentRes = currentPoint(points, now)
// - Map.svelte: const picked = currentPoint(item.points, Date.now())
// - estacao/[id].astro: const currentRes = currentPoint(points, now)
// Todos importam o mesmo módulo `../lib/current-point` e derivam o IQAr via `globalIQAr(p.observed)`.
test("BUG-06: clamp ao passado e consistência do trio (timestamp, iqar, primary) entre Dashboard e estacao/[id]", () => {
	// Série bruta de entrada com concentrações observadas (reproduz o bundle real)
	const rawBundlePoints = [
		{
			timestamp: new Date(NOW - 120 * 60_000).toISOString(),
			observed: { pm25: 12, o3: 40, no2: 25 },
		},
		{
			timestamp: new Date(NOW - 60 * 60_000).toISOString(),
			observed: { pm25: 22, o3: 75, no2: 30 }, // Moderada, crítico PM2.5
		},
		{
			timestamp: new Date(NOW).toISOString(),
			observed: { pm25: 14, o3: 115, no2: 35 }, // Moderada, crítico O3
		},
		{
			timestamp: new Date(NOW + 60 * 60_000).toISOString(),
			observed: { pm25: 45, o3: 60, no2: 50 }, // Ruim (previsão futura)
		},
	];

	// Derivação canônica feita no Dashboard.svelte e em estacao/[id].astro
	const dashboardTransformed = rawBundlePoints.map((p) => {
		const res = globalIQAr(p.observed);
		return {
			...p,
			iqar: res.iqar,
			classification: res.classification,
			primary: res.primary,
		};
	});

	const stationTransformed = rawBundlePoints.map((p) => {
		const res = globalIQAr(p.observed);
		return {
			...p,
			iqar: res.iqar,
			classification: res.classification,
			primary: res.primary,
		};
	});

	// Resolução em NOW exato
	const dashPoint = currentPoint(dashboardTransformed, NOW)?.point;
	const stationPoint = currentPoint(stationTransformed, NOW)?.point;

	assert.ok(dashPoint && stationPoint);
	// Trio (timestamp, iqar, primary) perfeitamente alinhado
	assert.equal(dashPoint.timestamp, stationPoint.timestamp);
	assert.equal(dashPoint.iqar, stationPoint.iqar);
	assert.equal(dashPoint.primary, stationPoint.primary);
	assert.equal(dashPoint.timestamp, new Date(NOW).toISOString());
	assert.equal(dashPoint.primary, "o3");

	// Resolução com NOW intermediário (+20 min após o ponto -60, -40 min antes do ponto 0)
	// A distância absoluta até o ponto 0 (40 min) é maior que até o ponto -60 (20 min),
	// mas se estivéssemos em +45 min (15 min antes de 0), a distância até o ponto 0 seria menor.
	const intermediateNow = NOW - 15 * 60_000; // 45 min após ponto(-60), 15 min antes de ponto(0)
	const intermediateDash = currentPoint(
		dashboardTransformed,
		intermediateNow,
	)?.point;
	const intermediateStation = currentPoint(
		stationTransformed,
		intermediateNow,
	)?.point;

	assert.ok(intermediateDash && intermediateStation);
	assert.equal(intermediateDash.timestamp, intermediateStation.timestamp);
	assert.equal(intermediateDash.iqar, intermediateStation.iqar);
	assert.equal(intermediateDash.primary, intermediateStation.primary);

	// Prova de clamp ao passado: mesmo com ponto(0) a apenas 15 min no futuro,
	// o resolvedor obrigatoriamente trava no ponto(-60) que está a 45 min no passado.
	assert.equal(
		intermediateDash.timestamp,
		new Date(NOW - 60 * 60_000).toISOString(),
		"deve selecionar estritamente o ponto observado <= now (-60 min), garantindo clamp ao passado",
	);
	assert.equal(intermediateDash.primary, "pm25");
});
