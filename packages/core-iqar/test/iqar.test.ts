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

test("médias móveis regulatórias CONAMA 491/2018 (BUG-09)", async () => {
	const {
		REGULATORY_WINDOWS,
		calculateRegulatoryMovingAverage,
		calculatePollutantMovingAverages,
		calculateRegulatoryIQAr,
	} = await import("../src/iqar.ts");

	// Janelas regulatórias normativas CONAMA 491/2018
	assert.equal(REGULATORY_WINDOWS.pm25, 24);
	assert.equal(REGULATORY_WINDOWS.pm10, 24);
	assert.equal(REGULATORY_WINDOWS.so2, 24);
	assert.equal(REGULATORY_WINDOWS.o3, 8);
	assert.equal(REGULATORY_WINDOWS.no2, 1);

	// Janela incompleta DEVE devolver null (nunca zero silencioso)
	assert.equal(
		calculateRegulatoryMovingAverage("pm25", Array(23).fill(10)),
		null,
	);
	assert.equal(calculateRegulatoryMovingAverage("o3", Array(7).fill(50)), null);
	assert.equal(calculateRegulatoryMovingAverage("pm25", []), null);

	// Janela exata (24h para pm25, 8h para o3, 1h para no2)
	assert.equal(
		calculateRegulatoryMovingAverage("pm25", Array(24).fill(15)),
		15,
	);
	assert.equal(calculateRegulatoryMovingAverage("o3", Array(8).fill(80)), 80);
	assert.equal(calculateRegulatoryMovingAverage("no2", [100]), 100);

	// Média aritmética simples
	const seriesO3 = [10, 20, 30, 40, 50, 60, 70, 80]; // soma = 360, média 8h = 45
	assert.equal(calculateRegulatoryMovingAverage("o3", seriesO3), 45);

	// Série maior que a janela usa os últimos N valores
	const longerSeriesO3 = [999, ...seriesO3];
	assert.equal(calculateRegulatoryMovingAverage("o3", longerSeriesO3), 45);

	// calculatePollutantMovingAverages em série contínua
	const series10h = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	const o3Avgs = calculatePollutantMovingAverages("o3", series10h);
	assert.equal(o3Avgs.length, 10);
	for (let i = 0; i < 7; i++) {
		assert.equal(
			o3Avgs[i],
			null,
			`índice ${i} deve ser null por janela incompleta`,
		);
	}
	assert.equal(o3Avgs[7], 4.5); // (1+2+3+4+5+6+7+8)/8 = 36/8 = 4.5
	assert.equal(o3Avgs[8], 5.5); // (2+3+4+5+6+7+8+9)/8 = 44/8 = 5.5
	assert.equal(o3Avgs[9], 6.5); // (3+4+5+6+7+8+9+10)/8 = 52/8 = 6.5

	// calculateRegulatoryIQAr com médias válidas
	const regRes = calculateRegulatoryIQAr({
		pm25: 20, // Moderada (15-25)
		pm10: 40, // Boa (0-50)
		o3: 50, // Boa (0-100)
		no2: 80, // Boa (0-200)
		so2: 10, // Boa (0-20)
	});
	assert.ok(regRes !== null);
	assert.equal(regRes.classification, "Moderada");
	assert.equal(regRes.primary, "pm25");

	// calculateRegulatoryIQAr com janela incompleta em todos os poluentes devolve null
	assert.equal(
		calculateRegulatoryIQAr({
			pm25: null,
			pm10: null,
			o3: null,
			no2: null,
			so2: null,
		}),
		null,
	);
});
