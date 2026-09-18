// apps/web/src/lib/location.ts — localização inteligente (SSR-safe)
// Prioridade: estação salva (localStorage) > GPS (nearest) > default.
// Re-exporta resolveActiveStation do @aetherml/geo para as islands.

export { resolveActiveStation, getStationCoords } from "@aetherml/geo";

const STORAGE_KEY = "aetherml:stationId";
const BASEMAP_KEY = "aetherml:basemap";

export function loadStationId(): string | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

export function saveStationId(id: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		/* storage indisponível — ignora */
	}
}

export function loadBasemap(): string | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage.getItem(BASEMAP_KEY);
	} catch {
		return null;
	}
}

export function saveBasemap(style: string): void {
	try {
		localStorage.setItem(BASEMAP_KEY, style);
	} catch {
		/* ignora */
	}
}

export interface GpsResult {
	lat: number;
	lon: number;
	accuracyM?: number;
}

// Promise wrapper do Geolocation API com timeout (padrão 8s)
export function getUserPosition(timeoutMs = 8000): Promise<GpsResult> {
	return new Promise((resolve, reject) => {
		if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
			reject(new Error("Geolocalização não suportada."));
			return;
		}
		const timer = window.setTimeout(
			() => reject(new Error("Tempo esgotado ao obter localização.")),
			timeoutMs,
		);
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				window.clearTimeout(timer);
				resolve({
					lat: pos.coords.latitude,
					lon: pos.coords.longitude,
					accuracyM: pos.coords.accuracy,
				});
			},
			(err) => {
				window.clearTimeout(timer);
				reject(err);
			},
			{ enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 },
		);
	});
}
