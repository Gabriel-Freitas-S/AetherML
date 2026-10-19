import assert from "node:assert/strict";
import { test } from "node:test";
import {
	STATIC_ASSETS,
	canCacheModelResponse,
	cleanRedirectedResponse,
	fetchModelAsset,
	getModelCacheStrategy,
	isDashboardNavigationPath,
	isModelMetadataPath,
	isModelOrWasmPath,
	resolveOfflineDataFallbackUrl,
	versionedAssetUrl,
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

test("STATIC_ASSETS inclui calibration.json para garantir calibração offline-first", () => {
	assert.ok(STATIC_ASSETS.includes("/models/calibration.json"));
});

test("versionedAssetUrl anexa ou substitui query param de versão v corretamente", () => {
	// Caminho feliz: sem query string anterior
	assert.equal(
		versionedAssetUrl("/models/pm25.onnx", "v2026.42.1"),
		"/models/pm25.onnx?v=v2026.42.1",
	);
	assert.equal(
		versionedAssetUrl("/models/calibration.json", "v2026.42.1"),
		"/models/calibration.json?v=v2026.42.1",
	);
	// Com parâmetros pré-existentes
	assert.equal(
		versionedAssetUrl("/models/pm25.onnx?backend=wasm", "v2026.42.1"),
		"/models/pm25.onnx?backend=wasm&v=v2026.42.1",
	);
	// Substituição de versão anterior
	assert.equal(
		versionedAssetUrl("/models/pm25.onnx?v=v2026.38.5", "v2026.42.1"),
		"/models/pm25.onnx?v=v2026.42.1",
	);
	// Versão vazia ou ausente: mantém path intocado
	assert.equal(versionedAssetUrl("/models/pm25.onnx", ""), "/models/pm25.onnx");
	assert.equal(
		versionedAssetUrl("/models/pm25.onnx", undefined),
		"/models/pm25.onnx",
	);
	assert.equal(
		versionedAssetUrl("/models/pm25.onnx", null),
		"/models/pm25.onnx",
	);
});

test("isModelMetadataPath classifica registry.json e calibration.json como metadados", () => {
	assert.equal(isModelMetadataPath("/models/registry.json"), true);
	assert.equal(isModelMetadataPath("/models/calibration.json"), true);
	assert.equal(isModelMetadataPath("/models/pm25.onnx"), false);
	assert.equal(isModelMetadataPath("/models/pm25.topology.json"), false);
	assert.equal(isModelMetadataPath("/wasm/ort-wasm-simd.wasm"), false);
	assert.equal(isModelMetadataPath("/data/stations-data.json"), false);
});

test("isModelOrWasmPath identifica assets sob /models/ ou /wasm/", () => {
	assert.equal(isModelOrWasmPath("/models/pm25.onnx"), true);
	assert.equal(isModelOrWasmPath("/models/registry.json"), true);
	assert.equal(isModelOrWasmPath("/wasm/ort-wasm-simd.wasm"), true);
	assert.equal(isModelOrWasmPath("/data/stations-data.json"), false);
	assert.equal(isModelOrWasmPath("/api/forecast"), false);
	assert.equal(isModelOrWasmPath("/confronto"), false);
});

test("getModelCacheStrategy separa network-first (metadados) de cache-first (modelos/wasm)", () => {
	assert.equal(getModelCacheStrategy("/models/registry.json"), "network-first");
	assert.equal(
		getModelCacheStrategy("/models/calibration.json"),
		"network-first",
	);
	assert.equal(getModelCacheStrategy("/models/pm25.onnx"), "cache-first");
	assert.equal(
		getModelCacheStrategy("/models/pm25.topology.json"),
		"cache-first",
	);
	assert.equal(
		getModelCacheStrategy("/wasm/ort-wasm-simd.wasm"),
		"cache-first",
	);
	assert.equal(getModelCacheStrategy("/data/stations-data.json"), null);
});

test("match de modelo com versão exige query param exato (sem ignoreSearch) para evitar mismatch", async () => {
	// Simulação de cache com Request / Response
	const store = new Map<string, Response>();
	const fakeCache = {
		put: async (req: Request | string, res: Response) => {
			const key = typeof req === "string" ? req : req.url;
			store.set(key, res);
		},
		match: async (
			req: Request | string,
			options?: { ignoreSearch?: boolean },
		) => {
			const key = typeof req === "string" ? req : req.url;
			if (options?.ignoreSearch) {
				const targetBase = key.split("?")[0];
				for (const [storedUrl, res] of store.entries()) {
					if (storedUrl.split("?")[0] === targetBase) {
						return res;
					}
				}
				return undefined;
			}
			return store.get(key);
		},
	};

	// Popula cache antigo com modelo da v2026.38.5
	const oldModelUrl =
		"https://aetherml.pages.dev/models/pm25.onnx?v=v2026.38.5";
	const oldResponse = new Response("old_weights_v38_5", {
		headers: { "Content-Type": "application/octet-stream" },
	});
	await fakeCache.put(oldModelUrl, oldResponse);

	// Nova requisição buscando o modelo promovido v2026.42.1
	const newRequestUrl =
		"https://aetherml.pages.dev/models/pm25.onnx?v=v2026.42.1";

	// Comportamento ANTERIOR (com ignoreSearch: true) -> causava o BUG:
	const buggyMatch = await fakeCache.match(newRequestUrl, {
		ignoreSearch: true,
	});
	assert.ok(buggyMatch, "ignoreSearch=true devolvia modelo antigo!");
	assert.equal(await buggyMatch.text(), "old_weights_v38_5"); // Mismatch garantido!

	// Comportamento NOVO (match exato pela URL completa, sem ignoreSearch) -> PREVINE O BUG:
	const fixedMatch = await fakeCache.match(newRequestUrl);
	assert.equal(
		fixedMatch,
		undefined,
		"Match exato deve dar cache-miss quando a versão muda, forçando fetch novo da rede",
	);
});

test("fetchModelAsset faz fetch com { cache: 'no-cache' } e armazena resposta válida", async () => {
	const store = new Map<string, Response>();
	const fakeCache = {
		match: async (req: Request | string) => {
			const key = typeof req === "string" ? req : req.url;
			return store.get(key);
		},
		put: async (req: Request | string, res: Response) => {
			const key = typeof req === "string" ? req : req.url;
			store.set(key, res);
		},
	};

	let capturedOptions: RequestInit | undefined;
	const fakeFetch: typeof fetch = async (_input, init) => {
		capturedOptions = init;
		return new Response("export default {};", {
			status: 200,
			headers: { "Content-Type": "text/javascript" },
		});
	};

	const requestUrl =
		"https://aetherml.pages.dev/wasm/ort-wasm-simd-threaded.mjs";
	const res = await fetchModelAsset(requestUrl, fakeCache, fakeFetch);

	assert.equal(res.status, 200);
	assert.equal(await res.text(), "export default {};");
	assert.equal(
		capturedOptions?.cache,
		"no-cache",
		"Deve enviar { cache: 'no-cache' } para forçar revalidação e ignorar entrada velha no HTTP cache",
	);
	assert.ok(
		store.has(requestUrl),
		"Asset válido deve ter sido armazenado no cache do SW",
	);
});

test("fetchModelAsset recusa resposta envenenada (HTML 200) do cache HTTP e não envenena o SW", async () => {
	const store = new Map<string, Response>();
	const fakeCache = {
		match: async (req: Request | string) => {
			const key = typeof req === "string" ? req : req.url;
			return store.get(key);
		},
		put: async (req: Request | string, res: Response) => {
			const key = typeof req === "string" ? req : req.url;
			store.set(key, res);
		},
	};

	// Simula cache HTTP envenenado devolvendo fallback SPA HTML 200
	const fakeFetch: typeof fetch = async () => {
		return new Response(
			"<!DOCTYPE html><html><body>SPA Fallback</body></html>",
			{
				status: 200,
				headers: { "Content-Type": "text/html; charset=utf-8" },
			},
		);
	};

	const requestUrl =
		"https://aetherml.pages.dev/wasm/ort-wasm-simd-threaded.mjs";
	const res = await fetchModelAsset(requestUrl, fakeCache, fakeFetch);

	// Não deve entregar o HTML envenenado pro import dinâmico quebrar
	assert.notEqual(res.status, 200);
	assert.equal(res.status, 503);
	assert.equal(
		store.has(requestUrl),
		false,
		"HTML envenenado nunca deve ser gravado no cache de modelos do SW",
	);
});

test("fetchModelAsset preserva fallback offline de asset previamente cacheado quando a rede falha", async () => {
	const store = new Map<string, Response>();
	const requestUrl = "https://aetherml.pages.dev/models/pm25.onnx?v=v2026.42.1";
	store.set(
		requestUrl,
		new Response("valid_weights", {
			headers: { "Content-Type": "application/octet-stream" },
		}),
	);

	const fakeCache = {
		match: async (req: Request | string) => {
			const key = typeof req === "string" ? req : req.url;
			return store.get(key);
		},
		put: async (req: Request | string, res: Response) => {
			const key = typeof req === "string" ? req : req.url;
			store.set(key, res);
		},
	};

	const failingFetch: typeof fetch = async () => {
		throw new Error("Network error (offline)");
	};

	const res = await fetchModelAsset(requestUrl, fakeCache, failingFetch);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), "valid_weights");
});
