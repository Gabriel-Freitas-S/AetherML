// apps/web/test/provenance.test.ts — a tira de proveniência do painel é montada por
// funções puras: nada de DOM, nada de Svelte. `node --test` roda este arquivo direto.
//
// O alvo é honestidade: a tela precisa dizer de onde veio o número, qual é o horário
// do dado mais recente, há quanto tempo ele é, e se ele está vencido. Uma série
// totalmente no FUTURO também não é "atual", mesmo sem estar velha.

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStaleNotice } from "../src/lib/forecast-days.ts";
import type { DataAge } from "../src/lib/forecast-days.ts";
import {
	buildProvenance,
	describeOrigin,
	estimateLine,
	freshnessOf,
	getLeadLine,
} from "../src/lib/provenance.ts";
import type { DataOrigin, Freshness } from "../src/lib/provenance.ts";

/** Dado de 02/10/2026 17:00 (America/Sao_Paulo), com 1 h de idade. */
function age(overrides: Partial<DataAge> = {}): DataAge {
	return {
		observedAt: "02/10 17:00",
		ageMs: 3_600_000,
		ageText: "há 1 h",
		...overrides,
	};
}

function rowValue(rows: { label: string; value: string }[], label: string) {
	return rows.find((r) => r.label === label)?.value;
}

// ─── freshnessOf: três estados, e "velho" ganha de "adiantado" ────────────

test("freshnessOf: série com hora atual é live", () => {
	assert.equal(freshnessOf(false, false), "live");
});

test("freshnessOf: sem nenhum ponto no futuro é stale", () => {
	assert.equal(freshnessOf(true, false), "stale");
});

test("freshnessOf: série sem nenhum ponto <= now é ahead, não live", () => {
	assert.equal(freshnessOf(false, true), "ahead");
});

test("freshnessOf: stale ganha de ahead quando os dois flags vêm true (série vazia)", () => {
	assert.equal(
		freshnessOf(true, true),
		"stale",
		"prioridade documentada: série atrás é o aviso mais grave; na prática os dois true significam 'sem dado nenhum'",
	);
});

// ─── describeOrigin: origem desconhecida NUNCA se declara ML ──────────────

test("describeOrigin: ml é a única origem que se declara saída do modelo e explicita CAMS regional + meteo local + MOS in-situ", () => {
	const ml = describeOrigin("ml");
	assert.equal(ml.isMl, true);
	assert.match(ml.label, /ML|modelo/i, "o rótulo declara o modelo");
	assert.match(
		ml.detail,
		/CAMS.*meteo|previsão regional CAMS/i,
		"o detalhe deve explicitar previsão regional CAMS + correção meteorológica local",
	);
	assert.match(
		ml.detail,
		/in-situ.*MOS|MOS/i,
		"o detalhe deve explicitar que a diferenciação por estação virá com in-situ (MOS)",
	);
});

test("describeOrigin: open-meteo declara explicitamente que não é o modelo", () => {
	const api = describeOrigin("open-meteo");
	assert.equal(api.isMl, false);
	assert.match(api.label, /Open-Meteo/);
	assert.match(
		api.detail,
		/não/i,
		"o detalhe precisa recusar a autoria do modelo",
	);
});

test("describeOrigin: origem desconhecida ou inválida cai em unknown, nunca em ml", () => {
	const unknown = describeOrigin("unknown");
	const garbage = describeOrigin("sensor-p magically" as DataOrigin);
	assert.equal(unknown.isMl, false);
	assert.equal(
		garbage.isMl,
		false,
		"string fora do domínio não pode virar 'ml'",
	);
	assert.equal(garbage.label, unknown.label, "e cai na mesma faixa descritiva");
});

// ─── buildProvenance: série em dia, vinda do modelo ──────────────────────

test("buildProvenance: caminho feliz — origem, horário e idade numa tira só", () => {
	const p = buildProvenance({
		origin: "ml",
		age: age(),
		isStale: false,
		isFallback: false,
	});

	assert.equal(p.freshness, "live");
	assert.equal(p.role, null, "série em dia não anuncia nada em região viva");
	assert.equal(p.isAlert, false);
	assert.equal(p.tone, "neutral");

	assert.equal(rowValue(p.rows, "Origem"), describeOrigin("ml").label);
	assert.equal(rowValue(p.rows, "Mais recente"), "02/10 17:00");
	assert.equal(rowValue(p.rows, "Idade"), "há 1 h");
	assert.deepEqual(p.warnings, [], "nada a avisar quando tudo está em dia");
});

// ─── buildProvenance: dado velho ─────────────────────────────────────────

test("buildProvenance: dado velho vira role=alert e amber, com o aviso canônico", () => {
	const a = age({ observedAt: "26/09 09:00", ageText: "há 6 dias" });
	const p = buildProvenance({
		origin: "ml",
		age: a,
		isStale: true,
		isFallback: false,
	});

	assert.equal(p.freshness, "stale");
	assert.equal(
		p.role,
		"alert",
		"o affordance de acessibilidade do aviso antigo é preservado",
	);
	assert.equal(p.isAlert, true);
	assert.equal(p.tone, "amber");
	assert.ok(
		p.warnings.some((w) => w === formatStaleNotice(a).body),
		"o corpo do aviso vem de formatStaleNotice — uma única redação para o projeto inteiro",
	);
	assert.ok(
		p.warnings.some((w) => w.includes("26/09 09:00")),
		"a tira precisa repetir o horário do dado mais recente",
	);
});

// ─── buildProvenance: série inteira no futuro ────────────────────────────

test("buildProvenance: série no futuro é previsão normal (não é erro nem histórico) (BUG-07)", () => {
	const now = new Date("2026-10-18T12:00:00Z");
	const startFuture = "2026-10-18T13:00:00Z";
	const horizonFuture = "2026-10-23T12:00:00Z";

	const p = buildProvenance({
		origin: "ml",
		age: age({
			observedAt: "18/10 10:00",
			ageMs: -3600000,
			ageText: "em 1 h",
		}),
		isStale: false,
		isFallback: true,
		startTimestamp: startFuture,
		horizonTimestamp: horizonFuture,
		now,
	});

	assert.equal(p.freshness, "ahead");
	assert.equal(p.role, null, "previsão normal não ocupa role alert");
	assert.equal(p.isAlert, false, "previsão no futuro não é erro");
	assert.equal(p.tone, "neutral", "previsão normal tem tom neutro");
	assert.equal(p.headline, "Dados em dia");
	assert.deepEqual(
		p.warnings,
		[],
		"previsão no futuro não emite avisos de erro",
	);

	// Linhas da tira: Início da previsão (HH:MM (em X min)) e Horizonte até (DD/MM HH:MM)
	assert.equal(rowValue(p.rows, "Origem"), describeOrigin("ml").label);
	assert.equal(rowValue(p.rows, "Início da previsão"), "10:00 (em 1 h)");
	assert.equal(rowValue(p.rows, "Horizonte até"), "23/10 09:00");
});

// ─── buildProvenance: origem não-ML é sempre declarada ───────────────────

test("buildProvenance: qualquer série que não seja do modelo carrega aviso explícito", () => {
	for (const origin of ["open-meteo", "unknown"] as DataOrigin[]) {
		const p = buildProvenance({
			origin,
			age: age(),
			isStale: false,
			isFallback: true,
		});

		assert.equal(
			p.warnings.some((w) => w.includes(describeOrigin(origin).label)),
			true,
			`origem ${origin} precisa ser nomeada em voz alta`,
		);
		assert.equal(
			p.warnings.some((w) => /LightGBM|não é saída do modelo/i.test(w)),
			true,
			`origem ${origin} precisa dizer que não é saída do modelo`,
		);
	}
});

test("buildProvenance: origem não-ML no estado 'ahead' declara explicitamente a origem e role=alert", () => {
	const p = buildProvenance({
		origin: "open-meteo",
		age: age({ observedAt: "05/10 14:00" }),
		isStale: false,
		isFallback: true,
	});

	assert.equal(p.role, "alert");
	assert.equal(p.tone, "amber");
	assert.ok(p.warnings.length >= 1, "declaração de origem externa");
	assert.equal(rowValue(p.rows, "Origem"), describeOrigin("open-meteo").label);
});

test("BUG-08: unificação de redação impede que frases contraditórias coexistam", () => {
	// 1. Previsão normal (série no futuro)
	const pForecast = buildProvenance({
		origin: "ml",
		age: age({ observedAt: "18/10 13:00", ageText: "em 1 h" }),
		isStale: false,
		isFallback: true,
		startTimestamp: "2026-10-18T13:00:00Z",
		horizonTimestamp: "2026-10-23T12:00:00Z",
	});
	const leadForecast = getLeadLine({
		freshness: pForecast.freshness,
		stationName: "Camburi",
		pointsCount: 120,
		observedAt: "18/10 13:00",
		ageText: "em 1 h",
		origin: "ml",
	});

	// Não pode conter alegação de histórico nem erro
	assert.doesNotMatch(pForecast.origin.detail, /histórico/i);
	assert.doesNotMatch(leadForecast, /histórico/i);
	assert.equal(
		pForecast.isAlert,
		false,
		"previsão no futuro é o estado normal, não erro",
	);
	assert.equal(pForecast.tone, "neutral");
	for (const w of pForecast.warnings) {
		assert.doesNotMatch(w, /histórico/i);
		assert.doesNotMatch(w, /observado/i);
	}

	// 2. Série esgotada (histórico do modelo)
	const pStale = buildProvenance({
		origin: "ml",
		age: age({ observedAt: "02/10 03:00", ageText: "há 8 dias" }),
		isStale: true,
		isFallback: false,
	});
	const leadStale = getLeadLine({
		freshness: pStale.freshness,
		stationName: "Camburi",
		pointsCount: 120,
		observedAt: "02/10 03:00",
		ageText: "há 8 dias",
		origin: "ml",
	});

	// Afirma histórico do modelo, NUNCA "observado" e NUNCA "previsão" contraditória
	assert.match(pStale.origin.detail, /histórico do modelo/i);
	assert.doesNotMatch(pStale.origin.detail, /previstas pelo modelo/i);
	assert.match(leadStale, /histórico do modelo, não previsão/i);
	assert.doesNotMatch(leadStale, /observado/i);
	for (const w of pStale.warnings) {
		assert.doesNotMatch(w, /histórico observado/i);
	}

	// 3. Fallback Open-Meteo
	const pFallback = buildProvenance({
		origin: "open-meteo",
		age: age(),
		isStale: false,
		isFallback: false,
	});
	const leadFallback = getLeadLine({
		freshness: pFallback.freshness,
		stationName: "Camburi",
		pointsCount: 120,
		origin: "open-meteo",
	});
	assert.match(pFallback.origin.detail, /não é saída do LightGBM/i);
	assert.match(leadFallback, /não é saída do modelo/i);
});

test("estimateLine: condicionado à origem ativa (modelo ML vs Open-Meteo)", () => {
	// Origem ML
	const mlEstimate = estimateLine("ml");
	assert.match(mlEstimate, /valores horários do modelo/i);
	assert.match(mlEstimate, /CONAMA 491/i);

	// Fallback Open-Meteo: não pode afirmar ser do modelo
	const omEstimate = estimateLine("open-meteo");
	assert.match(omEstimate, /valores horários da API Open-Meteo/i);
	assert.doesNotMatch(omEstimate, /do modelo/i);
	assert.match(omEstimate, /CONAMA 491/i);

	// Default sem origem
	assert.match(estimateLine(), /valores horários do modelo/i);
	assert.match(estimateLine(null), /valores horários do modelo/i);

	// Origem genérica / desconhecida
	const unkEstimate = estimateLine("unknown" as any);
	assert.match(unkEstimate, /valores horários;/i);
	assert.doesNotMatch(unkEstimate, /do modelo/i);
	assert.doesNotMatch(unkEstimate, /Open-Meteo/i);
});

test("getLeadLine: defensivo à origem em stale e sem contagem enganosa em open-meteo", () => {
	// Stale com Open-Meteo não pode dizer "histórico do modelo"
	const staleOm = getLeadLine({
		freshness: "stale",
		stationName: "Camburi",
		pointsCount: 120,
		observedAt: "02/10 03:00",
		ageText: "há 8 dias",
		origin: "open-meteo",
	});
	assert.doesNotMatch(staleOm, /histórico do modelo/i);
	assert.match(staleOm, /Open-Meteo/i);

	// Open-Meteo não diz "próximas N h" (que contaria horas passadas)
	const omLead = getLeadLine({
		freshness: "live",
		stationName: "Camburi",
		pointsCount: 120,
		origin: "open-meteo",
	});
	assert.doesNotMatch(omLead, /próximas 120 h/i);
	assert.match(omLead, /120 h de dados/i);
});

test("buildProvenance: sem dado nenhum a tira diz '—' em vez de mentir com vazio", () => {
	const p = buildProvenance({
		origin: "ml",
		age: age({ observedAt: null, ageMs: null, ageText: "" }),
		isStale: false,
		isFallback: false,
	});

	assert.equal(rowValue(p.rows, "Mais recente"), "—");
	assert.equal(rowValue(p.rows, "Idade"), "—");
});

test("buildProvenance: freshness exposto bate com freshnessOf", () => {
	const combos: [boolean, boolean, Freshness][] = [
		[false, false, "live"],
		[true, false, "stale"],
		[false, true, "ahead"],
		[true, true, "stale"],
	];
	for (const [isStale, isFallback, expected] of combos) {
		const p = buildProvenance({
			origin: "ml",
			age: age(),
			isStale,
			isFallback,
		});
		assert.equal(
			p.freshness,
			expected,
			`isStale=${isStale} isFallback=${isFallback}`,
		);
	}
});

test("buildProvenance: os rótulos de linha são fixos — a UI não pode reescrevê-los", () => {
	const p = buildProvenance({
		origin: "ml",
		age: age(),
		isStale: false,
		isFallback: false,
	});
	assert.deepEqual(
		p.rows.map((r) => r.label),
		["Origem", "Mais recente", "Idade"],
	);
});
