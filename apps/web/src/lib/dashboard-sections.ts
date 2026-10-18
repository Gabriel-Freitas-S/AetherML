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

export type SectionId = "agora" | "mapa" | "precisao" | "confronto";
export type ConfrontoSubtab = "previsao" | "holdout";

export const DEFAULT_SECTION: SectionId = "agora";
export const DEFAULT_CONFRONTO_SUBTAB: ConfrontoSubtab = "previsao";

export interface DashboardSection {
	id: SectionId;
	/** Etiqueta da aba. Curta o bastante para 4 abas em 360px. */
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

export interface ConfrontoSubtabItem {
	id: ConfrontoSubtab;
	label: string;
	href: string;
	natureNotice: string;
}

/**
 * Ordem deliberada: da leitura de agora para o buried técnico.
 *
 * Uma pessoa resident encontra o número que precisa na primeira seção e nunca é
 * obrigada a atravessar tabela de MAE para chegar nele. Um técnico atravessa a
 * mesma lista em ordem crescente de profundidade — situação, espaço, erro
 * medido, confronto (previsão 120h + holdout 168h) — e a auditoria completa fica
 * no fim, onde ela pertence.
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
		id: "confronto",
		label: "Confronto",
		href: "/confronto",
		hint: "Leitura técnica: modelo vs Open-Meteo (CAMS) na previsão (120h à frente) e no holdout (168h de validação).",
	},
] as const;

export const CONFRONTO_SUBTABS: readonly ConfrontoSubtabItem[] = [
	{
		id: "previsao",
		label: "Previsão — 120h à frente",
		href: "/comparacao-previsao",
		natureNotice:
			"Projeção futura: o CAMS da hora entra como insumo do modelo (não valida precisão).",
	},
	{
		id: "holdout",
		label: "Holdout — 168h de validação",
		href: "/comparacao",
		natureNotice:
			"Validação fora do treino: horas passadas que o modelo nunca viu.",
	},
] as const;

const BY_ID = new Map(DASHBOARD_SECTIONS.map((s) => [s.id, s]));
const SUBTAB_BY_ID = new Map(CONFRONTO_SUBTABS.map((t) => [t.id, t]));

/** `true` só para ids exatamente do registro — sem trim, sem caixa-insensível. */
export function isSectionId(value: unknown): value is SectionId {
	return typeof value === "string" && BY_ID.has(value as SectionId);
}

export function isConfrontoSubtab(value: unknown): value is ConfrontoSubtab {
	return (
		typeof value === "string" && SUBTAB_BY_ID.has(value as ConfrontoSubtab)
	);
}

/** Normaliza qualquer entrada externa (incluindo ids legados previsao/holdout) para um id do registro. */
export function resolveSection(value: unknown): SectionId {
	if (isSectionId(value)) return value;
	if (value === "previsao" || value === "holdout") return "confronto";
	return DEFAULT_SECTION;
}

/** Resolve a sub-aba ativa dentro da seção Confronto a partir do id ou da rota. */
export function resolveConfrontoSubtab(value: unknown): ConfrontoSubtab {
	if (isConfrontoSubtab(value)) return value;
	if (typeof value === "string") {
		const clean =
			value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
		if (clean === "/comparacao") return "holdout";
		if (clean === "/comparacao-previsao") return "previsao";
	}
	return DEFAULT_CONFRONTO_SUBTAB;
}

/** Verifica se o caminho corresponde a qualquer rota do painel (incluindo rotas preservadas das sub-abas). */
export function isDashboardPath(pathname: string): boolean {
	const clean =
		pathname.length > 1 && pathname.endsWith("/")
			? pathname.slice(0, -1)
			: pathname;
	if (DASHBOARD_SECTIONS.some((s) => s.href === clean)) return true;
	if (CONFRONTO_SUBTABS.some((t) => t.href === clean)) return true;
	return false;
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
 * `moveSection("confronto", 1) === "agora"` — a última aba é vizinha da primeira,
 * que é o que o leitor de tela anuncia e o que o leitor espera de uma lista
 * circular.
 */
export function moveSection(current: SectionId, delta: number): SectionId {
	const index = DASHBOARD_SECTIONS.findIndex((s) => s.id === current);
	const from = index === -1 ? 0 : index;
	const count = DASHBOARD_SECTIONS.length;
	const next = (((from + delta) % count) + count) % count;
	return DASHBOARD_SECTIONS[next].id;
}

export function moveConfrontoSubtab(
	current: ConfrontoSubtab,
	delta: number,
): ConfrontoSubtab {
	const index = CONFRONTO_SUBTABS.findIndex((t) => t.id === current);
	const from = index === -1 ? 0 : index;
	const count = CONFRONTO_SUBTABS.length;
	const next = (((from + delta) % count) + count) % count;
	return CONFRONTO_SUBTABS[next].id;
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
