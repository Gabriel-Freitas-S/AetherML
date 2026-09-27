import katex from "katex";

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMarkdown(md: string): string {
	const codeTokens: string[] = [];
	const mathTokens: string[] = [];

	// 1. Isolar blocos de código com cercas ```...```
	let text = md.replace(
		/```([a-z0-9_-]*)\n([\s\S]*?)```/gi,
		(_, _lang, code) => {
			const id = `@@CODE_BLOCK_${codeTokens.length}@@`;
			codeTokens.push(
				`<pre class="bg-slate-900 p-4 rounded-xl font-mono text-xs text-sky-200 overflow-x-auto my-4 shadow-inner"><code>${escapeHtml(code.trim())}</code></pre>`,
			);
			return id;
		},
	);

	// 2. Isolar código inline `...`
	text = text.replace(/`([^`\n]+)`/g, (_, code) => {
		const id = `@@CODE_INLINE_${codeTokens.length}@@`;
		codeTokens.push(
			`<code class="bg-sky-50 text-sky-800 border border-sky-100 px-1.5 py-0.5 rounded-md font-mono text-xs">${escapeHtml(code)}</code>`,
		);
		return id;
	});

	// 3. Fórmulas LaTeX em bloco $$...$$
	text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
		const id = `@@MATH_BLOCK_${mathTokens.length}@@`;
		try {
			const rendered = katex.renderToString(math.trim(), {
				displayMode: true,
				throwOnError: false,
			});
			mathTokens.push(
				`<div class="katex-display-wrapper overflow-x-auto my-5 py-3 px-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 text-center shadow-sm select-all">${rendered}</div>`,
			);
		} catch {
			mathTokens.push(
				`<div class="katex-display-wrapper my-4 text-center text-red-600 font-mono text-xs">${escapeHtml(math)}</div>`,
			);
		}
		return id;
	});

	// 4. Fórmulas LaTeX inline $...$
	text = text.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, prefix, math) => {
		const id = `@@MATH_INLINE_${mathTokens.length}@@`;
		try {
			const rendered = katex.renderToString(math.trim(), {
				displayMode: false,
				throwOnError: false,
			});
			mathTokens.push(rendered);
		} catch {
			mathTokens.push(`<code>${escapeHtml(math)}</code>`);
		}
		return `${prefix}${id}`;
	});

	// 5. Escapar caracteres HTML no corpo de texto
	text = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

	// 6. Tabelas markdown (| a | b |)
	text = text.replace(/(?:^\|.*\|\s*\n)+/gm, (block) => {
		const rows = block
			.trim()
			.split("\n")
			.filter((r) => !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(r));
		const cells = rows.map((r) =>
			r
				.trim()
				.replace(/^\||\|$/g, "")
				.split("|")
				.map((c) => c.trim()),
		);
		if (!cells.length) return block;
		const [head, ...body] = cells;
		const th = head
			.map(
				(h) =>
					`<th class="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500 font-bold">${h}</th>`,
			)
			.join("");
		const tb = body
			.map(
				(r, i) =>
					`<tr class="${i % 2 ? "bg-slate-50" : "bg-white"}">${r
						.map(
							(c) =>
								`<td class="px-3 py-2 text-[13px] text-slate-700 border-t border-slate-100">${c}</td>`,
						)
						.join("")}</tr>`,
			)
			.join("");
		return `<div class="overflow-x-auto my-5 rounded-xl border border-slate-200 shadow-sm"><table class="w-full min-w-[560px] border-collapse bg-white"><thead class="bg-slate-100"><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
	});

	// 7. Títulos
	text = text.replace(
		/^#### (.*$)/gim,
		'<h4 class="text-sm font-bold text-slate-800 mt-5 mb-1.5">$1</h4>',
	);
	text = text.replace(
		/^### (.*$)/gim,
		'<h3 class="text-base font-bold text-slate-800 mt-6 mb-2">$1</h3>',
	);
	text = text.replace(
		/^## (.*$)/gim,
		'<h2 class="text-xl font-extrabold text-slate-900 mt-8 mb-3 pb-2 border-b border-slate-200">$1</h2>',
	);
	text = text.replace(
		/^# (.*$)/gim,
		'<h1 class="text-2xl sm:text-3xl font-black text-slate-900 mb-4 tracking-tight">$1</h1>',
	);

	// 8. Negrito e itálico
	text = text.replace(
		/\*\*([^*]+)\*\*/g,
		'<strong class="text-slate-900 font-bold">$1</strong>',
	);
	text = text.replace(
		/\*([^*]+)\*/g,
		'<em class="text-slate-600 italic">$1</em>',
	);

	// 9. Listas
	text = text.replace(
		/^\s*-\s+(.*$)/gim,
		'<li class="text-slate-600 text-sm ml-5 list-disc my-1">$1</li>',
	);

	// 10. Divisórias
	text = text.replace(/^---$/gim, '<hr class="my-6 border-slate-200" />');

	// 11. Parágrafos e callouts (> [!TIPO] e > texto)
	const paragraphs = text.split(/\n\n+/);
	let html = paragraphs
		.map((rawP) => {
			const p = rawP.trim();
			if (!p) return "";
			if (
				p.startsWith("<h") ||
				p.startsWith("<pre") ||
				p.startsWith("<li") ||
				p.startsWith("<div") ||
				p.startsWith("<hr") ||
				p.startsWith("@@MATH_BLOCK_")
			) {
				return p;
			}
			const callout = p.match(
				/^&gt; \[!(NOTE|IMPORTANT|WARNING)\]\s*([\s\S]*)$/,
			);
			if (callout) {
				const styles: Record<string, string> = {
					NOTE: "bg-sky-50 border-sky-200 text-sky-900",
					IMPORTANT: "bg-emerald-50 border-emerald-200 text-emerald-900",
					WARNING: "bg-amber-50 border-amber-200 text-amber-900",
				};
				const s = styles[callout[1]] ?? styles.NOTE;
				return `<div class="my-4 px-4 py-3 rounded-xl border text-sm leading-relaxed ${s}">${callout[2].replace(/\n&gt; ?/g, "<br />")}</div>`;
			}
			if (p.startsWith("&gt;")) {
				return `<blockquote class="my-4 pl-4 border-l-2 border-slate-300 text-slate-600 italic text-sm">${p.replace(/^&gt; ?/gm, "")}</blockquote>`;
			}
			return `<p class="text-slate-600 text-[15px] leading-relaxed my-3">${p}</p>`;
		})
		.join("\n");

	// 12. Restaurar tokens de Math e Code
	html = html.replace(
		/@@MATH_BLOCK_(\d+)@@/g,
		(_, idx) => mathTokens[Number(idx)] ?? "",
	);
	html = html.replace(
		/@@MATH_INLINE_(\d+)@@/g,
		(_, idx) => mathTokens[Number(idx)] ?? "",
	);
	html = html.replace(
		/@@CODE_BLOCK_(\d+)@@/g,
		(_, idx) => codeTokens[Number(idx)] ?? "",
	);
	html = html.replace(
		/@@CODE_INLINE_(\d+)@@/g,
		(_, idx) => codeTokens[Number(idx)] ?? "",
	);

	return html;
}
