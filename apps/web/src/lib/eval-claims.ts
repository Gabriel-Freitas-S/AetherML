// apps/web/src/lib/eval-claims.ts — as frases de número do `AccuracyDashboard`
// como funções puras sobre `model-eval.json`.
//
// Motivo: nenhuma tela deste projeto DIGITA accuracy, contagem de amostras ou
// duração de janela. `13.977 amostras` e `91,9%` viveram no copy e passaram a
// envelhecer sozinhos — e `model-eval.json` já traz `iqar.class_accuracy` e
// `holdout.points`, que são a fonte real dos dois números. Cada função abaixo
// recebe o artefato já parseado e devolve a frase pronta, ou `null` quando o
// artefato não sustenta a afirmação: "sem fonte" é uma resposta honesta; um `0`
// ou uma constante de reserva não é.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.

/**
 * Subconjunto de `model-eval.json` que estas frases leem.
 *
 * Deliberadamente frouxo: o artefato é gerado fora do TypeScript e muda quando o
 * modelo retreina. Só o que sustenta uma frase entra aqui; o resto do payload é
 * lido pelo componente.
 */
export interface EvalArtifactLike {
	holdout?: {
		start?: string;
		end?: string;
		hours?: number;
		stations?: number;
		points?: number;
	} | null;
	metrics?: Record<string, { n?: number | null } | null> | null;
	horizons_mae?: Record<string, unknown> | null;
	iqar?: {
		class_accuracy?: number | null;
		by_class?: Record<
			string,
			{ n?: number | null; acc?: number | null } | null
		> | null;
	} | null;
}

/** Campo do artefato que carrega o acerto de faixa IQAr — a procedência do número. */
export const CLASS_ACCURACY_FIELD = "iqar.class_accuracy";

/** Ausência de fonte: o que a tela mostra quando o artefato não sustenta a frase. */
export const DASH = "—";

function isNum(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

/** Inteiro não-negativo com separador de milhar pt-BR: `1512` → `1.512`. */
export function formatPtBrInteger(
	value: number | null | undefined,
): string | null {
	if (!isNum(value) || !Number.isInteger(value) || value < 0) return null;
	return new Intl.NumberFormat("pt-BR").format(value);
}

/**
 * Pontos de AVALIAÇÃO do holdout — nunca amostras de treino.
 *
 * `holdout.points` quando existe; senão o `n` de um alvo de `metrics`, que é a
 * mesma contagem vista pelo lado do erro. `null` quando o artefato não diz.
 */
export function evaluationPointCount(
	artifact: EvalArtifactLike | null | undefined,
): number | null {
	const points = artifact?.holdout?.points;
	if (isNum(points) && points >= 0) return points;
	for (const m of Object.values(artifact?.metrics ?? {})) {
		if (isNum(m?.n) && m.n >= 0) return m.n;
	}
	return null;
}

/** `"1.512 pontos de holdout"` — a contagem nomeada pelo que ela de fato é. */
export function evaluationPointClaim(
	artifact: EvalArtifactLike | null | undefined,
): string | null {
	const n = evaluationPointCount(artifact);
	return n === null ? null : `${formatPtBrInteger(n)} pontos de holdout`;
}

/** Duração da janela de avaliação, em horas, ou `null`. */
export function holdoutHours(
	artifact: EvalArtifactLike | null | undefined,
): number | null {
	const hours = artifact?.holdout?.hours;
	return isNum(hours) && hours >= 0 ? hours : null;
}

/** `"168h"` — a duração da janela de avaliação, nunca digitada. */
export function holdoutHoursClaim(
	artifact: EvalArtifactLike | null | undefined,
): string | null {
	const hours = holdoutHours(artifact);
	return hours === null ? null : `${formatPtBrInteger(hours)}h`;
}

/**
 * `"7 dias"` quando a janela divide em dias inteiros; senão a própria contagem
 * de horas (`"90 h"`).
 *
 * Arredondar 168 para 7 é correto; arredondar 90 para 4 seria mentira — por isso
 * o fallback não é um dia aproximado, é a unidade que o artefato dá.
 */
export function holdoutSpanClaim(
	artifact: EvalArtifactLike | null | undefined,
): string | null {
	const hours = holdoutHours(artifact);
	if (hours === null) return null;
	const days = hours / 24;
	if (Number.isInteger(days) && days > 0)
		return `${days} ${days === 1 ? "dia" : "dias"}`;
	return `${formatPtBrInteger(hours)} h`;
}

/** `"5 modelos calibrados"` — a contagem sai dos alvos que o artefato traz. */
export function modelCountClaim(
	artifact: EvalArtifactLike | null | undefined,
): string | null {
	const targets = Object.keys(artifact?.metrics ?? {}).filter(
		(k) => k.length > 0,
	);
	if (targets.length === 0) return null;
	return `${targets.length} ${targets.length === 1 ? "modelo calibrado" : "modelos calibrados"}`;
}

/**
 * Maior horizonte presente em `horizons_mae` — o rollout que a tabela cobre de
 * fato, e não o rollout que alguém digitou no título.
 */
export function rolloutHours(
	artifact: EvalArtifactLike | null | undefined,
): number | null {
	let max: number | null = null;
	for (const key of Object.keys(artifact?.horizons_mae ?? {})) {
		const h = Number(key);
		if (!Number.isFinite(h) || h <= 0) continue;
		if (max === null || h > max) max = h;
	}
	return max;
}

/** `"rollout 120h recursivo"`. */
export function rolloutClaim(
	artifact: EvalArtifactLike | null | undefined,
): string | null {
	const hours = rolloutHours(artifact);
	return hours === null
		? null
		: `rollout ${formatPtBrInteger(hours)}h recursivo`;
}

/** `iqar.class_accuracy` em porcentagem (`0.9649` → `96.49`), ou `null`. */
export function classAccuracyPercent(
	artifact: EvalArtifactLike | null | undefined,
): number | null {
	const acc = artifact?.iqar?.class_accuracy;
	return isNum(acc) ? acc * 100 : null;
}

/**
 * Acerto de UMA faixa IQAr. `null` quando a faixa não tem amostra suficiente —
 * o artefato guarda `acc: null` para Ruim/Muito Ruim/Péssima, e um `?? 0`
 * escreveria "0.0%" onde não houve medição nenhuma.
 */
export function classAccuracyByName(
	artifact: EvalArtifactLike | null | undefined,
	name: string,
): number | null {
	const acc = artifact?.iqar?.by_class?.[name]?.acc;
	return isNum(acc) ? acc : null;
}

/**
 * Percentual no formato que a tela já imprimia, com travessão quando falta.
 *
 * O separador decimal continua `.` porque é o que `toFixed` já rendia nesta
 * tela; trocar por vírgula aqui seria mexer em copy que não é a afirmação falsa
 * que esta mudança corrige.
 */
export function formatClassAccuracy(value: number | null | undefined): string {
	if (!isNum(value)) return DASH;
	return `${(value * 100).toFixed(1)}%`;
}
