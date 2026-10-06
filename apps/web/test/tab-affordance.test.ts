import assert from "node:assert/strict";
import { test } from "node:test";
import { computeEdgeHint } from "../src/lib/tab-affordance.ts";

/**
 * A dica de borda da tira de abas só pode aparecer quando existe conteúdo
 * ESCONDIDO. Sem isso, a 360px a quinta aba ("Holdout") fica 105px fora da caixa
 * arredondada e ninguém tem como saber que ela existe.
 *
 * Os números 417/312 vêm da medição real a 360px (CDP, `scrollWidth`/`clientWidth`
 * da `[role="tablist"]`): 417px de conteúdo contra 312px de caixa.
 */

test("caixa que cabe inteiro não pede dica de borda nenhuma", () => {
	assert.equal(computeEdgeHint(960, 960, 0), "none");
	assert.equal(computeEdgeHint(576, 576, 0), "none");
	assert.equal(computeEdgeHint(312, 312, 0), "none");
});

test("conteúdo que overflowa só à direita pede dica na direita", () => {
	// Medido a 360px: 417 de conteúdo, 312 de caixa, parado no início.
	assert.equal(computeEdgeHint(417, 312, 0), "end");
});

test("conteúdo que overflowa só à esquerda pede dica na esquerda", () => {
	// Mesma tira já rolada até o fim: as 105px escondidas passaram para a esquerda.
	assert.equal(computeEdgeHint(417, 312, 105), "start");
});

test("no meio do rolamento as duas pontas escondem conteúdo e as duas pedem dica", () => {
	assert.equal(computeEdgeHint(417, 312, 52), "both");
});

test("caixa ainda não medida (clientWidth 0) não inventa dica", () => {
	assert.equal(computeEdgeHint(417, 0, 0), "none");
	assert.equal(computeEdgeHint(0, 0, 0), "none");
});

test("larga fracionária não acende dica por erro de arredondamento", () => {
	// O navegador devolve frações de pixel: 311.6 vs 312.0 é a MESMA caixa.
	assert.equal(computeEdgeHint(417, 312, 104.6), "start");
	assert.equal(computeEdgeHint(417.4, 417, 0), "none");
	// Rolado até o fim com sobra de meio pixel não reacende a ponta direita:
	// a 104.8 ainda resta 0.2px de conteúdo à direita, abaixo da tolerância.
	assert.equal(computeEdgeHint(417, 312, 105.2), "start");
	assert.equal(computeEdgeHint(417, 312, 104.8), "start");
	// Um pixel antes disso as duas pontas escondem conteúdo de verdade.
	assert.equal(computeEdgeHint(417, 312, 104), "both");
});

test("a caixa crescendo nunca deixa dica pendurada", () => {
	// A janela abriu: a tira passou a caber. A dica tem de sumir sozinha.
	const antes = computeEdgeHint(417, 312, 0);
	const depois = computeEdgeHint(417, 900, 0);
	assert.equal(antes, "end");
	assert.equal(depois, "none");
});
