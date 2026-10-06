// apps/web/src/lib/dashboard-sections.ts — o registro das SEÇÕES do painel único.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.
//
// Por que existe: a navegação tem dois itens (Dashboard, Docs) e o painel tem
// cinco. A lista de seções, o rótulo de cada uma, a rota que a preserva e o par
// poluente/concentração que o mapa exibe são fatos sobre o produto — não sobre a
// tela. Eles vivem aqui para que o shell, o mapa e o teste leiam a MESMA lista.
//
// `href` NÃO é decoração: é a rota real que renderiza esta seção com ela já
// selecionada. É o que mantém `/mapa`, `/precisao`, `/comparacao` e
// `/comparacao-previsao` de pé, é o que faz a aba funcionar sem JavaScript e é o
// que o cliqueenhanced reescreve na barra de endereços sem recarregar a página.

export type SectionId = "agora" | "mapa" | "precisao" | "previsao" | "holdout";

export const DEFAULT_SECTION: SectionId = "agora";

export interface DashboardSection {
	id: SectionId;
	/** Etiqueta da aba. Curta o bastante para 5 abas em 360px. */
	label: string;
	/** Rota que renderiza o painel com esta seção já selecionada. */
	href: string;
	/**
	 * Uma linha que diz ao leitor o que a seção responde.
	 *
	 * É o mecanismo que concilia as duas audiências: a pessoa leiga vê, antes de
	 * entrar, que a seção é leitura técnica e pode voltar. O profissional não
	 * precisa descobrir sozinho que há auditoria de modelo no mesmo produto.
	 */
	hint: string;
}

/**
 * Ordem deliberada: da leitura de agora para o buried técnico.
 *
 * Uma pessoa resident encontra o número que precisa na primeira seção e nunca é
 * obrigada a atravessar tabela de MAE para chegar nele. Um técnico atravessa a
 * mesma lista em ordem crescente de profundidade — situação, espaço, erro
 * medido, previsão comparada, holdout — e a auditoria completa fica no fim, onde
 * ela pertence.
 */
export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
	{
		id: "agora",
		label: "Agora",
		href: "/",
		hint: "O ar de uma estação, hora a hora, e o que fazer com ele.",
	},
	{
		id: "mapa",
		label: "Mapa",
		href: "/mapa",
		hint: "Onde o ar está pior agora, estação a estação.",
	},
	{
		id: "precisao",
		label: "Precisão",
		href: "/precisao",
		hint: "Leitura técnica: erro medido contra dados reais, lido do artefato de avaliação.",
	},
	{
		id: "previsao",
		label: "Previsão",
		href: "/comparacao-previsao",
		hint: "Leitura técnica: o modelo contra a re-análise CAMS nas 120h à frente.",
	},
	{
		id: "holdout",
		label: "Holdout",
		href: "/comparacao",
		hint: "Leitura técnica: o modelo contra a mesma fonte em 168h que ele nunca viu no treino.",
	},
] as const;

const BY_ID = new Map(DASHBOARD_SECTIONS.map((s) => [s.id, s]));

/** `true` só para ids exatamente do registro — sem trim, sem caixa-insensível. */
export function isSectionId(value: unknown): value is SectionId {
	return typeof value === "string" && BY_ID.has(value as SectionId);
}

/** Normaliza qualquer entrada externa para um id do registro. */
export function resolveSection(value: unknown): SectionId {
	return isSectionId(value) ? value : DEFAULT_SECTION;
}

/** Entrada do registro. Id fora dele cai no fallback (nunca lança). */
export function sectionById(id: SectionId): DashboardSection {
	const found = BY_ID.get(id);
	if (found) return found;
	return DASHBOARD_SECTIONS[0];
}

export function sectionHref(id: SectionId): string {
	return sectionById(id).href;
}

/**
 * Movimento de teclado entre abas, com volta no fim da lista.
 *
 * `moveSection("holdout", 1) === "agora"` — a última aba é vizinha da primeira,
 * que é o que areader de tela anuncia e o que o leitor espera de uma lista
 * circular.
 */
export function moveSection(current: SectionId, delta: number): SectionId {
	const index = DASHBOARD_SECTIONS.findIndex((s) => s.id === current);
	const from = index === -1 ? 0 : index;
	const count = DASHBOARD_SECTIONS.length;
	const next = (((from + delta) % count) + count) % count;
	return DASHBOARD_SECTIONS[next].id;
}

/**
 * Concentração em µg/m³ do poluente que DOMINA o IQAr daquela estação.
 *
 * `null` quando o poluente não está no bloco `observed` ou o valor não é número
 * finito. `null` nunca vira 0: 0 µg/m³ é uma leitura, "sem dado" não é.
 *
 * Não há jitter, offset por estação nem arredondamento para manufacture
 * variação espacial. O contraste de ~0,7 µg/m³ entre estações existe no modelo e
 * a job é mostrar o número que existe.
 */
export function dominantConcentration(
	observed: Record<string, unknown> | null | undefined,
	primary: string | null | undefined,
): number | null {
	if (!observed || !primary) return null;
	const value = observed[primary];
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
}

const DASH = "—"; // —

/**
 * Concentração com uma casa decimal e vírgula decimal (pt-BR).
 *
 * `toFixed` + troca manual, e não `Intl`: o separador é fixo por contrato de
 * produto, não por locale disponível no runtime. O valor é sempre exibido como
 * concentração bruta em µg/m³ — nunca como fração de índice, que falsificaria a
 * classificação regulatória.
 */
export function formatConcentration(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
	return value.toFixed(1).replace(".", ",");
}
