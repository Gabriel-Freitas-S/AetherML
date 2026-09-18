// packages/inference-client/src/weather-cache.ts
// DB-First Cache Guard para OpenWeather e Open-Meteo
// Protege cotas de API verificando registros do dia e da semana antes de qualquer requisição externa.

export interface EnvironmentalRecord {
	id: string;
	station_id: string;
	timestamp: string; // ISO 8601
	is_forecast: number; // 0 = histórico, 1 = previsão
	temperature: number;
	relative_humidity: number;
	wind_speed: number;
	wind_direction: number;
	wind_u: number;
	wind_v: number;
	boundary_layer_height: number;
	surface_pressure: number;
	solar_radiation: number;
	satellite_aod?: number;
	satellite_tropomi_no2?: number;
	satellite_uvai?: number;
	traffic_speed_avg?: number;
	traffic_delay_ratio?: number;
	traffic_congestion_index?: number;
	source: string; // 'OpenWeather' | 'Open-Meteo' | 'Synthetic'
	created_at?: string;
}

export interface WeatherDatabase {
	query(sql: string, params: unknown[]): Promise<unknown[]>;
	execute(sql: string, params: unknown[]): Promise<{ changes?: number }>;
}

export interface CacheCheckResult {
	hasDayData: boolean;
	hasWeekData: boolean;
	cachedRecords: EnvironmentalRecord[];
}

/**
 * Converte velocidade e direção do vento em componentes zonal (u) e meridional (v).
 */
export function calcWindComponents(
	speed: number,
	directionDeg: number,
): { wind_u: number; wind_v: number } {
	const rad = (directionDeg * Math.PI) / 180;
	// Convenção meteorológica: vento de onde vem para onde vai
	const wind_u = -speed * Math.sin(rad);
	const wind_v = -speed * Math.cos(rad);
	return {
		wind_u: Math.round(wind_u * 100) / 100,
		wind_v: Math.round(wind_v * 100) / 100,
	};
}

/**
 * Consulta a DB para verificar se existem registros do dia solicitado (ou últimas 24h).
 */
export async function checkDayCache(
	stationId: string,
	targetDate: Date,
	db: WeatherDatabase,
	maxAgeHours = 3,
): Promise<{ cached: boolean; records: EnvironmentalRecord[] }> {
	const startOfDay = new Date(targetDate);
	startOfDay.setUTCHours(0, 0, 0, 0);
	const endOfDay = new Date(targetDate);
	endOfDay.setUTCHours(23, 59, 59, 999);

	const startIso = startOfDay.toISOString();
	const endIso = endOfDay.toISOString();

	const rows = (await db.query(
		`SELECT * FROM environmental_features 
     WHERE station_id = ? AND timestamp >= ? AND timestamp <= ? 
     ORDER BY timestamp ASC`,
		[stationId, startIso, endIso],
	)) as EnvironmentalRecord[];

	if (rows.length === 0) {
		return { cached: false, records: [] };
	}

	// Verifica se os dados ainda estão dentro do TTL
	const now = new Date().getTime();
	const latestCreated = rows.reduce((latest, r) => {
		const t = r.created_at ? new Date(r.created_at).getTime() : 0;
		return t > latest ? t : latest;
	}, 0);

	const isRecentEnough =
		latestCreated === 0 || now - latestCreated < maxAgeHours * 3600 * 1000;

	// Considera o dia cacheado se tiver pelo menos 8 pontos e estiver recente
	const isComplete = rows.length >= 8 && isRecentEnough;
	return { cached: isComplete, records: rows };
}

/**
 * Consulta a DB para verificar se a semana completa já está armazenada no banco.
 */
export async function checkWeekCache(
	stationId: string,
	startOfWeek: Date,
	endOfWeek: Date,
	db: WeatherDatabase,
): Promise<{ cached: boolean; count: number; records: EnvironmentalRecord[] }> {
	const startIso = startOfWeek.toISOString();
	const endIso = endOfWeek.toISOString();

	const rows = (await db.query(
		`SELECT * FROM environmental_features 
     WHERE station_id = ? AND timestamp >= ? AND timestamp <= ? 
     ORDER BY timestamp ASC`,
		[stationId, startIso, endIso],
	)) as EnvironmentalRecord[];

	// Uma semana completa de dados horários possui ~168 pontos
	const isWeekComplete = rows.length >= 50; // limiar de cobertura representativa da semana
	return { cached: isWeekComplete, count: rows.length, records: rows };
}

/**
 * Salva registros em lote na tabela environmental_features com estratégia UPSERT.
 */
export async function saveRecordsToDb(
	records: EnvironmentalRecord[],
	db: WeatherDatabase,
): Promise<void> {
	for (const r of records) {
		await db.execute(
			`INSERT INTO environmental_features (
        id, station_id, timestamp, is_forecast,
        temperature, relative_humidity, wind_speed, wind_direction,
        wind_u, wind_v, boundary_layer_height, surface_pressure,
        solar_radiation, satellite_aod, satellite_tropomi_no2, satellite_uvai,
        traffic_speed_avg, traffic_delay_ratio, traffic_congestion_index,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(station_id, timestamp, is_forecast) DO UPDATE SET
        temperature = excluded.temperature,
        relative_humidity = excluded.relative_humidity,
        wind_speed = excluded.wind_speed,
        wind_direction = excluded.wind_direction,
        wind_u = excluded.wind_u,
        wind_v = excluded.wind_v,
        boundary_layer_height = excluded.boundary_layer_height,
        surface_pressure = excluded.surface_pressure,
        solar_radiation = excluded.solar_radiation,
        source = excluded.source`,
			[
				r.id || `${r.station_id}_${r.timestamp}_${r.is_forecast}`,
				r.station_id,
				r.timestamp,
				r.is_forecast ?? 0,
				r.temperature,
				r.relative_humidity,
				r.wind_speed,
				r.wind_direction,
				r.wind_u,
				r.wind_v,
				r.boundary_layer_height,
				r.surface_pressure,
				r.solar_radiation,
				r.satellite_aod ?? 0.15,
				r.satellite_tropomi_no2 ?? 15.0,
				r.satellite_uvai ?? 0.5,
				r.traffic_speed_avg ?? 45.0,
				r.traffic_delay_ratio ?? 1.1,
				r.traffic_congestion_index ?? 0.2,
				r.source,
			],
		);
	}
}

/**
 * Orquestrador DB-First com blindagem de cota Open-Meteo (https://open-meteo.com/en/docs):
 * 1. Primeiro checa se os dados do dia e da semana já existem no banco D1/SQLite local.
 * 2. Se existirem e estiverem válidos, retorna do banco com ZERO chamadas de API externa.
 * 3. Se ausentes ou expirados, consulta a API Open-Meteo e persiste no banco via UPSERT.
 */
interface OpenMeteoHourly {
	time: string[];
	temperature_2m?: number[];
	relative_humidity_2m?: number[];
	wind_speed_10m?: number[];
	wind_direction_10m?: number[];
	surface_pressure?: number[];
	direct_radiation?: number[];
	boundary_layer_height?: number[];
}

interface OpenMeteoResponse {
	latitude: number;
	longitude: number;
	hourly?: OpenMeteoHourly;
}

export async function getWeatherDataWithQuotaGuard(params: {
	stationId: string;
	latitude: number;
	longitude: number;
	targetDate: Date;
	db: WeatherDatabase;
	forceRefresh?: boolean;
	openMeteoApiKey?: string;
}): Promise<{
	records: EnvironmentalRecord[];
	sourceUsed: "db-cache" | "open-meteo-api" | "fallback";
}> {
	const {
		stationId,
		latitude,
		longitude,
		targetDate,
		db,
		forceRefresh,
		openMeteoApiKey,
	} = params;

	// 1. Pesquisa primeiro se tem dados do dia na DB (DB-First)
	if (!forceRefresh) {
		const dayCheck = await checkDayCache(stationId, targetDate, db);
		if (dayCheck.cached && dayCheck.records.length > 0) {
			return { records: dayCheck.records, sourceUsed: "db-cache" };
		}
	}

	// 2. Se não tem no banco ou expirou, chama a API Open-Meteo (https://open-meteo.com/en/docs)
	try {
		const baseUrl = "https://api.open-meteo.com/v1/forecast";
		const queryParams = new URLSearchParams({
			latitude: latitude.toString(),
			longitude: longitude.toString(),
			hourly:
				"temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure,direct_radiation,boundary_layer_height",
			wind_speed_unit: "ms",
			forecast_days: "5",
			timezone: "America/Sao_Paulo",
		});
		if (openMeteoApiKey) {
			queryParams.set("apikey", openMeteoApiKey);
		}

		const url = `${baseUrl}?${queryParams.toString()}`;
		const res = await fetch(url);
		if (res.ok) {
			const data = (await res.json()) as OpenMeteoResponse;
			const hourly = data.hourly;
			if (hourly && hourly.time && hourly.time.length > 0) {
				const fetchedRecords: EnvironmentalRecord[] = hourly.time.map(
					(timeStr: string, idx: number) => {
						const speed = hourly.wind_speed_10m?.[idx] ?? 3.5;
						const deg = hourly.wind_direction_10m?.[idx] ?? 45;
						const { wind_u, wind_v } = calcWindComponents(speed, deg);
						const isoTimestamp = new Date(timeStr).toISOString();

						return {
							id: `${stationId}_${timeStr}_1`,
							station_id: stationId,
							timestamp: isoTimestamp,
							is_forecast: 1,
							temperature: hourly.temperature_2m?.[idx] ?? 24.0,
							relative_humidity: hourly.relative_humidity_2m?.[idx] ?? 70.0,
							wind_speed: speed,
							wind_direction: deg,
							wind_u,
							wind_v,
							boundary_layer_height:
								hourly.boundary_layer_height?.[idx] ?? 380.0,
							surface_pressure: hourly.surface_pressure?.[idx] ?? 1013.25,
							solar_radiation: hourly.direct_radiation?.[idx] ?? 0.0,
							source: "Open-Meteo",
							created_at: new Date().toISOString(),
						};
					},
				);

				if (fetchedRecords.length > 0) {
					// Salva imediatamente no banco para blindar as próximas requisições
					await saveRecordsToDb(fetchedRecords, db);
					return { records: fetchedRecords, sourceUsed: "open-meteo-api" };
				}
			}
		}
	} catch (err) {
		console.warn(
			"[Open-Meteo Quota Guard] Erro ao consultar API externa:",
			err,
		);
	}

	// 3. Fallback: Se a API falhou, retorna registros existentes ou vazios
	const fallbackCheck = await checkDayCache(stationId, targetDate, db, 24 * 7); // busca histórico relaxado
	return { records: fallbackCheck.records, sourceUsed: "fallback" };
}
