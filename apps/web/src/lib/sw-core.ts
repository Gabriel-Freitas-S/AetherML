// apps/web/src/lib/sw-core.ts — Lógica pura e testável do Service Worker (specs/06)

export const STATIC_ASSETS = [
	"/",
	"/mapa",
	"/precisao",
	"/confronto",
	"/comparacao",
	"/comparacao-previsao",
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
] as const;

const DASHBOARD_NAV_PATHS = new Set([
	"/",
	"/mapa",
	"/precisao",
	"/confronto",
	"/comparacao",
	"/comparacao-previsao",
]);

function normalizePathname(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith("/")
		? pathname.slice(0, -1)
		: pathname;
}

export function isDashboardNavigationPath(pathname: string): boolean {
	return DASHBOARD_NAV_PATHS.has(normalizePathname(pathname));
}

/**
 * Reconstrói uma `Response` sem a flag `redirected: true`.
 *
 * No Cloudflare Pages (Pretty URLs), `/offline.html` sofre redirecionamento
 * (`308 /offline`), fazendo `cache.addAll` armazenar uma `Response` com
 * `redirected === true`. O Chromium recusa (`net::ERR_FAILED`) qualquer
 * `respondWith()` em `request.mode === "navigate"` cuja resposta tenha
 * `redirected === true`. Clonar o corpo em um `new Response(...)` limpa a flag.
 */
export async function cleanRedirectedResponse(
	res: Response,
): Promise<Response> {
	if (!res.redirected) return res;
	const body = await res.blob();
	return new Response(body, {
		status: res.status || 200,
		statusText: res.statusText,
		headers: new Headers(res.headers),
	});
}

/**
 * Só permite usar `/data/stations-data.json` como último recurso quando a
 * requisição era para a própria série de estações ou `/api/forecast`.
 * Nunca devolve `stations-data.json` no lugar de `comparison-data.json`,
 * `forecast-compare.json` ou `model-eval.json` (shapes incompatíveis).
 */
export function resolveOfflineDataFallbackUrl(pathname: string): string | null {
	if (
		pathname.endsWith("/data/stations-data.json") ||
		pathname.includes("/api/forecast")
	) {
		return "/data/stations-data.json";
	}
	return null;
}

/**
 * Impede que um fallback HTML 200 (ex.: SPA fallback de arquivo inexistente)
 * seja salvo em `CACHE_MODELS` como se fosse um binário `.onnx`/`.wasm`/`.mjs`.
 */
export function canCacheModelResponse(res: Response): boolean {
	if (!res.ok) return false;
	const contentType = (res.headers.get("Content-Type") ?? "").toLowerCase();
	if (contentType.includes("text/html")) return false;
	return true;
}
