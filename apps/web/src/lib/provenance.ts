// apps/web/src/lib/provenance.ts — fonte única da verdade sobre DE ONDE VEIO o número
// que o painel está exibindo.
//
// Três perguntas, uma tira: origem, início/mais recente, horizonte/idade.
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
	/** Identificador canônico da origem. */
	id: DataOrigin;
	/** Rótulo curto exibido na tira. */
	label: string;
	/** Descrição contextual da procedência (sem prometer o que não é). */
	detail: string;
	/** Só `ml` é saída do modelo de Machine Learning do projeto. */
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
		detail:
			"Não foi possível identificar a origem desta série; não é saída do modelo LightGBM do projeto.",
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

/** Linha chave-valor da tabela de proveniência na interface. */
export interface ProvenanceRow {
	/** Rótulo fixo da métrica (ex.: 'Origem', 'Início da previsão', 'Horizonte até'). */
	label: string;
	/** Valor textual formatado correspondente. */
	value: string;
}

/** Parâmetros de entrada para montagem da tira de proveniência. */
export interface ProvenanceInput {
	/** Origem declarada dos dados ('ml', 'open-meteo' ou 'unknown'). */
	origin: DataOrigin | null | undefined;
	/** Metadados de idade calculada em relação ao relógio. */
	age: DataAge;
	/** Verdadeiro quando a série não possui pontos futuros (apenas histórico). */
	isStale: boolean;
	/** Verdadeiro quando o ponto atual foi resolvido como fallback do início da série. */
	isFallback?: boolean;
	/** Ponto inicial em ISO da série de previsão. */
	startTimestamp?: string | null;
	/** Timestamp de referência atual do dado (<= now). */
	referenceTimestamp?: string | null;
	/** Ponto final em ISO da série de previsão (horizonte máximo). */
	horizonTimestamp?: string | null;
	/** Timestamp de referência para cálculo relativo (padrão: agora). */
	now?: Date;
}

/** Objeto final de proveniência consumido pela interface do usuário. */
export interface Provenance {
	/** Metadados estruturados sobre a fonte geradora. */
	origin: OriginInfo;
	/** Categorização da tempestividade da série (live, stale ou ahead). */
	freshness: Freshness;
	/** Frase de abertura da tira de proveniência. */
	headline: string;
	/**
	 * `"alert"` só quando a atualidade é questionável (stale) ou origem externa (open-meteo/unknown).
	 * Séries em dia (live ou ahead) não disparam alerta visual nem auditivo.
	 */
	role: "alert" | null;
	/** Flag booleano para estilização e verificações condicionais. */
	isAlert: boolean;
	/** `amber` para alertas de dado vencido ou fallback; `neutral` para operação regular. */
	tone: "neutral" | "amber";
	/** As três respostas estruturadas: Origem, Início/Mais recente e Horizonte/Idade. */
	rows: ProvenanceRow[];
	/** Avisos e ressalvas metodológicas exibidos abaixo da tira. */
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
			`Esta série foi gerada por ${origin.label} — ${origin.detail}`,
		);
	}
	if (freshness === "stale") {
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

/**
 * Linha de transparência metodológica CONAMA 491/2018 (BUG-09).
 * Discrimina se as estimativas horárias pontuais provêm do modelo LightGBM do projeto
 * ou da API pública Open-Meteo, evitando contradição quando em modo fallback.
 */
export function estimateLine(origin?: DataOrigin | null): string {
	if (origin === "open-meteo") {
		return "Estimativa a partir de valores horários da API Open-Meteo; a CONAMA 491 exige médias móveis (24h/8h)";
	}
	if (origin === "ml" || !origin) {
		return "Estimativa a partir de valores horários do modelo; a CONAMA 491 exige médias móveis (24h/8h)";
	}
	return "Estimativa a partir de valores horários; a CONAMA 491 exige médias móveis (24h/8h)";
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
		const sourceLabel =
			opts.origin === "open-meteo"
				? "da API Open-Meteo"
				: opts.origin === "ml" || !opts.origin
					? "do modelo"
					: "dos dados";
		return `A série desta estação termina em ${when} (${opts.ageText ?? ""}). As horas abaixo são histórico ${sourceLabel}, não previsão.`;
	}
	if (opts.origin === "open-meteo") {
		return `Série da API pública Open-Meteo com ${opts.pointsCount} h de dados em ${opts.stationName}. Não é saída do modelo LightGBM do projeto.`;
	}
	if (opts.origin && opts.origin !== "ml") {
		return `Previsão horária contínua para as próximas ${opts.pointsCount} h em ${opts.stationName}, classificada segundo as diretrizes de saúde da Resolução CONAMA 491/2018.`;
	}
	return `Previsão horária contínua do modelo para as próximas ${opts.pointsCount} h em ${opts.stationName}, classificada segundo as diretrizes de saúde da Resolução CONAMA 491/2018.`;
}
