// apps/web/src/lib/tab-affordance.ts — quando a tira de abas esconde conteúdo.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.
//
// Por que existe: medido a 360px, a tira das cinco seções tem 417px de conteúdo
// contra 312px de caixa — 105px ficam do lado de fora. A quinta aba, "Holdout",
// some inteira atrás da borda arredondada e, sem mais nada, não há como saber
// que ela existe. O `overflow-x-auto` sozinho não advertise nada: em toque a
// barra de rolagem é sobreposta e some depois do primeiro toque.
//
// A regra é deliberadamente burra e testável: a dica de borda só pode acender
// quando existe conteúdo ESCONDIDO naquela ponta. Decisão visual fica no
// `DashboardShell.svelte`, que lê esta resposta e desenha o esmaecimento.

export type EdgeHint = "none" | "start" | "end" | "both";

/**
 * Metade de pixel. O navegador devolve larguras fracionárias, então comparar
 * `scrollWidth > clientWidth` sem tolerância acende a dica numa caixa que cabe.
 */
const EPS = 0.5;

/**
 * Qual ponta da tira está escondendo conteúdo agora.
 *
 * @param scrollWidth largura total do conteúdo rolável
 * @param clientWidth largura visível da caixa
 * @param scrollLeft quanto já rolou para a direita
 */
export function computeEdgeHint(
	scrollWidth: number,
	clientWidth: number,
	scrollLeft: number,
): EdgeHint {
	// Caixa ainda não medida (`display:none`, ou medindo antes do layout):
	// sem clientWidth não há nada honesto a afirmar.
	if (!(clientWidth > 0)) return "none";
	// Cabe inteiro: nada escondido, nenhuma dica.
	if (scrollWidth <= clientWidth + EPS) return "none";

	const hiddenAtStart = scrollLeft > EPS;
	const hiddenAtEnd = scrollLeft + clientWidth < scrollWidth - EPS;

	if (hiddenAtStart && hiddenAtEnd) return "both";
	if (hiddenAtStart) return "start";
	if (hiddenAtEnd) return "end";
	return "none";
}
