import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CONFRONTO_SUBTABS,
	DASHBOARD_SECTIONS,
	DEFAULT_CONFRONTO_SUBTAB,
	DEFAULT_SECTION,
	dominantConcentration,
	formatConcentration,
	isConfrontoSubtab,
	isDashboardPath,
	isSectionId,
	moveConfrontoSubtab,
	moveSection,
	resolveConfrontoSubtab,
	resolveSection,
	sectionById,
	sectionHref,
} from "../src/lib/dashboard-sections.ts";

test("o registro de seções tem quatro entradas (Agora, Mapa, Precisão, Confronto) e a primeira é a leitura de agora", () => {
	assert.equal(DASHBOARD_SECTIONS.length, 4);
	assert.deepEqual(
		DASHBOARD_SECTIONS.map((s) => s.id),
		["agora", "mapa", "precisao", "confronto"],
	);
	assert.equal(DASHBOARD_SECTIONS[0].id, DEFAULT_SECTION);
	assert.equal(DEFAULT_SECTION, "agora");
});

test("cada seção aponta para uma rota canônica do produto", () => {
	assert.deepEqual(
		DASHBOARD_SECTIONS.map((s) => s.href),
		["/", "/mapa", "/precisao", "/confronto"],
		"o href da aba é a rota canônica: sem JavaScript a navegação continua funcionando",
	);
});

test("a seção Confronto possui duas sub-abas internas (Previsão 120h e Holdout 168h) preservando as rotas antigas", () => {
	assert.equal(CONFRONTO_SUBTABS.length, 2);
	assert.equal(DEFAULT_CONFRONTO_SUBTAB, "previsao");
	assert.deepEqual(
		CONFRONTO_SUBTABS.map((t) => ({ id: t.id, label: t.label, href: t.href })),
		[
			{
				id: "previsao",
				label: "Previsão — 120h à frente",
				href: "/comparacao-previsao",
			},
			{
				id: "holdout",
				label: "Holdout — 168h de validação",
				href: "/comparacao",
			},
		],
	);
});

test("resolveSection devolve a seção pedida e mapeia 'previsao' e 'holdout' legados para 'confronto'", () => {
	assert.equal(resolveSection("mapa"), "mapa");
	assert.equal(resolveSection("confronto"), "confronto");
	assert.equal(resolveSection("previsao"), "confronto");
	assert.equal(resolveSection("holdout"), "confronto");
});

test("resolveConfrontoSubtab seleciona a sub-aba correta a partir do id ou da rota legada", () => {
	assert.equal(resolveConfrontoSubtab("previsao"), "previsao");
	assert.equal(resolveConfrontoSubtab("holdout"), "holdout");
	assert.equal(resolveConfrontoSubtab("/comparacao"), "holdout");
	assert.equal(resolveConfrontoSubtab("/comparacao/"), "holdout");
	assert.equal(resolveConfrontoSubtab("/comparacao-previsao"), "previsao");
	assert.equal(resolveConfrontoSubtab("/comparacao-previsao/"), "previsao");
	assert.equal(resolveConfrontoSubtab("confronto"), "previsao");
	assert.equal(resolveConfrontoSubtab(undefined), "previsao");
});

test("isConfrontoSubtab e moveConfrontoSubtab alternam entre previsão e holdout", () => {
	assert.equal(isConfrontoSubtab("previsao"), true);
	assert.equal(isConfrontoSubtab("holdout"), true);
	assert.equal(isConfrontoSubtab("confronto"), false);
	assert.equal(moveConfrontoSubtab("previsao", 1), "holdout");
	assert.equal(moveConfrontoSubtab("holdout", 1), "previsao");
	assert.equal(moveConfrontoSubtab("previsao", -1), "holdout");
});

test("isDashboardPath reconhece as 4 rotas principais e as 2 rotas legadas de comparação", () => {
	assert.equal(isDashboardPath("/"), true);
	assert.equal(isDashboardPath("/mapa"), true);
	assert.equal(isDashboardPath("/precisao"), true);
	assert.equal(isDashboardPath("/confronto"), true);
	assert.equal(isDashboardPath("/comparacao"), true);
	assert.equal(isDashboardPath("/comparacao-previsao"), true);
	assert.equal(isDashboardPath("/docs"), false);
});

test("resolveSection cai em 'agora' para qualquer valor fora do registro", () => {
	assert.equal(resolveSection(undefined), "agora");
	assert.equal(resolveSection(null), "agora");
	assert.equal(resolveSection("Mapa"), "agora");
	assert.equal(resolveSection("../etc/passwd"), "agora");
});

test("isSectionId aceita apenas os 4 ids canônicos do registro", () => {
	assert.equal(isSectionId("confronto"), true);
	assert.equal(isSectionId("previsao"), false);
	assert.equal(isSectionId("holdout"), false);
	assert.equal(isSectionId("confronto "), false);
	assert.equal(isSectionId(3), false);
});

test("sectionById devolve exatamente a entrada correspondente do registro", () => {
	assert.equal(
		sectionById("precisao"),
		sectionById(resolveSection("precisao")),
	);
	assert.equal(sectionById("precisao").label, "Precisão");
	assert.equal(sectionById("confronto").label, "Confronto");
});

test("sectionHref aponta '/' para a seção padrão e a rota própria para as demais", () => {
	assert.equal(sectionHref("agora"), "/");
	assert.equal(sectionHref("precisao"), "/precisao");
	assert.equal(sectionHref("confronto"), "/confronto");
});

test("moveSection avança uma posição e dá a volta no fim da lista", () => {
	assert.equal(moveSection("agora", 1), "mapa");
	assert.equal(
		moveSection("confronto", 1),
		"agora",
		"a última volta para a primeira",
	);
});

test("moveSection recua uma posição e dá a volta no começo da lista", () => {
	assert.equal(moveSection("mapa", -1), "agora");
	assert.equal(
		moveSection("agora", -1),
		"confronto",
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

test("getShellStaticProps mantém stationsMeta em todas as rotas mas escopa initialBundle, initialMapStations e evalData por seção", async () => {
	const { getShellStaticProps } = await import("../src/lib/shell-props.ts");

	const agora = getShellStaticProps("agora");
	assert.equal(agora.stationsMeta.length, 9);
	assert.ok(agora.initialBundle !== null, "agora deve incluir initialBundle");
	assert.equal(
		agora.initialMapStations.length,
		9,
		"agora deve incluir initialMapStations",
	);
	assert.equal(agora.evalData, null, "agora não deve embutir evalData");

	const mapa = getShellStaticProps("mapa");
	assert.equal(mapa.stationsMeta.length, 9);
	assert.equal(mapa.initialBundle, null, "mapa não deve embutir initialBundle");
	assert.equal(
		mapa.initialMapStations.length,
		9,
		"mapa deve incluir initialMapStations",
	);
	assert.equal(mapa.evalData, null, "mapa não deve embutir evalData");

	const precisao = getShellStaticProps("precisao");
	assert.equal(precisao.stationsMeta.length, 9);
	assert.equal(
		precisao.initialBundle,
		null,
		"precisao não deve embutir initialBundle",
	);
	assert.equal(
		precisao.initialMapStations.length,
		0,
		"precisao não deve embutir initialMapStations",
	);
	assert.ok(precisao.evalData !== null, "precisao deve incluir evalData");

	const confronto = getShellStaticProps("confronto");
	assert.equal(confronto.stationsMeta.length, 9);
	assert.equal(
		confronto.initialBundle,
		null,
		"confronto não deve embutir initialBundle",
	);
	assert.equal(
		confronto.initialMapStations.length,
		0,
		"confronto não deve embutir initialMapStations",
	);
	assert.equal(confronto.evalData, null, "confronto não deve embutir evalData");
});
