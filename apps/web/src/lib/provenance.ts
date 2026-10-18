// apps/web/src/lib/provenance.ts — fonte única da verdade sobre DE ONDE VEIO o número
// que o painel está exibindo.
//
// Três perguntas, uma tira: origem, horário do dado mais recente, idade.
// Com dados frescos, uma série de previsão estende-se no futuro (now+1h .. now+120h).
// Essa série é PREVISÃO NORMAL (não erro, não histórico).
//
// Regra do projeto: "é obrigatório usar ML". Qualquer série que não seja saída do
// modelo tem de se declarar na tela, então uma origem desconhecida NUNCA é
// aproximada de "ml" — cai em `unknown`, que é a única resposta honesta.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.

import {
	formatForecastStart,
	formatObservedAt,
	formatStaleNotice,
} from "./forecast-days.ts";
import type { DataAge } from "./forecast-days.ts";

/**
 * Quem produziu as concentrações que estão em tela.
 *
 * - `ml`: o bundle previsto pelo LightGBM do projeto (caminho normal).
 * - `open-meteo`: fallback que TROCA a série da estação ativa pela API pública.
 *   É o estado perigoso: os números são reais e tem formato de IQAr, mas não são
 *   saída do modelo, e nada na tela original dizia isso.
 * - `unknown`: não sabemos. Preferível a uma mentira.
 */
export type DataOrigin = "ml" | "open-meteo" | "unknown";

export interface OriginInfo {
	id: DataOrigin;
	/** Rótulo curto da tira. */
	label: string;
	/** O que a origem é, em uma frase — sem prometer o que não é. */
	detail: string;
	/** Só `ml` é saída do modelo do projeto. */
	isMl: boolean;
}

/** Descreve a origem. Quando stale, ajusta o texto para declarar histórico do modelo, nunca previsão. */
export function describeOrigin(
	origin: DataOrigin | null | undefined,
	isStale = false,
): OriginInfo {
	if (origin === "ml") {
		return {
			id: "ml",
			label: isStale
				? "Modelo LightGBM (histórico)"
				: "Modelo LightGBM (previsão)",
			detail: isStale
				? "Histórico do modelo do projeto. Não são medições de sensor."
				: "Concentrações previstas pelo modelo do projeto. Não são medições de sensor.",
			isMl: true,
		};
	}
	if (origin === "open-meteo") {
		return {
			id: "open-meteo",
			label: "Open-Meteo (fallback)",
			detail:
				"Série da API pública em uso porque o bundle do modelo estava vencido. Não é saída do LightGBM.",
			isMl: false,
		};
	}
	return {
		id: "unknown",
		label: "Origem desconhecida",
		detail: "Não foi possível identificar a origem desta série.",
		isMl: false,
	};
}

/**
 * Estado de atualidade da série, distinto de "idade do dado".
 *
 * - `live`: existe hora atual (algum ponto `<= now`) e existe previsão à frente.
 * - `stale`: NENHUM ponto no futuro — o que resta é histórico.
 * - `ahead`: NENHUM ponto `<= now` — a série inteira está no futuro (previsão normal).
 */
export type Freshness = "live" | "stale" | "ahead";

/**
 * `stale` ganha de `ahead` quando os dois flags chegam true: isso só acontece
 * quando não existe ponto nenhum, e "dado velho" é o aviso mais útil para ler.
 */
export function freshnessOf(isStale: boolean, isFallback: boolean): Freshness {
	if (isStale) return "stale";
	if (isFallback) return "ahead";
	return "live";
}

export interface ProvenanceRow {
	label: string;
	value: string;
}

export interface ProvenanceInput {
	origin: DataOrigin | null | undefined;
	age: DataAge;
	/** Verdadeiro quando a série não tem nenhum ponto no futuro. */
	isStale: boolean;
	/** Verdadeiro quando `currentPoint` caiu no ponto mais antigo (série no futuro). */
	isFallback?: boolean;
	/** Ponto inicial ou de referência da previsão. */
	startTimestamp?: string | null;
	referenceTimestamp?: string | null;
	/** Fim da série (horizonte final de previsão). */
	horizonTimestamp?: string | null;
	now?: Date;
}

export interface Provenance {
	origin: OriginInfo;
	freshness: Freshness;
	/** Frase de abertura da tira. */
	headline: string;
	/**
	 * `"alert"` só quando a atualidade é questionável (stale) ou origem externa (open-meteo/unknown).
	 * Série em dia (live ou ahead) não ocupa região viva.
	 */
	role: "alert" | null;
	isAlert: boolean;
	/** `amber` quando qualquer coisa precisa de destaque visual. */
	tone: "neutral" | "amber";
	/** As três respostas, sempre nesta ordem e com estes rótulos. */
	rows: ProvenanceRow[];
	/** Fatos que não cabem numa linha: nunca vazio se a origem não for `ml`. */
	warnings: string[];
}

export const DASH = "—";

export function buildProvenance(input: ProvenanceInput): Provenance {
	const origin = describeOrigin(input.origin, input.isStale);
	const { age } = input;
	const freshness = freshnessOf(input.isStale, input.isFallback ?? false);

	// Regra do produto: série no futuro é previsão normal do modelo, NÃO erro!
	// Alert apenas quando stale (dados velhos) ou quando a origem não é ML.
	const isAlert = freshness === "stale" || !origin.isMl;

	const warnings: string[] = [];
	if (!origin.isMl) {
		warnings.push(
			`Esta série vem de ${origin.label} — não é saída do modelo LightGBM do projeto.`,
		);
	}
	if (freshness === "stale") {
		// Redação única do projeto: `formatStaleNotice` também alimenta a página da
		// estação, então o texto não pode divergir entre telas.
		warnings.push(formatStaleNotice(age).body);
	}

	const headline =
		freshness === "stale" ? formatStaleNotice(age).title : "Dados em dia";

	const now = input.now ?? new Date();
	const startTs = input.startTimestamp ?? input.referenceTimestamp;
	const horizonTs = input.horizonTimestamp;

	let rows: ProvenanceRow[];
	if (!input.isStale && (startTs || horizonTs)) {
		rows = [
			{ label: "Origem", value: origin.label },
			{
				label: "Início da previsão",
				value: startTs
					? formatForecastStart(startTs, now)
					: (age.observedAt ?? DASH),
			},
			{
				label: "Horizonte até",
				value: horizonTs ? formatObservedAt(horizonTs) : DASH,
			},
		];
	} else {
		rows = [
			{ label: "Origem", value: origin.label },
			{ label: "Mais recente", value: age.observedAt ?? DASH },
			{ label: "Idade", value: age.ageText || DASH },
		];
	}

	return {
		origin,
		freshness,
		headline,
		role: isAlert ? "alert" : null,
		isAlert,
		tone: isAlert ? "amber" : "neutral",
		rows,
		warnings,
	};
}

/** Redação única para o texto de abertura do Dashboard (evita contradição de legendas). */
export function getLeadLine(opts: {
	freshness: Freshness;
	stationName: string;
	pointsCount: number;
	observedAt?: string | null;
	ageText?: string | null;
	origin?: DataOrigin | null;
}): string {
	const when = opts.observedAt ?? DASH;
	if (opts.freshness === "stale") {
		return `A série desta estação termina em ${when} (${opts.ageText ?? ""}). As horas abaixo são histórico do modelo, não previsão.`;
	}
	if (opts.origin === "open-meteo") {
		return `Série da API pública Open-Meteo para as próximas ${opts.pointsCount} h em ${opts.stationName}. Não é saída do modelo LightGBM do projeto.`;
	}
	return `Previsão horária contínua do modelo para as próximas ${opts.pointsCount} h em ${opts.stationName}, classificada segundo as diretrizes de saúde da Resolução CONAMA 491/2018.`;
}
