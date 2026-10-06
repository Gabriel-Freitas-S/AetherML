// apps/web/src/lib/provenance.ts — fonte única da verdade sobre DE ONDE VEIO o número
// que o painel está exibindo.
//
// Três perguntas, uma tira: origem, horário do dado mais recente, idade. Mais um
// estado que a idade sozinha não cobre: uma série totalmente no FUTURO não é velha,
// mas também não tem "hora atual" — e é a série que o `currentPoint` sinaliza com
// `isFallback`.
//
// Regra do projeto: "é obrigatório usar ML". Qualquer série que não seja saída do
// modelo tem de se declarar na tela, então uma origem desconhecida NUNCA é
// aproximada de "ml" — cai em `unknown`, que é a única resposta honesta.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.

// Extensão explícita: este arquivo é importado por `node --test`, e o resolver
// ESM do Node não completa `./forecast-days` sem o `.ts` (o Vite completa).
import { formatStaleNotice } from "./forecast-days.ts";
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

const ORIGINS: Record<DataOrigin, OriginInfo> = {
	ml: {
		id: "ml",
		label: "Modelo LightGBM (previsão)",
		detail:
			"Concentrações previstas pelo modelo do projeto. Não são medições de sensor.",
		isMl: true,
	},
	"open-meteo": {
		id: "open-meteo",
		label: "Open-Meteo (fallback)",
		detail:
			"Série da API pública em uso porque o bundle do modelo estava vencido. Não é saída do LightGBM.",
		isMl: false,
	},
	unknown: {
		id: "unknown",
		label: "Origem desconhecida",
		detail: "Não foi possível identificar a origem desta série.",
		isMl: false,
	},
};

/** Descreve a origem. Qualquer valor fora do domínio cai em `unknown`, nunca em `ml`. */
export function describeOrigin(
	origin: DataOrigin | null | undefined,
): OriginInfo {
	if (origin && origin in ORIGINS) return ORIGINS[origin];
	return ORIGINS.unknown;
}

/**
 * Estado de atualidade da série, distinto de "idade do dado".
 *
 * - `live`: existe hora atual (algum ponto `<= now`) e existe previsão à frente.
 * - `stale`: NENHUM ponto no futuro — o que resta é histórico.
 * - `ahead`: NENHUM ponto `<= now` — a série inteira está no futuro, logo não há
 *   valor "atual" para exibir. É o que `currentPoint` marca como `isFallback`.
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
	isFallback: boolean;
}

export interface Provenance {
	origin: OriginInfo;
	freshness: Freshness;
	/** Frase de abertura da tira. */
	headline: string;
	/**
	 * `"alert"` só quando a atualidade é questionável (stale/ahead), preservando o
	 * tratamento âmbar já existente. Série em dia não ocupa região viva.
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

const DASH = "—";

export function buildProvenance(input: ProvenanceInput): Provenance {
	const origin = describeOrigin(input.origin);
	const { age } = input;
	const freshness = freshnessOf(input.isStale, input.isFallback);
	const isAlert = freshness !== "live";

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
	if (freshness === "ahead") {
		warnings.push(
			`Não há hora atual na série (ela começa em ${age.observedAt ?? DASH}): o IQAr no topo é a primeira hora disponível, não o valor de agora.`,
		);
	}

	const headline =
		freshness === "stale"
			? formatStaleNotice(age).title
			: freshness === "ahead"
				? "Série ainda no futuro"
				: "Dados em dia";

	return {
		origin,
		freshness,
		headline,
		role: isAlert ? "alert" : null,
		isAlert,
		tone: isAlert || !origin.isMl ? "amber" : "neutral",
		rows: [
			{ label: "Origem", value: origin.label },
			{ label: "Mais recente", value: age.observedAt ?? DASH },
			{ label: "Idade", value: age.ageText || DASH },
		],
		warnings,
	};
}
