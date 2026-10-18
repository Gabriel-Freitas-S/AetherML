import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CLAMPS,
	applyIsotonic,
	calibrateValue,
	clampValue,
} from "../src/calibrate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calPath = path.resolve(
	__dirname,
	"..",
	"..",
	"..",
	"apps",
	"web",
	"public",
	"models",
	"calibration.json",
);
const calData = JSON.parse(fs.readFileSync(calPath, "utf-8"));

test("CLAMPS: define pisos mínimos regulatórios para os 5 poluentes", () => {
	assert.equal(CLAMPS.pm25, 1.0);
	assert.equal(CLAMPS.pm10, 2.0);
	assert.equal(CLAMPS.o3, 2.0);
	assert.equal(CLAMPS.no2, 3.0);
	assert.equal(CLAMPS.so2, 0.5);
});

test("applyIsotonic: interpolação linear e saturação de borda", () => {
	const mapping = {
		x: [10, 20, 30],
		y: [12, 25, 32],
	};

	// Saturação inferior
	assert.equal(applyIsotonic([5], mapping)[0], 12);
	assert.equal(applyIsotonic([10], mapping)[0], 12);

	// Ponto intermediário (15 está na metade de 10 e 20 -> y deve ser 12 + 0.5*(25-12) = 18.5)
	assert.equal(applyIsotonic([15], mapping)[0], 18.5);

	// Ponto no nó
	assert.equal(applyIsotonic([20], mapping)[0], 25);

	// Saturação superior
	assert.equal(applyIsotonic([35], mapping)[0], 32);
});

test("calibrateValue: calibração com dados reais de calibration.json", () => {
	// pm25 tem isotonic em calibration.json
	const calPm25 = calibrateValue("pm25", 10.0, calData);
	assert.ok(typeof calPm25 === "number" && !Number.isNaN(calPm25));

	// Teste com target só com bias
	const fakeCal = {
		bias: { o3: 1.5 },
		isotonic: {},
	};
	assert.equal(calibrateValue("o3", 20.0, fakeCal), 21.5);

	// Teste com target declarado em isotonic porém vazio: devolve inalterado (não cai em bias)
	const fakeCalIsoEmpty = {
		bias: { o3: 1.5 },
		isotonic: { o3: { x: [], y: [] } },
	};
	assert.equal(calibrateValue("o3", 20.0, fakeCalIsoEmpty), 20.0);
});

test("clampValue: respeita CLAMP mínimo e arredonda para 2 casas", () => {
	assert.equal(clampValue("pm25", 0.2), 1.0);
	assert.equal(clampValue("pm25", 12.3456), 12.35);
	assert.equal(clampValue("so2", 0.1), 0.5);
	assert.equal(clampValue("so2", 5.678), 5.68);
});
