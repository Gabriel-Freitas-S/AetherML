// apps/web/src/service-worker.ts — PWA Service Worker (specs/06)
// Estratégias multinível: CacheFirst (modelos/shell/wasm) · NetworkFirst (meteo/data) · SWR (navegação)

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { CACHE_VERSION } from "./generated/cache-version";
import {
	STATIC_ASSETS,
	canCacheModelResponse,
	cleanRedirectedResponse,
	getModelCacheStrategy,
	isDashboardNavigationPath,
	resolveOfflineDataFallbackUrl,
} from "./lib/sw-core";

// Versionado pelo build (scripts/gen-sw-version.mjs). O sufixo muda a cada build,
// e o handler `activate` apaga os caches de versões anteriores.
const CACHE_SHELL = `aetherml-shell-${CACHE_VERSION}`;
const CACHE_MODELS = `aetherml-models-${CACHE_VERSION}`;
const CACHE_TILES = `aetherml-tiles-${CACHE_VERSION}`;
const CACHE_DATA = `aetherml-data-${CACHE_VERSION}`;

async function matchAcrossCaches(
	requestOrUrl: Request | string,
	options?: MultiCacheQueryOptions,
): Promise<Response | undefined> {
	const dataCache = await caches.open(CACHE_DATA);
	const fromData = await dataCache.match(requestOrUrl, options);
	if (fromData) return fromData;

	const shellCache = await caches.open(CACHE_SHELL);
	const fromShell = await shellCache.match(requestOrUrl, options);
	if (fromShell) return fromShell;

	return caches.match(requestOrUrl, options);
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_SHELL).then(async (cache) => {
			await Promise.allSettled(
				STATIC_ASSETS.map(async (assetUrl) => {
					try {
						const res = await fetch(assetUrl, { cache: "no-cache" });
						if (!res.ok) return;
						const cleanRes = await cleanRedirectedResponse(res);
						await cache.put(assetUrl, cleanRes);
					} catch (err) {
						console.warn(`[SW] Falha ao pré-carregar ${assetUrl}:`, err);
					}
				}),
			);
			return self.skipWaiting();
		}),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => {
				return Promise.all(
					keys
						.filter(
							(k) =>
								![CACHE_SHELL, CACHE_MODELS, CACHE_TILES, CACHE_DATA].includes(
									k,
								),
						)
						.map((k) => caches.delete(k)),
				);
			})
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") {
		self.skipWaiting();
	}
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	const url = new URL(request.url);

	// 1. Modelos e Wasm (registry.json/calibration.json -> NetworkFirst; .onnx/.topology.json/.wasm -> CacheFirst)
	const modelStrategy = getModelCacheStrategy(url.pathname);
	if (modelStrategy) {
		if (modelStrategy === "network-first") {
			// Metadados mutáveis (registry.json, calibration.json) -> NetworkFirst com fallback em CACHE_MODELS
			event.respondWith(
				fetch(request)
					.then(async (res) => {
						if (res.ok && canCacheModelResponse(res)) {
							const cache = await caches.open(CACHE_MODELS);
							await cache.put(request, res.clone());
							if (url.search) {
								const cleanUrl = new URL(request.url);
								cleanUrl.search = "";
								await cache.put(new Request(cleanUrl.toString()), res.clone());
							}
						}
						return res;
					})
					.catch(async () => {
						const cache = await caches.open(CACHE_MODELS);
						const cached =
							(await cache.match(request)) ||
							(await cache.match(url.pathname)) ||
							(await matchAcrossCaches(request)) ||
							(await matchAcrossCaches(url.pathname));
						if (cached) return cached;
						return new Response(
							JSON.stringify({ error: "offline", offline: true }),
							{
								status: 503,
								headers: { "Content-Type": "application/json" },
							},
						);
					}),
			);
			return;
		}

		// Binários e topologias imutáveis por versão (.onnx, .topology.json, /wasm/) -> CacheFirst com match exato (?v=)
		event.respondWith(
			caches.open(CACHE_MODELS).then(async (cache) => {
				// Match exato com ?v= no CACHE_MODELS (sem ignoreSearch para evitar misturar versões)
				const cached = await cache.match(request);
				if (cached && canCacheModelResponse(cached)) return cached;
				try {
					const res = await fetch(request);
					if (canCacheModelResponse(res)) {
						await cache.put(request, res.clone());
					}
					return res;
				} catch {
					if (cached) return cached;
					return new Response("Offline model asset unavailable", {
						status: 503,
					});
				}
			}),
		);
		return;
	}

	// 2. Map Tiles (Leaflet OpenStreetMap/Carto) -> CacheFirst com teto de 200 tiles
	if (
		url.hostname.includes("tile.openstreetmap.org") ||
		url.hostname.includes("basemaps.cartocdn.com")
	) {
		event.respondWith(
			caches.open(CACHE_TILES).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;
				try {
					const res = await fetch(request);
					if (res.ok || res.type === "opaque") {
						try {
							const keys = await cache.keys();
							if (keys.length > 200) await cache.delete(keys[0]); // LRU simples
							await cache.put(request, res.clone());
						} catch {
							// Ignora se o browser limitar cache de requisição opaca
						}
					}
					return res;
				} catch {
					if (cached) return cached;
					// Retorna PNG 1x1 transparente para evitar ícone de imagem quebrada se estiver offline
					return new Response(
						new Uint8Array([
							137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0,
							0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10,
							73, 68, 65, 84, 120, 156, 99, 96, 0, 0, 0, 2, 0, 1, 244, 113, 100,
							166, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
						]),
						{
							headers: {
								"Content-Type": "image/png",
								"Cache-Control": "no-cache",
							},
						},
					);
				}
			}),
		);
		return;
	}

	// 3. Meteorologia e Previsões (/data/*.json e /api/forecast) -> NetworkFirst com fallback em CACHE_DATA + CACHE_SHELL
	if (
		url.pathname.includes("/data/") ||
		url.pathname.includes("/api/forecast")
	) {
		event.respondWith(
			fetch(request)
				.then(async (res) => {
					const ct = (res.headers.get("Content-Type") ?? "").toLowerCase();
					if (res.ok && !ct.includes("text/html")) {
						const cache = await caches.open(CACHE_DATA);
						await cache.put(request, res.clone());
						if (url.search) {
							const cleanUrl = new URL(request.url);
							cleanUrl.search = "";
							await cache.put(new Request(cleanUrl.toString()), res.clone());
						}
					}
					return res;
				})
				.catch(async () => {
					const exactOrClean =
						(await matchAcrossCaches(request)) ||
						(await matchAcrossCaches(request, { ignoreSearch: true })) ||
						(await matchAcrossCaches(url.pathname));
					if (exactOrClean) return exactOrClean;

					const fallbackUrl = resolveOfflineDataFallbackUrl(url.pathname);
					if (fallbackUrl) {
						const fallback = await matchAcrossCaches(fallbackUrl);
						if (fallback) return fallback;
					}

					return new Response(
						JSON.stringify({ error: "offline", offline: true }),
						{
							status: 503,
							headers: { "Content-Type": "application/json" },
						},
					);
				}),
		);
		return;
	}

	// 4. Navegação geral HTML -> NetworkFirst com gravação no CACHE_SHELL e fallback limpo (sem redirected=true)
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then(async (res) => {
					const clean = await cleanRedirectedResponse(res);
					if (clean.ok) {
						const cache = await caches.open(CACHE_SHELL);
						await cache.put(url.pathname, clean.clone());
					}
					return clean;
				})
				.catch(async () => {
					const cachedPage =
						(await caches.match(request)) ||
						(await caches.match(url.pathname)) ||
						(isDashboardNavigationPath(url.pathname)
							? await caches.match("/")
							: undefined) ||
						(await caches.match("/offline.html")) ||
						(await caches.match("/offline"));
					if (cachedPage) {
						return cleanRedirectedResponse(cachedPage);
					}
					return new Response(
						"<!DOCTYPE html><html lang='pt-BR'><meta charset='utf-8'><title>AetherML — Modo Offline</title><body><h1>Sem conexão com a internet</h1><p><a href='/'>Abrir painel salvo</a></p></body></html>",
						{
							status: 503,
							headers: { "Content-Type": "text/html; charset=utf-8" },
						},
					);
				}),
		);
		return;
	}

	// 5. Assets estáticos (JS /_astro/*, CSS, Fontes, Ícones) -> CacheFirst com gravação em CACHE_SHELL
	event.respondWith(
		caches.match(request).then(async (cached) => {
			if (cached) return cleanRedirectedResponse(cached);
			try {
				const res = await fetch(request);
				if (res.ok && url.origin === self.location.origin) {
					const clean = await cleanRedirectedResponse(res);
					const cache = await caches.open(CACHE_SHELL);
					await cache.put(request, clean.clone());
					return clean;
				}
				return res;
			} catch {
				const fallback = await caches.match(request, { ignoreSearch: true });
				if (fallback) return cleanRedirectedResponse(fallback);
				return new Response("Offline asset unavailable", { status: 503 });
			}
		}),
	);
});
