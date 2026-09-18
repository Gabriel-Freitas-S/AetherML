// apps/web/src/service-worker.ts — PWA Service Worker (specs/06)
// Estratégias multinível: CacheFirst (modelos/shell/wasm) · NetworkFirst (meteo) · SWR (telemetria)

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_SHELL = "aetherml-shell-v1";
const CACHE_MODELS = "aetherml-models-v1";
const CACHE_TILES = "aetherml-tiles-v1";
const CACHE_DATA = "aetherml-data-v1";

const STATIC_ASSETS = [
	"/",
	"/offline.html",
	"/manifest.webmanifest",
	"/favicon.svg",
	"/models/registry.json",
	"/data/stations-data.json",
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
					if (res.ok) {
						const keys = await cache.keys();
						if (keys.length > 200) await cache.delete(keys[0]); // LRU simples
						cache.put(request, res.clone());
					}
					return res;
				} catch {
					return cached || new Response("", { status: 408 });
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
						cache.put(request, res.clone());
					}
					return res;
				})
				.catch(async () => {
					const cached = await caches.match(request);
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
