// apps/web/src/service-worker.ts — PWA Service Worker (specs/06)
// Estratégias multinível: CacheFirst (modelos/shell/wasm) · NetworkFirst (meteo/data) · SWR (telemetria)

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { CACHE_VERSION } from "./generated/cache-version";

// Versionado pelo build (scripts/gen-sw-version.mjs). Fixar "v3" fazia os caches
// nunca rotacionarem entre deploys: uma falha de rede devolvia o bundle antigo
// indefinidamente. O sufixo agora muda a cada build, e o handler `activate`
// (abaixo) apaga os caches antigos.
const CACHE_SHELL = `aetherml-shell-${CACHE_VERSION}`;
const CACHE_MODELS = `aetherml-models-${CACHE_VERSION}`;
const CACHE_TILES = `aetherml-tiles-${CACHE_VERSION}`;
const CACHE_DATA = `aetherml-data-${CACHE_VERSION}`;

// Offline é a condição padrão, não o plano B (PRODUCT.md, princípio 4). As cinco
// seções do painel dividem UMA rota, então o artefato de cada uma precisa estar
// no precache: sem `/data/comparison-data.json` e `/data/forecast-compare.json`
// aqui, as abas Holdout e Previsão abrem vazias justamente para quem está sem
// rede — que é a audiência que mais precisa delas. São 200 KB contra 374 KB do
// bundle de estações; é o preço de a seção existir offline.
const STATIC_ASSETS = [
	"/",
	"/offline.html",
	"/manifest.webmanifest",
	"/favicon.svg",
	"/favicon-32x32.png",
	"/apple-touch-icon.png",
	"/pwa-192x192.png",
	"/pwa-512x512.png",
	"/maskable-icon-512x512.png",
	"/models/registry.json",
	"/data/stations-data.json",
	"/data/model-eval.json",
	"/data/comparison-data.json",
	"/data/forecast-compare.json",
	"/leaflet/leaflet.css",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_SHELL).then(async (cache) => {
			try {
				await cache.addAll(STATIC_ASSETS);
			} catch (err) {
				console.warn("[SW] Falha ao pré-carregar alguns assets:", err);
			}
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
	const url = new URL(request.url);

	// 1. Modelos .onnx, .wasm e .topology.json -> CacheFirst (imutável por versão)
	if (url.pathname.includes("/models/") || url.pathname.includes("/wasm/")) {
		event.respondWith(
			caches.open(CACHE_MODELS).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;
				const res = await fetch(request);
				if (res.ok) cache.put(request, res.clone());
				return res;
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

	// 3. Meteorologia e Previsões -> NetworkFirst com fallback em cache
	if (
		url.pathname.includes("/data/") ||
		url.pathname.includes("/api/forecast")
	) {
		event.respondWith(
			fetch(request)
				.then(async (res) => {
					if (res.ok) {
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
					const cache = await caches.open(CACHE_DATA);
					const cached =
						(await cache.match(request)) ||
						(await cache.match(request, { ignoreSearch: true })) ||
						(await cache.match("/data/stations-data.json"));
					if (cached) return cached;
					return new Response(
						JSON.stringify({ error: "offline", offline: true }),
						{
							headers: { "Content-Type": "application/json" },
						},
					);
				}),
		);
		return;
	}

	// 4. Navegação geral HTML -> StaleWhileRevalidate com fallback offline.html
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request).catch(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;
				return (
					(await caches.match("/offline.html")) ||
					new Response("Offline", { status: 503 })
				);
			}),
		);
		return;
	}

	// 5. Assets estáticos (JS, CSS, Fontes) -> CacheFirst
	event.respondWith(
		caches.match(request).then((cached) => cached || fetch(request)),
	);
});
