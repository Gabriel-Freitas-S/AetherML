import assert from "node:assert/strict";
import { test } from "node:test";
import { globalIQAr, individualIndex } from "../src/iqar.ts";

test("individualIndex calcula corretamente as faixas CONAMA 491/2018 para PM2.5", () => {
	// Faixa Boa (0 a 15) -> 0 a 40
	assert.deepEqual(individualIndex("pm25", 0), {
		index: 0,
		classification: "Boa",
	});
	assert.deepEqual(individualIndex("pm25", 15), {
		index: 40,
		classification: "Boa",
	});

	// Faixa Moderada (>15 a 25) -> 41 a 80
	const mod = individualIndex("pm25", 20);
	assert.equal(mod.classification, "Moderada");
	assert.ok(mod.index >= 41 && mod.index <= 80);

	// Faixa Ruim (>25 a 50) -> 81 a 120
	const ruim = individualIndex("pm25", 30);
	assert.equal(ruim.classification, "Ruim");

	// Faixa Muito Ruim (>50 a 75) -> 121 a 200
	const mruim = individualIndex("pm25", 60);
	assert.equal(mruim.classification, "Muito Ruim");

	// Faixa Péssima (>75) -> 201 a 300
	const pessima = individualIndex("pm25", 100);
	assert.equal(pessima.classification, "Péssima");
});

test("globalIQAr seleciona o pior caso e identifica o poluente crítico correto", () => {
	// PM2.5 em nível Ruim enquanto outros estão Bons
	const res1 = globalIQAr({
		pm25: 35, // Ruim
		pm10: 20, // Boa
		o3: 40, // Boa
		no2: 50, // Boa
		so2: 5, // Boa
	});
	assert.equal(res1.classification, "Ruim");
	assert.equal(res1.primary, "pm25");
	assert.ok(res1.iqar >= 81 && res1.iqar <= 120);

	// O3 em nível Muito Ruim em dia ensolarado
	const res2 = globalIQAr({
		pm25: 12, // Boa
		pm10: 30, // Boa
		o3: 180, // Muito Ruim (160-200)
		no2: 80, // Boa
		so2: 10, // Boa
	});
	assert.equal(res2.classification, "Muito Ruim");
	assert.equal(res2.primary, "o3");
});
