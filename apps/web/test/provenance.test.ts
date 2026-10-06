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
	freshnessOf,
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

test("describeOrigin: ml é a única origem que se declara saída do modelo", () => {
	const ml = describeOrigin("ml");
	assert.equal(ml.isMl, true);
	assert.match(ml.label, /ML|modelo/i, "o rótulo declara o modelo");
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

test("buildProvenance: série no futuro avisa que o IQAr do topo NÃO é a hora atual", () => {
	const p = buildProvenance({
		origin: "ml",
		age: age({
			observedAt: "05/10 14:00",
			ageMs: -259_200_000,
			ageText: "em 3 dias",
		}),
		isStale: false,
		isFallback: true,
	});

	assert.equal(p.freshness, "ahead");
	assert.equal(p.role, "alert");
	assert.ok(
		p.warnings.some((w) => w.includes("05/10 14:00") && /não/i.test(w)),
		"o aviso nomeia o primeiro ponto e diz que ele não é 'agora'",
	);
	assert.ok(
		!p.warnings.some((w) => w === formatStaleNotice(age()).body),
		"'ahead' não pode reusar o texto de 'velho': são afirmações opostas sobre a série",
	);
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

test("buildProvenance: origem não-ML no estado 'ahead' someia os dois avisos, sem perder nenhum", () => {
	const p = buildProvenance({
		origin: "open-meteo",
		age: age({ observedAt: "05/10 14:00" }),
		isStale: false,
		isFallback: true,
	});

	assert.equal(p.role, "alert");
	assert.equal(p.tone, "amber");
	assert.ok(
		p.warnings.length >= 2,
		"proveniência E atualidade são dois fatos distintos",
	);
	assert.equal(rowValue(p.rows, "Origem"), describeOrigin("open-meteo").label);
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
