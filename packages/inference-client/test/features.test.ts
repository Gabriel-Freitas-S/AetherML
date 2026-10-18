import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	FEATURE_NAMES,
	FEATURE_NAMES_V2,
	buildRowFeatures,
	rowToFeatures,
	satelliteProxy,
	trafficProxy,
} from "../src/features.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "features_fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

test("trafficProxy: cálculo determinístico de tráfego", () => {
	// Horário de pico em dia útil (8h)
	const [spdPeak, delayPeak, idxPeak] = trafficProxy(8, false, {});
	assert.equal(spdPeak, 22.0);
	assert.equal(delayPeak, 1.9);
	assert.equal(idxPeak, 0.82);

	// Horário noturno em dia útil (2h)
	const [spdNight, delayNight, idxNight] = trafficProxy(2, false, {});
	assert.equal(spdNight, 58.0);
	assert.equal(delayNight, 1.02);
	assert.equal(idxNight, 0.08);

	// Fim de semana (14h)
	const [spdWeekend, delayWeekend, idxWeekend] = trafficProxy(14, true, {});
	assert.equal(spdWeekend, 52.0);
	assert.equal(delayWeekend, 1.08);
	assert.equal(idxWeekend, 0.18);

	// Pico com proximidade de ponte (bridge_proximity)
	const [spdBridge, delayBridge, idxBridge] = trafficProxy(18, false, {
		bridge_proximity: true,
	});
	assert.equal(spdBridge, 22.0);
	assert.equal(delayBridge, 1.9 * 1.25);
	assert.equal(idxBridge, Math.min(1.0, 0.82 * 1.3));
});

test("satelliteProxy: proxies a partir de lag24 sem vazar a hora atual", () => {
	const [aod, tropomi, uvai] = satelliteProxy({ pm10: 20.0, no2: 8.0 });
	assert.equal(aod, 0.13); // round(0.08 + 20/400, 3) = 0.13
	assert.equal(tropomi, 8.0);
	assert.equal(uvai, 0.595); // round(0.4 + 0.13 * 1.5, 3) = 0.595
});

test("rowToFeatures: espelho fiel do Python comprovado contra fixture real (tolerância 1e-6)", () => {
	assert.ok(
		fixture.cases.length >= 3,
		"Fixture deve conter pelo menos 3 casos",
	);

	for (const c of fixture.cases) {
		const feats = rowToFeatures(
			c.meteo,
			c.aq,
			c.iso_ts,
			c.lags,
			c.flags,
			c.order,
			c.lags1,
			c.feature_names,
		);

		assert.equal(
			feats.length,
			c.expected_features.length,
			`Caso ${c.description}: tamanho do vetor difere`,
		);

		for (let i = 0; i < feats.length; i++) {
			const featName = c.feature_names[i];
			const actual = feats[i];
			const expected = c.expected_features[i];
			const diff = Math.abs(actual - expected);

			assert.ok(
				diff <= 1e-6,
				`Caso [${c.description}] na feature [${featName}] (idx ${i}): esperado ${expected}, obtido ${actual} (diff: ${diff})`,
			);
		}
	}
});

test("rowToFeatures: lança erro se order='v2' e lags1 não for fornecido", () => {
	const c = fixture.cases[0];
	assert.throws(
		() => {
			rowToFeatures(c.meteo, c.aq, c.iso_ts, c.lags, c.flags, "v2", null);
		},
		{
			message: /order='v2' exige lags1/,
		},
	);
});

test("buildRowFeatures: lê ordem e nomes de registry.json em runtime", () => {
	const registryPath = path.resolve(
		__dirname,
		"..",
		"..",
		"..",
		"models",
		"registry.json",
	);
	const reg = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
	const runtimeFeatureNames: string[] = reg.feature_names_v1;

	assert.equal(runtimeFeatureNames.length, 30);

	const c = fixture.cases[0];
	const feats = buildRowFeatures({
		meteo: c.meteo,
		aq: c.aq,
		isoTs: c.iso_ts,
		lags: c.lags,
		flags: c.flags,
		lags1: c.lags1,
		featureNames: runtimeFeatureNames,
	});

	assert.equal(feats.length, 30);
	for (let i = 0; i < feats.length; i++) {
		const diff = Math.abs(feats[i] - c.expected_features[i]);
		assert.ok(
			diff <= 1e-6,
			`Runtime feature [${runtimeFeatureNames[i]}] divergente (diff: ${diff})`,
		);
	}
});
