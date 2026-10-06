// workers/ingestion/src/index.ts — Cron :30: ingestão Open-Meteo → observed_pollutants
//
// ---------------------------------------------------------------------------
// O QUE ESTE WORKER GRAVA (leia antes de "simplificar")
// ---------------------------------------------------------------------------
// Open-Meteo CAMS é REANÁLISE/PREVISÃO DE MODELO, NÃO leitura de estação. O
// modelo LightGBM do projeto foi TREINADO contra valores CAMS (ver
// ml/training/fetch_openmeteo.py), portanto gravar CAMS em `observed_pollutants`
// e depois retreinar contra esta tabela seria CIRCULAR. É por isso que o
// pipeline de retreino lê o Open-Meteo direto pelo caminho Python e NÃO lê esta
// tabela. Consequência prática: `source` é SEMPRE explícito e nunca 'IEMA'.
// Migration 0002_observed_source.sql adicionou a coluna justamente anulável e sem
// DEFAULT, para obrigar cada write path a declarar a origem.
//
// O IQAr NÃO é recalculado aqui. `globalIQAr`/`classifyIndex` vêm do pacote
// canônico packages/core-iqar/src/iqar.ts (CONAMA 491/2018). Uma segunda cópia
// divergente da aritmética foi exatamente o que fez o mapa mostrar 17 e o
// dashboard 40.
//
// Sem hedge de fonte: quando o Open-Meteo não traz um valor, a coluna fica NULL
// e o gap é logado. Nunca há número plausível inventado (o worker de inferência
// faz isso quando a sessão falha e é um antipadrão conhecido — não repetir).

// Import relativo, não `@aetherml/core-iqar`: workers/ingestion/package.json não
// declara a dependência de workspace, então `node_modules/@aetherml` não existe
// aqui. Apontar para o ARQUIVO canônico preserva a implementação única; trocar
// por um specifier de pacote sem antes adicionar a dep exigiria copiar as
// fórmulas. Ver "follow-up" no relatório.
import {
	classifyIndex,
	globalIQAr,
	type Pollutant,
} from "../../../packages/core-iqar/src/iqar.ts";

export interface Env {
	DB: D1Database;
}

// --- Contrato com o Open-Meteo (espelha ml/training/fetch_openmeteo.py) -------

export const AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const METEO_URL = "https://api.open-meteo.com/v1/forecast";

/** Mesmos nomes crus que o Python pede. `carbon_monoxide` é a 6ª chave CAMS. */
export const AQ_VARS =
	"pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide";

/** Idêntico a METEO_VARS do Python. */
export const METEO_VARS =
	"temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m," +
	"pressure_msl,shortwave_radiation,boundary_layer_height";

/** Verificado em 2026-10-02: com past_days=1 o payload começa em D-1T00:00. */
export const PAST_DAYS = 1;
/**
 * `forecast_days=0` faz o payload terminar em D-1T23:00 — o dia corrente inteiro
 * vem do ramo de PREVISÃO do CAMS. Sem isto, a tabela não teria a hora corrente.
 */
export const FORECAST_DAYS = 1;

/**
 * IEMA é sentinela reservado a observação oficial in-situ (migration 0002).
 * Nenhum write path deste worker pode emiti-lo.
 */
export const IEMA_SENTINEL = "IEMA";

/** Análise CAMS: hora anterior a `dayStart(now)`. */
export const CAMPS_ANALYSIS_SOURCE = "open-meteo-cams-reanalysis";
/** Previsão CAMS: hora do dia corrente — produto de modelo também, mas não análise. */
export const CAMPS_FORECAST_SOURCE = "open-meteo-cams-forecast";
/** environmental_features: endpoint /v1/forecast (ERA5 no passado, NWP no presente). */
export const FEATURES_SOURCE = "open-meteo-forecast-api";

/** Chave CAMS crua → coluna de observed_pollutants. */
export const CAMPS_TO_COLUMN = {
	pm2_5: "pm25",
	pm10: "pm10",
	ozone: "o3",
	nitrogen_dioxide: "no2",
	sulphur_dioxide: "so2",
	carbon_monoxide: "co",
} as const;

/** Poluentes que entram no IQAr global (CO não entra — ver iqar.ts). */
const IQAR_INPUT: readonly Pollutant[] = ["pm25", "pm10", "o3", "no2", "so2"];

/**
 * Horas cobertas por execução, incluindo a hora corrente. Recobre o tick
 * anterior (o CAMS nem sempre publica a hora fechada no primeiro tick) sem
 * reescrever história a cada hora. Deve caber em `past_days * 24`.
 */
export const LOOKBACK_HOURS = 3;

const HOUR_MS = 3_600_000;

// --- SQL --------------------------------------------------------------------

/**
 * A tabela tem UNIQUE(station_id, timestamp) (índice
 * sqlite_autoindex_observed_pollutants_2). Um INSERT simples estoura no 2º tick
 * horário — daí o ON CONFLICT, que também torna a re-execução idempotente.
 * `id` e `created_at` ficam de fora do DO UPDATE de propósito: `id` é PK e a
 * linha existente precisa preservá-lo; `created_at` tem DEFAULT.
 */
export function buildObservedUpsert(): string {
	const cols = [
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
	];
	return `INSERT INTO observed_pollutants (id, station_id, timestamp, ${cols.join(", ")})
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(station_id, timestamp) DO UPDATE SET
${cols.map((c) => `  ${c} = excluded.${c}`).join(",\n")}`;
}

/** Mesma estratégia para environmental_features, cuja UNIQUE tem 3 colunas. */
export function buildFeaturesUpsert(): string {
	const cols = [
		"temperature",
		"relative_humidity",
		"wind_speed",
		"wind_direction",
		"wind_u",
		"wind_v",
		"boundary_layer_height",
		"surface_pressure",
		"solar_radiation",
		"is_forecast",
		"source",
	];
	return `INSERT INTO environmental_features (id, station_id, timestamp, ${cols.join(", ")})
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(station_id, timestamp, is_forecast) DO UPDATE SET
${cols.map((c) => `  ${c} = excluded.${c}`).join(",\n")}`;
}

// --- Tempo ------------------------------------------------------------------

/** `YYYY-MM-DDTHH:00` em UTC — mesmo formato (e mesma semântica) de `hourly.time`. */
export function hourFloor(now: Date): string {
	return `${now.toISOString().slice(0, 13)}:00`;
}

/** `YYYY-MM-DDT00:00` em UTC. */
export function dayStart(now: Date): string {
	return `${now.toISOString().slice(0, 10)}T00:00`;
}

/** Janela inclusiva de `hours` horas terminando na hora cheia de `now`. */
export function hourWindow(now: Date, hours: number): { from: string; to: string } {
	// Ancorar pelo instante absoluto, nunca por `Date.parse(hourFloor(...))`: uma
	// string sem offset é interpretada como hora LOCAL pelo spec, o que deslocaria
	// a janela em -03 (fuso do Brasil) e gravaria as horas erradas.
	const toMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
	return {
		from: hourFloor(new Date(toMs - (hours - 1) * HOUR_MS)),
		to: hourFloor(new Date(toMs)),
	};
}

// --- Mapeamento -------------------------------------------------------------

type Series = Array<number | null>;
export interface OpenMeteoHourly {
	time: string[];
	[key: string]: Series | string[] | undefined;
}

export interface ObservedRow {
	stationId: string;
	timestamp: string;
	pm25: number | null;
	pm10: number | null;
	so2: number | null;
	no2: number | null;
	o3: number | null;
	co: number | null;
	iqarIndex: number | null;
	iqarClassification: string | null;
	primaryPollutant: string | null;
	source: string;
}

export interface FeaturesRow {
	stationId: string;
	timestamp: string;
	temperature: number | null;
	relativeHumidity: number | null;
	windSpeed: number | null;
	windDirection: number | null;
	windU: number | null;
	windV: number | null;
	boundaryLayerHeight: number | null;
	surfacePressure: number | null;
	solarRadiation: number | null;
	isForecast: 0;
	source: string;
}

/**
 * Só passa número finito. `undefined`, `null`, string e NaN viram NULL — jamais 0,
 * porque 0 é uma concentração plausível (e falsa).
 */
function num(series: Series | string[] | undefined, i: number): number | null {
	if (!Array.isArray(series)) return null;
	const v = (series as Series)[i];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// `Math.round` devolve -0 para valores negativo-zerados — e `cos(90°)` de um vento
// qualquer dá exatamente isso. -0 numa coluna REAL vira "-0.0" no SQLite e quebra
// igualdade estrita (Object.is) de quem ler de volta; normaliza aqui.
const round2 = (v: number) => {
	const r = Math.round(v * 100) / 100;
	return Object.is(r, -0) ? 0 : r;
};

/**
 * Converte uma hora CAMS em linha de observed_pollutants.
 *
 * `analysisCutoff` = `dayStart(now)`: antes dele a hora é reanálise, a partir
 * dele é previsão do mesmo modelo. As duas são rotuladas de forma diferente
 * porque são produtos diferentes — chamá-las as duas de "reanalysis" seria
 * inventar proveniência.
 */
export function observedRowFrom(
	stationId: string,
	hourly: OpenMeteoHourly,
	i: number,
	analysisCutoff: string,
): ObservedRow {
	const timestamp = hourly.time[i];
	const pm25 = num(hourly.pm2_5, i);
	const pm10 = num(hourly.pm10, i);
	const so2 = num(hourly.sulphur_dioxide, i);
	const no2 = num(hourly.nitrogen_dioxide, i);
	const o3 = num(hourly.ozone, i);
	const co = num(hourly.carbon_monoxide, i);

	// IQAr só existe se os 5 poluentes da CONAMA estão presentes. Faltando um, o
	// índice fica NULL: computá-lo com um 0 inventado publicaria "Boa" num dado
	// que não mede poluição.
	const concs = { pm25, pm10, o3, no2, so2 } as Record<Pollutant, number | null>;
	const complete = IQAR_INPUT.every((p) => concs[p] !== null);
	const iqar = complete ? globalIQAr(concs as Record<Pollutant, number>) : null;

	return {
		stationId,
		timestamp,
		pm25,
		pm10,
		so2,
		no2,
		o3,
		co,
		iqarIndex: iqar?.iqar ?? null,
		iqarClassification: iqar ? classifyIndex(iqar.iqar) : null,
		primaryPollutant: iqar?.primary ?? null,
		source: timestamp < analysisCutoff ? CAMPS_ANALYSIS_SOURCE : CAMPS_FORECAST_SOURCE,
	};
}

/**
 * Converte uma hora de meteorologia em linha de environmental_features.
 *
 * `wind_speed` é gravado em m/s (docs/03-pipeline-ml-features.md, feature 2), e
 * o Open-Meteo devolve km/h — mesma conversão de build_real_dataset.py.
 * `traffic_*` e `satellite_*` NÃO são preenchidos: os únicos proxies que existem
 * são as curvas determinísticas do script de treino, que aqui seriam número
 * fabricado sem fonte.
 */
export function featuresRowFrom(
	stationId: string,
	hourly: OpenMeteoHourly,
	i: number,
): FeaturesRow {
	const temperature = num(hourly.temperature_2m, i);
	const relativeHumidity = num(hourly.relative_humidity_2m, i);
	const kmh = num(hourly.wind_speed_10m, i);
	const direction = num(hourly.wind_direction_10m, i);
	const boundaryLayerHeight = num(hourly.boundary_layer_height, i);
	const surfacePressure = num(hourly.pressure_msl, i);
	const radiation = num(hourly.shortwave_radiation, i);

	const windSpeed = kmh === null ? null : round2(kmh / 3.6);
	let windU: number | null = null;
	let windV: number | null = null;
	if (windSpeed !== null && direction !== null) {
		const rad = (direction % 360) * (Math.PI / 180);
		windU = round2(-windSpeed * Math.sin(rad));
		windV = round2(-windSpeed * Math.cos(rad));
	}

	return {
		stationId,
		timestamp: hourly.time[i],
		temperature,
		relativeHumidity,
		windSpeed,
		windDirection: direction === null ? null : direction % 360,
		windU,
		windV,
		boundaryLayerHeight,
		surfacePressure,
		solarRadiation: radiation === null ? null : round2(Math.max(0, radiation)),
		isForecast: 0,
		source: FEATURES_SOURCE,
	};
}

// --- Fetch ------------------------------------------------------------------

export interface Station {
	id: string;
	latitude: number;
	longitude: number;
}

/** Mesma construção de query do Python: latitude, longitude, timezone=UTC, hourly. */
export function buildOpenMeteoUrl(
	base: string,
	hourly: string,
	station: { lat: number; lon: number },
): string {
	const url = new URL(base);
	url.searchParams.set("latitude", String(station.lat));
	url.searchParams.set("longitude", String(station.lon));
	url.searchParams.set("timezone", "UTC");
	url.searchParams.set("hourly", hourly);
	url.searchParams.set("past_days", String(PAST_DAYS));
	url.searchParams.set("forecast_days", String(FORECAST_DAYS));
	return url.toString();
}

/**
 * Valida o envelope do Open-Meteo antes de deixar ele chegar perto do SQL. Um
 * shape inesperado é reportado com o que foi recebido — nunca normalizado à
 * força, porque `pm2_5: "não sou lista"` normalizado vira lixo silencioso.
 */
function readHourly(payload: unknown, vars: string[], label: string): OpenMeteoHourly {
	const hourly = (payload as { hourly?: unknown } | null)?.hourly;
	const time = (hourly as { time?: unknown } | null)?.time;
	if (!Array.isArray(time)) {
		throw new Error(
			`${label}: hourly.time ausente ou não-lista; chaves recebidas = ${JSON.stringify(
				Object.keys((payload as object | null) ?? {}),
			)}`,
		);
	}
	for (const v of vars) {
		const series = (hourly as Record<string, unknown>)[v];
		if (!Array.isArray(series)) {
			throw new Error(
				`${label}: hourly["${v}"] ausente ou não-lista; chaves hourly = ${JSON.stringify(
					Object.keys(hourly as object),
				)}`,
			);
		}
		if (series.length !== time.length) {
			throw new Error(
				`${label}: hourly["${v}"] tem ${series.length} itens, time tem ${time.length}`,
			);
		}
	}
	return hourly as OpenMeteoHourly;
}

async function fetchHourly(
	doFetch: typeof fetch,
	base: string,
	vars: string,
	station: Station,
	label: string,
): Promise<OpenMeteoHourly> {
	const url = buildOpenMeteoUrl(base, vars, { lat: station.latitude, lon: station.longitude });
	const res = await doFetch(url, { headers: { "User-Agent": "AetherML/1.0" } });
	if (!res.ok) {
		// Corpo curto e verbatim: o motivo da recusa do Open-Meteo está nele.
		const body = (await res.text().catch(() => "")).slice(0, 300);
		throw new Error(`${label}: HTTP ${res.status} ${res.statusText} — ${body}`);
	}
	return readHourly(await res.json(), vars.split(","), label);
}

// --- Orquestração -----------------------------------------------------------

export interface IngestOptions {
	/** Injetável para teste determinístico. Default: agora. */
	now?: Date;
	lookbackHours?: number;
	fetchImpl?: typeof fetch;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

export interface StationReport {
	stationId: string;
	ok: boolean;
	observedRows: number;
	featureRows: number;
	error: string | null;
}

export interface IngestReport {
	from: string;
	to: string;
	stations: StationReport[];
	observedRows: number;
	featureRows: number;
	failed: number;
}

async function ingestStation(
	env: Env,
	station: Station,
	window: { from: string; to: string },
	analysisCutoff: string,
	doFetch: typeof fetch,
	logError: (msg: string) => void,
): Promise<StationReport> {
	try {
		const aq = await fetchHourly(
			doFetch,
			AQ_URL,
			AQ_VARS,
			station,
			`${station.id} cams`,
		);
		const met = await fetchHourly(
			doFetch,
			METEO_URL,
			METEO_VARS,
			station,
			`${station.id} meteo`,
		);

		const observed: ObservedRow[] = [];
		for (let i = 0; i < aq.time.length; i++) {
			const ts = aq.time[i];
			if (ts < window.from || ts > window.to) continue;
			observed.push(observedRowFrom(station.id, aq, i, analysisCutoff));
		}

		const features: FeaturesRow[] = [];
		for (let i = 0; i < met.time.length; i++) {
			const ts = met.time[i];
			if (ts < window.from || ts > window.to) continue;
			features.push(featuresRowFrom(station.id, met, i));
		}

		if (observed.length === 0 && features.length === 0) {
			return { stationId: station.id, ok: true, observedRows: 0, featureRows: 0, error: null };
		}

		// `batch` do D1 roda tudo numa transação: ou a estação entra inteira,
		// ou nada. É o que impede uma tabela meio escrita após falha parcial.
		await env.DB.batch([
			...observed.map((r) =>
				env.DB
					.prepare(buildObservedUpsert())
					.bind(
						crypto.randomUUID(),
						r.stationId,
						r.timestamp,
						r.pm25,
						r.pm10,
						r.so2,
						r.no2,
						r.o3,
						r.co,
						r.iqarIndex,
						r.iqarClassification,
						r.primaryPollutant,
						r.source,
					),
			),
			...features.map((r) =>
				env.DB
					.prepare(buildFeaturesUpsert())
					.bind(
						crypto.randomUUID(),
						r.stationId,
						r.timestamp,
						r.temperature,
						r.relativeHumidity,
						r.windSpeed,
						r.windDirection,
						r.windU,
						r.windV,
						r.boundaryLayerHeight,
						r.surfacePressure,
						r.solarRadiation,
						r.isForecast,
						r.source,
					),
			),
		]);

		const gaps = observed.filter((r) => r.iqarIndex === null).length;
		if (gaps > 0) {
			// Gap real do CAMS (série parcial), não um erro: some, mas fica registrado.
			logError(
				`[ingest] ${station.id}: ${gaps}/${observed.length} horas sem IQAr (poluente ausente no payload CAMS); gravadas com iqar_* NULL`,
			);
		}
		return {
			stationId: station.id,
			ok: true,
			observedRows: observed.length,
			featureRows: features.length,
			error: null,
		};
	} catch (err) {
		// Estações são isoladas: uma falha não pode derrubar as outras oito, e
		// nunca pode virar número inventado para tapar o buraco.
		return {
			stationId: station.id,
			ok: false,
			observedRows: 0,
			featureRows: 0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function ingest(env: Env, opts: IngestOptions = {}): Promise<IngestReport> {
	const now = opts.now ?? new Date();
	const window = hourWindow(now, opts.lookbackHours ?? LOOKBACK_HOURS);
	const analysisCutoff = dayStart(now);
	const doFetch = opts.fetchImpl ?? fetch;
	const log = opts.log ?? ((m: string) => console.log(m));
	const logError = opts.logError ?? ((m: string) => console.error(m));

	// As estações vêm do D1, não de uma constante: a lista muda (ativo/inativo,
	// novos pontos) e um id hardcoded escreveria linhas órfãs.
	const { results: stationRows } = await env.DB.prepare(
		"SELECT id, latitude, longitude FROM monitoring_stations WHERE is_active=1 ORDER BY id",
	).all<{ id: string; latitude: number; longitude: number }>();
	const stations: Station[] = stationRows ?? [];

	log(
		`[ingest] janela ${window.from}..${window.to} UTC · ${stations.length} estações ativas · fonte=${CAMPS_ANALYSIS_SOURCE}|${CAMPS_FORECAST_SOURCE}`,
	);

	const perStation = await Promise.all(
		stations.map((s) => ingestStation(env, s, window, analysisCutoff, doFetch, logError)),
	);

	const failed = perStation.filter((s) => !s.ok);
	for (const s of failed) {
		logError(`[ingest] FALHA ${s.stationId}: ${s.error}`);
	}
	const observedRows = perStation.reduce((a, s) => a + s.observedRows, 0);
	const featureRows = perStation.reduce((a, s) => a + s.featureRows, 0);
	log(
		`[ingest] observado_pollutants=${observedRows} environmental_features=${featureRows} falhas=${failed.length}`,
	);

	return {
		from: window.from,
		to: window.to,
		stations: perStation,
		observedRows,
		featureRows,
		failed: failed.length,
	};
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		// Disparo manual para reprocessar uma janela sem esperar o cron.
		const url = new URL(req.url);
		if (url.pathname !== "/ingest") {
			return new Response("ingestion worker — POST /ingest", { status: 404 });
		}
		const report = await ingest(env, {
			log: (m) => console.log(m),
			logError: (m) => console.error(m),
		});
		return new Response(JSON.stringify(report, null, 2), {
			status: report.failed > 0 && report.observedRows === 0 ? 502 : 200,
			headers: { "content-type": "application/json" },
		});
	},
	async scheduled(_event: ScheduledEvent, env: Env) {
		await ingest(env);
	},
};
