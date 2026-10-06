// workers/ingestion/test/ingestion.test.ts — TDD do worker de ingestão.
//
// Cobre as partes puras (SQL do upsert, mapeamento CAMS→coluna, recorte da
// janela, idempotência) sem rede: o fetch de `ingest()` é substituído por um
// dublê com o MESMO formato de payload que o Open-Meteo devolve (verificado
// contra a API real em 2026-10-02). A prova com rede de verdade, contra um D1
// local, vive em `live-ingest.test.ts` (opt-in via AETHERML_LIVE=1).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AQ_URL,
	AQ_VARS,
	CAMPS_ANALYSIS_SOURCE,
	CAMPS_FORECAST_SOURCE,
	CAMPS_TO_COLUMN,
	FEATURES_SOURCE,
	IEMA_SENTINEL,
	LOOKBACK_HOURS,
	METEO_URL,
	METEO_VARS,
	buildFeaturesUpsert,
	buildObservedUpsert,
	buildOpenMeteoUrl,
	dayStart,
	featuresRowFrom,
	hourWindow,
	ingest,
	observedRowFrom,
} from "../src/index.ts";
import { createSchema, localD1 } from "./d1-local.ts";

// --- fixtures ---------------------------------------------------------------

const TS = "2026-10-01T14:00";
const ANALYSIS_CUTOFF = "2026-10-02T00:00";
const NOW = new Date("2026-10-02T13:30:00.000Z");
const WINDOW_HOURS = ["2026-10-02T11:00", "2026-10-02T12:00", "2026-10-02T13:00"];

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

/** Dublê de fetch que devolve o envelope do Open-Meteo com `hours` horas. */
function fakeOpenMeteo(
	hours: string[],
	overrides: { aq?: Record<string, unknown>; met?: Record<string, unknown> } = {},
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
		const body = String(input).startsWith(AQ_URL) ? aq : met;
		return new Response(JSON.stringify({ hourly: body }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
}

const SILENT = { log: () => {}, logError: () => {} };

// --- 1. SQL do upsert --------------------------------------------------------

test("buildObservedUpsert: usa ON CONFLICT(station_id, timestamp) — a UNIQUE viva", () => {
	assert.match(
		buildObservedUpsert(),
		/ON CONFLICT\(station_id, timestamp\) DO UPDATE SET/,
		"sem ON CONFLICT o 2º tick horário estoura UNIQUE(station_id, timestamp)",
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
		assert.match(update, new RegExp(`\\b${col} = excluded\\.${col}\\b`), `falta ${col}`);
	}
	assert.doesNotMatch(update, /\bid = excluded\.id\b/, "id é PK: a linha existente preserva");
});

test("buildObservedUpsert: nunca escreve created_at (DEFAULT CURRENT_TIMESTAMP)", () => {
	assert.doesNotMatch(buildObservedUpsert(), /created_at/);
});

test("buildFeaturesUpsert: usa a UNIQUE de 3 colunas de environmental_features", () => {
	const sql = buildFeaturesUpsert();
	assert.match(sql, /ON CONFLICT\(station_id, timestamp, is_forecast\) DO UPDATE SET/);
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
		observedRowFrom("ramqar_camburi", cams({ time: ["2026-10-02T09:00"] }), 0, ANALYSIS_CUTOFF)
			.source,
		CAMPS_FORECAST_SOURCE,
	);
});

test("observedRowFrom: nenhuma fonte escrita é o sentinela IEMA nem NULL", () => {
	for (const ts of ["2026-10-01T14:00", "2026-10-02T09:00"]) {
		const { source } = observedRowFrom("s", cams({ time: [ts] }), 0, ANALYSIS_CUTOFF);
		assert.notEqual(source, IEMA_SENTINEL, "IEMA é reservado p/ estação in-situ oficial");
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
	const row = observedRowFrom("ramqar_camburi", cams({ ozone: [null] }), 0, ANALYSIS_CUTOFF);
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
			i <= 40 ? "Boa" : i <= 80 ? "Moderada" : i <= 120 ? "Ruim" : i <= 200 ? "Muito Ruim" : "Péssima";
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
			report.stations.filter((s) => !s.ok).map((s) => `${s.stationId}: ${s.error}`),
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
		await ingest({ DB: local.db }, { now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT });
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
			.prepare("SELECT DISTINCT station_id FROM observed_pollutants ORDER BY station_id")
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
		const opts = { now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT };
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
			.prepare("SELECT o3, iqar_index, primary_pollutant FROM observed_pollutants WHERE station_id=? AND timestamp=?")
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
		await ingest({ DB: local.db }, { now: NOW, fetchImpl: fakeOpenMeteo(hours), ...SILENT });
		const { results } = await local.db
			.prepare("SELECT DISTINCT timestamp FROM observed_pollutants ORDER BY timestamp")
			.all<{ timestamp: string }>();
		assert.deepEqual(results.map((r) => r.timestamp), WINDOW_HOURS);
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
			{ now: NOW, fetchImpl: failing, log: () => {}, logError: (m) => errors.push(m) },
		);
		const failed = report.stations.filter((s) => !s.ok);
		assert.equal(failed.length, 1);
		assert.equal(failed[0].stationId, "ramqar_cariacica");
		assert.match(errors.join("\n"), /ramqar_cariacica/, "falha tem de ser visível");
		assert.match(errors.join("\n"), /503/, "o status HTTP precisa aparecer no log");

		const distinct = await local.db
			.prepare("SELECT COUNT(DISTINCT station_id) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(distinct?.n, 8, "as 8 estações boas gravaram");
		const broken = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants WHERE station_id='ramqar_cariacica'")
			.first<{ n: number }>();
		assert.equal(broken?.n, 0, "sem fallback fabricationado para a estação que falhou");
	} finally {
		local.close();
	}
});

test("ingest: payload com shape inesperado é reprovado, não coercionado", async () => {
	const local = localD1(createSchema());
	try {
		const malformed = (async () =>
			new Response(JSON.stringify({ hourly: { time: WINDOW_HOURS, pm2_5: "não sou lista" } }), {
				status: 200,
			})) as unknown as typeof fetch;
		const report = await ingest({ DB: local.db }, { now: NOW, fetchImpl: malformed, ...SILENT });
		assert.ok(report.stations.every((s) => !s.ok), "shape inválido tem de reprovar a estação");
		assert.match(report.stations[0].error ?? "", /pm2_5/);
		const written = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(written?.n, 0, "nada pode ser gravado a partir de payload inválido");
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
		const report = await ingest({ DB: local.db }, { now: NOW, fetchImpl: fakeOpenMeteo(WINDOW_HOURS), ...SILENT });
		assert.ok(report.stations.every((s) => !s.ok));
		const partial = await local.db
			.prepare("SELECT COUNT(*) n FROM observed_pollutants")
			.first<{ n: number }>();
		assert.equal(partial?.n, 0, "batch atômico: ou entra a estação inteira, ou nada");
	} finally {
		local.close();
	}
});
