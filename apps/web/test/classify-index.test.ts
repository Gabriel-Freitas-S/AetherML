import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyIndex, individualIndex } from "@aetherml/core-iqar";

// Bandas do IQAr global (CONAMA 491/2018) — os mesmos limites de `individualIndex`.
const BOUNDARIES: [number, string][] = [
	[-1, "Boa"],
	[0, "Boa"],
	[40, "Boa"],
	[41, "Moderada"],
	[80, "Moderada"],
	[81, "Ruim"],
	[120, "Ruim"],
	[121, "Muito Ruim"],
	[200, "Muito Ruim"],
	[201, "Péssima"],
	[300, "Péssima"],
];

test("classifyIndex: respeita exatamente os limites de faixa da CONAMA", () => {
	for (const [index, expected] of BOUNDARIES) {
		assert.equal(
			classifyIndex(index),
			expected,
			`IQAr ${index} deve cair em ${expected}`,
		);
	}
});

test("classifyIndex: satura nas faixas extremas fora da tabela", () => {
	assert.equal(classifyIndex(301), "Péssima");
	assert.equal(
		classifyIndex(5_000),
		"Péssima",
		"índice além da saturação de UI",
	);
	assert.equal(
		classifyIndex(Number.NaN),
		"Boa",
		"entrada inválida não estoura",
	);
});

// Propriedade que o card de dia depende: classificar a partir do índice nunca pode
// contradizer a faixa que a própria tabela deu para a concentração de origem.
test("classifyIndex: concorda com a faixa devolvida por individualIndex", () => {
	for (const pollutant of ["pm25", "pm10", "o3", "no2", "so2"] as const) {
		for (let conc = 0; conc <= 250; conc += 0.5) {
			const { index, classification } = individualIndex(pollutant, conc);
			assert.equal(
				classifyIndex(index),
				classification,
				`${pollutant} @ ${conc} → índice ${index}`,
			);
		}
	}
});
