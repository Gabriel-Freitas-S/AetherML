// packages/inference-client/src/forecast.ts — Recursão autoregressiva de 120h (espelho fiel de predict_forecast.py)

import {
	type CalibrationData,
	calibrateValue,
	clampValue,
} from "./calibrate.ts";
import {
	FEATURE_NAMES,
	FEATURE_NAMES_V2,
	type StationFlags,
	TARGETS,
	buildRowFeatures,
} from "./features.ts";

export interface HourlySeries {
	time: string[];
	temperature_2m: number[];
	relative_humidity_2m: number[];
	wind_speed_10m: number[];
	wind_direction_10m: number[];
	pressure_msl: number[];
	shortwave_radiation: number[];
	boundary_layer_height: number[];
	[key: string]: unknown;
}

export interface AQSeries {
	time: string[];
	pm2_5?: number[];
	pm25?: number[];
	pm10?: number[];
	ozone?: number[];
	o3?: number[];
	nitrogen_dioxide?: number[];
	no2?: number[];
	sulphur_dioxide?: number[];
	so2?: number[];
	[key: string]: unknown;
}

export interface ForecastPoint {
	hour: number;
	day: number;
	timestamp: string;
	features: number[];
	observed: Record<string, number>;
}

export interface ForecastOptions {
	stationId: string;
	flags?: StationFlags;
	meteo: HourlySeries;
	aq: AQSeries;
	cutoff?: string; // ISO string para delimitar o último instante real
	hours?: number; // padrão 120
	order?: "v1" | "v2";
	featureNames?: readonly string[] | string[];
	calibration?: CalibrationData;
	predictFn: (
		features: number[],
	) => Promise<Record<string, number>> | Record<string, number>;
}

export interface ForecastResult {
	stationId: string;
	points: ForecastPoint[];
}

function getAqValue(aq: AQSeries, target: string, index: number): number {
	let arr: number[] | undefined;
	if (target === "pm25") arr = aq.pm2_5 ?? aq.pm25;
	else if (target === "pm10") arr = aq.pm10;
	else if (target === "o3") arr = aq.ozone ?? aq.o3;
	else if (target === "no2") arr = aq.nitrogen_dioxide ?? aq.no2;
	else if (target === "so2") arr = aq.sulphur_dioxide ?? aq.so2;
	return arr?.[index] ?? 10.0;
}

/**
 * Executa a previsão recursiva de N horas (120h por padrão) espelhando
 * fielmente predict_forecast.py::predict_all.
 */
export async function runRecursiveForecast(
	options: ForecastOptions,
): Promise<ForecastResult> {
	const {
		stationId,
		flags = {},
		meteo,
		aq,
		cutoff,
		hours = 120,
		order = "v2",
		featureNames,
		calibration,
		predictFn,
	} = options;

	const times = aq.time || meteo.time;
	const cutoff13 = cutoff ? cutoff.slice(0, 13) : "";

	let nowIdx = -1;
	for (let i = times.length - 1; i >= 0; i--) {
		const ts13 = times[i].slice(0, 13);
		if (!cutoff13 || ts13 <= cutoff13) {
			nowIdx = i;
			break;
		}
	}
	if (nowIdx < 23) {
		nowIdx = Math.min(23, times.length - 1);
	}

	const futIdx: number[] = [];
	for (let i = nowIdx + 1; i <= nowIdx + hours; i++) {
		futIdx.push(i);
	}

	// Sementes reais: últimas 24h de AQ + últimas 6h de PBLH
	const histAq: Record<string, number[]> = {};
	for (const t of TARGETS) {
		histAq[t] = [];
		for (let k = 0; k < 24; k++) {
			const idx = nowIdx - 23 + k;
			histAq[t].push(getAqValue(aq, t, idx));
		}
	}

	const histPblh: number[] = [];
	for (let k = nowIdx - 5; k <= nowIdx; k++) {
		histPblh.push(Number(meteo.boundary_layer_height?.[k] ?? 300));
	}

	const preds: Record<string, number[]> = {
		pm25: [],
		pm10: [],
		o3: [],
		no2: [],
		so2: [],
	};

	const points: ForecastPoint[] = [];

	for (let step = 0; step < futIdx.length; step++) {
		const gi = futIdx[step];
		const ts = times[gi];
		if (!ts) break;

		const mNow = {
			temperature_2m: Number(meteo.temperature_2m?.[gi] ?? 20),
			relative_humidity_2m: Number(meteo.relative_humidity_2m?.[gi] ?? 60),
			wind_speed_10m: Number(meteo.wind_speed_10m?.[gi] ?? 10),
			wind_direction_10m: Number(meteo.wind_direction_10m?.[gi] ?? 0),
			pressure_msl: Number(meteo.pressure_msl?.[gi] ?? 1013),
			shortwave_radiation: Number(meteo.shortwave_radiation?.[gi] ?? 0),
			boundary_layer_height: Number(meteo.boundary_layer_height?.[gi] ?? 400),
		};

		// lag24 na hora futura: hist[step] se step < 24, senão preds[t][step - 24]
		const lags: Record<string, number> = {};
		for (const t of ["pm25", "pm10", "no2", "o3"]) {
			lags[t] = step < 24 ? histAq[t][step] : preds[t][step - 24];
		}

		// pblh_rolling6 = média das 6h anteriores de PBLH
		const pblhSlice = histPblh
			.concat([mNow.boundary_layer_height])
			.slice(-7, -1);
		lags.pblh6 = pblhSlice.reduce((a, b) => a + b, 0) / 6.0;
		histPblh.push(mNow.boundary_layer_height);

		// aq_est = última previsão (ou último real)
		const aqEst: Record<string, number> = {};
		for (const t of TARGETS) {
			aqEst[t] =
				preds[t].length > 0
					? preds[t][preds[t].length - 1]
					: histAq[t][histAq[t].length - 1];
		}

		let lags1: Record<string, number> | undefined;
		if (order === "v2") {
			lags1 = {};
			for (const t of TARGETS) {
				lags1[t] =
					step === 0
						? histAq[t][histAq[t].length - 1]
						: preds[t][preds[t].length - 1];
			}
		}

		const feats = buildRowFeatures({
			meteo: mNow,
			aq: aqEst,
			isoTs: ts,
			lags: lags as any,
			flags,
			order,
			lags1: lags1 as any,
			featureNames,
		});

		const rawPred = await predictFn(feats);

		const observed: Record<string, number> = {};
		for (const t of TARGETS) {
			const rawVal = rawPred[t] ?? 10.0;
			const calibrated = calibrateValue(t, rawVal, calibration);
			const clamped = clampValue(t, calibrated);
			preds[t].push(clamped);
			observed[t] = clamped;
		}

		points.push({
			hour: step,
			day: Math.floor(step / 24) + 1,
			timestamp: ts.endsWith("Z") ? ts : `${ts}Z`,
			features: feats,
			observed,
		});
	}

	return {
		stationId,
		points,
	};
}
