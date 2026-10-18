import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalibrationData } from "../src/calibrate.ts";
import { FEATURE_NAMES_V2 } from "../src/features.ts";
import { runRecursiveForecast } from "../src/forecast.ts";

test("runRecursiveForecast: recursão fiel com sementes de 24h, lags autoregressivos e calibração", async () => {
	const times: string[] = [];
	// Gera 24h de passado + 48h de futuro
	const baseDate = new Date("2026-10-01T00:00:00Z");
	for (let i = 0; i < 72; i++) {
		const d = new Date(baseDate.getTime() + i * 3600 * 1000);
		times.push(d.toISOString().slice(0, 16));
	}

	const cutoff = times[23]; // Agora é na hora 23

	const meteoHourly = {
		time: times,
		temperature_2m: times.map((_, i) => 20 + (i % 10)),
		relative_humidity_2m: times.map((_, i) => 60 + (i % 20)),
		wind_speed_10m: times.map(() => 15.0),
		wind_direction_10m: times.map(() => 45.0),
		pressure_msl: times.map(() => 1012.0),
		shortwave_radiation: times.map((_, i) =>
			i % 24 > 6 && i % 24 < 18 ? 500 : 0,
		),
		boundary_layer_height: times.map((_, i) => 300 + i * 5),
	};

	const aqHourly = {
		time: times,
		pm2_5: times.map((_, i) => 10 + i * 0.5),
		pm10: times.map((_, i) => 20 + i * 0.5),
		ozone: times.map((_, i) => 30 + i * 0.5),
		nitrogen_dioxide: times.map((_, i) => 15 + i * 0.5),
		sulphur_dioxide: times.map((_, i) => 5 + i * 0.5),
	};

	const capturedFeatures: number[][] = [];
	const mockPredict = (feats: number[]) => {
		capturedFeatures.push([...feats]);
		// Retorna predições conhecidas
		return {
			pm25: 12.0,
			pm10: 22.0,
			o3: 35.0,
			no2: 18.0,
			so2: 4.0,
		};
	};

	const calData: CalibrationData = {
		bias: { pm25: 0.5, pm10: -0.5, o3: 1.0, no2: 0.0, so2: 0.0 },
	};

	const result = await runRecursiveForecast({
		stationId: "ramqar_camburi",
		flags: { name: "Camburi", lat: -20.27, lon: -40.28 },
		meteo: meteoHourly,
		aq: aqHourly,
		cutoff,
		hours: 48,
		order: "v2",
		featureNames: FEATURE_NAMES_V2,
		calibration: calData,
		predictFn: mockPredict,
	});

	assert.equal(result.points.length, 48);

	// Ponto 0
	const p0 = result.points[0];
	assert.equal(p0.hour, 0);
	assert.equal(p0.day, 1);
	assert.equal(p0.timestamp, `${times[24]}Z`);
	// Calibração: pm25 raw 12.0 + bias 0.5 = 12.5
	assert.equal(p0.observed.pm25, 12.5);
	assert.equal(p0.observed.pm10, 21.5);
	assert.equal(p0.observed.o3, 36.0);

	// Verifica se lag1 no passo 0 usou o último real (índice 23)
	// aqHourly.pm2_5[23] = 10 + 23*0.5 = 21.5
	// pm25_lag1 é a feature índice 25 no vetor V2
	assert.equal(capturedFeatures[0][25], 21.5);

	// Verifica se lag1 no passo 1 usou a predição anterior (12.5)
	assert.equal(capturedFeatures[1][25], 12.5);

	// No passo 24, lag24 passa a usar a própria previsão do passo 0 (12.5)
	// pm25_lag24 é a feature índice 20
	assert.equal(capturedFeatures[24][20], 12.5);
});

test("runRecursiveForecast: rejeita calibração ausente ou vazia (require_calibration)", async () => {
	await assert.rejects(
		async () => {
			await runRecursiveForecast({
				stationId: "ramqar_camburi",
				meteo: { time: ["2026-10-01T00:00"] } as any,
				aq: { time: ["2026-10-01T00:00"] } as any,
				calibration: {},
				predictFn: () => ({}),
			});
		},
		{ message: /require_calibration/ },
	);
});

test("runRecursiveForecast: rejeita histórico insuficiente (< 24h) para sementes", async () => {
	const shortTimes = ["2026-10-01T00:00", "2026-10-01T01:00"];
	await assert.rejects(
		async () => {
			await runRecursiveForecast({
				stationId: "ramqar_camburi",
				meteo: { time: shortTimes } as any,
				aq: { time: shortTimes } as any,
				calibration: { bias: { pm25: 0.1 } },
				predictFn: () => ({}),
			});
		},
		{ message: /Histórico insuficiente/ },
	);
});
