// workers/api/test/history.test.ts — TDD para GET /api/history com prioridade por source
//
// Verifica que, quando coexistem múltiplas linhas em `observed_pollutants` para
// o mesmo `(station_id, timestamp)` (migration 0003), `/api/history` devolve no
// máximo 1 ponto por `timestamp`, aplicando a prioridade:
//   'IEMA' > 'open-meteo-cams-reanalysis' > 'open-meteo-cams-forecast'

import assert from "node:assert/strict";
import { test } from "node:test";
import { createSchema, localD1 } from "../../ingestion/test/d1-local.ts";
import apiWorker, { type Env } from "../src/index.ts";

function makeEnv(db: D1Database): Env {
	return {
		DB: db,
		MODELS: {} as R2Bucket,
		VAPID_PUBLIC_KEY: "test-pub",
		VAPID_PRIVATE_KEY: "test-priv",
	};
}

test("GET /api/history: deduplica por timestamp aplicando prioridade 'IEMA' > 'open-meteo-cams-reanalysis' > 'open-meteo-cams-forecast'", async () => {
	const local = localD1(createSchema());
	try {
		const insertSql = `INSERT INTO observed_pollutants
			(id, station_id, timestamp, pm25, pm10, so2, no2, o3, co, iqar_index, iqar_classification, primary_pollutant, source)
			VALUES (?, ?, ?, ?, 20, 2, 10, 40, 300, ?, 'Boa', 'pm25', ?)`;

		// Hora T1 (11:00): todas as 3 fontes presentes → 'IEMA' deve vencer (pm25 = 7.1, iqar = 19)
		await local.db
			.prepare(insertSql)
			.bind(
				"t1-fc",
				"ramqar_camburi",
				"2026-10-18T11:00",
				14.0,
				37,
				"open-meteo-cams-forecast",
			)
			.run();
		await local.db
			.prepare(insertSql)
			.bind(
				"t1-re",
				"ramqar_camburi",
				"2026-10-18T11:00",
				12.0,
				32,
				"open-meteo-cams-reanalysis",
			)
			.run();
		await local.db
			.prepare(insertSql)
			.bind("t1-iema", "ramqar_camburi", "2026-10-18T11:00", 7.1, 19, "IEMA")
			.run();

		// Hora T2 (12:00): sem IEMA, mas com reanalysis + forecast → 'open-meteo-cams-reanalysis' deve vencer (pm25 = 11.5)
		await local.db
			.prepare(insertSql)
			.bind(
				"t2-fc",
				"ramqar_camburi",
				"2026-10-18T12:00",
				15.0,
				40,
				"open-meteo-cams-forecast",
			)
			.run();
		await local.db
			.prepare(insertSql)
			.bind(
				"t2-re",
				"ramqar_camburi",
				"2026-10-18T12:00",
				11.5,
				31,
				"open-meteo-cams-reanalysis",
			)
			.run();

		// Hora T3 (13:00): apenas forecast → 'open-meteo-cams-forecast' entra como fallback (pm25 = 13.2)
		await local.db
			.prepare(insertSql)
			.bind(
				"t3-fc",
				"ramqar_camburi",
				"2026-10-18T13:00",
				13.2,
				35,
				"open-meteo-cams-forecast",
			)
			.run();

		const res = await apiWorker.fetch(
			new Request(
				"https://aetherml-api.local/api/history?station=ramqar_camburi&from=2026-10-18T10:00&to=2026-10-18T14:00",
			),
			makeEnv(local.db),
		);
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			station_id: string;
			points: Array<Record<string, unknown>>;
		};
		assert.equal(body.station_id, "ramqar_camburi");
		assert.equal(
			body.points.length,
			3,
			"não pode devolver timestamps duplicados",
		);
		assert.deepEqual(
			body.points.map((p) => ({
				id: p.id,
				timestamp: p.timestamp,
				pm25: p.pm25,
				iqar_index: p.iqar_index,
				source: p.source,
			})),
			[
				{
					id: "t1-iema",
					timestamp: "2026-10-18T11:00",
					pm25: 7.1,
					iqar_index: 19,
					source: "IEMA",
				},
				{
					id: "t2-re",
					timestamp: "2026-10-18T12:00",
					pm25: 11.5,
					iqar_index: 31,
					source: "open-meteo-cams-reanalysis",
				},
				{
					id: "t3-fc",
					timestamp: "2026-10-18T13:00",
					pm25: 13.2,
					iqar_index: 35,
					source: "open-meteo-cams-forecast",
				},
			],
		);
		// Garante que colunas auxiliares de window function (ex.: rn) não vazam no payload JSON
		assert.equal("rn" in body.points[0], false);
	} finally {
		local.close();
	}
});

test("GET /api/history: retorna 400 BAD_STATION quando station está ausente", async () => {
	const local = localD1(createSchema());
	try {
		const res = await apiWorker.fetch(
			new Request("https://aetherml-api.local/api/history"),
			makeEnv(local.db),
		);
		assert.equal(res.status, 400);
		const body = (await res.json()) as { error?: { code?: string } };
		assert.equal(body.error?.code, "BAD_STATION");
	} finally {
		local.close();
	}
});
