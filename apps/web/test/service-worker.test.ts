import assert from "node:assert/strict";
import { test } from "node:test";
import {
	STATIC_ASSETS,
	canCacheModelResponse,
	cleanRedirectedResponse,
	isDashboardNavigationPath,
	resolveOfflineDataFallbackUrl,
} from "../src/lib/sw-core.ts";

test("STATIC_ASSETS inclui os 4 JSONs de dados, offline.html e rotas principais do painel", () => {
	assert.ok(STATIC_ASSETS.includes("/"));
	assert.ok(STATIC_ASSETS.includes("/confronto"));
	assert.ok(STATIC_ASSETS.includes("/offline.html"));
	assert.ok(STATIC_ASSETS.includes("/data/stations-data.json"));
	assert.ok(STATIC_ASSETS.includes("/data/model-eval.json"));
	assert.ok(STATIC_ASSETS.includes("/data/comparison-data.json"));
	assert.ok(STATIC_ASSETS.includes("/data/forecast-compare.json"));
	assert.ok(STATIC_ASSETS.includes("/models/registry.json"));
});

test("cleanRedirectedResponse remove flag redirected=true para evitar net::ERR_FAILED em navegação", async () => {
	const raw = new Response("<html>Offline</html>", {
		status: 200,
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
	// Simula resposta marcada como redirecionada pelo Cloudflare Pages (/offline.html -> /offline)
	Object.defineProperty(raw, "redirected", { value: true });
	assert.equal(raw.redirected, true);

	const cleaned = await cleanRedirectedResponse(raw);
	assert.equal(cleaned.redirected, false);
	assert.equal(cleaned.status, 200);
	assert.equal(cleaned.headers.get("Content-Type"), "text/html; charset=utf-8");
	assert.equal(await cleaned.text(), "<html>Offline</html>");
});

test("cleanRedirectedResponse devolve a própria resposta quando redirected=false", async () => {
	const normal = new Response("ok", { status: 200 });
	const out = await cleanRedirectedResponse(normal);
	assert.equal(out, normal);
	assert.equal(out.redirected, false);
});

test("resolveOfflineDataFallbackUrl não substitui comparison-data ou forecast-compare por stations-data", () => {
	assert.equal(
		resolveOfflineDataFallbackUrl("/data/stations-data.json"),
		"/data/stations-data.json",
	);
	assert.equal(
		resolveOfflineDataFallbackUrl("/api/forecast"),
		"/data/stations-data.json",
	);
	assert.equal(
		resolveOfflineDataFallbackUrl("/data/comparison-data.json"),
		null,
	);
	assert.equal(
		resolveOfflineDataFallbackUrl("/data/forecast-compare.json"),
		null,
	);
	assert.equal(resolveOfflineDataFallbackUrl("/data/model-eval.json"), null);
});

test("canCacheModelResponse recusa respostas HTML (SPA fallback 200) para não envenenar CACHE_MODELS", () => {
	const htmlFallback = new Response("<!DOCTYPE html><html></html>", {
		status: 200,
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
	assert.equal(canCacheModelResponse(htmlFallback), false);

	const wasmRes = new Response(new Uint8Array([0, 97, 115, 109]), {
		status: 200,
		headers: { "Content-Type": "application/wasm" },
	});
	assert.equal(canCacheModelResponse(wasmRes), true);

	const mjsRes = new Response("export default {}", {
		status: 200,
		headers: { "Content-Type": "text/javascript" },
	});
	assert.equal(canCacheModelResponse(mjsRes), true);
});

import fs from "node:fs";
import path from "node:path";

test("isDashboardNavigationPath identifica todas as rotas que podem usar o shell '/' offline", () => {
	assert.equal(isDashboardNavigationPath("/"), true);
	assert.equal(isDashboardNavigationPath("/mapa"), true);
	assert.equal(isDashboardNavigationPath("/precisao"), true);
	assert.equal(isDashboardNavigationPath("/confronto"), true);
	assert.equal(isDashboardNavigationPath("/comparacao"), true);
	assert.equal(isDashboardNavigationPath("/comparacao-previsao"), true);
	assert.equal(isDashboardNavigationPath("/docs/arquitetura"), false);
	assert.equal(isDashboardNavigationPath("/estacao/ramqar_camburi"), false);
});

test("todo arquivo .wasm em apps/web/public/wasm possui um loader .mjs irmão (guarda ONNX Runtime Web)", () => {
	const wasmDir = path.resolve(import.meta.dirname, "../public/wasm");
	const entries = fs.readdirSync(wasmDir);
	const wasmFiles = entries.filter((f) => f.endsWith(".wasm"));
	assert.ok(
		wasmFiles.length > 0,
		"Deve haver pelo menos um arquivo .wasm em public/wasm",
	);
	for (const wasmFile of wasmFiles) {
		const expectedMjs = wasmFile.replace(/\.wasm$/, ".mjs");
		assert.ok(
			entries.includes(expectedMjs),
			`Arquivo ${wasmFile} não possui loader irmão ${expectedMjs} em public/wasm`,
		);
	}
});
