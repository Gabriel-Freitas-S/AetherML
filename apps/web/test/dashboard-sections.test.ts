import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DASHBOARD_SECTIONS,
	DEFAULT_SECTION,
	dominantConcentration,
	formatConcentration,
	isSectionId,
	moveSection,
	resolveSection,
	sectionById,
	sectionHref,
} from "../src/lib/dashboard-sections.ts";

test("o registro de seções tem cinco entradas e a primeira é a leitura de agora", () => {
	assert.equal(DASHBOARD_SECTIONS.length, 5);
	assert.equal(DASHBOARD_SECTIONS[0].id, DEFAULT_SECTION);
	assert.equal(DEFAULT_SECTION, "agora");
});

test("cada seção aponta para uma rota do produto que existe de fato", () => {
	assert.deepEqual(
		DASHBOARD_SECTIONS.map((s) => s.href),
		["/", "/mapa", "/precisao", "/comparacao-previsao", "/comparacao"],
		"o href da aba é a rota canônica: sem JavaScript a navegação continua funcionando",
	);
});

test("resolveSection devolve a seção pedida quando ela existe no registro", () => {
	assert.equal(resolveSection("mapa"), "mapa");
	assert.equal(resolveSection("holdout"), "holdout");
});

test("resolveSection cai em 'agora' para qualquer valor fora do registro", () => {
	assert.equal(resolveSection(undefined), "agora");
	assert.equal(resolveSection(null), "agora");
	assert.equal(resolveSection("Mapa"), "agora");
	assert.equal(resolveSection("../etc/passwd"), "agora");
});

test("isSectionId aceita apenas ids do registro", () => {
	assert.equal(isSectionId("previsao"), true);
	assert.equal(isSectionId("previsao "), false);
	assert.equal(isSectionId(3), false);
});

test("sectionById devolve exatamente a entrada correspondente do registro", () => {
	assert.equal(
		sectionById("precisao"),
		sectionById(resolveSection("precisao")),
	);
	assert.equal(sectionById("precisao").label, "Precisão");
});

test("sectionHref aponta '/' para a seção padrão e a rota própria para as demais", () => {
	assert.equal(sectionHref("agora"), "/");
	assert.equal(sectionHref("precisao"), "/precisao");
});

test("moveSection avança uma posição e dá a volta no fim da lista", () => {
	assert.equal(moveSection("agora", 1), "mapa");
	assert.equal(
		moveSection("holdout", 1),
		"agora",
		"a última volta para a primeira",
	);
});

test("moveSection recua uma posição e dá a volta no começo da lista", () => {
	assert.equal(moveSection("mapa", -1), "agora");
	assert.equal(
		moveSection("agora", -1),
		"holdout",
		"a primeira volta para a última",
	);
});

test("formatConcentration escreve uma casa decimal com vírgula", () => {
	assert.equal(formatConcentration(8.44), "8,4");
	assert.equal(formatConcentration(18), "18,0");
	assert.equal(formatConcentration(0.74), "0,7");
});

test("formatConcentration devolve um traço quando não há número para mostrar", () => {
	assert.equal(formatConcentration(null), "—");
	assert.equal(formatConcentration(undefined), "—");
	assert.equal(formatConcentration(Number.NaN), "—");
});

test("dominantConcentration lê a concentração do poluente que domina o IQAr", () => {
	assert.equal(dominantConcentration({ pm25: 8.44, o3: 101.28 }, "pm25"), 8.44);
});

test("dominantConcentration devolve null quando o poluente não está no bloco observed", () => {
	assert.equal(dominantConcentration({ pm25: 8.44 }, "o3"), null);
	assert.equal(dominantConcentration(null, "pm25"), null);
	assert.equal(dominantConcentration({ pm25: null }, "pm25"), null);
});
