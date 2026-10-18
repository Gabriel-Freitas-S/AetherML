// workers/ingestion/src/index.ts — Cron :30: ingestão Open-Meteo + IEMA in-situ → observed_pollutants
//
// ---------------------------------------------------------------------------
// O QUE ESTE WORKER GRAVA (leia antes de "simplificar")
// ---------------------------------------------------------------------------
// Este worker alimenta `observed_pollutants` a partir de DUAS famílias de fonte
// que coexistem na mesma `(station_id, timestamp)` graças a
// `UNIQUE(station_id, timestamp, source)` (migration `0003_observed_source_unique.sql`):
//
// 1. Open-Meteo CAMS (`open-meteo-cams-reanalysis` e `open-meteo-cams-forecast`):
//    REANÁLISE/PREVISÃO DE MODELO (~40 km), NÃO leitura de estação física. Serve
//    como preditor X do MOS e fallback quando a estação física está offline ou
//    não existe (caso de `ramqar_paul` e `ramqar_vila_velha_fundo` no v1).
// 2. PRODEST/IEMA-ES (`source = 'IEMA'`):
//    Observações físicas horárias das 7 estações automáticas da RAMQAr na RGV
//    (`https://qualidadedoarapi.es.gov.br/api/mapa` no cron `:30` e
//    `/api/mapa/{IdEstacao}` no backfill `POST /ingest/insitu?hours=48`).
//
// Pós-BUG-03, o pipeline de retreino (`ml/training/fetch_from_d1.py`,
// `retrain_real --source d1`) LÊ `observed_pollutants` do D1 separando
// explicitamente observações in-situ (`source = 'IEMA'`) de produtos de modelo
// (`open-meteo-cams-*`), e `/api/history` prioriza `'IEMA' > reanalysis > forecast`.
//
// O IQAr NÃO é recalculado manualmente nem copiado do campo `Iqa` da API IEMA.
// `globalIQAr`, `calculateRegulatoryIQAr` e `classifyIndex` vêm do pacote
// canônico `packages/core-iqar/src/iqar.ts` (CONAMA 491/2018). Uma segunda cópia
// divergente da aritmética foi exatamente o que fez o mapa mostrar 17 e o
// dashboard 40.
//
// Sem hedge de fonte: quando a origem não traz um valor, a coluna fica NULL
// e o gap é logado. Nunca há número plausível inventado (o worker de inferência
// faz isso quando a sessão falha e é um antipadrão conhecido — não repetir).

// Import relativo, não `@aetherml/core-iqar`: workers/ingestion/package.json não
// declara a dependência de workspace, então `node_modules/@aetherml` não existe
// aqui. Apontar para o ARQUIVO canônico preserva a implementação única; trocar
// por um specifier de pacote sem antes adicionar a dep exigiria copiar as
// fórmulas. Ver "follow-up" no relatório.
import {
	type Pollutant,
	calculateRegulatoryIQAr,
	classifyIndex,
	globalIQAr,
} from "../../../packages/core-iqar/src/iqar.ts";

export interface Env {
	DB: D1Database;
	/** Token opcional para autenticar `POST /ingest` e `POST /ingest/insitu` via header `X-Ingest-Token`. */
	INGEST_TOKEN?: string;
}

// --- Contrato com o Open-Meteo (espelha ml/training/fetch_openmeteo.py) -------

export const AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const METEO_URL = "https://api.open-meteo.com/v1/forecast";

/** Endpoint público REST JSON da PRODEST/IEMA-ES (sem autenticação). */
export const IEMA_MAPA_URL = "https://qualidadedoarapi.es.gov.br/api/mapa";

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
 * Sentinela oficial para observação física in-situ da rede RAMQAr/IEMA
 * (migration 0002 / 0003). Jamais emitido pelo caminho CAMS (`observedRowFrom`),
 * e emitido exclusivamente pelo caminho IEMA (`iemaRowFromMapa` / `ingestInsitu`).
 */
export const IEMA_SENTINEL = "IEMA";

/** Análise CAMS: hora anterior a `dayStart(now)`. */
export const CAMPS_ANALYSIS_SOURCE = "open-meteo-cams-reanalysis";
/** Previsão CAMS: hora do dia corrente — produto de modelo também, mas não análise. */
export const CAMPS_FORECAST_SOURCE = "open-meteo-cams-forecast";
/** environmental_features: endpoint /v1/forecast (ERA5 no passado, NWP no presente). */
export const FEATURES_SOURCE = "open-meteo-forecast-api";

/**
 * Mapeamento canônico `IdEstacao` (API PRODEST/IEMA) ↔ `station_id` (`monitoring_stations`).
 * Referência: `docs/research/fontes-insitu.md §4` (Mapa de estações RAMQAr ↔ AetherML).
 *
 * Escopo v1 = 7 estações com sensor físico ativo na RGV:
 * - `IdEstacao = 2` (EMQAr - RGV2 Carapina) está desativada no IEMA (`0001-01-01T00:00:00`) e fora do seed.
 * - `IdEstacao = 11..16` (SUL 1..4 Anchieta/Meaípe e NORTE 1..2 Linhares) ficam fora da RGV.
 * - TODO(IDW): `ramqar_paul` (Vila Velha - Paul) e `ramqar_vila_velha_fundo` (Vila Velha - Centro)
 *   NÃO possuem estação física ativa na API da PRODEST/IEMA (as antigas RGV7 Paul e RGV9 VV-Centro
 *   foram descontinuadas na telemetria automática; ver `docs/research/fontes-insitu.md §4.2`).
 *   No v1 elas permanecem sem linhas `source='IEMA'` (atendidas por CAMS); a interpolação espacial
 *   IDW a partir de RGV4/RGV5/RGV6 entrará numa fase seguinte conforme definição de ML/mapa.
 */
export const IEMA_STATION_MAP: Readonly<Record<number, string>> = {
	1: "ramqar_serra_laranjeiras", // EMQAr - RGV1 (Laranjeiras)
	3: "ramqar_camburi", // EMQAr - RGV3 (Jardim Camburi)
	4: "ramqar_enseada_sua", // EMQAr - RGV4 (Enseada do Suá)
	5: "ramqar_vitoria_centro", // EMQAr - RGV5 (Vitória - Centro)
	6: "ramqar_ibes", // EMQAr - RGV6 (Ibes)
	8: "ramqar_cariacica", // EMQAr - RGV8 (Cariacica)
	9: "ramqar_serra_jacupemba", // EMQAr - RGV10 (Cid. Continental; mapeada em ramqar_serra_jacupemba conforme doc §4.1)
} as const;

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

/** Limite superior de dias para backfill manual via `POST /ingest?days=N`. */
export const MAX_BACKFILL_DAYS = 30;

/** Limite superior de horas para backfill in-situ via `POST /ingest/insitu?hours=N` (janela da API IEMA = 48h). */
export const MAX_INSITU_HOURS = 48;

const HOUR_MS = 3_600_000;

// --- SQL --------------------------------------------------------------------

/**
 * A tabela tem UNIQUE(station_id, timestamp, source) (migration 0003).
 * Isso permite que CAMS (`open-meteo-cams-*`) e observação física (`IEMA`)
 * coexistam na mesma hora sem sobrescrita mútua, enquanto re-execuções da
 * MESMA fonte continuam idempotentes via `ON CONFLICT(station_id, timestamp, source)`.
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
ON CONFLICT(station_id, timestamp, source) DO UPDATE SET
${cols.map((c) => `  ${c} = excluded.${c}`).join(",\n")}`;
}

/**
 * Upsert para a ingestão horária do cron (/api/mapa).
 * Como /api/mapa reporta apenas o poluente crítico da estação (deixando os demais como NULL),
 * a cláusula DO UPDATE usa COALESCE para NUNCA sobrescrever valores pré-existentes de um
 * backfill multi-poluente consolidado (/api/mapa/{id}). Assim, o dado oficial consolidado
 * sempre vence o instantâneo do cron, independentemente da ordem de execução.
 */
export function buildIemaMapaUpsert(): string {
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
ON CONFLICT(station_id, timestamp, source) DO UPDATE SET
${cols.map((c) => `  ${c} = COALESCE(observed_pollutants.${c}, excluded.${c})`).join(",\n")}`;
}

/** Prepara um statement de inserção/upsert para uma `ObservedRow`. */
export function prepareObservedStatement(
	db: D1Database,
	r: ObservedRow,
	sql: string = buildObservedUpsert(),
): D1PreparedStatement {
	return db
		.prepare(sql)
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
		);
}

/**
 * Executa o batch de upsert de `ObservedRow` no D1 com o SQL especificado (default: `buildObservedUpsert()`).
 */
export async function upsertObservedRows(
	db: D1Database,
	rows: ObservedRow[],
	sql: string = buildObservedUpsert(),
): Promise<void> {
	if (rows.length === 0) return;
	await db.batch(rows.map((r) => prepareObservedStatement(db, r, sql)));
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
export function hourWindow(
	now: Date,
	hours: number,
): { from: string; to: string } {
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
	const concs = { pm25, pm10, o3, no2, so2 } as Record<
		Pollutant,
		number | null
	>;
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
		source:
			timestamp < analysisCutoff
				? CAMPS_ANALYSIS_SOURCE
				: CAMPS_FORECAST_SOURCE,
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

// --- Mapeamento e Unidades PRODEST/IEMA-ES ----------------------------------
//
// Auditoria de unidades (`docs/research/fontes-insitu.md §3` + `qualidadeArES.js`
// + `iema_ramqar_2026_horaria_sample.csv`):
// 1. Em `GET /api/mapa`, o campo `Valor` já é a concentração horária em **µg/m³**
//    (fator = `1.0`) para todos os poluentes reportados, inclusive CO (a tabela
//    oficial do portal IEMA em `qualidadeArES.js` e as planilhas RAMQAr 2026
//    usam `CO (µg/m³)` com faixa Boa `0–40 IQA = 0–10.000 µg/m³`, mesma unidade
//    de `carbon_monoxide` do Open-Meteo CAMS).
// 2. Em `GET /api/mapa/{IdEstacao}` (série 48h), a API pública não expõe `Valor`
//    cru, apenas `ValorIqa` (string com o subíndice CONAMA 491/2018 $I_p$ em
//    ponto flutuante, p.ex. `"17.54"`). Para reconstruir a concentração em
//    `µg/m³` sem perda nas faixas lineares por partes da CONAMA 491/2018,
//    `iemaIqaToUgM3` aplica a inversa exata `Bp_lo + ((Ip - I_lo)/(I_hi - I_lo)) * (Bp_hi - Bp_lo)`
//    usando os breakpoints de `packages/core-iqar/src/iqar.ts` para `pm25, pm10, o3, no2, so2`
//    e os breakpoints em `µg/m³` da tabela oficial IEMA para `co` (fator `250 µg/m³`
//    por ponto de IQA na faixa Boa `0..40`, onde `9 ppm ≈ 10 mg/m³ = 10.000 µg/m³`).

export type IemaPollutantColumn = Pollutant | "co";

interface IqaBand {
	iLo: number;
	iHi: number;
	bpLo: number;
	bpHi: number;
}

const IEMA_CONAMA_BANDS_UG_M3: Record<IemaPollutantColumn, readonly IqaBand[]> =
	{
		pm25: [
			{ iLo: 0, iHi: 40, bpLo: 0, bpHi: 15 },
			{ iLo: 41, iHi: 80, bpLo: 15, bpHi: 25 },
			{ iLo: 81, iHi: 120, bpLo: 25, bpHi: 50 },
			{ iLo: 121, iHi: 200, bpLo: 50, bpHi: 75 },
			{ iLo: 201, iHi: 300, bpLo: 75, bpHi: 150 },
		],
		pm10: [
			{ iLo: 0, iHi: 40, bpLo: 0, bpHi: 50 },
			{ iLo: 41, iHi: 80, bpLo: 50, bpHi: 100 },
			{ iLo: 81, iHi: 120, bpLo: 100, bpHi: 150 },
			{ iLo: 121, iHi: 200, bpLo: 150, bpHi: 250 },
			{ iLo: 201, iHi: 300, bpLo: 250, bpHi: 500 },
		],
		o3: [
			{ iLo: 0, iHi: 40, bpLo: 0, bpHi: 100 },
			{ iLo: 41, iHi: 80, bpLo: 100, bpHi: 130 },
			{ iLo: 81, iHi: 120, bpLo: 130, bpHi: 160 },
			{ iLo: 121, iHi: 200, bpLo: 160, bpHi: 200 },
			{ iLo: 201, iHi: 300, bpLo: 200, bpHi: 400 },
		],
		no2: [
			{ iLo: 0, iHi: 40, bpLo: 0, bpHi: 200 },
			{ iLo: 41, iHi: 80, bpLo: 200, bpHi: 240 },
			{ iLo: 81, iHi: 120, bpLo: 240, bpHi: 320 },
			{ iLo: 121, iHi: 200, bpLo: 320, bpHi: 1130 },
			{ iLo: 201, iHi: 300, bpLo: 1130, bpHi: 2260 },
		],
		so2: [
			{ iLo: 0, iHi: 40, bpLo: 0, bpHi: 20 },
			{ iLo: 41, iHi: 80, bpLo: 20, bpHi: 40 },
			{ iLo: 81, iHi: 120, bpLo: 40, bpHi: 365 },
			{ iLo: 121, iHi: 200, bpLo: 365, bpHi: 800 },
			{ iLo: 201, iHi: 300, bpLo: 800, bpHi: 1600 },
		],
		co: [
			{ iLo: 0, iHi: 40, bpLo: 0, bpHi: 10_000 },
			{ iLo: 41, iHi: 80, bpLo: 10_000, bpHi: 13_000 },
			{ iLo: 81, iHi: 120, bpLo: 13_000, bpHi: 15_000 },
			{ iLo: 121, iHi: 200, bpLo: 15_000, bpHi: 17_000 },
			{ iLo: 201, iHi: 300, bpLo: 17_000, bpHi: 34_000 },
		],
	};

/**
 * Converte `DataHora` da API PRODEST/IEMA (`"YYYY-MM-DDTHH:MM:SS"` em horário
 * local BRT, `America/Sao_Paulo = UTC-03:00`, sem sufixo de fuso) para o formato
 * canônico UTC `"YYYY-MM-DDTHH:00"` de `observed_pollutants`.
 * Devolve `null` para sentinelas de estação desativada (`"0001-01-01T00:00:00"`)
 * ou timestamps projetados no futuro além de 2 horas.
 */
export function iemaDataHoraToUtc(
	raw: string | null | undefined,
	now: Date = new Date(),
): string | null {
	if (typeof raw !== "string") return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
		raw.trim(),
	);
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const hour = Number(m[4]);
	const maxYear = now.getFullYear() + 1;
	if (year < 2000 || year > maxYear) return null; // ignora "0001-01-01" e rejeita ano futuro (ex.: 2099)
	// BRT é UTC-3 fixo (Brasil sem horário de verão): somar 3 horas obtém UTC.
	const utcMs = Date.UTC(year, month - 1, day, hour + 3, 0, 0);
	if (!Number.isFinite(utcMs)) return null;
	return hourFloor(new Date(utcMs));
}

/** Traduz nome ou sigla de poluente da API IEMA para coluna de `observed_pollutants`. */
export function parseIemaPollutant(
	rawNameOrSigla: string | null | undefined,
): IemaPollutantColumn | null {
	if (typeof rawNameOrSigla !== "string") return null;
	// Normaliza decomposição Unicode NFKD (converte subscritos MP₂,₅ / MP₁₀) e remove diacríticos
	const s = rawNameOrSigla
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "");
	if (s.includes("2,5") || s.includes("2.5") || s.includes("mp2")) {
		return "pm25";
	}
	if (s.includes("10") || s.includes("mp10")) {
		return "pm10";
	}
	if (s.includes("ozonio") || s.includes("(o3)") || s.includes("o3")) {
		return "o3";
	}
	if (s.includes("nitrogenio") || s.includes("no2")) {
		return "no2";
	}
	if (s.includes("enxofre") || s.includes("so2")) {
		return "so2";
	}
	if (s.includes("monoxido") || s.includes("(co)") || s.includes("co")) {
		return "co";
	}
	return null;
}

/**
 * Inverte o subíndice `ValorIqa` de `/api/mapa/{IdEstacao}` para concentração
 * em `µg/m³` segundo as faixas lineares por partes da CONAMA 491/2018.
 * Rejeita valores negativos ou acima do teto normativo de 300.
 */
export function iemaIqaToUgM3(
	pollutant: IemaPollutantColumn,
	valorIqa: number,
): number | null {
	if (
		typeof valorIqa !== "number" ||
		!Number.isFinite(valorIqa) ||
		valorIqa < 0 ||
		valorIqa > 300
	) {
		return null;
	}
	const bands = IEMA_CONAMA_BANDS_UG_M3[pollutant];
	const b =
		bands.find((band) => valorIqa <= band.iHi) ?? bands[bands.length - 1];
	const iLo = b.iLo === 0 ? 0 : b.iLo - 1; // continuidade com subíndice decimal da API IEMA (ex.: 40.4)
	const conc = b.bpLo + ((valorIqa - iLo) / (b.iHi - iLo)) * (b.bpHi - b.bpLo);
	return round2(Math.max(0, conc));
}

export interface IemaMapaItem {
	IdEstacao?: unknown;
	DataHora?: unknown;
	Valor?: unknown;
	Poluente?: unknown;
	Iqa?: unknown;
	Faixa?: unknown;
}

/**
 * Constrói uma `ObservedRow` (`source = 'IEMA'`) a partir de um item de `GET /api/mapa`.
 * `Valor` em `/api/mapa` reporta a concentração instantânea (em µg/m³, fator 1.0) do poluente
 * crítico da estação.
 *
 * Semântica física e conformidade CONAMA 491:
 * `calculateRegulatoryIQAr` exige médias móveis (24h p/ PM, 8h p/ O3/CO), não leituras
 * instantâneas de 1 hora. Nunca derivamos um falso IQAr regulatório a partir do `Valor` de 1h.
 * Em vez disso, preservamos o `Iqa` e a `Faixa` OFICIAIS já computados e publicados pelo IEMA
 * no payload (ou deixamos NULL caso ausentes/inválidos).
 */
export function iemaRowFromMapa(
	item: IemaMapaItem,
	activeStationIds?: ReadonlySet<string>,
	now: Date = new Date(),
): ObservedRow | null {
	const idEstacao =
		typeof item?.IdEstacao === "number" ? item.IdEstacao : Number.NaN;
	const stationId = IEMA_STATION_MAP[idEstacao];
	if (!stationId) return null;
	if (activeStationIds && !activeStationIds.has(stationId)) return null;

	const timestamp = iemaDataHoraToUtc(
		typeof item.DataHora === "string" ? item.DataHora : null,
		now,
	);
	if (!timestamp) return null;

	const col = parseIemaPollutant(
		typeof item.Poluente === "string" ? item.Poluente : null,
	);
	if (!col) return null;

	const rawVal = typeof item.Valor === "number" ? item.Valor : Number.NaN;
	if (!Number.isFinite(rawVal) || rawVal < 0) return null;
	const valUgM3 = round2(rawVal); // fator 1.0: /api/mapa já reporta µg/m³

	const officialIqa =
		typeof item.Iqa === "number" && Number.isFinite(item.Iqa) && item.Iqa >= 0
			? Math.round(item.Iqa)
			: null;
	const officialFaixa =
		typeof item.Faixa === "string" && item.Faixa.trim().length > 0
			? item.Faixa.trim()
			: null;

	return {
		stationId,
		timestamp,
		pm25: col === "pm25" ? valUgM3 : null,
		pm10: col === "pm10" ? valUgM3 : null,
		so2: col === "so2" ? valUgM3 : null,
		no2: col === "no2" ? valUgM3 : null,
		o3: col === "o3" ? valUgM3 : null,
		co: col === "co" ? valUgM3 : null,
		iqarIndex: officialIqa,
		iqarClassification: officialFaixa,
		primaryPollutant: officialIqa !== null ? col : null,
		source: IEMA_SENTINEL,
	};
}

// --- Fetch ------------------------------------------------------------------

export interface Station {
	id: string;
	latitude: number;
	longitude: number;
}

export interface OpenMeteoUrlOptions {
	pastDays?: number;
	forecastDays?: number;
}

/** Mesma construção de query do Python: latitude, longitude, timezone=UTC, hourly. */
export function buildOpenMeteoUrl(
	base: string,
	hourly: string,
	station: { lat: number; lon: number },
	opts: OpenMeteoUrlOptions = {},
): string {
	const pastDays = opts.pastDays ?? PAST_DAYS;
	const forecastDays = opts.forecastDays ?? FORECAST_DAYS;
	const url = new URL(base);
	url.searchParams.set("latitude", String(station.lat));
	url.searchParams.set("longitude", String(station.lon));
	url.searchParams.set("timezone", "UTC");
	url.searchParams.set("hourly", hourly);
	url.searchParams.set("past_days", String(pastDays));
	url.searchParams.set("forecast_days", String(forecastDays));
	return url.toString();
}

export type BackfillDaysParseResult =
	| { ok: true; days: number | undefined }
	| { ok: false; error: string };

/**
 * Valida o parâmetro `?days=N` do disparo manual (`POST /ingest?days=N`).
 * Ausente (`null`/`undefined`) mantém o modo horário padrão (`LOOKBACK_HOURS`).
 */
export function parseBackfillDays(
	raw: string | null | undefined,
): BackfillDaysParseResult {
	if (raw === null || raw === undefined) {
		return { ok: true, days: undefined };
	}
	if (!/^\d+$/.test(raw)) {
		return {
			ok: false,
			error: `Parâmetro 'days' inválido (${JSON.stringify(raw)}): deve ser inteiro entre 1 e ${MAX_BACKFILL_DAYS}.`,
		};
	}
	const days = Number(raw);
	if (!Number.isInteger(days) || days < 1 || days > MAX_BACKFILL_DAYS) {
		return {
			ok: false,
			error: `Parâmetro 'days' fora do limite (${days}): permitido entre 1 e ${MAX_BACKFILL_DAYS}.`,
		};
	}
	return { ok: true, days };
}

export type InsituHoursParseResult =
	| { ok: true; hours: number }
	| { ok: false; error: string };

/**
 * Valida o parâmetro `?hours=N` do backfill in-situ (`POST /ingest/insitu?hours=N`).
 * Ausente (`null`/`undefined`) usa o default `48` (janela completa de `/api/mapa/{id}`).
 */
export function parseInsituHours(
	raw: string | null | undefined,
): InsituHoursParseResult {
	if (raw === null || raw === undefined) {
		return { ok: true, hours: MAX_INSITU_HOURS };
	}
	if (!/^\d+$/.test(raw)) {
		return {
			ok: false,
			error: `Parâmetro 'hours' inválido (${JSON.stringify(raw)}): deve ser inteiro entre 1 e ${MAX_INSITU_HOURS}.`,
		};
	}
	const hours = Number(raw);
	if (!Number.isInteger(hours) || hours < 1 || hours > MAX_INSITU_HOURS) {
		return {
			ok: false,
			error: `Parâmetro 'hours' fora do limite (${hours}): permitido entre 1 e ${MAX_INSITU_HOURS}.`,
		};
	}
	return { ok: true, hours };
}

/**
 * Valida o envelope do Open-Meteo antes de deixar ele chegar perto do SQL. Um
 * shape inesperado é reportado com o que foi recebido — nunca normalizado à
 * força, porque `pm2_5: "não sou lista"` normalizado vira lixo silencioso.
 */
function readHourly(
	payload: unknown,
	vars: string[],
	label: string,
): OpenMeteoHourly {
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
	urlOpts: OpenMeteoUrlOptions = {},
): Promise<OpenMeteoHourly> {
	const url = buildOpenMeteoUrl(
		base,
		vars,
		{ lat: station.latitude, lon: station.longitude },
		urlOpts,
	);
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
	/** Backfill manual em dias (1..MAX_BACKFILL_DAYS): ajusta past_days=days e lookbackHours=days*24. */
	days?: number;
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

export interface IemaMapaReport {
	ok: boolean;
	observedRows: number;
	skipped: number;
	error: string | null;
}

export interface IngestReport {
	from: string;
	to: string;
	stations: StationReport[];
	observedRows: number;
	featureRows: number;
	failed: number;
	iema?: IemaMapaReport;
}

async function ingestStation(
	env: Env,
	station: Station,
	window: { from: string; to: string },
	analysisCutoff: string,
	doFetch: typeof fetch,
	logError: (msg: string) => void,
	urlOpts: OpenMeteoUrlOptions,
): Promise<StationReport> {
	try {
		const aq = await fetchHourly(
			doFetch,
			AQ_URL,
			AQ_VARS,
			station,
			`${station.id} cams`,
			urlOpts,
		);
		const met = await fetchHourly(
			doFetch,
			METEO_URL,
			METEO_VARS,
			station,
			`${station.id} meteo`,
			urlOpts,
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
			return {
				stationId: station.id,
				ok: true,
				observedRows: 0,
				featureRows: 0,
				error: null,
			};
		}

		// `batch` do D1 roda tudo numa transação: ou a estação entra inteira,
		// ou nada. É o que impede uma tabela meio escrita após falha parcial.
		await env.DB.batch([
			...observed.map((r) => prepareObservedStatement(env.DB, r)),
			...features.map((r) =>
				env.DB.prepare(buildFeaturesUpsert()).bind(
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

/**
 * Busca `GET /api/mapa` na API da PRODEST/IEMA e grava as observações correntes
 * com `source = 'IEMA'`. Qualquer falha de rede, HTTP ou payload é capturada e
 * isolada aqui para NUNCA derrubar a ingestão CAMS do cron `:30`.
 */
export async function ingestIemaMapa(
	env: Env,
	activeStationIds: ReadonlySet<string>,
	doFetch: typeof fetch,
	log: (msg: string) => void,
	logError: (msg: string) => void,
	now: Date = new Date(),
): Promise<IemaMapaReport> {
	try {
		const res = await doFetch(IEMA_MAPA_URL, {
			headers: { "User-Agent": "AetherML/1.0" },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) {
			const body = (await res.text().catch(() => "")).slice(0, 300);
			throw new Error(
				`IEMA /api/mapa: HTTP ${res.status} ${res.statusText} — ${body}`,
			);
		}
		const payload: unknown = await res.json();
		if (!Array.isArray(payload)) {
			throw new Error("IEMA /api/mapa: payload não é um array JSON");
		}
		const rows: ObservedRow[] = [];
		let skipped = 0;
		for (const item of payload) {
			const row = iemaRowFromMapa(item as IemaMapaItem, activeStationIds, now);
			if (row) {
				rows.push(row);
			} else {
				skipped++;
			}
		}
		if (rows.length > 0) {
			await upsertObservedRows(env.DB, rows, buildIemaMapaUpsert());
		}
		log(
			`[ingest:iema] /api/mapa observed_pollutants=${rows.length} ignoradas=${skipped} fonte=${IEMA_SENTINEL}`,
		);
		return {
			ok: true,
			observedRows: rows.length,
			skipped,
			error: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logError(`[ingest:iema] FALHA isolada em /api/mapa: ${message}`);
		return {
			ok: false,
			observedRows: 0,
			skipped: 0,
			error: message,
		};
	}
}

export interface InsituStationReport {
	idEstacao: number;
	stationId: string;
	ok: boolean;
	observedRows: number;
	error: string | null;
}

export interface InsituIngestReport {
	hours: number;
	stations: InsituStationReport[];
	observedRows: number;
	failed: number;
}

export interface InsituIngestOptions {
	hours?: number;
	fetchImpl?: typeof fetch;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
	now?: Date;
}

interface IemaStationSeriesItem {
	Poluente?: unknown;
	PoluenteSigla?: unknown;
	DataHora?: unknown;
	ValorIqa?: unknown;
}

/**
 * Converte o payload de `GET /api/mapa/{IdEstacao}` (série 48h por poluente) em
 * linhas horárias consolidadas por `timestamp` UTC (`source = 'IEMA'`), recortando
 * as `hours` horas mais recentes presentes na estação.
 * `ValorIqa` representa os subíndices regulatórios das médias móveis CONAMA calculadas
 * pelo IEMA; `iemaIqaToUgM3` inverte-os para concentrações equivalentes em µg/m³.
 */
export function iemaRowsFromStationSeries(
	stationId: string,
	payload: unknown,
	hours: number,
	now: Date = new Date(),
): ObservedRow[] {
	if (!Array.isArray(payload)) {
		throw new Error(`${stationId} iema-48h: payload não é uma lista`);
	}
	const byTimestamp = new Map<
		string,
		Partial<Record<IemaPollutantColumn, number>>
	>();

	for (const entry of payload as IemaStationSeriesItem[]) {
		const col =
			parseIemaPollutant(
				typeof entry?.PoluenteSigla === "string" ? entry.PoluenteSigla : null,
			) ??
			parseIemaPollutant(
				typeof entry?.Poluente === "string" ? entry.Poluente : null,
			);
		if (!col) continue;

		const times = entry?.DataHora;
		const iqaValues = entry?.ValorIqa;
		if (!Array.isArray(times) || !Array.isArray(iqaValues)) continue;

		const len = Math.min(times.length, iqaValues.length);
		for (let i = 0; i < len; i++) {
			const ts = iemaDataHoraToUtc(
				typeof times[i] === "string" ? times[i] : null,
				now,
			);
			if (!ts) continue;
			const rawNum = Number(iqaValues[i]);
			if (!Number.isFinite(rawNum) || rawNum < 0) continue;
			const ugM3 = iemaIqaToUgM3(col, rawNum);
			if (ugM3 === null) continue;

			const bucket = byTimestamp.get(ts) ?? {};
			bucket[col] = ugM3;
			byTimestamp.set(ts, bucket);
		}
	}

	const sortedTimestamps = Array.from(byTimestamp.keys()).sort();
	const selectedTimestamps = sortedTimestamps.slice(-hours);

	return selectedTimestamps.map((timestamp) => {
		const bucket = byTimestamp.get(timestamp) ?? {};
		const pm25 = bucket.pm25 ?? null;
		const pm10 = bucket.pm10 ?? null;
		const so2 = bucket.so2 ?? null;
		const no2 = bucket.no2 ?? null;
		const o3 = bucket.o3 ?? null;
		const co = bucket.co ?? null;

		const reg = calculateRegulatoryIQAr({ pm25, pm10, o3, no2, so2 });
		return {
			stationId,
			timestamp,
			pm25,
			pm10,
			so2,
			no2,
			o3,
			co,
			iqarIndex: reg?.iqar ?? null,
			iqarClassification: reg?.classification ?? null,
			primaryPollutant: reg?.primary ?? null,
			source: IEMA_SENTINEL,
		};
	});
}

/**
 * Backfill in-situ de até 48h via `GET /api/mapa/{IdEstacao}` para as 7 estações
 * físicas mapeadas em `IEMA_STATION_MAP`.
 */
export async function ingestInsitu(
	env: Env,
	opts: InsituIngestOptions = {},
): Promise<InsituIngestReport> {
	const hours = opts.hours ?? MAX_INSITU_HOURS;
	if (!Number.isInteger(hours) || hours < 1 || hours > MAX_INSITU_HOURS) {
		throw new Error(
			`Parâmetro 'hours' inválido (${hours}): deve ser inteiro entre 1 e ${MAX_INSITU_HOURS}.`,
		);
	}
	const doFetch = opts.fetchImpl ?? fetch;
	const log = opts.log ?? ((m: string) => console.log(m));
	const logError = opts.logError ?? ((m: string) => console.error(m));

	const { results: stationRows } = await env.DB.prepare(
		"SELECT id FROM monitoring_stations WHERE is_active=1",
	).all<{ id: string }>();
	const activeIds = new Set((stationRows ?? []).map((r) => r.id));

	const entries = Object.entries(IEMA_STATION_MAP)
		.map(([idStr, stationId]) => ({
			idEstacao: Number(idStr),
			stationId,
		}))
		.filter((e) => activeIds.has(e.stationId));

	const stationReports = await Promise.all(
		entries.map(
			async ({ idEstacao, stationId }): Promise<InsituStationReport> => {
				try {
					const url = `${IEMA_MAPA_URL}/${idEstacao}`;
					const res = await doFetch(url, {
						headers: { "User-Agent": "AetherML/1.0" },
						signal: AbortSignal.timeout(5000),
					});
					if (!res.ok) {
						const body = (await res.text().catch(() => "")).slice(0, 300);
						throw new Error(
							`${stationId} (/api/mapa/${idEstacao}): HTTP ${res.status} ${res.statusText} — ${body}`,
						);
					}
					const payload: unknown = await res.json();
					const rows = iemaRowsFromStationSeries(
						stationId,
						payload,
						hours,
						opts.now ?? new Date(),
					);
					if (rows.length > 0) {
						await upsertObservedRows(env.DB, rows, buildObservedUpsert());
					}
					return {
						idEstacao,
						stationId,
						ok: true,
						observedRows: rows.length,
						error: null,
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					logError(
						`[ingest:insitu] FALHA ${stationId} (id=${idEstacao}): ${msg}`,
					);
					return {
						idEstacao,
						stationId,
						ok: false,
						observedRows: 0,
						error: msg,
					};
				}
			},
		),
	);

	const failed = stationReports.filter((s) => !s.ok).length;
	const observedRows = stationReports.reduce((a, s) => a + s.observedRows, 0);
	log(
		`[ingest:insitu] hours=${hours} observed_pollutants=${observedRows} falhas=${failed}`,
	);
	return {
		hours,
		stations: stationReports,
		observedRows,
		failed,
	};
}

export async function ingest(
	env: Env,
	opts: IngestOptions = {},
): Promise<IngestReport> {
	if (opts.days !== undefined) {
		if (
			!Number.isInteger(opts.days) ||
			opts.days < 1 ||
			opts.days > MAX_BACKFILL_DAYS
		) {
			throw new Error(
				`Parâmetro 'days' inválido (${opts.days}): deve ser inteiro entre 1 e ${MAX_BACKFILL_DAYS}.`,
			);
		}
	}
	const now = opts.now ?? new Date();
	const pastDays = opts.days ?? PAST_DAYS;
	const forecastDays = FORECAST_DAYS;
	const lookbackHours =
		opts.lookbackHours ??
		(opts.days !== undefined ? opts.days * 24 : LOOKBACK_HOURS);
	const window = hourWindow(now, lookbackHours);
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
		`[ingest] janela ${window.from}..${window.to} UTC · past_days=${pastDays} · ${stations.length} estações ativas · fonte=${CAMPS_ANALYSIS_SOURCE}|${CAMPS_FORECAST_SOURCE}`,
	);

	const perStation = await Promise.all(
		stations.map((s) =>
			ingestStation(env, s, window, analysisCutoff, doFetch, logError, {
				pastDays,
				forecastDays,
			}),
		),
	);

	// No cron horário (:30, sem `opts.days`), busca também GET /api/mapa da PRODEST/IEMA
	// com isolamento total de falha (nunca derruba CAMS).
	let iema: IemaMapaReport | undefined;
	if (opts.days === undefined) {
		const activeIds = new Set(stations.map((s) => s.id));
		iema = await ingestIemaMapa(env, activeIds, doFetch, log, logError, now);
	}

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
		...(iema ? { iema } : {}),
	};
}

function checkMethodAndAuth(
	req: Request,
	env: Env,
	route: string,
): Response | null {
	if (req.method !== "POST") {
		return new Response(
			JSON.stringify(
				{ error: `Método não permitido; use POST ${route}.` },
				null,
				2,
			),
			{
				status: 405,
				headers: { "content-type": "application/json", allow: "POST" },
			},
		);
	}
	const token = req.headers.get("X-Ingest-Token");
	if (
		!env.INGEST_TOKEN ||
		typeof env.INGEST_TOKEN !== "string" ||
		env.INGEST_TOKEN.trim() === "" ||
		token !== env.INGEST_TOKEN
	) {
		return new Response(
			JSON.stringify(
				{
					error: "Não autorizado: header X-Ingest-Token ausente ou inválido.",
				},
				null,
				2,
			),
			{
				status: 401,
				headers: { "content-type": "application/json" },
			},
		);
	}
	return null;
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/ingest/insitu") {
			const guard = checkMethodAndAuth(req, env, "/ingest/insitu");
			if (guard) return guard;

			const parsedHours = parseInsituHours(url.searchParams.get("hours"));
			if (!parsedHours.ok) {
				return new Response(
					JSON.stringify({ error: parsedHours.error }, null, 2),
					{
						status: 400,
						headers: { "content-type": "application/json" },
					},
				);
			}
			const report = await ingestInsitu(env, {
				hours: parsedHours.hours,
				log: (m) => console.log(m),
				logError: (m) => console.error(m),
			});
			return new Response(JSON.stringify(report, null, 2), {
				status: report.failed > 0 && report.observedRows === 0 ? 502 : 200,
				headers: { "content-type": "application/json" },
			});
		}

		// Disparo manual para reprocessar uma janela (ou backfill ?days=N) sem esperar o cron.
		if (url.pathname !== "/ingest") {
			return new Response(
				"ingestion worker — POST /ingest | POST /ingest/insitu",
				{ status: 404 },
			);
		}
		const guard = checkMethodAndAuth(req, env, "/ingest");
		if (guard) return guard;

		const parsedDays = parseBackfillDays(url.searchParams.get("days"));
		if (!parsedDays.ok) {
			return new Response(
				JSON.stringify({ error: parsedDays.error }, null, 2),
				{
					status: 400,
					headers: { "content-type": "application/json" },
				},
			);
		}
		const report = await ingest(env, {
			days: parsedDays.days,
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
