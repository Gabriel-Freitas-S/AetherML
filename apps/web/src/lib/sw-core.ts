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
	"/models/calibration.json",
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

/**
 * Anexa ou atualiza a tag de versão (?v=<version>) na URL de um asset de modelo.
 * Se version for vazia, nula ou indefinida, devolve o path original intacto.
 */
export function versionedAssetUrl(
	path: string,
	version?: string | null,
): string {
	if (!version) return path;
	const [base, search] = path.split("?");
	const params = new URLSearchParams(search ?? "");
	params.set("v", version);
	const query = params.toString();
	return query ? `${base}?${query}` : base;
}

/**
 * Retorna true se o pathname aponta para metadados de modelo mutáveis
 * que devem seguir estratégia Network-First (ex.: registry.json, calibration.json).
 */
export function isModelMetadataPath(pathname: string): boolean {
	return (
		pathname.endsWith("/models/registry.json") ||
		pathname.endsWith("/models/calibration.json")
	);
}

/**
 * Retorna true se o pathname pertence ao escopo de modelos ou runtime wasm.
 */
export function isModelOrWasmPath(pathname: string): boolean {
	return pathname.includes("/models/") || pathname.includes("/wasm/");
}

/**
 * Retorna a estratégia de cache adequada para o asset sob /models/ ou /wasm/.
 * Metadados (/models/registry.json e /models/calibration.json) são Network-First com fallback no cache.
 * Binários e topologias (.onnx, .topology.json, .wasm, etc.) são Cache-First imutáveis por versão.
 */
export function getModelCacheStrategy(
	pathname: string,
): "network-first" | "cache-first" | null {
	if (!isModelOrWasmPath(pathname)) return null;
	if (isModelMetadataPath(pathname)) return "network-first";
	return "cache-first";
}
