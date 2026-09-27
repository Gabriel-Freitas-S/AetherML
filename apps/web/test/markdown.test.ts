import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/lib/markdown.ts";

test("renderMarkdown: renderiza fórmulas LaTeX em bloco ($$...$$) usando KaTeX", () => {
	const md = "$$\\mathcal{O}(K \\cdot D)$$";
	const html = renderMarkdown(md);
	assert.ok(
		html.includes("katex-display-wrapper"),
		"Deve conter o container de exibição",
	);
	assert.ok(html.includes("katex"), "Deve conter classes do KaTeX");
	assert.ok(!html.includes("$$"), "Não deve conter delimitadores brutos $$");
});

test("renderMarkdown: renderiza a fórmula canônica do IQAr CONAMA 491/2018", () => {
	const md =
		"$$I_p = I_{ini} + \\frac{I_{fim} - I_{ini}}{C_{fim} - C_{ini}} \\cdot (C_p - C_{ini})$$";
	const html = renderMarkdown(md);
	assert.ok(html.includes("katex-display-wrapper"));
	assert.ok(html.includes("katex"));
	assert.ok(html.includes("frac-line"));
});

test("renderMarkdown: renderiza fórmulas LaTeX inline ($...$) no texto", () => {
	const md = "O valor basal é $\\Phi_0$ e a variável é $x_i$.";
	const html = renderMarkdown(md);
	assert.ok(html.includes("katex"));
	assert.ok(!html.includes("$\\Phi_0$"));
	assert.ok(!html.includes("$x_i$"));
});

test("renderMarkdown: renderiza fórmulas LaTeX dentro de tabelas Markdown", () => {
	const md = `
| Fenômeno | Restrição |
| :--- | :--- |
| Emissão | $\\partial \\hat{y} / \\partial \\text{emissão} \\ge 0$ |
`;
	const html = renderMarkdown(md);
	assert.ok(html.includes("<table"));
	assert.ok(html.includes("katex"));
	assert.ok(!html.includes("$\\partial"));
});

test("renderMarkdown: preserva blocos de código com $ sem interpretar como LaTeX", () => {
	const md = "```bash\necho $VARIABLE\n```";
	const html = renderMarkdown(md);
	assert.ok(html.includes("<pre"));
	assert.ok(html.includes("echo $VARIABLE"));
	assert.ok(!html.includes("katex"));
});

test("renderMarkdown: preserva código inline com $ sem interpretar como LaTeX", () => {
	const md = "Use o comando `echo $PATH` no terminal.";
	const html = renderMarkdown(md);
	assert.ok(html.includes("<code"));
	assert.ok(html.includes("echo $PATH"));
	assert.ok(!html.includes("katex"));
});
