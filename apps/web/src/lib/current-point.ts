// apps/web/src/lib/current-point.ts — fonte única da verdade sobre "qual ponto é o
// atual". Mapa, página da estação e Dashboard importam daqui para que nunca voltem
// a divergir: o IQAr atual é SEMPRE o do ponto mais recente com `timestamp <= now`.
// Um ponto no futuro nunca é o ponto atual, por mais próximo de `now` que ele esteja.

/** Qualquer ponto que carregue o timestamp da série horária. */
export interface TimestampedPoint {
	timestamp: string;
}

/** Ponto escolhido por `currentPoint` + como ele foi escolhido. */
export interface CurrentPoint<T> {
	point: T;
	/**
	 * Verdadeiro quando nenhum ponto tinha `timestamp <= now` e o ponto mais antigo
	 * foi usado como fallback. Nesse caso o valor exibido NÃO é uma observação atual
	 * e o chamador deve avisar o leitor.
	 */
	isFallback: boolean;
}

/**
 * Ponto mais recente com `timestamp <= now` — clamp para o passado.
 *
 * Devolve `null` apenas quando não existe nenhum ponto com timestamp legível.
 * Se todos os pontos estiverem no futuro, devolve o mais antigo com
 * `isFallback: true`. Não muta a entrada.
 */
export function currentPoint<T extends TimestampedPoint>(
	points: readonly T[],
	now: Date | number,
): CurrentPoint<T> | null {
	const nowMs = now instanceof Date ? now.getTime() : now;
	let latest: { point: T; ms: number } | null = null;
	let earliest: { point: T; ms: number } | null = null;

	for (const point of points) {
		const ms = Date.parse(point.timestamp);
		if (Number.isNaN(ms)) continue;
		if (!earliest || ms < earliest.ms) earliest = { point, ms };
		if (ms <= nowMs && (!latest || ms > latest.ms)) latest = { point, ms };
	}

	const chosen = latest ?? earliest;
	if (!chosen) return null;
	return { point: chosen.point, isFallback: latest === null };
}
