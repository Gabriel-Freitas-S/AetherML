// apps/web/test/eval-claims.test.ts — as frases de número do `AccuracyDashboard`
// derivadas de `model-eval.json`.
//
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.
//
// O que este arquivo trava: nenhuma tela volta a DIGITAR uma accuracy, uma
// contagem de amostras ou uma duração de janela. `13.977 amostras` e `91,9%`
// viveram no copy e envelheceram sozinhos. Aqui a única fonte de um número é o
// artefato, e a ausência de fonte devolve `null` — nunca um 0 e nunca uma
// constante de reserva. E `evaluationPointClaim` nomeia o que conta: pontos de
// holdout, não amostras de treino.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CLASS_ACCURACY_FIELD,
	DASH,
	classAccuracyByName,
	classAccuracyPercent,
	evaluationPointClaim,
	evaluationPointCount,
	formatClassAccuracy,
	formatPtBrInteger,
	holdoutHours,
	holdoutHoursClaim,
	holdoutSpanClaim,
	modelCountClaim,
	rolloutClaim,
	rolloutHours,
} from "../src/lib/eval-claims.ts";

/**
 * Recorte de `model-eval.json` com os MESMOS valores do artefato real, para que
 * o teste trave o formato que a tela mostra hoje — não um formato inventado.
 */
function artifact() {
	return {
		holdout: {
			start: "2026-09-25T17:00Z",
			end: "2026-10-02T16:00Z",
			hours: 168,
			stations: 9,
			points: 1512,
		},
		metrics: {
			pm25: { mae: 0.57, n: 1512 },
			pm10: { mae: 0.75, n: 1512 },
			o3: { mae: 3.34, n: 1512 },
			no2: { mae: 0.62, n: 1512 },
			so2: { mae: 0.5, n: 1512 },
		},
		horizons_mae: {
			"24": { pm25: 3.3, o3: 21.28, iqar: 20.78 },
			"48": { pm25: 4.45, o3: 10.36, iqar: 11.89 },
			"72": { pm25: 2.23, o3: 34.73, iqar: 31.22 },
			"120": { pm25: 3.9, o3: 25.16, iqar: 31.89 },
		},
		iqar: {
			class_accuracy: 0.9649,
			mae_index: 2.14,
			within_5pts: 0.9127,
			within_10pts: 0.9775,
			by_class: {
				Boa: { n: 1308, acc: 0.9725 },
				Moderada: { n: 204, acc: 0.9167 },
				Ruim: { n: 0, acc: null },
			},
		},
	};
}

test("evaluationPointCount lê holdout.points do artefato", () => {
	assert.equal(evaluationPointCount(artifact()), 1512);
});

test("evaluationPointCount cai para metrics.*.n quando holdout.points falta", () => {
	const a = artifact();
	(a.holdout as Partial<typeof a.holdout>).points = undefined;
	assert.equal(evaluationPointCount(a), 1512);
});

test("evaluationPointCount devolve null sem nenhuma contagem no artefato", () => {
	assert.equal(evaluationPointCount({}), null);
	assert.equal(evaluationPointCount(null), null);
});

test("evaluationPointClaim nomeia PONTOS DE HOLDOUT, nunca amostras de treino", () => {
	const claim = evaluationPointClaim(artifact());
	assert.equal(claim, "1.512 pontos de holdout");
	assert.ok(
		!claim?.includes("amostra"),
		"confunde ponto de avaliação com amostra de treino",
	);
	assert.ok(!claim?.includes("13.977"), "literal do copy antigo");
	assert.equal(evaluationPointClaim({}), null);
});

test("formatPtBrInteger separa milhar em pt-BR e recusa o que não é inteiro", () => {
	assert.equal(formatPtBrInteger(1512), "1.512");
	assert.equal(formatPtBrInteger(120), "120");
	assert.equal(formatPtBrInteger(0), "0");
	assert.equal(formatPtBrInteger(1512.5), null);
	assert.equal(formatPtBrInteger(-1), null);
	assert.equal(formatPtBrInteger(null), null);
});

test("holdoutHours e holdoutHoursClaim tiram a duração do artefato", () => {
	assert.equal(holdoutHours(artifact()), 168);
	assert.equal(holdoutHoursClaim(artifact()), "168h");
	assert.equal(holdoutHoursClaim({}), null);
});

test("holdoutSpanClaim diz '7 dias' só quando a janela divide em dias inteiros", () => {
	assert.equal(holdoutSpanClaim(artifact()), "7 dias");
	const ninetyHours = artifact();
	ninetyHours.holdout.hours = 90;
	assert.equal(holdoutSpanClaim(ninetyHours), "90 h");
	const oneDay = artifact();
	oneDay.holdout.hours = 24;
	assert.equal(holdoutSpanClaim(oneDay), "1 dia");
	assert.equal(holdoutSpanClaim({}), null);
});

test("modelCountClaim conta os alvos do artefato em vez de dizer '5'", () => {
	assert.equal(modelCountClaim(artifact()), "5 modelos calibrados");
	const one = artifact();
	one.metrics = { pm25: { mae: 0.57, n: 1512 } };
	assert.equal(modelCountClaim(one), "1 modelo calibrado");
	assert.equal(modelCountClaim({ metrics: {} }), null);
	assert.equal(modelCountClaim({}), null);
});

test("rolloutHours e rolloutClaim tiram o horizonte máximo de horizons_mae", () => {
	assert.equal(rolloutHours(artifact()), 120);
	assert.equal(rolloutClaim(artifact()), "rollout 120h recursivo");
	const short = artifact();
	short.horizons_mae = { "24": { pm25: 3.3 }, "48": { pm25: 4.45 } };
	assert.equal(rolloutHours(short), 48);
	assert.equal(rolloutClaim({}), null);
});

test("classAccuracyPercent escala iqar.class_accuracy e não inventa quando falta", () => {
	const pct = classAccuracyPercent(artifact());
	assert.ok(
		pct !== null && Math.abs(pct - 96.49) < 1e-9,
		`esperado ~96.49, veio ${pct}`,
	);
	assert.equal(classAccuracyPercent({}), null);
});

test("CLASS_ACCURACY_FIELD expõe a procedência do número na tela", () => {
	assert.equal(CLASS_ACCURACY_FIELD, "iqar.class_accuracy");
});

test("classAccuracyByName devolve null para faixa sem amostra, não 0", () => {
	assert.equal(classAccuracyByName(artifact(), "Boa"), 0.9725);
	assert.equal(classAccuracyByName(artifact(), "Ruim"), null);
	assert.equal(classAccuracyByName(artifact(), "Inexistente"), null);
});

test("formatClassAccuracy mantém o formato de tela e troca 0 por travessão", () => {
	assert.equal(formatClassAccuracy(0.9725), "97.3%");
	assert.equal(formatClassAccuracy(null), DASH);
	assert.equal(formatClassAccuracy(undefined), DASH);
	assert.notEqual(formatClassAccuracy(null), "0.0%");
});
