import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type EnvironmentalRecord,
	type WeatherDatabase,
	calcWindComponents,
	checkDayCache,
	checkWeekCache,
	getWeatherDataWithQuotaGuard,
	saveRecordsToDb,
} from "../src/weather-cache.ts";

class MockDatabase implements WeatherDatabase {
	private records: Map<string, EnvironmentalRecord> = new Map();

	async query(sql: string, params: unknown[]): Promise<unknown[]> {
		const stationId = String(params[0]);
		const start = String(params[1]);
		const end = String(params[2]);

		return Array.from(this.records.values()).filter((r) => {
			return (
				r.station_id === stationId && r.timestamp >= start && r.timestamp <= end
			);
		});
	}

	async execute(sql: string, params: unknown[]): Promise<{ changes: number }> {
		const record: EnvironmentalRecord = {
			id: String(params[0]),
			station_id: String(params[1]),
			timestamp: String(params[2]),
			is_forecast: Number(params[3]),
			temperature: Number(params[4]),
			relative_humidity: Number(params[5]),
			wind_speed: params[6],
			wind_direction: params[7],
			wind_u: params[8],
			wind_v: params[9],
			boundary_layer_height: params[10],
			surface_pressure: params[11],
			solar_radiation: params[12],
			satellite_aod: params[13],
			satellite_tropomi_no2: params[14],
			satellite_uvai: params[15],
			traffic_speed_avg: params[16],
			traffic_delay_ratio: params[17],
			traffic_congestion_index: params[18],
			source: params[19],
			created_at: new Date().toISOString(),
		};
		const key = `${record.station_id}_${record.timestamp}_${record.is_forecast}`;
		this.records.set(key, record);
		return { changes: 1 };
	}
}

test("calcWindComponents calcula componentes zonal e meridional corretamente", () => {
	// Vento Norte (0° ou 360°) -> sopra de Norte para Sul (v < 0, u ≈ 0)
	const north = calcWindComponents(10, 0);
	assert.equal(north.wind_u, -0);
	assert.equal(north.wind_v, -10);

	// Vento Leste (90°) -> sopra de Leste para Oeste (u < 0, v ≈ 0)
	const east = calcWindComponents(10, 90);
	assert.equal(east.wind_u, -10);
	assert.equal(east.wind_v, -0);
});

test("Quota Guard: prioriza DB e não consome API se já existirem dados do dia/semana", async () => {
	const db = new MockDatabase();
	const stationId = "ramqar_camburi";
	const today = new Date("2026-09-18T12:00:00Z");

	// Inicialmente o banco está vazio
	const initialCheck = await checkDayCache(stationId, today, db);
	assert.equal(initialCheck.cached, false);

	// Simulamos a persistência dos dados de 24 horas no banco
	const mockDayRecords: EnvironmentalRecord[] = Array.from({ length: 24 }).map(
		(_, h) => {
			const hourStr = String(h).padStart(2, "0");
			return {
				id: `${stationId}_2026-09-18T${hourStr}:00:00Z_0`,
				station_id: stationId,
				timestamp: `2026-09-18T${hourStr}:00:00Z`,
				is_forecast: 0,
				temperature: 24.5 + Math.sin(h / 4),
				relative_humidity: 75.0,
				wind_speed: 4.2,
				wind_direction: 45,
				wind_u: -2.97,
				wind_v: -2.97,
				boundary_layer_height: 400.0,
				surface_pressure: 1014.0,
				solar_radiation: h >= 6 && h <= 18 ? 500 : 0,
				source: "Open-Meteo",
				created_at: new Date().toISOString(),
			};
		},
	);

	await saveRecordsToDb(mockDayRecords, db);

	// Agora checamos o cache do dia: deve reportar como cacheado!
	const cachedCheck = await checkDayCache(stationId, today, db);
	assert.equal(cachedCheck.cached, true);
	assert.equal(cachedCheck.records.length, 24);

	// Chamada via getWeatherDataWithQuotaGuard deve retornar diretamente do DB ('db-cache') sem tocar na API Open-Meteo
	const result = await getWeatherDataWithQuotaGuard({
		stationId,
		latitude: -20.2764,
		longitude: -40.2881,
		targetDate: today,
		db,
	});

	assert.equal(result.sourceUsed, "db-cache");
	assert.equal(result.records.length, 24);
});
