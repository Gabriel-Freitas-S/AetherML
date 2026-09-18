// packages/geo/src/geo.ts — Haversine + estações (geolocalização fica no cliente)
export interface Station {
	id: string;
	name: string;
	municipality: string;
	latitude: number;
	longitude: number;
}

export function haversineKm(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const R = 6371;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dPhi = toRad(lat2 - lat1);
	const dLambda = toRad(lon2 - lon1);
	const a =
		Math.sin(dPhi / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStation(
	lat: number,
	lon: number,
	stations: Station[],
): { station: Station; distanceKm: number } {
	let best = stations[0];
	let bestD = Number.POSITIVE_INFINITY;
	for (const s of stations) {
		const c = getStationCoords(s);
		const d = haversineKm(lat, lon, c.latitude, c.longitude);
		if (d < bestD) {
			bestD = d;
			best = s;
		}
	}
	return { station: best, distanceKm: bestD };
}

// Aceita tanto {latitude,longitude} quanto {lat,lon} (stations-data.json)
export function getStationCoords(s: any): {
	latitude: number;
	longitude: number;
} {
	const latitude = s.latitude ?? s.lat;
	const longitude = s.longitude ?? s.lon;
	return { latitude, longitude };
}

export type StationResolutionReason = "saved" | "gps" | "default" | "fallback";

// Prioridade: storedId válido > GPS (nearest) > defaultId > primeira estação
export function resolveActiveStation(
	stations: Station[],
	opts?: {
		storedId?: string | null;
		userLat?: number | null;
		userLon?: number | null;
		defaultId?: string;
	},
): { stationId: string; reason: StationResolutionReason } {
	const ids = new Set(stations.map((s) => s.id));
	if (opts?.storedId && ids.has(opts.storedId)) {
		return { stationId: opts.storedId, reason: "saved" };
	}
	if (
		opts?.userLat != null &&
		opts?.userLon != null &&
		Number.isFinite(opts.userLat) &&
		Number.isFinite(opts.userLon)
	) {
		const nearest = nearestStation(opts.userLat, opts.userLon, stations);
		return { stationId: nearest.station.id, reason: "gps" };
	}
	if (opts?.defaultId && ids.has(opts.defaultId)) {
		return { stationId: opts.defaultId, reason: "default" };
	}
	return { stationId: stations[0].id, reason: "fallback" };
}
