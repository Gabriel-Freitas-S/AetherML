// apps/web/src/lib/location.ts — localização inteligente (SSR-safe)
// Prioridade: estação salva (localStorage) > GPS (nearest) > default.
// Re-exporta utilitários do @aetherml/geo para as islands.

import {
	type Station,
	getStationCoords,
	nearestStation,
	resolveActiveStation,
	roundDistanceKm,
} from "@aetherml/geo";

export {
	getStationCoords,
	nearestStation,
	resolveActiveStation,
	roundDistanceKm,
};

const STORAGE_KEY = "aetherml:stationId";
const BASEMAP_KEY = "aetherml:basemap";

function getStorage(): Storage | null {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			return window.localStorage;
		}
		const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		if (desc?.value) return desc.value as Storage;
		return null;
	} catch {
		return null;
	}
}

export function loadStationId(): string | null {
	try {
		return getStorage()?.getItem(STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}

export function saveStationId(id: string): void {
	if (!id) return;
	try {
		getStorage()?.setItem(STORAGE_KEY, id);
	} catch {
		/* storage indisponível — ignora */
	}
}

export function loadBasemap(): string | null {
	try {
		return getStorage()?.getItem(BASEMAP_KEY) ?? null;
	} catch {
		return null;
	}
}

export function saveBasemap(style: string): void {
	if (!style) return;
	try {
		getStorage()?.setItem(BASEMAP_KEY, style);
	} catch {
		/* ignora */
	}
}

export interface GpsResult {
	lat: number;
	lon: number;
	accuracyM?: number;
}

export interface StationLike {
	id: string;
	name: string;
	municipality: string;
	latitude?: number;
	longitude?: number;
	lat?: number;
	lon?: number;
}

/**
 * Resolve a estação mais próxima a partir de coordenadas GPS, normalizando
 * tanto `{ lat, lon }` quanto `{ latitude, longitude }` e arredondando a
 * distância para 1 casa decimal (`3.3 km`). Devolve `null` se a lista estiver
 * vazia ou se as coordenadas forem inválidas.
 */
export function resolveGpsNearest(
	pos: { lat: number; lon: number },
	stations: StationLike[],
): { stationId: string; stationName: string; distanceKm: number } | null {
	if (
		!pos ||
		!Number.isFinite(pos.lat) ||
		!Number.isFinite(pos.lon) ||
		!Array.isArray(stations) ||
		stations.length === 0
	) {
		return null;
	}
	const normalized: Station[] = stations.map((s) => {
		const c = getStationCoords(s);
		return {
			id: s.id,
			name: s.name,
			municipality: s.municipality,
			latitude: c.latitude,
			longitude: c.longitude,
		};
	});
	const nearest = nearestStation(pos.lat, pos.lon, normalized);
	return {
		stationId: nearest.station.id,
		stationName: nearest.station.name,
		distanceKm: nearest.roundedDistanceKm,
	};
}

/**
 * Traduz erros da Geolocation API (`code === 1` permissão negada, `code === 3`
 * timeout, ausência de suporte) em mensagens claras em português.
 */
export function formatGpsError(err: unknown): string {
	const code = (err as { code?: number } | null)?.code;
	const msg = (err as { message?: string } | null)?.message ?? "";
	if (code === 1) {
		return "Permissão de localização bloqueada no navegador. Escolha uma estação na lista ao lado.";
	}
	if (code === 3 || msg.includes("Tempo esgotado")) {
		return "Tempo limite para obter GPS esgotado. Tente novamente ou selecione sua estação na lista.";
	}
	if (msg.includes("não suportada")) {
		return "Geolocalização não suportada neste navegador. Selecione sua estação na lista.";
	}
	return "Não foi possível obter sua localização atual. Selecione sua estação na lista.";
}

// Promise wrapper do Geolocation API com timeout (padrão 8s)
export function getUserPosition(timeoutMs = 8000): Promise<GpsResult> {
	return new Promise((resolve, reject) => {
		if (
			typeof navigator === "undefined" ||
			!navigator.geolocation ||
			typeof navigator.geolocation.getCurrentPosition !== "function"
		) {
			reject(new Error("Geolocalização não suportada."));
			return;
		}
		const timer = globalThis.setTimeout(
			() => reject(new Error("Tempo esgotado ao obter localização.")),
			timeoutMs,
		);
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				globalThis.clearTimeout(timer);
				resolve({
					lat: pos.coords.latitude,
					lon: pos.coords.longitude,
					accuracyM: pos.coords.accuracy,
				});
			},
			(err) => {
				globalThis.clearTimeout(timer);
				reject(err);
			},
			{ enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 },
		);
	});
}
