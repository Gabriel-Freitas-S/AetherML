// workers/ingestion/test/ingestion.test.ts — TDD do worker de ingestão.
//
// Cobre as partes puras (SQL do upsert, mapeamento CAMS→coluna, recorte da
// janela, idempotência) sem rede: o fetch de `ingest()` é substituído por um
// dublê com o MESMO formato de payload que o Open-Meteo devolve (verificado
// contra a API real em 2026-10-02). A prova com rede de verdade, contra um D1
// local, vive em `live-ingest.test.ts` (opt-in via AETHERML_LIVE=1).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
	AQ_URL,
	AQ_VARS,
	CAMPS_ANALYSIS_SOURCE,
	CAMPS_FORECAST_SOURCE,
	CAMPS_TO_COLUMN,
	FEATURES_SOURCE,
	IEMA_MAPA_URL,
	IEMA_SENTINEL,
	IEMA_STATION_MAP,
	LOOKBACK_HOURS,
	MAX_BACKFILL_DAYS,
	MAX_INSITU_HOURS,
	METEO_URL,
	METEO_VARS,
	buildFeaturesUpsert,
	buildIemaMapaUpsert,
	buildObservedUpsert,
	buildOpenMeteoUrl,
	dayStart,
	featuresRowFrom,
	hourWindow,
	iemaDataHoraToUtc,
	iemaIqaToUgM3,
	iemaRowFromMapa,
	ingest,
	ingestInsitu,
	observedRowFrom,
	parseBackfillDays,
	parseIemaPollutant,
	parseInsituHours,
	prepareObservedStatement,
	upsertObservedRows,
} from "../src/index.ts";
import worker from "../src/index.ts";
import { DB_DIR, createSchema, localD1 } from "./d1-local.ts";

// --- fixtures ---------------------------------------------------------------

const TS = "2026-10-01T14:00";
const ANALYSIS_CUTOFF = "2026-10-02T00:00";
const NOW = new Date("2026-10-02T13:30:00.000Z");
const WINDOW_HOURS = [
	"2026-10-02T11:00",
	"2026-10-02T12:00",
	"2026-10-02T13:00",
];

/** Série CAMS sintética com os valores crus que o Open-Meteo devolve. */
function cams(overrides: Record<string, unknown> = {}) {
	return {
		time: [TS],
		pm2_5: [12.4],
		pm10: [21.7],
		ozone: [63],
		nitrogen_dioxide: [18.2],
		sulphur_dioxide: [3.1],
		carbon_monoxide: [412],
		...overrides,
	};
}

/** Série meteorológica sintética (unidades do Open-Meteo: km/h, hPa, m). */
function meteo(overrides: Record<string, unknown> = {}) {
	return {
		time: [TS],
		temperature_2m: [25.7],
		relative_humidity_2m: [82],
		wind_speed_10m: [13.6],
		wind_direction_10m: [90],
		pressure_msl: [1013.8],
		shortwave_radiation: [0],
		boundary_layer_height: [430],
		...overrides,
	};
}

/** Dublê de fetch que devolve o envelope do Open-Meteo com `hours` horas (e IEMA opcional). */
function fakeOpenMeteo(
	hours: string[],
	overrides: {
		aq?: Record<string, unknown>;
		met?: Record<string, unknown>;
		iema?: unknown[];
	} = {},
): typeof fetch {
	const n = hours.length;
	const fill = (v: number) => Array.from({ length: n }, () => v);
	const aq = {
		time: hours,
		pm2_5: fill(12.4),
		pm10: fill(21.7),
		ozone: fill(63),
		nitrogen_dioxide: fill(18.2),
		sulphur_dioxide: fill(3.1),
		carbon_monoxide: fill(412),
		...overrides.aq,
	};
	const met = {
		time: hours,
		temperature_2m: fill(25.7),
		relative_humidity_2m: fill(82),
		wind_speed_10m: fill(13.6),
		wind_direction_10m: fill(90),
		pressure_msl: fill(1013.8),
		shortwave_radiation: fill(0),
		boundary_layer_height: fill(430),
		...overrides.met,
	};
	return (async (input: string) => {
		const url = String(input);
		if (url.startsWith(IEMA_MAPA_URL)) {
			return new Response(JSON.stringify(overrides.iema ?? []), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		const body = url.startsWith(AQ_URL) ? aq : met;
		return new Response(JSON.stringify({ hourly: body }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
}

const SILENT = { log: () => {}, logError: () => {} };

// --- 1. SQL do upsert --------------------------------------------------------

test("buildObservedUpsert: usa ON CONFLICT(station_id, timestamp, source) — coexistência por fonte (migration 0003)", () => {
	assert.match(
		buildObservedUpsert(),
		/ON CONFLICT\(station_id, timestamp, source\) DO UPDATE SET/,
		"coexistência CAMS×IEMA exige UNIQUE(station_id, timestamp, source)",
	);
});

test("buildObservedUpsert: propaga source na cláusula DO UPDATE", () => {
	assert.match(
		buildObservedUpsert(),
		/source = excluded\.source/,
		"re-ingestão precisa atualizar a origem, não deixá-la obsoleta",
	);
});

test("buildObservedUpsert: DO UPDATE cobre todo campo gravado, menos id", () => {
	const [, update] = buildObservedUpsert().split("DO UPDATE SET");
	assert.ok(update, "falta DO UPDATE SET");
	for (const col of [
		"pm25",
		"pm10",
		"so2",
		"no2",
		"o3",
		"co",
		"iqar_index",
		"iqar_classification",
		"primary_pollutant",
		"source",
	]) {
		assert.match(
			update,
			new RegExp(`\\b${col} = excluded\\.${col}\\b`),
			`falta ${col}`,
		);
	}
	assert.doesNotMatch(
		update,
		/\bid = excluded\.id\b/,
		"id é PK: a linha existente preserva",
	);
});

test("buildObservedUpsert: nunca escreve created_at (DEFAULT CURRENT_TIMESTAMP)", () => {
	assert.doesNotMatch(buildObservedUpsert(), /created_at/);
});

test("buildFeaturesUpsert: usa a UNIQUE de 3 colunas de environmental_features", () => {
	const sql = buildFeaturesUpsert();
	assert.match(
		sql,
		/ON CONFLICT\(station_id, timestamp, is_forecast\) DO UPDATE SET/,
	);
	assert.match(sql, /is_forecast = excluded\.is_forecast/);
	assert.match(sql, /source = excluded\.source/);
});

// --- 2. URL: mesma construção do lado Python --------------------------------

test("buildOpenMeteoUrl: espelha ml/training/fetch_openmeteo.py", () => {
	const url = new URL(
		buildOpenMeteoUrl(AQ_URL, AQ_VARS, { lat: -20.3196, lon: -40.337 }),
	);
	assert.equal(url.origin + url.pathname, AQ_URL);
	assert.equal(url.searchParams.get("latitude"), "-20.3196");
	assert.equal(url.searchParams.get("longitude"), "-40.337");
	// `timezone=UTC` é o que faz `hourly.time` vir sem sufixo e com utc_offset 0.
	assert.equal(url.searchParams.get("timezone"), "UTC");
	assert.equal(url.searchParams.get("hourly"), AQ_VARS);
	assert.equal(url.searchParams.get("past_days"), "1");
	// Sem isto o payload do dia corrente não existe: CAMS só tem análise
	// até o fim de D-1 (verificado na API em 2026-10-02).
	assert.equal(url.searchParams.get("forecast_days"), "1");
});

test("buildOpenMeteoUrl: a URL de meteorologia é api.open-meteo.com, não a de qualidade do ar", () => {
	assert.equal(AQ_URL, "https://air-quality-api.open-meteo.com/v1/air-quality");
	assert.equal(METEO_URL, "https://api.open-meteo.com/v1/forecast");
});

test("AQ_VARS: cobre as 6 chaves CAMS com os nomes crus do Open-Meteo", () => {
	assert.deepEqual(AQ_VARS.split(","), [
		"pm2_5",
		"pm10",
		"ozone",
		"nitrogen_dioxide",
		"sulphur_dioxide",
		"carbon_monoxide",
	]);
});

test("METEO_VARS: mesmas 7 variáveis que build_real_dataset.py consome", () => {
	assert.deepEqual(METEO_VARS.split(","), [
		"temperature_2m",
		"relative_humidity_2m",
		"wind_speed_10m",
		"wind_direction_10m",
		"pressure_msl",
		"shortwave_radiation",
		"boundary_layer_height",
	]);
});

test("CAMPS_TO_COLUMN: mapeia chave CAMS → coluna observed_pollutants", () => {
	assert.deepEqual(CAMPS_TO_COLUMN, {
		pm2_5: "pm25",
		pm10: "pm10",
		ozone: "o3",
		nitrogen_dioxide: "no2",
		sulphur_dioxide: "so2",
		carbon_monoxide: "co",
	});
});

test("LOOKBACK_HOURS cabe no past_days=1 pedido (≤ 24h)", () => {
	assert.ok(LOOKBACK_HOURS >= 1 && LOOKBACK_HOURS <= 24);
});

// --- 3. Recorte da janela ---------------------------------------------------

test("hourWindow: ancora na hora cheia corrente, sem minutos", () => {
	assert.deepEqual(hourWindow(NOW, 3), {
		from: "2026-10-02T11:00",
		to: "2026-10-02T13:00",
	});
});

test("hourWindow: hours=1 devolve uma hora só", () => {
	assert.deepEqual(hourWindow(new Date("2026-10-02T13:59:59.000Z"), 1), {
		from: "2026-10-02T13:00",
		to: "2026-10-02T13:00",
	});
});

test("hourWindow: corta exatamente N horas, atravessando meia-noite", () => {
	const w = hourWindow(new Date("2026-10-02T00:30:00.000Z"), 3);
	assert.deepEqual(w, { from: "2026-10-01T22:00", to: "2026-10-02T00:00" });
	assert.equal((Date.parse(w.to) - Date.parse(w.from)) / 3_600_000, 2);
});

test("dayStart: meia-noite UTC do dia corrente, no mesmo formato de hourly.time", () => {
	assert.equal(dayStart(NOW), ANALYSIS_CUTOFF);
});

// --- 4. Mapeamento CAMS → linha ---------------------------------------------

test("observedRowFrom: traduz as chaves CAMS para as colunas da tabela", () => {
	const row = observedRowFrom("ramqar_camburi", cams(), 0, ANALYSIS_CUTOFF);
	assert.equal(row.pm25, 12.4);
	assert.equal(row.pm10, 21.7);
	assert.equal(row.o3, 63);
	assert.equal(row.no2, 18.2);
	assert.equal(row.so2, 3.1);
	assert.equal(row.co, 412);
	assert.equal(row.stationId, "ramqar_camburi");
	assert.equal(row.timestamp, TS);
});

test("observedRowFrom: IQAr vem do pacote canônico, não de uma segunda cópia", () => {
	// pm25=12.4 → 0+40/15*12.4=33 · pm10=21.7 → 0+40/50*21.7=17 · o3=63 →
	// 0+40/100*63=25 · no2=18.2 → 0+40/200*18.2=4 · so2=3.1 → 0+40/20*3.1=6.
	// Global = 33 (pm25, Boa).
	const row = observedRowFrom("ramqar_camburi", cams(), 0, ANALYSIS_CUTOFF);
	assert.equal(row.iqarIndex, 33);
	assert.equal(row.iqarClassification, "Boa");
	assert.equal(row.primaryPollutant, "pm25");
});

test("observedRowFrom: hours anteriores ao corte são marcados como reanálise CAMS", () => {
	assert.equal(CAMPS_ANALYSIS_SOURCE, "open-meteo-cams-reanalysis");
	assert.equal(
		observedRowFrom("ramqar_camburi", cams(), 0, ANALYSIS_CUTOFF).source,
		CAMPS_ANALYSIS_SOURCE,
	);
});

test("observedRowFrom: hours do dia corrente são marcados como forecast CAMS", () => {
	// O Open-Meteo só tem análise até o fim do dia anterior: com past_days=1 o
	// payload começa em D-1T00:00 e as horas de hoje vêm do ramo de previsão.
	// Chamarforecast de reanálise seria a mesma mentira que chamar de IEMA.
	assert.equal(CAMPS_FORECAST_SOURCE, "open-meteo-cams-forecast");
	assert.equal(
		observedRowFrom(
			"ramqar_camburi",
			cams({ time: ["2026-10-02T09:00"] }),
			0,
			ANALYSIS_CUTOFF,
		).source,
		CAMPS_FORECAST_SOURCE,
	);
});

test("observedRowFrom: nenhuma fonte escrita é o sentinela IEMA nem NULL", () => {
	for (const ts of ["2026-10-01T14:00", "2026-10-02T09:00"]) {
		const { source } = observedRowFrom(
			"s",
			cams({ time: [ts] }),
			0,
			ANALYSIS_CUTOFF,
		);
		assert.notEqual(
			source,
			IEMA_SENTINEL,
			"IEMA é reservado p/ estação in-situ oficial",
		);
		assert.ok(source.startsWith("open-meteo-cams-"));
	}
});

test("observedRowFrom: valor ausente vira NULL, nunca zero nem chute", () => {
	const row = observedRowFrom(
		"ramqar_camburi",
		cams({ pm2_5: [null], nitrogen_dioxide: [null] }),
		0,
		ANALYSIS_CUTOFF,
	);
	assert.equal(row.pm25, null, "0 seria um número plausível e falso");
	assert.equal(row.no2, null);
	assert.equal(row.pm10, 21.7, "as demais séries continuam íntegras");
});

test("observedRowFrom: IQAr fica NULL quando falta qualquer um dos 5 poluentes", () => {
	const row = observedRowFrom(
		"ramqar_camburi",
		cams({ ozone: [null] }),
		0,
		ANALYSIS_CUTOFF,
	);
	assert.equal(row.iqarIndex, null);
	assert.equal(row.iqarClassification, null);
	assert.equal(row.primaryPollutant, null);
	assert.equal(row.o3, null, "o dado cru ainda é preservado");
});

test("observedRowFrom: a faixa gravada é sempre a do índice gravado", () => {
	// Regressão do bug "mapa 17 / dashboard 40": iqar_classification tem de ser a
	// classifyIndex(iqar_index) da MESMA linha, nunca a de outro ponto.
	for (const o3 of [10, 55, 130, 150, 260]) {
		const row = observedRowFrom("s", cams({ ozone: [o3] }), 0, ANALYSIS_CUTOFF);
		const i = row.iqarIndex as number;
		const band =
			i <= 40
				? "Boa"
				: i <= 80
					? "Moderada"
					: i <= 120
						? "Ruim"
						: i <= 200
							? "Muito Ruim"
							: "Péssima";
		assert.equal(row.iqarClassification, band, `o3=${o3} iqar=${i}`);
	}
});

test("featuresRowFrom: converte vento de km/h para m/s (docs/03, feature 2)", () => {
	const row = featuresRowFrom("ramqar_camburi", meteo(), 0);
	assert.equal(row.windSpeed, 3.78); // 13.6 / 3.6
	// u = -spd*sin(dir); v = -spd*cos(dir) — mesma fórmula de build_real_dataset.py.
	assert.equal(row.windU, -3.78);
	assert.ok(Math.abs(row.windV as number) < 0.005, "v ≈ 0 com dir=90°");
	assert.equal(row.temperature, 25.7);
	assert.equal(row.relativeHumidity, 82);
	assert.equal(row.surfacePressure, 1013.8);
	assert.equal(row.boundaryLayerHeight, 430);
	assert.equal(row.isForecast, 0);
	assert.equal(row.source, FEATURES_SOURCE);
});

test("featuresRowFrom: nunca inventa tráfego nem satélite (só proxy determinístico existe)", () => {
	assert.equal(FEATURES_SOURCE, "open-meteo-forecast-api");
});

test("featuresRowFrom: radiação negativa é clampada em 0 (como no Python)", () => {
	const row = featuresRowFrom("s", meteo({ shortwave_radiation: [-12] }), 0);
	assert.equal(row.solarRadiation, 0);
});

test("featuresRowFrom: ausente vira NULL e não propaga para as componentes do vento", () => {
	const row = featuresRowFrom(
		"s",
		meteo({ temperature_2m: [null], wind_speed_10m: [null] }),
		0,
	);
	assert.equal(row.temperature, null);
	assert.equal(row.windSpeed, null);
	assert.equal(row.windU, null);
	assert.equal(row.windV, null);
});

// --- 5. ingest(): upsert, idempotência, falhas -------------------------------

test("ingest: grava uma linha por estação por hora, com source preenchida", async () => {
	const local = localD1(createSchema());
	try {
		const report = await ingest(
			{ DB: local.db },
			{ now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT },
		);
		assert.equal(report.stations.length, 9);
		assert.deepEqual(
			report.stations
				.filter((s) => !s.ok)
				.map((s) => `${s.stationId}: ${s.error}`),
			[],
		);

		const { results } = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.all<{ n: number }>();
		assert.equal(results[0].n, 9 * WINDOW_HOURS.length);

		const sample = await local.db
			.prepare(
				"SELECT station_id, timestamp, pm25, o3, co, iqar_index, iqar_classification, primary_pollutant, source FROM observed_pollutants WHERE timestamp=? ORDER BY station_id LIMIT 1",
			)
			.bind(WINDOW_HOURS[0])
			.first<Record<string, unknown>>();
		assert.equal(sample?.station_id, "ramqar_camburi");
		assert.equal(sample?.source, CAMPS_FORECAST_SOURCE);
		assert.equal(sample?.iqar_index, 33);
		assert.equal(sample?.primary_pollutant, "pm25");
		assert.equal(sample?.iqar_classification, "Boa");
	} finally {
		local.close();
	}
});

test("ingest: popula environmental_features no mesmo recorte, com is_forecast=0", async () => {
	const local = localD1(createSchema());
	try {
		await ingest(
			{ DB: local.db },
			{ now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT },
		);
		// `.first()` devolve a LINHA, não `{ results }` — é `.all()` que embrulha.
		const featCount = await local.db
			.prepare("SELECT COUNT(*) n FROM environmental_features")
			.first<{ n: number }>();
		assert.equal(featCount?.n, 9 * WINDOW_HOURS.length);
		const f = await local.db
			.prepare("SELECT is_forecast, source FROM environmental_features LIMIT 1")
			.first<Record<string, unknown>>();
		assert.equal(f?.is_forecast, 0);
		assert.equal(f?.source, FEATURES_SOURCE);
	} finally {
		local.close();
	}
});

test("ingest: as estações vêm do D1, não de uma lista hardcoded", async () => {
	const local = localD1(createSchema());
	try {
		// Apaga 3 estações: se o id viesse de código, ele as gravaria na mesma.
		await local.db.exec(
			"DELETE FROM monitoring_stations WHERE id IN ('ramqar_paul','ramqar_ibes','ramqar_cariacica')",
		);
		const report = await ingest(
			{ DB: local.db },
			{ now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT },
		);
		assert.equal(report.stations.length, 6);
		const { results } = await local.db
			.prepare(
				"SELECT DISTINCT station_id FROM observed_pollutants ORDER BY station_id",
			)
			.all<{ station_id: string }>();
		assert.equal(results.length, 6);
		assert.ok(!results.some((r) => r.station_id === "ramqar_paul"));
	} finally {
		local.close();
	}
});

test("ingest: idempotente — 2 execuções na MESMA janela não duplicam nem falham", async () => {
	const local = localD1(createSchema());
	try {
		const opts = {
			now: NOW,
			fetchImpl: fakeOpenMeteo(WINDOW_HOURS),
			...SILENT,
		};
		await ingest({ DB: local.db }, opts);
		const first = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		await ingest({ DB: local.db }, opts);
		const second = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(first?.n, 9 * WINDOW_HOURS.length);
		assert.equal(second?.n, first?.n, "ON CONFLICT não segurou a 2ª execução");
	} finally {
		local.close();
	}
});

test("ingest: re-execução ATUALIZA os valores no mesmo (station_id, timestamp)", async () => {
	const local = localD1(createSchema());
	try {
		const run = (o3: number) =>
			ingest(
				{ DB: local.db },
				{
					now: NOW,
					// ozone precisa ter o MESMO comprimento de `time` — um array de
					// 1 item num payload de 3 horas é shape inválido, e o worker
					// precisa recusá-lo em vez de preencher as lacunas.
					fetchImpl: fakeOpenMeteo(WINDOW_HOURS, {
						aq: { ozone: WINDOW_HOURS.map(() => o3) },
					}),
					...SILENT,
				},
			);
		await run(63);
		await run(150);
		const row = await local.db
			.prepare(
				"SELECT o3, iqar_index, primary_pollutant FROM observed_pollutants WHERE station_id=? AND timestamp=?",
			)
			.bind("ramqar_camburi", WINDOW_HOURS[0])
			.first<Record<string, unknown>>();
		assert.equal(row?.o3, 150);
		// o3=150 → faixa {81,120,130,160}: 81 + 39/30*(150-130) = 107, vence pm25=33.
		assert.equal(row?.iqar_index, 107);
		assert.equal(row?.primary_pollutant, "o3");
		const updated = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants WHERE o3=150")
			.first<{ n: number }>();
		assert.equal(updated?.n, 9 * WINDOW_HOURS.length);
	} finally {
		local.close();
	}
});

test("ingest: hora fora da janela é ignorada — o cron não reescreve histórico", async () => {
	const local = localD1(createSchema());
	try {
		const hours = [
			"2026-09-30T00:00",
			"2026-09-30T12:00",
			...WINDOW_HOURS,
			"2026-10-02T14:00",
			"2026-10-03T00:00",
		];
		await ingest(
			{ DB: local.db },
			{ now: NOW, fetchImpl: fakeOpenMeteo(hours), ...SILENT },
		);
		const { results } = await local.db
			.prepare(
				"SELECT DISTINCT timestamp FROM observed_pollutants ORDER BY timestamp",
			)
			.all<{ timestamp: string }>();
		assert.deepEqual(
			results.map((r) => r.timestamp),
			WINDOW_HOURS,
		);
	} finally {
		local.close();
	}
});

test("ingest: falha de rede por estação é logada e isola as demais", async () => {
	const local = localD1(createSchema());
	const errors: string[] = [];
	try {
		const ok = fakeOpenMeteo(WINDOW_HOURS);
		const failing = (async (input: string) => {
			if (String(input).includes("longitude=-40.4166")) {
				return new Response("upstream boom", { status: 503 });
			}
			return ok(input);
		}) as unknown as typeof fetch;

		const report = await ingest(
			{ DB: local.db },
			{
				now: NOW,
				fetchImpl: failing,
				log: () => {},
				logError: (m) => errors.push(m),
			},
		);
		const failed = report.stations.filter((s) => !s.ok);
		assert.equal(failed.length, 1);
		assert.equal(failed[0].stationId, "ramqar_cariacica");
		assert.match(
			errors.join("\n"),
			/ramqar_cariacica/,
			"falha tem de ser visível",
		);
		assert.match(
			errors.join("\n"),
			/503/,
			"o status HTTP precisa aparecer no log",
		);

		const distinct = await local.db
			.prepare("SELECT COUNT(DISTINCT station_id) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(distinct?.n, 8, "as 8 estações boas gravaram");
		const broken = await local.db
			.prepare(
				"SELECT COUNT(*) n FROM observed_pollutants WHERE station_id='ramqar_cariacica'",
			)
			.first<{ n: number }>();
		assert.equal(
			broken?.n,
			0,
			"sem fallback fabricationado para a estação que falhou",
		);
	} finally {
		local.close();
	}
});

test("ingest: payload com shape inesperado é reprovado, não coercionado", async () => {
	const local = localD1(createSchema());
	try {
		const malformed = (async () =>
			new Response(
				JSON.stringify({
					hourly: { time: WINDOW_HOURS, pm2_5: "não sou lista" },
				}),
				{
					status: 200,
				},
			)) as unknown as typeof fetch;
		const report = await ingest(
			{ DB: local.db },
			{ now: NOW, fetchImpl: malformed, ...SILENT },
		);
		assert.ok(
			report.stations.every((s) => !s.ok),
			"shape inválido tem de reprovar a estação",
		);
		assert.match(report.stations[0].error ?? "", /pm2_5/);
		const written = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(
			written?.n,
			0,
			"nada pode ser gravado a partir de payload inválido",
		);
	} finally {
		local.close();
	}
});

test("ingest: falha do batch não deixa a estação pela metade", async () => {
	const sqlite = createSchema();
	const local = localD1(sqlite);
	try {
		sqlite.exec(
			"CREATE TRIGGER boom BEFORE INSERT ON observed_pollutants BEGIN SELECT RAISE(ABORT, 'boom'); END;",
		);
		const report = await ingest(
			{ DB: local.db },
			{ now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT },
		);
		assert.ok(report.stations.every((s) => !s.ok));
		const partial = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(
			partial?.n,
			0,
			"batch atômico: ou entra a estação inteira, ou nada",
		);
	} finally {
		local.close();
	}
});

// --- 6. Backfill manual (POST /ingest?days=N) -------------------------------

function generateHours(endIso: string, count: number): string[] {
	const endMs = Math.floor(new Date(endIso).getTime() / 3_600_000) * 3_600_000;
	const out: string[] = [];
	for (let i = count - 1; i >= 0; i--) {
		out.push(
			`${new Date(endMs - i * 3_600_000).toISOString().slice(0, 13)}:00`,
		);
	}
	return out;
}

test("parseBackfillDays: aceita null/ausente como modo horário padrão e inteiros 1..MAX_BACKFILL_DAYS", () => {
	assert.equal(MAX_BACKFILL_DAYS, 30);
	assert.deepEqual(parseBackfillDays(null), { ok: true, days: undefined });
	assert.deepEqual(parseBackfillDays("1"), { ok: true, days: 1 });
	assert.deepEqual(parseBackfillDays("7"), { ok: true, days: 7 });
	assert.deepEqual(parseBackfillDays("30"), { ok: true, days: 30 });
});

test("parseBackfillDays: rejeita 0, negativos, >30, decimais, strings vazias e lixo", () => {
	for (const bad of [
		"",
		" ",
		"0",
		"-1",
		"-7",
		"31",
		"90",
		"3.5",
		"7d",
		"abc",
		"NaN",
		"Infinity",
	]) {
		const res = parseBackfillDays(bad);
		assert.equal(res.ok, false, `deveria rejeitar days=${JSON.stringify(bad)}`);
	}
});

test("buildOpenMeteoUrl: parametriza past_days e forecast_days quando fornecidos", () => {
	const url = new URL(
		buildOpenMeteoUrl(
			AQ_URL,
			AQ_VARS,
			{ lat: -20.3196, lon: -40.337 },
			{ pastDays: 7, forecastDays: 1 },
		),
	);
	assert.equal(url.searchParams.get("past_days"), "7");
	assert.equal(url.searchParams.get("forecast_days"), "1");
});

test("ingest com days=7: busca past_days=7, recorta 168h, respeita 1 subrequest/estação/serviço e separa reanalysis de forecast", async () => {
	const local = localD1(createSchema());
	const requestedUrls: string[] = [];
	try {
		const hours7d = generateHours(NOW.toISOString(), 7 * 24 + 24);
		const baseFetch = fakeOpenMeteo(hours7d);
		const spyFetch = (async (input: string) => {
			requestedUrls.push(String(input));
			return baseFetch(input);
		}) as unknown as typeof fetch;

		const report = await ingest(
			{ DB: local.db },
			{ now: NOW, days: 7, fetchImpl: spyFetch, ...SILENT },
		);

		assert.equal(report.failed, 0);
		assert.equal(report.from, "2026-09-25T14:00");
		assert.equal(report.to, "2026-10-02T13:00");
		assert.equal(report.observedRows, 9 * 168);
		assert.equal(report.featureRows, 9 * 168);

		// 9 estações × 2 serviços (AQ + Meteo) = 18 subrequests no total
		assert.equal(requestedUrls.length, 18);
		for (const u of requestedUrls) {
			const parsed = new URL(u);
			assert.equal(parsed.searchParams.get("past_days"), "7");
			assert.equal(parsed.searchParams.get("forecast_days"), "1");
		}

		// Horas anteriores a dayStart(NOW) ("2026-10-02T00:00") → reanalysis (154h)
		// Horas de hoje ("2026-10-02T00:00".."2026-10-02T13:00") → forecast (14h)
		const bySource = await local.db
			.prepare(
				"SELECT source, COUNT(*) n FROM observed_pollutants GROUP BY source ORDER BY source",
			)
			.all<{ source: string; n: number }>();
		assert.deepEqual(
			bySource.results.map((r) => ({ source: r.source, n: r.n })),
			[
				{ source: CAMPS_FORECAST_SOURCE, n: 9 * 14 },
				{ source: CAMPS_ANALYSIS_SOURCE, n: 9 * 154 },
			],
		);

		// Idempotência: rodar backfill de 7d novamente não duplica linhas
		await ingest(
			{ DB: local.db },
			{ now: NOW, days: 7, fetchImpl: spyFetch, ...SILENT },
		);
		const totalAfter = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(totalAfter?.n, 9 * 168);
	} finally {
		local.close();
	}
});

test("ingest: rejeita days fora do intervalo 1..MAX_BACKFILL_DAYS", async () => {
	const local = localD1(createSchema());
	try {
		for (const bad of [0, -2, 31, 1.5, Number.NaN]) {
			await assert.rejects(
				() =>
					ingest(
						{ DB: local.db },
						{
							now: NOW,
							days: bad,
							fetchImpl: fakeOpenMeteo(WINDOW_HOURS),
							...SILENT,
						},
					),
				/days/,
			);
		}
	} finally {
		local.close();
	}
});

test("ingest com days=30 (teto MAX_BACKFILL_DAYS): busca past_days=30, recorta 720h e grava 6480 linhas por tabela em 18 subrequests", async () => {
	const local = localD1(createSchema());
	const requestedUrls: string[] = [];
	try {
		const hours30d = generateHours(NOW.toISOString(), 30 * 24 + 24);
		const baseFetch = fakeOpenMeteo(hours30d);
		const spyFetch = (async (input: string) => {
			requestedUrls.push(String(input));
			return baseFetch(input);
		}) as unknown as typeof fetch;

		const report = await ingest(
			{ DB: local.db },
			{ now: NOW, days: 30, fetchImpl: spyFetch, ...SILENT },
		);

		assert.equal(report.failed, 0);
		assert.equal(report.from, "2026-09-02T14:00");
		assert.equal(report.to, "2026-10-02T13:00");
		assert.equal(report.observedRows, 9 * 720);
		assert.equal(report.featureRows, 9 * 720);
		assert.equal(requestedUrls.length, 18);
		for (const u of requestedUrls) {
			const parsed = new URL(u);
			assert.equal(parsed.searchParams.get("past_days"), "30");
			assert.equal(parsed.searchParams.get("forecast_days"), "1");
		}

		const obsCount = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		const featCount = await local.db
			.prepare("SELECT COUNT(*) n FROM environmental_features")
			.first<{ n: number }>();
		assert.equal(obsCount?.n, 6480);
		assert.equal(featCount?.n, 6480);

		// Reexecução no teto (days=30): upsert idempotente mantém 6480 linhas nas duas tabelas
		await ingest(
			{ DB: local.db },
			{ now: NOW, days: 30, fetchImpl: spyFetch, ...SILENT },
		);
		const obsAfterSecond = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		const featAfterSecond = await local.db
			.prepare("SELECT COUNT(*) n FROM environmental_features")
			.first<{ n: number }>();
		assert.equal(obsAfterSecond?.n, 6480);
		assert.equal(featAfterSecond?.n, 6480);
	} finally {
		local.close();
	}
});

test("worker.fetch: POST /ingest?days=invalid devolve 400 Bad Request e POST /ingest?days=2 executa backfill com relógio determinístico", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: NOW });
	const local = localD1(createSchema());
	const origFetch = globalThis.fetch;
	const origLog = console.log;
	const origErr = console.error;
	try {
		for (const q of ["days=0", "days=31", "days=-1", "days=abc", "days="]) {
			const res = await worker.fetch(
				new Request(`https://aetherml-ingestion.local/ingest?${q}`, {
					method: "POST",
					headers: { "X-Ingest-Token": "tok-test" },
				}),
				{ DB: local.db, INGEST_TOKEN: "tok-test" },
			);
			assert.equal(res.status, 400, `esperava 400 para ?${q}`);
			const body = (await res.json()) as { error?: string };
			assert.match(body.error ?? "", /days/i);
		}
		const countAfterBad = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(countAfterBad?.n, 0, "requisição 400 não pode tocar no D1");

		const requestedUrls: string[] = [];
		const hours2d = generateHours(NOW.toISOString(), 2 * 24 + 24);
		const baseFetch = fakeOpenMeteo(hours2d);
		globalThis.fetch = (async (input: string) => {
			requestedUrls.push(String(input));
			return baseFetch(input);
		}) as unknown as typeof fetch;
		console.log = () => {};
		console.error = () => {};

		const okRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest?days=2", {
				method: "POST",
				headers: { "X-Ingest-Token": "tok-test" },
			}),
			{ DB: local.db, INGEST_TOKEN: "tok-test" },
		);
		assert.equal(okRes.status, 200);
		const report = (await okRes.json()) as {
			from: string;
			to: string;
			observedRows: number;
			featureRows: number;
			failed: number;
		};
		assert.equal(report.failed, 0);
		assert.equal(report.from, "2026-09-30T14:00");
		assert.equal(report.to, "2026-10-02T13:00");
		assert.equal(report.observedRows, 9 * 48);
		assert.equal(report.featureRows, 9 * 48);
		assert.equal(requestedUrls.length, 18);
		assert.equal(new URL(requestedUrls[0]).searchParams.get("past_days"), "2");
	} finally {
		globalThis.fetch = origFetch;
		console.log = origLog;
		console.error = origErr;
		local.close();
	}
});

test("worker.fetch: GET e HEAD em /ingest devolvem 405 Method Not Allowed sem ingerir nada", async () => {
	const local = localD1(createSchema());
	let fetchCalls = 0;
	const origFetch = globalThis.fetch;
	try {
		globalThis.fetch = (async () => {
			fetchCalls++;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		for (const method of ["GET", "HEAD", "PUT", "DELETE"]) {
			const res = await worker.fetch(
				new Request("https://aetherml-ingestion.local/ingest?days=7", {
					method,
				}),
				{ DB: local.db },
			);
			assert.equal(res.status, 405, `esperava 405 para ${method} /ingest`);
			assert.equal(res.headers.get("allow"), "POST");
		}

		assert.equal(
			fetchCalls,
			0,
			"método não-POST não pode disparar subrequests",
		);
		const obsCount = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		const featCount = await local.db
			.prepare("SELECT COUNT(*) n FROM environmental_features")
			.first<{ n: number }>();
		assert.equal(
			obsCount?.n,
			0,
			"observed_pollutants deve permanecer intocado",
		);
		assert.equal(
			featCount?.n,
			0,
			"environmental_features deve permanecer intocado",
		);
	} finally {
		globalThis.fetch = origFetch;
		local.close();
	}
});

test("worker.fetch: exige X-Ingest-Token (401) quando env.INGEST_TOKEN está configurado (inclusive vazio = fail-closed)", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: NOW });
	const local = localD1(createSchema());
	const origFetch = globalThis.fetch;
	const origLog = console.log;
	const origErr = console.error;
	try {
		let fetchCalls = 0;
		const baseFetch = fakeOpenMeteo(WINDOW_HOURS);
		globalThis.fetch = (async (input: string) => {
			fetchCalls++;
			return baseFetch(input);
		}) as unknown as typeof fetch;
		console.log = () => {};
		console.error = () => {};

		// 0. INGEST_TOKEN não configurado (undefined) → fail-closed (401 mesmo com header)
		const undefinedSecretRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
				headers: { "X-Ingest-Token": "algum-token" },
			}),
			{ DB: local.db },
		);
		assert.equal(undefinedSecretRes.status, 401);

		// 1. Sem header X-Ingest-Token → 401
		const missingRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
			}),
			{ DB: local.db, INGEST_TOKEN: "segredo-super-forte" },
		);
		assert.equal(missingRes.status, 401);

		// 2. Com header X-Ingest-Token errado → 401
		const wrongRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
				headers: { "X-Ingest-Token": "token-errado" },
			}),
			{ DB: local.db, INGEST_TOKEN: "segredo-super-forte" },
		);
		assert.equal(wrongRes.status, 401);

		// 3. INGEST_TOKEN configurado como string vazia ("") → fail-closed (401 mesmo com header vazio)
		const emptySecretNoHeader = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
			}),
			{ DB: local.db, INGEST_TOKEN: "" },
		);
		assert.equal(emptySecretNoHeader.status, 401);

		const emptySecretEmptyHeader = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
				headers: { "X-Ingest-Token": "" },
			}),
			{ DB: local.db, INGEST_TOKEN: "" },
		);
		assert.equal(emptySecretEmptyHeader.status, 401);

		assert.equal(fetchCalls, 0, "requisição 401 não pode disparar subrequests");

		const obsBefore = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(obsBefore?.n, 0, "D1 intocado após 401");

		// 4. Com header X-Ingest-Token correto → 200 e ingere normalmente
		const okRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
				headers: { "X-Ingest-Token": "segredo-super-forte" },
			}),
			{ DB: local.db, INGEST_TOKEN: "segredo-super-forte" },
		);
		assert.equal(okRes.status, 200);
		const obsAfter = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(obsAfter?.n, 9 * WINDOW_HOURS.length);
	} finally {
		globalThis.fetch = origFetch;
		console.log = origLog;
		console.error = origErr;
		local.close();
	}
});

test("worker.fetch: devolve 502 Bad Gateway quando todas as estações falham e observedRows === 0", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: NOW });
	const local = localD1(createSchema());
	const origFetch = globalThis.fetch;
	const origLog = console.log;
	const origErr = console.error;
	try {
		globalThis.fetch = (async () =>
			new Response("open-meteo down", {
				status: 503,
			})) as unknown as typeof fetch;
		console.log = () => {};
		console.error = () => {};

		const res = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest", {
				method: "POST",
				headers: { "X-Ingest-Token": "tok-test" },
			}),
			{ DB: local.db, INGEST_TOKEN: "tok-test" },
		);
		assert.equal(res.status, 502);
		const report = (await res.json()) as {
			failed: number;
			observedRows: number;
			featureRows: number;
		};
		assert.equal(report.failed, 9);
		assert.equal(report.observedRows, 0);
		assert.equal(report.featureRows, 0);

		const obsCount = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(obsCount?.n, 0);
	} finally {
		globalThis.fetch = origFetch;
		console.log = origLog;
		console.error = origErr;
		local.close();
	}
});

// --- 7. Fase 2: Ingestão IEMA em tempo real (coexistência + /api/mapa + /ingest/insitu) ---

const IEMA_MAPA_FIXTURE = [
	{
		IdEstacao: 1,
		Descricao: "EMQAr - RGV1",
		Localizacao: "Laranjeiras",
		DataHora: "2026-10-02T10:00:00", // 10:00 BRT = 13:00 UTC
		Iqa: 10.02736,
		Valor: 4.9434334,
		Poluente: "Ozônio",
		Faixa: "Boa",
	},
	{
		IdEstacao: 2,
		Descricao: "EMQAr - RGV2",
		Localizacao: "Carapina",
		DataHora: "0001-01-01T00:00:00", // offline sentinel
		Iqa: 0.0,
		Valor: 0.0,
		Poluente: null,
		Faixa: null,
	},
	{
		IdEstacao: 3,
		Descricao: "EMQAr - RGV3",
		Localizacao: "Jardim Camburi",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 16.05936,
		Valor: 25.0,
		Poluente: "Partículas Inaláveis (<10µm)",
		Faixa: "Boa",
	},
	{
		IdEstacao: 4,
		Descricao: "EMQAr - RGV4",
		Localizacao: "Enseada do Suá",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 28.454, // IQA oficial da API (médias móveis regulatórias da rede IEMA) preservado
		Valor: 10.67, // pm25 em µg/m³
		Poluente: "Partículas Respiráveis (<2,5µm)",
		Faixa: "Boa",
	},
	{
		IdEstacao: 5,
		Descricao: "EMQAr - RGV5",
		Localizacao: "Vitória - Centro",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 17.5396,
		Valor: 8.769799,
		Poluente: "Partículas Respiráveis (<2,5µm)",
		Faixa: "Boa",
	},
	{
		IdEstacao: 6,
		Descricao: "EMQAr - RGV6",
		Localizacao: "Ibes",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 12.16424,
		Valor: 6.0821204,
		Poluente: "Partículas Respiráveis (<2,5µm)",
		Faixa: "Boa",
	},
	{
		IdEstacao: 8,
		Descricao: "EMQAr - RGV8",
		Localizacao: "Cariacica",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 14.37616,
		Valor: 5.2913218,
		Poluente: "Dióxido de Enxofre",
		Faixa: "Boa",
	},
	{
		IdEstacao: 9,
		Descricao: "EMQAr - RGV10",
		Localizacao: "Cid. Continental",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 12.24892,
		Valor: 6.1244583,
		Poluente: "Partículas Respiráveis (<2,5µm)",
		Faixa: "Boa",
	},
	{
		IdEstacao: 11,
		Descricao: "EMQAr - SUL 1",
		Localizacao: "Meaípe",
		DataHora: "2026-10-02T10:00:00",
		Iqa: 14.44264,
		Valor: 23.095472,
		Poluente: "Partículas Inaláveis (<10µm)",
		Faixa: "Boa",
	},
];

test("migration 0003: aplica 0001→0003 e dois upserts de sources diferentes convivem no mesmo (station_id, timestamp)", async () => {
	const local = localD1(createSchema());
	try {
		const sql = buildObservedUpsert();
		// 1. Grava previsão CAMS em (ramqar_camburi, 2026-10-02T13:00)
		await local.db
			.prepare(sql)
			.bind(
				"id-cams-1",
				"ramqar_camburi",
				"2026-10-02T13:00",
				12.4,
				21.7,
				3.1,
				18.2,
				63.0,
				412.0,
				33,
				"Boa",
				"pm25",
				CAMPS_FORECAST_SOURCE,
			)
			.run();

		// 2. Grava observação IEMA na MESMA (station_id, timestamp)
		await local.db
			.prepare(sql)
			.bind(
				"id-iema-1",
				"ramqar_camburi",
				"2026-10-02T13:00",
				8.5,
				25.0,
				2.0,
				14.0,
				50.0,
				350.0,
				23,
				"Boa",
				"pm25",
				IEMA_SENTINEL,
			)
			.run();

		const { results } = await local.db
			.prepare(
				"SELECT id, pm25, pm10, iqar_index, source FROM observed_pollutants WHERE station_id=? AND timestamp=? ORDER BY source",
			)
			.bind("ramqar_camburi", "2026-10-02T13:00")
			.all<{
				id: string;
				pm25: number;
				pm10: number;
				iqar_index: number;
				source: string;
			}>();

		assert.equal(
			results.length,
			2,
			"CAMS e IEMA têm de coexistir na mesma hora",
		);
		assert.deepEqual(
			results.map((r) => ({ ...r })),
			[
				{
					id: "id-iema-1",
					pm25: 8.5,
					pm10: 25,
					iqar_index: 23,
					source: "IEMA",
				},
				{
					id: "id-cams-1",
					pm25: 12.4,
					pm10: 21.7,
					iqar_index: 33,
					source: CAMPS_FORECAST_SOURCE,
				},
			],
		);

		// 3. Re-upsert na MESMA source ('IEMA') atualiza in-place sem criar 3ª linha e preserva id
		await local.db
			.prepare(sql)
			.bind(
				"id-iema-2",
				"ramqar_camburi",
				"2026-10-02T13:00",
				15.0,
				28.0,
				2.5,
				16.0,
				55.0,
				360.0,
				40,
				"Boa",
				"pm25",
				IEMA_SENTINEL,
			)
			.run();

		const afterUpdate = await local.db
			.prepare(
				"SELECT id, pm25, iqar_index, source FROM observed_pollutants WHERE station_id=? AND timestamp=? ORDER BY source",
			)
			.bind("ramqar_camburi", "2026-10-02T13:00")
			.all<{ id: string; pm25: number; iqar_index: number; source: string }>();

		assert.equal(afterUpdate.results.length, 2);
		assert.deepEqual(
			{ ...afterUpdate.results[0] },
			{
				id: "id-iema-1",
				pm25: 15,
				iqar_index: 40,
				source: "IEMA",
			},
		);
	} finally {
		local.close();
	}
});

test("migration 0003: aplica sobre banco com DADOS pré-existentes, preservando registros e habilitando coexistência por source", () => {
	const db = new DatabaseSync(":memory:");
	try {
		// 1. Aplica 0001 (init) e 0002 (adiciona coluna source, ainda com UNIQUE(station_id, timestamp))
		db.exec(readFileSync(`${DB_DIR}migrations/0001_init.sql`, "utf8"));
		db.exec(
			readFileSync(`${DB_DIR}migrations/0002_observed_source.sql`, "utf8"),
		);
		db.exec(readFileSync(`${DB_DIR}seed.sql`, "utf8"));

		// 2. Insere dados pré-existentes sob a restrição antiga
		const insertOld = db.prepare(`INSERT INTO observed_pollutants
			(id, station_id, timestamp, pm25, pm10, so2, no2, o3, co, iqar_index, iqar_classification, primary_pollutant, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

		insertOld.run(
			"legacy-1",
			"ramqar_camburi",
			"2026-10-18T12:00",
			12.5,
			22.0,
			2.1,
			14.0,
			45.0,
			320.0,
			30,
			"Boa",
			"pm25",
			"open-meteo-cams-forecast",
			"2026-10-18 12:30:00",
		);

		insertOld.run(
			"legacy-2",
			"ramqar_vitoria_centro",
			"2026-10-18T12:00",
			8.0,
			18.0,
			1.5,
			10.0,
			35.0,
			280.0,
			22,
			"Boa",
			"pm25",
			null, // linha antiga sem source preenchido
			"2026-10-18 12:30:00",
		);

		// 3. Aplica a migration 0003 que reconstrói a tabela com UNIQUE(station_id, timestamp, source)
		db.exec(
			readFileSync(
				`${DB_DIR}migrations/0003_observed_source_unique.sql`,
				"utf8",
			),
		);

		// 4. Valida integridade absoluta dos dados após a migração
		const rows = db
			.prepare("SELECT * FROM observed_pollutants ORDER BY id")
			.all() as Array<Record<string, unknown>>;
		assert.equal(
			rows.length,
			2,
			"todas as linhas pré-existentes devem ser migradas",
		);
		assert.equal(rows[0].id, "legacy-1");
		assert.equal(rows[0].station_id, "ramqar_camburi");
		assert.equal(rows[0].pm25, 12.5);
		assert.equal(rows[0].source, "open-meteo-cams-forecast");
		assert.equal(rows[0].created_at, "2026-10-18 12:30:00");

		assert.equal(rows[1].id, "legacy-2");
		assert.equal(rows[1].station_id, "ramqar_vitoria_centro");
		assert.equal(rows[1].source, null);

		// 5. Prova que agora podemos inserir linha IEMA na MESMA (station_id, timestamp) sem violar UNIQUE
		const insertNew = db.prepare(`INSERT INTO observed_pollutants
			(id, station_id, timestamp, pm25, pm10, so2, no2, o3, co, iqar_index, iqar_classification, primary_pollutant, source)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

		insertNew.run(
			"iema-new-1",
			"ramqar_camburi",
			"2026-10-18T12:00",
			7.2,
			19.0,
			1.8,
			11.0,
			40.0,
			310.0,
			19,
			"Boa",
			"pm25",
			"IEMA",
		);

		const camburiRows = db
			.prepare(
				"SELECT id, source, pm25 FROM observed_pollutants WHERE station_id = 'ramqar_camburi' AND timestamp = '2026-10-18T12:00' ORDER BY source",
			)
			.all() as Array<Record<string, unknown>>;
		assert.equal(
			camburiRows.length,
			2,
			"CAMS e IEMA coexistem no mesmo par (estação, hora)",
		);
		assert.equal(camburiRows[0].source, "IEMA");
		assert.equal(camburiRows[1].source, "open-meteo-cams-forecast");
	} finally {
		db.close();
	}
});

test("resolução de conflito IEMA: backfill oficial multi-poluente vence o cron instantâneo independentemente da ordem", async () => {
	const local = localD1(createSchema());
	try {
		// Cenário A: Cron roda primeiro (grava linha parcial de 1 poluente), depois Backfill roda
		// 1. Cron grava RGV3 com apenas PM10=25.0 e IQA oficial 16
		const cronRowA = {
			stationId: "ramqar_camburi",
			timestamp: "2026-10-18T17:00",
			pm25: null,
			pm10: 25.0,
			so2: null,
			no2: null,
			o3: null,
			co: null,
			iqarIndex: 16,
			iqarClassification: "Boa",
			primaryPollutant: "pm10",
			source: IEMA_SENTINEL,
		};
		await upsertObservedRows(local.db, [cronRowA], buildIemaMapaUpsert());

		// 2. Backfill roda depois trazendo dados consolidados de múltiplos poluentes
		const backfillRowA = {
			stationId: "ramqar_camburi",
			timestamp: "2026-10-18T17:00",
			pm25: 8.5,
			pm10: 22.0,
			so2: 2.0,
			no2: 12.0,
			o3: 45.0,
			co: 300.0,
			iqarIndex: 22,
			iqarClassification: "Boa",
			primaryPollutant: "pm25",
			source: IEMA_SENTINEL,
		};
		await upsertObservedRows(local.db, [backfillRowA], buildObservedUpsert());

		const afterBackfillA = await local.db
			.prepare(
				"SELECT pm25, pm10, o3, iqar_index, primary_pollutant FROM observed_pollutants WHERE station_id = 'ramqar_camburi' AND timestamp = '2026-10-18T17:00' AND source = 'IEMA'",
			)
			.first<Record<string, unknown>>();
		assert.equal(afterBackfillA?.pm25, 8.5);
		assert.equal(afterBackfillA?.pm10, 22.0);
		assert.equal(afterBackfillA?.o3, 45.0);
		assert.equal(afterBackfillA?.iqar_index, 22);

		// Cenário B: Backfill roda primeiro (grava dados consolidados), depois Cron roda na mesma hora
		// 1. Backfill grava RGV6 consolidado
		const backfillRowB = {
			stationId: "ramqar_ibes",
			timestamp: "2026-10-18T17:00",
			pm25: 9.0,
			pm10: 18.0,
			so2: 1.5,
			no2: 10.0,
			o3: 35.0,
			co: 250.0,
			iqarIndex: 18,
			iqarClassification: "Boa",
			primaryPollutant: "pm25",
			source: IEMA_SENTINEL,
		};
		await upsertObservedRows(local.db, [backfillRowB], buildObservedUpsert());

		// 2. Cron roda na mesma hora com apenas PM2.5 e demais campos nulos
		const cronRowB = {
			stationId: "ramqar_ibes",
			timestamp: "2026-10-18T17:00",
			pm25: 14.0, // leitura instantânea de 1h
			pm10: null,
			so2: null,
			no2: null,
			o3: null,
			co: null,
			iqarIndex: 28,
			iqarClassification: "Boa",
			primaryPollutant: "pm25",
			source: IEMA_SENTINEL,
		};
		await upsertObservedRows(local.db, [cronRowB], buildIemaMapaUpsert());

		// 3. Prova que os campos consolidados do backfill NÃO foram destruídos pelo cron (COALESCE protege)
		const afterCronB = await local.db
			.prepare(
				"SELECT pm25, pm10, so2, o3, iqar_index, primary_pollutant FROM observed_pollutants WHERE station_id = 'ramqar_ibes' AND timestamp = '2026-10-18T17:00' AND source = 'IEMA'",
			)
			.first<Record<string, unknown>>();
		assert.equal(
			afterCronB?.pm25,
			9.0,
			"backfill consolidado vence a leitura instantânea do cron",
		);
		assert.equal(
			afterCronB?.pm10,
			18.0,
			"campos existentes não são sobrescritos com NULL pelo cron",
		);
		assert.equal(afterCronB?.o3, 35.0);
		assert.equal(afterCronB?.iqar_index, 18);
	} finally {
		local.close();
	}
});

test("IEMA_STATION_MAP: mapeia exatamente as 7 estações físicas do v1 e deixa ramqar_paul e ramqar_vila_velha_fundo de fora", () => {
	assert.deepEqual(IEMA_STATION_MAP, {
		1: "ramqar_serra_laranjeiras",
		3: "ramqar_camburi",
		4: "ramqar_enseada_sua",
		5: "ramqar_vitoria_centro",
		6: "ramqar_ibes",
		8: "ramqar_cariacica",
		9: "ramqar_serra_jacupemba",
	});
	const mappedStations = Object.values(IEMA_STATION_MAP);
	assert.equal(mappedStations.length, 7);
	assert.ok(!mappedStations.includes("ramqar_paul" as never));
	assert.ok(!mappedStations.includes("ramqar_vila_velha_fundo" as never));
});

test("iemaDataHoraToUtc: converte BRT (-03:00) para UTC YYYY-MM-DDTHH:00 e rejeita sentinela offline", () => {
	assert.equal(iemaDataHoraToUtc("2026-10-18T16:00:00"), "2026-10-18T19:00");
	// Virada de dia (22:00 BRT → 01:00 UTC do dia seguinte)
	assert.equal(iemaDataHoraToUtc("2026-10-18T22:00:00"), "2026-10-19T01:00");
	// Virada de mês/ano
	assert.equal(iemaDataHoraToUtc("2026-12-31T21:00:00"), "2027-01-01T00:00");
	// Sentinela de estação offline na API IEMA (ex.: RGV2 Carapina)
	assert.equal(iemaDataHoraToUtc("0001-01-01T00:00:00"), null);
	assert.equal(iemaDataHoraToUtc(""), null);
	// F9: Rejeita ano futuro (ex.: ano 2099 ou 2035)
	assert.equal(iemaDataHoraToUtc("2099-01-01T00:00:00", NOW), null);
	assert.equal(iemaDataHoraToUtc("2035-06-15T12:00:00", NOW), null);
});

test("parseIemaPollutant: reconhece nomes, siglas e formato Unicode com subscritos (MP₂,₅ / MP₁₀)", () => {
	assert.equal(parseIemaPollutant("MP₂,₅"), "pm25");
	assert.equal(parseIemaPollutant("Partículas Respiráveis (MP₂,₅)"), "pm25");
	assert.equal(parseIemaPollutant("MP₁₀"), "pm10");
	assert.equal(parseIemaPollutant("Partículas Inaláveis (MP₁₀)"), "pm10");
	assert.equal(parseIemaPollutant("Ozônio"), "o3");
	assert.equal(parseIemaPollutant("Dióxido de Nitrogênio"), "no2");
	assert.equal(parseIemaPollutant("Dióxido de Enxofre"), "so2");
	assert.equal(parseIemaPollutant("Monóxido de Carbono"), "co");
	assert.equal(parseIemaPollutant("invalido"), null);
});

test("iemaRowFromMapa e iemaIqaToUgM3: preserva Iqa oficial no cron, inverte CONAMA no backfill e respeita teto 0..300", () => {
	// Em /api/mapa, Valor já vem em µg/m³ (fator 1.0). Em RGV4 (IdEstacao=4),
	// Valor=10.67 de MP2,5 tem Iqa=28.454 e Faixa="Boa": iemaRowFromMapa DEVE
	// preservar o Iqa oficial do IEMA (arredondado para 28) e Faixa "Boa".
	const row4 = iemaRowFromMapa(IEMA_MAPA_FIXTURE[3], undefined, NOW);
	assert.ok(row4);
	assert.equal(row4.stationId, "ramqar_enseada_sua");
	assert.equal(row4.timestamp, "2026-10-02T13:00");
	assert.equal(row4.pm25, 10.67);
	assert.equal(row4.pm10, null);
	assert.equal(row4.iqarIndex, 28);
	assert.equal(row4.iqarClassification, "Boa");
	assert.equal(row4.primaryPollutant, "pm25");
	assert.equal(row4.source, "IEMA");

	// Item sem Iqa/Faixa oficial: deixa iqarIndex/classification/primary nulos (não deriva de Valor de 1h)
	const rowNoIqa = iemaRowFromMapa(
		{
			IdEstacao: 4,
			DataHora: "2026-10-02T10:00:00",
			Valor: 15.0,
			Poluente: "MP2,5",
			Iqa: null,
			Faixa: null,
		},
		undefined,
		NOW,
	);
	assert.ok(rowNoIqa);
	assert.equal(rowNoIqa.iqarIndex, null);
	assert.equal(rowNoIqa.iqarClassification, null);
	assert.equal(rowNoIqa.primaryPollutant, null);

	// Estação offline (IdEstacao=2) e estação fora do escopo (IdEstacao=11) retornam null
	assert.equal(iemaRowFromMapa(IEMA_MAPA_FIXTURE[1], undefined, NOW), null);
	assert.equal(iemaRowFromMapa(IEMA_MAPA_FIXTURE[8], undefined, NOW), null);

	// Em /api/mapa/{id}, ValorIqa é subíndice Ip: iemaIqaToUgM3 inverte a faixa CONAMA
	// PM2.5 Boa (0..40 → 0..15 µg/m³): Ip=20 → 7.5 µg/m³
	assert.equal(iemaIqaToUgM3("pm25", 20), 7.5);
	// O3 Boa (0..40 → 0..100 µg/m³): Ip=10.03 → 25.07 µg/m³
	assert.equal(iemaIqaToUgM3("o3", 10.03), 25.07);
	// CO Boa (0..40 → 0..10000 µg/m³, fator 250 µg/m³ por ponto de IQA): Ip=1.74 → 435 µg/m³
	assert.equal(iemaIqaToUgM3("co", 1.74), 435);

	// F3: Teto e piso CONAMA 491/2018 (0..300): valores fora desse intervalo devolvem null
	assert.equal(
		iemaIqaToUgM3("pm25", 350),
		null,
		"subíndice > 300 deve devolver null",
	);
	assert.equal(iemaIqaToUgM3("pm25", 301), null);
	assert.equal(
		iemaIqaToUgM3("pm25", -5),
		null,
		"subíndice < 0 deve devolver null",
	);
	assert.equal(
		iemaIqaToUgM3("pm25", 300),
		150,
		"teto 300 mapeia para bpHi 150 µg/m³",
	);
});

test("ingest (cron :30): grava CAMS + 7 estações IEMA de /api/mapa coexistindo na mesma hora", async () => {
	const local = localD1(createSchema());
	try {
		const report = await ingest(
			{ DB: local.db },
			{
				now: NOW,
				fetchImpl: fakeOpenMeteo(WINDOW_HOURS, { iema: IEMA_MAPA_FIXTURE }),
				...SILENT,
			},
		);

		assert.equal(report.failed, 0);
		assert.equal(report.observedRows, 9 * WINDOW_HOURS.length);
		assert.ok(report.iema);
		assert.equal(report.iema.ok, true);
		assert.equal(report.iema.observedRows, 7);

		const bySource = await local.db
			.prepare(
				"SELECT source, COUNT(*) n FROM observed_pollutants GROUP BY source ORDER BY source",
			)
			.all<{ source: string; n: number }>();
		assert.deepEqual(
			bySource.results.map((r) => ({ source: r.source, n: r.n })),
			[
				{ source: "IEMA", n: 7 },
				{ source: CAMPS_FORECAST_SOURCE, n: 27 },
			],
		);

		// ramqar_paul e ramqar_vila_velha_fundo não têm linha IEMA no v1
		const nonPhysical = await local.db
			.prepare(
				"SELECT COUNT(*) n FROM observed_pollutants WHERE source='IEMA' AND station_id IN ('ramqar_paul', 'ramqar_vila_velha_fundo')",
			)
			.first<{ n: number }>();
		assert.equal(nonPhysical?.n, 0);
	} finally {
		local.close();
	}
});

test("ingest (cron :30): falha da API IEMA é isolada e NUNCA derruba a ingestão CAMS", async () => {
	const local = localD1(createSchema());
	const errors: string[] = [];
	try {
		const base = fakeOpenMeteo(WINDOW_HOURS);
		const iemaDown = (async (input: string) => {
			if (String(input).startsWith(IEMA_MAPA_URL)) {
				return new Response("prodest gateway timeout", { status: 504 });
			}
			return base(input);
		}) as unknown as typeof fetch;

		const report = await ingest(
			{ DB: local.db },
			{
				now: NOW,
				fetchImpl: iemaDown,
				log: () => {},
				logError: (m) => errors.push(m),
			},
		);

		assert.equal(
			report.failed,
			0,
			"falha do IEMA não pode contar como falha das estações CAMS",
		);
		assert.equal(report.observedRows, 9 * WINDOW_HOURS.length);
		assert.equal(report.featureRows, 9 * WINDOW_HOURS.length);
		assert.ok(report.iema);
		assert.equal(report.iema.ok, false);
		assert.equal(report.iema.observedRows, 0);
		assert.match(report.iema.error ?? "", /504/);
		assert.match(errors.join("\n"), /IEMA/i);
	} finally {
		local.close();
	}
});

test("parseInsituHours: default 48 e aceita inteiros 1..MAX_INSITU_HOURS (48)", () => {
	assert.equal(MAX_INSITU_HOURS, 48);
	assert.deepEqual(parseInsituHours(null), { ok: true, hours: 48 });
	assert.deepEqual(parseInsituHours(undefined), { ok: true, hours: 48 });
	assert.deepEqual(parseInsituHours("1"), { ok: true, hours: 1 });
	assert.deepEqual(parseInsituHours("24"), { ok: true, hours: 24 });
	assert.deepEqual(parseInsituHours("48"), { ok: true, hours: 48 });
	for (const bad of ["", "0", "-5", "49", "72", "12.5", "abc"]) {
		const res = parseInsituHours(bad);
		assert.equal(
			res.ok,
			false,
			`deveria rejeitar hours=${JSON.stringify(bad)}`,
		);
	}
});

test("ingestInsitu e POST /ingest/insitu?hours=N: faz backfill de 48h por estação via /api/mapa/{id}, aplica horas de corte e valida 405/401/400/502", async () => {
	const local = localD1(createSchema());
	const origFetch = globalThis.fetch;
	const origLog = console.log;
	const origErr = console.error;
	try {
		// 1. 405 para GET/HEAD
		for (const method of ["GET", "HEAD"]) {
			const res = await worker.fetch(
				new Request("https://aetherml-ingestion.local/ingest/insitu", {
					method,
				}),
				{ DB: local.db },
			);
			assert.equal(res.status, 405);
		}

		// 2. 401 quando INGEST_TOKEN está definido e header falta/erra
		const unauth = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest/insitu", {
				method: "POST",
			}),
			{ DB: local.db, INGEST_TOKEN: "tok-123" },
		);
		assert.equal(unauth.status, 401);

		// 3. 400 para hours inválido
		for (const q of ["hours=0", "hours=49", "hours=-1", "hours=abc"]) {
			const bad = await worker.fetch(
				new Request(`https://aetherml-ingestion.local/ingest/insitu?${q}`, {
					method: "POST",
					headers: { "X-Ingest-Token": "tok-123" },
				}),
				{ DB: local.db, INGEST_TOKEN: "tok-123" },
			);
			assert.equal(bad.status, 400);
		}

		// 4. 200 com série de 3 horas nas 7 estações e recorte ?hours=2
		const seriesFixture = [
			{
				Poluente: "Partículas Respiráveis (<2,5µm)",
				PoluenteSigla: "(MP2,5)",
				Estacao: "EMQAr",
				DataHora: [
					"2026-10-02T08:00:00", // 11:00 UTC
					"2026-10-02T09:00:00", // 12:00 UTC
					"2026-10-02T10:00:00", // 13:00 UTC
				],
				ValorIqa: ["20.0", "24.0", "28.0"], // 7.5, 9.0, 10.5 µg/m³
			},
			{
				Poluente: "Ozônio",
				PoluenteSigla: "(O3)",
				Estacao: "EMQAr",
				DataHora: [
					"2026-10-02T08:00:00",
					"2026-10-02T09:00:00",
					"2026-10-02T10:00:00",
				],
				ValorIqa: ["10.0", "12.0", "16.0"], // 25, 30, 40 µg/m³
			},
			{
				Poluente: "Monóxido de Carbono",
				PoluenteSigla: "(CO)",
				Estacao: "EMQAr",
				DataHora: [
					"2026-10-02T08:00:00",
					"2026-10-02T09:00:00",
					"2026-10-02T10:00:00",
				],
				ValorIqa: ["1.6", "1.8", "2.0"], // 400, 450, 500 µg/m³
			},
		];

		const requestedStationUrls: string[] = [];
		globalThis.fetch = (async (input: string) => {
			requestedStationUrls.push(String(input));
			return new Response(JSON.stringify(seriesFixture), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;
		console.log = () => {};
		console.error = () => {};

		const okRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest/insitu?hours=2", {
				method: "POST",
				headers: { "X-Ingest-Token": "tok-123" },
			}),
			{ DB: local.db, INGEST_TOKEN: "tok-123" },
		);
		assert.equal(okRes.status, 200);
		const report = (await okRes.json()) as {
			hours: number;
			observedRows: number;
			failed: number;
			stations: Array<{
				idEstacao: number;
				stationId: string;
				ok: boolean;
				observedRows: number;
			}>;
		};
		assert.equal(report.hours, 2);
		assert.equal(report.failed, 0);
		assert.equal(report.stations.length, 7);
		// Com hours=2, recorta apenas as 2 horas mais recentes (12:00 e 13:00 UTC) × 7 estações = 14 linhas
		assert.equal(report.observedRows, 14);
		assert.equal(requestedStationUrls.length, 7);

		const sample = await local.db
			.prepare(
				"SELECT pm25, o3, co, iqar_index, iqar_classification, primary_pollutant, source FROM observed_pollutants WHERE station_id='ramqar_camburi' AND timestamp='2026-10-02T13:00'",
			)
			.first<Record<string, unknown>>();
		assert.equal(sample?.pm25, 10.5);
		assert.equal(sample?.o3, 40);
		assert.equal(sample?.co, 500);
		assert.equal(sample?.iqar_index, 28);
		assert.equal(sample?.iqar_classification, "Boa");
		assert.equal(sample?.primary_pollutant, "pm25");
		assert.equal(sample?.source, "IEMA");

		// 5. Idempotência: rodar de novo mantém 14 linhas
		await ingestInsitu(
			{ DB: local.db },
			{ hours: 2, fetchImpl: globalThis.fetch, ...SILENT },
		);
		const totalAfter = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants WHERE source='IEMA'")
			.first<{ n: number }>();
		assert.equal(totalAfter?.n, 14);

		// 6. 502 quando todas as 7 estações falham e nenhuma linha é gravada
		globalThis.fetch = (async () =>
			new Response("iema down", { status: 503 })) as unknown as typeof fetch;
		const failRes = await worker.fetch(
			new Request("https://aetherml-ingestion.local/ingest/insitu?hours=48", {
				method: "POST",
				headers: { "X-Ingest-Token": "tok-123" },
			}),
			{ DB: local.db, INGEST_TOKEN: "tok-123" },
		);
		assert.equal(failRes.status, 502);
	} finally {
		globalThis.fetch = origFetch;
		console.log = origLog;
		console.error = origErr;
		local.close();
	}
});
