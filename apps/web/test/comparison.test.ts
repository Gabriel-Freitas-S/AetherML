// apps/web/test/comparison.test.ts — lógica pura da comparação ML × Open-Meteo.
// Sem DOM e sem Svelte: `node --test` roda este arquivo direto.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	IQAR_BANDS,
	POLLUTANT_ORDER,
	alignLengths,
	axisTicks,
	badgeClass,
	buildResidual,
	buildSeries,
	caveatsMentioning,
	coverageOf,
	describeSeries,
	extent,
	formatHoldoutRange,
	formatMetric,
	formatSigned,
	iqarBand,
	iqarHex,
	iqarIcon,
	iqarTextColor,
	isRenderable,
	niceCeiling,
	polylineSegments,
	residualDirection,
} from "../src/lib/comparison.ts";
import type { ComparisonStation } from "../src/lib/comparison.ts";

const T0 = Date.parse("2026-09-25T17:00:00Z");

function iso(i: number): string {
	return new Date(T0 + i * 3_600_000).toISOString().replace(".000Z", "Z");
}

/** Estação fake de 168 h com as duas séries presentes. */
function station(
	overrides: Partial<ComparisonStation> = {},
): ComparisonStation {
	const n = 6;
	return {
		id: "ramqar_camburi",
		name: "Camburi - Vitória",
		municipality: "Vitória",
		lat: -20.2764,
		lon: -40.2881,
		timestamps: Array.from({ length: n }, (_, i) => iso(i)),
		pollutants: {
			pm25: {
				ml: [10, 11, 12, 13, 14, 15],
				api: [9, 11, 14, 13, 12, 16],
			},
		} as ComparisonStation["pollutants"],
		...overrides,
	};
}

// ─── Alinhamento das três séries paralelas ────────────────────────────────

test("alignLengths: devolve o MENOR comprimento — nunca o maior nem a média", () => {
	assert.equal(
		alignLengths([1, 2, 3], ["a", "b"], [true, false, true, false]),
		2,
	);
	assert.equal(alignLengths([], [1], [2]), 0);
	assert.equal(alignLengths([1, 2], [3, 4], [5, 6]), 2);
});

test("buildSeries: trunca ao menor comprimento e mantém timestamps alinhados", () => {
	const s = buildSeries(
		station({
			timestamps: [iso(0), iso(1), iso(2), iso(3)],
			pollutants: {
				pm25: { ml: [1, 2, 3, 4, 5], api: [1, 1, 1] },
			} as ComparisonStation["pollutants"],
		}),
		"pm25",
	);

	assert.equal(s.length, 3, "timestamps(4) × ml(5) × api(3) → 3, o menor");
	assert.deepEqual(s.timestamps, [iso(0), iso(1), iso(2)]);
	assert.deepEqual(s.ml, [1, 2, 3]);
	assert.deepEqual(s.api, [1, 1, 1]);
	assert.deepEqual(s.residual, [0, -1, -2], "residual = api − ml");
});

test("buildSeries: poluente ausente ou estação ausente devolve série vazia, não erro", () => {
	const s = buildSeries(station(), "no2");
	assert.equal(s.length, 0);
	assert.deepEqual(s.ml, []);
	assert.deepEqual(s.residual, []);
	assert.equal(isRenderable(s), false);

	const none = buildSeries(null, "pm25");
	assert.equal(none.length, 0);
	assert.equal(isRenderable(none), false);
});

// ─── Resíduo: api − ml, com sinal ────────────────────────────────────────

test("buildResidual: api − ml com sinal preservado", () => {
	assert.deepEqual(buildResidual([10, 5, 8], [8, 5, 10]), [2, 0, -2]);
});

test("buildResidual: null em qualquer lado vira null — nunca zero nem interpolação", () => {
	assert.deepEqual(
		buildResidual([10, null, 8], [9, 7, null]),
		[1, null, null],
		"uma hora sem api e uma sem ml são ambas lacunas, e não 0",
	);
});

test("buildResidual: arrays de tamanhos diferentes são truncados ao menor", () => {
	assert.deepEqual(buildResidual([10, 20, 30], [5]), [5]);
});

// ─── Lacunas na linha: quebra, não ponte ──────────────────────────────────

test("polylineSegments: null QUEBRA a linha — nunca interpola por cima", () => {
	const segs = polylineSegments([1, 2, null, 4, 5]);

	assert.equal(segs.length, 2, "duas polilinhas disjuntas");
	assert.deepEqual(segs[0], [
		{ index: 0, value: 1 },
		{ index: 1, value: 2 },
	]);
	assert.deepEqual(
		segs[1],
		[
			{ index: 3, value: 4 },
			{ index: 4, value: 5 },
		],
		"o trecho depois da lacuna não carrega o valor de antes nem de depois",
	);
});

test("polylineSegments: null no início/fim produz segmentos parciais", () => {
	assert.deepEqual(polylineSegments([null, 3, 4]), [
		[
			{ index: 1, value: 3 },
			{ index: 2, value: 4 },
		],
	]);
	assert.deepEqual(polylineSegments([null, null]), []);
});

test("polylineSegments: sequência totalmente nula não gera linha alguma", () => {
	assert.deepEqual(polylineSegments([null, null, null]), []);
	assert.deepEqual(polylineSegments([]), []);
});

// ─── Cobertura e ausência de dados ───────────────────────────────────────

test("coverageOf: mede quanto da série existe de fato, não o comprimento do array", () => {
	assert.equal(coverageOf([1, 2, 3, 4]), 1);
	assert.equal(coverageOf([1, null, 3, null]), 0.5);
	assert.equal(coverageOf([null, null]), 0);
	assert.equal(coverageOf([]), 0, "série vazia não é 100% coberta");
});

test("describeSeries: conta n, lacunas e cobertura", () => {
	const st = describeSeries([1, null, 3, null]);
	assert.equal(st.total, 4);
	assert.equal(st.missing, 2);
	assert.equal(st.present, 2);
	assert.equal(st.coverage, 0.5);
});

test("isRenderable: true com um único ponto de qualquer lado da dupla", () => {
	assert.equal(isRenderable(buildSeries(station(), "pm25")), true);
	assert.equal(
		isRenderable({
			timestamps: [iso(0)],
			ml: [null],
			api: [12],
			residual: [null],
			length: 1,
		}),
		true,
		"um lado só já é informação: a lacuna é da API, não do ML",
	);
	assert.equal(
		isRenderable({
			timestamps: [iso(0)],
			ml: [null],
			api: [null],
			residual: [null],
			length: 1,
		}),
		false,
		"os dois lados ausentes = nada a desenhar; a UI precisa dizer isso",
	);
});

// ─── Escala do eixo Y ────────────────────────────────────────────────────

test("niceCeiling: arredonda para cima um múltiplo do passo", () => {
	assert.equal(niceCeiling(37, 10), 40);
	assert.equal(niceCeiling(40, 10), 40);
	assert.equal(niceCeiling(41, 10), 50);
	assert.equal(niceCeiling(0, 10), 0);
});

test("axisTicks: gera marcas de 0 ao teto em passos iguais, incluindo o teto", () => {
	assert.deepEqual(axisTicks(40, 10), [0, 10, 20, 30, 40]);
	assert.deepEqual(
		axisTicks(0, 10),
		[0],
		"escala degenerada não gera divisão infinita",
	);
});

test("extent: ignora null e devolve null quando não há nenhum valor", () => {
	assert.deepEqual(extent([3, null, 9, 1]), { min: 1, max: 9 });
	assert.deepEqual(extent([null, null]), null);
	assert.deepEqual(extent([]), null);
});

// ─── Formatação honesta de métrica (viés com sinal) ───────────────────────

test("formatSigned: viés mantém o sinal; nunca vira módulo", () => {
	assert.equal(formatSigned(0.119, 3), "+0.119");
	assert.equal(formatSigned(-1.5, 3), "-1.500");
	assert.equal(formatSigned(0, 3), "0.000");
});

test("formatSigned/formatMetric: valor ausente é '—', nunca 0", () => {
	assert.equal(formatSigned(null), "—");
	assert.equal(formatSigned(undefined), "—");
	assert.equal(formatSigned(Number.NaN), "—");
	assert.equal(formatMetric(null), "—");
	assert.equal(
		formatMetric(Number.POSITIVE_INFINITY),
		"—",
		"∞ não é um número plotável",
	);
});

test("formatMetric: arredonda no dígito pedido e usa ponto decimal", () => {
	assert.equal(formatMetric(0.573, 3), "0.573");
	assert.equal(formatMetric(1512, 0), "1512");
});

// ─── Direção do resíduo ──────────────────────────────────────────────────

test("residualDirection: separa acima/abaixo de zero, contando apenas horas válidas", () => {
	const d = residualDirection([2, -3, 0, null, 1]);

	assert.equal(d.above, 2, "2 e 1 são positivos");
	assert.equal(d.below, 1, "−3 é negativo");
	assert.equal(d.atZero, 1);
	assert.equal(d.total, 4, "a hora com null não entra em nenhum grupo");
});

test("residualDirection: série vazia ou toda nula não divide por zero", () => {
	const d = residualDirection([null, null]);
	assert.equal(d.total, 0);
	assert.equal(d.aboveShare, 0);
	assert.equal(d.belowShare, 0);
});

// ─── Ressalvas por poluente ──────────────────────────────────────────────

test("caveatsMentioning: isola a ressalva do poluente pedido", () => {
	const caveats = [
		"no2 tem piso físico de 3.0 µg/m³",
		"20.2% das previsões de no2 ficam abaixo do piso",
		"A curva 'api' é a re-análise CAMS",
	];

	assert.equal(caveatsMentioning(caveats, "no2").length, 2);
	assert.equal(caveatsMentioning(caveats, "pm25").length, 0);
	assert.equal(caveatsMentioning([], "no2").length, 0);
});

// ─── Janela do holdout ───────────────────────────────────────────────────

test("formatHoldoutRange: monta a janela no fuso da rede a partir do artefato", () => {
	assert.equal(
		formatHoldoutRange("2026-09-25T17:00Z", "2026-10-02T16:00Z"),
		"25/09 14:00 → 02/10 13:00",
	);
});

test("formatHoldoutRange: bordas ausentes não viram 'Invalid Date'", () => {
	assert.equal(
		formatHoldoutRange(null, "2026-10-02T16:00Z"),
		"— → 02/10 13:00",
	);
	assert.equal(
		formatHoldoutRange("2026-09-25T17:00Z", null),
		"25/09 14:00 → —",
	);
	assert.equal(formatHoldoutRange(null, null), "—");
});

// ─── Contrato do artefato ────────────────────────────────────────────────

test("POLLUTANT_ORDER: a ordem canônica dos 5 alvos do modelo", () => {
	assert.deepEqual([...POLLUTANT_ORDER], ["pm25", "pm10", "o3", "no2", "so2"]);
});

// ─── Rampa de IQAr: uma só verdade sobre cor de saúde ────────────────────

test("iqarBand: as 5 faixas CONAMA e a ordem da melhor para a pior", () => {
	assert.deepEqual(
		IQAR_BANDS.map((b) => b.cls),
		["Boa", "Moderada", "Ruim", "Muito Ruim", "Péssima"],
	);
	assert.deepEqual(
		IQAR_BANDS.map((b) => b.label),
		IQAR_BANDS.map((b) => b.cls),
		"o rótulo é a própria faixa: a regra do produto proíbe reformulá-la",
	);
});

test("iqarBand: faixa desconhecida cai na pior, nunca na melhor", () => {
	assert.equal(iqarBand("inexistente").cls, "Péssima");
	assert.equal(iqarBand(null).cls, "Péssima");
	assert.equal(iqarBand(undefined).cls, "Péssima");
	assert.equal(iqarBand("").cls, "Péssima");
});

test("iqarBand: hex e text são cores distintas — text é o par de texto AA", () => {
	for (const band of IQAR_BANDS) {
		assert.notEqual(
			band.text,
			band.hex,
			`${band.cls}: a cor de texto não pode ser a cor de preenchimento`,
		);
	}
});

test("iqarIcon: toda faixa tem glifo próprio — cor nunca é o único sinal", () => {
	const icons = IQAR_BANDS.map((b) => iqarIcon(b.cls));
	assert.equal(
		new Set(icons).size,
		IQAR_BANDS.length,
		"glifos distintos por faixa",
	);
});

test("iqarHex/iqarTextColor/badgeClass: os quatro acessors leem a MESMA tabela", () => {
	// Este é o teste antISSIM-paleta: qualquer cópia local da rampa que diverja
	// dele quebra aqui, e não numa tela de saúde.
	assert.equal(iqarHex("Ruim"), "#f97316");
	assert.equal(iqarTextColor("Ruim"), "#c2410c");
	assert.equal(badgeClass("Ruim"), "badge-ruim");
	assert.equal(iqarBand("Ruim").hex, iqarHex("Ruim"));
	assert.equal(iqarBand("Ruim").text, iqarTextColor("Ruim"));
	assert.equal(iqarBand("Ruim").badge, badgeClass("Ruim"));
	assert.equal(iqarBand("Ruim").icon, iqarIcon("Ruim"));
});
