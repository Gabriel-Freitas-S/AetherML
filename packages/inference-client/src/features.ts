// packages/inference-client/src/features.ts — Construtor de features (espelho exato do Python)

export const FEATURE_NAMES = [
	"temperature",
	"relative_humidity",
	"wind_speed",
	"wind_direction",
	"wind_u",
	"wind_v",
	"boundary_layer_height",
	"surface_pressure",
	"solar_radiation",
	"hour_sin",
	"hour_cos",
	"dow_sin",
	"dow_cos",
	"is_weekend",
	"traffic_speed_avg",
	"traffic_delay_ratio",
	"traffic_congestion_index",
	"satellite_aod",
	"satellite_tropomi_no2",
	"satellite_uvai",
	"pm25_lag24",
	"pm10_lag24",
	"no2_lag24",
	"o3_lag24",
	"pblh_rolling6",
] as const;

export const LAG1_TARGETS = ["pm25", "pm10", "no2", "o3", "so2"] as const;

export const FEATURE_NAMES_V2 = [
	...FEATURE_NAMES,
	"pm25_lag1",
	"pm10_lag1",
	"no2_lag1",
	"o3_lag1",
	"so2_lag1",
] as const;

export const TARGETS = ["pm25", "pm10", "o3", "no2", "so2"] as const;

export interface StationFlags {
	id?: string;
	name?: string;
	municipality?: string;
	lat?: number;
	lon?: number;
	latitude?: number;
	longitude?: number;
	coastal?: boolean;
	downwind_tubarao?: boolean;
	bridge_proximity?: boolean;
	traffic_heavy?: boolean;
	urban_canyon?: boolean;
	urban?: boolean;
	port_industrial?: boolean;
	interior_valley?: boolean;
	high_heat?: boolean;
	suburban_commercial?: boolean;
	coastal_north?: boolean;
	interior_residential?: boolean;
	[key: string]: unknown;
}

export interface MeteoInput {
	temperature_2m: number;
	relative_humidity_2m: number;
	wind_speed_10m: number;
	wind_direction_10m: number;
	pressure_msl: number;
	shortwave_radiation: number;
	boundary_layer_height: number;
	[key: string]: unknown;
}

export interface LagsInput {
	pm25: number;
	pm10: number;
	no2: number;
	o3: number;
	pblh6: number;
	[key: string]: number;
}

export interface Lags1Input {
	pm25: number;
	pm10: number;
	no2: number;
	o3: number;
	so2: number;
	[key: string]: number;
}

/**
 * Arredondamento decimal de ponto fixo via toFixed().
 * Nota: toFixed() arredonda metade para cima (away from zero), diferindo do
 * round() do Python 3 em caso de empate exato (round half to even). No domínio real
 * das variáveis meteorológicas e concentrações, empates exatos de representação não
 * ocorrem nas casas utilizadas.
 */
export function pyRound(val: number, decimals: number): number {
	return Number(val.toFixed(decimals));
}

/**
 * Proxy de tráfego determinístico: (speed_kmh, delay_ratio, congestion_idx).
 * Espelha ml/training/build_real_dataset.py::traffic_proxy.
 */
export function trafficProxy(
	hour: number,
	isWeekend: boolean,
	flags: StationFlags = {},
): [speed_kmh: number, delay_ratio: number, congestion_idx: number] {
	const isPeak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
	const isNight = hour < 5 || hour >= 23;
	let idx: number;
	let spd: number;
	let delay: number;

	if (isWeekend) {
		idx = 0.18;
		spd = 52.0;
		delay = 1.08;
	} else if (isPeak) {
		idx = 0.82;
		spd = 22.0;
		delay = 1.9;
	} else if (isNight) {
		idx = 0.08;
		spd = 58.0;
		delay = 1.02;
	} else {
		idx = 0.32;
		spd = 44.0;
		delay = 1.22;
	}

	if (flags.bridge_proximity || flags.traffic_heavy) {
		idx = Math.min(1.0, idx * 1.3);
		delay *= 1.25;
	}

	return [spd, delay, idx];
}

/**
 * Proxy de satélite a partir dos valores de 24h atrás (nunca da hora atual).
 * Espelha ml/training/build_real_dataset.py::satellite_proxy.
 */
export function satelliteProxy(aqLag24: {
	pm10?: number;
	no2?: number;
}): [aod: number, tropomi: number, uvai: number] {
	const pm10 = aqLag24.pm10 ?? 20.0;
	const no2 = aqLag24.no2 ?? 8.0;
	const aod = pyRound(0.08 + (pm10 || 0.0) / 400.0, 3);
	const tropomi = pyRound(no2 || 0.0, 2);
	const uvai = pyRound(0.4 + aod * 1.5, 3);
	return [aod, tropomi, uvai];
}

export interface BuildRowFeaturesOptions {
	meteo: MeteoInput;
	aq: Record<string, number>;
	isoTs: string;
	lags: LagsInput;
	flags?: StationFlags;
	order?: "v1" | "v2";
	lags1?: Lags1Input | null;
	featureNames?: readonly string[] | string[];
}

/**
 * Constrói o mapa chave->valor com todas as features calculadas.
 */
export function buildRowFeaturesMap(
	options: BuildRowFeaturesOptions,
): Record<string, number> {
	const { meteo, isoTs, lags, flags = {}, order = "v1", lags1 } = options;

	if (order === "v2" && !lags1) {
		throw new Error("order='v2' exige lags1");
	}

	// Normaliza timestamp ISO e extrai data/hora em UTC
	const cleanIso = isoTs.endsWith("Z") ? isoTs : `${isoTs}Z`;
	const dt = new Date(cleanIso);
	const h = dt.getUTCHours();
	const jsDow = dt.getUTCDay();
	const dow = (jsDow + 6) % 7; // Monday = 0, Sunday = 6
	const isWeekend = dow >= 5;

	const temp = Number(meteo.temperature_2m);
	const rh = Number(meteo.relative_humidity_2m);
	const spd_ms = Number(meteo.wind_speed_10m) / 3.6;
	const wdir = Number(meteo.wind_direction_10m) % 360.0;
	const rad = (wdir * Math.PI) / 180.0;
	const wind_u = -spd_ms * Math.sin(rad);
	const wind_v = -spd_ms * Math.cos(rad);
	const pblh = Number(meteo.boundary_layer_height);
	const press = Number(meteo.pressure_msl);
	const solar = Math.max(0.0, Number(meteo.shortwave_radiation));

	const [spd, delay, idx] = trafficProxy(h, isWeekend, flags);
	const [aod, tropomi, uvai] = satelliteProxy({
		pm10: lags.pm10,
		no2: lags.no2,
	});

	const featMap: Record<string, number> = {
		temperature: temp,
		relative_humidity: rh,
		wind_speed: pyRound(spd_ms, 2),
		wind_direction: pyRound(wdir, 2),
		wind_u: pyRound(wind_u, 2),
		wind_v: pyRound(wind_v, 2),
		boundary_layer_height: pyRound(pblh, 2),
		surface_pressure: pyRound(press, 2),
		solar_radiation: pyRound(solar, 2),
		hour_sin: pyRound(Math.sin((2 * Math.PI * h) / 24), 4),
		hour_cos: pyRound(Math.cos((2 * Math.PI * h) / 24), 4),
		dow_sin: pyRound(Math.sin((2 * Math.PI * dow) / 7), 4),
		dow_cos: pyRound(Math.cos((2 * Math.PI * dow) / 7), 4),
		is_weekend: isWeekend ? 1.0 : 0.0,
		traffic_speed_avg: pyRound(spd, 2),
		traffic_delay_ratio: pyRound(delay, 2),
		traffic_congestion_index: pyRound(idx, 3),
		satellite_aod: aod,
		satellite_tropomi_no2: tropomi,
		satellite_uvai: uvai,
		pm25_lag24: pyRound(Number(lags.pm25), 2),
		pm10_lag24: pyRound(Number(lags.pm10), 2),
		no2_lag24: pyRound(Number(lags.no2), 2),
		o3_lag24: pyRound(Number(lags.o3), 2),
		pblh_rolling6: pyRound(Number(lags.pblh6), 2),
	};

	if (lags1) {
		featMap.pm25_lag1 = pyRound(Number(lags1.pm25), 2);
		featMap.pm10_lag1 = pyRound(Number(lags1.pm10), 2);
		featMap.no2_lag1 = pyRound(Number(lags1.no2), 2);
		featMap.o3_lag1 = pyRound(Number(lags1.o3), 2);
		featMap.so2_lag1 = pyRound(Number(lags1.so2), 2);
	}

	return featMap;
}

/**
 * Constrói o vetor de features em tempo de execução segundo a lista fornecida de featureNames.
 */
export function buildRowFeatures(options: BuildRowFeaturesOptions): number[] {
	const map = buildRowFeaturesMap(options);
	const names =
		options.featureNames ??
		(options.order === "v2" ? FEATURE_NAMES_V2 : FEATURE_NAMES);
	return names.map((name) => {
		const val = map[name];
		if (val === undefined) {
			throw new Error(`Feature desconhecida ou ausente: ${name}`);
		}
		return val;
	});
}

/**
 * Espelho exato da assinatura Python:
 * row_to_features(meteo, aq, iso_ts, lags, flags, order='v1', lags1=None)
 */
export function rowToFeatures(
	meteo: MeteoInput,
	aq: Record<string, number>,
	iso_ts: string,
	lags: LagsInput,
	flags: StationFlags = {},
	order: "v1" | "v2" = "v1",
	lags1?: Lags1Input | null,
	featureNames?: readonly string[] | string[],
): number[] {
	return buildRowFeatures({
		meteo,
		aq,
		isoTs: iso_ts,
		lags,
		flags,
		order,
		lags1,
		featureNames,
	});
}
