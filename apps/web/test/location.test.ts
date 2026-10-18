import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
	formatGpsError,
	getUserPosition,
	loadBasemap,
	loadStationId,
	resolveActiveStation,
	resolveGpsNearest,
	saveBasemap,
	saveStationId,
} from "../src/lib/location.ts";

const SAMPLE_STATIONS = [
	{
		id: "ramqar_laranjeiras",
		name: "Laranjeiras - Serra",
		municipality: "Serra",
		lat: -20.1992,
		lon: -40.2584,
	},
	{
		id: "ramqar_camburi",
		name: "Jardim Camburi - Vitória",
		municipality: "Vitória",
		lat: -20.2575,
		lon: -40.2683,
	},
	{
		id: "ramqar_ibes",
		name: "IBES - Vila Velha",
		municipality: "Vila Velha",
		latitude: -20.3478,
		longitude: -40.3068,
	},
];

// Mock simples de localStorage para validar persistência entre visitas
function installMockStorage() {
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		value: {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => {
				store.set(k, String(v));
			},
			removeItem: (k: string) => {
				store.delete(k);
			},
			clear: () => store.clear(),
		},
		configurable: true,
		writable: true,
	});
	return store;
}

const origNavigator = (globalThis as any).navigator;

beforeEach(() => {
	installMockStorage();
});

afterEach(() => {
	Object.defineProperty(globalThis, "navigator", {
		value: origNavigator,
		configurable: true,
		writable: true,
	});
});

test("saveStationId e loadStationId persistem a estação escolhida entre visitas", () => {
	assert.equal(loadStationId(), null);
	saveStationId("ramqar_ibes");
	assert.equal(loadStationId(), "ramqar_ibes");
});

test("saveBasemap e loadBasemap persistem o estilo do mapa", () => {
	assert.equal(loadBasemap(), null);
	saveBasemap("dark");
	assert.equal(loadBasemap(), "dark");
});

test("resolveGpsNearest normaliza lat/lon e latitude/longitude e arredonda distância para 1 casa", () => {
	// Coordenada em Serra (-20.2286, -40.2647) -> mais próxima de Laranjeiras (~3.3 km) ou Jardim Camburi (~3.2 km)
	const nearLaranjeiras = resolveGpsNearest(
		{ lat: -20.205, lon: -40.26 },
		SAMPLE_STATIONS,
	);
	assert.ok(nearLaranjeiras);
	assert.equal(nearLaranjeiras.stationId, "ramqar_laranjeiras");
	assert.equal(nearLaranjeiras.stationName, "Laranjeiras - Serra");
	assert.equal(
		nearLaranjeiras.distanceKm,
		Math.round(nearLaranjeiras.distanceKm * 10) / 10,
	);
});

test("resolveGpsNearest devolve null quando a lista de estações está vazia ou inválida", () => {
	assert.equal(resolveGpsNearest({ lat: -20.28, lon: -40.29 }, []), null);
	assert.equal(
		resolveGpsNearest({ lat: Number.NaN, lon: -40.29 }, SAMPLE_STATIONS),
		null,
	);
});

test("formatGpsError diferencia permissão negada (code 1), timeout (code 3) e erro genérico", () => {
	assert.match(
		formatGpsError({ code: 1 }),
		/Permissão de localização bloqueada/,
	);
	assert.match(formatGpsError({ code: 3 }), /Tempo limite para obter GPS/);
	assert.match(
		formatGpsError(new Error("Tempo esgotado ao obter localização.")),
		/Tempo limite para obter GPS/,
	);
	assert.match(
		formatGpsError(new Error("Geolocalização não suportada.")),
		/Geolocalização não suportada/,
	);
	assert.match(
		formatGpsError({ code: 2 }),
		/Não foi possível obter sua localização/,
	);
});

test("getUserPosition resolve coordenadas quando permissão de GPS é concedida", async () => {
	Object.defineProperty(globalThis, "navigator", {
		value: {
			geolocation: {
				getCurrentPosition(success: (pos: any) => void) {
					success({
						coords: {
							latitude: -20.2286,
							longitude: -40.2647,
							accuracy: 42,
						},
					});
				},
			},
		},
		configurable: true,
		writable: true,
	});

	const res = await getUserPosition(1000);
	assert.deepEqual(res, {
		lat: -20.2286,
		lon: -40.2647,
		accuracyM: 42,
	});
});

test("getUserPosition rejeita com erro quando permissão de GPS é negada (code 1)", async () => {
	Object.defineProperty(globalThis, "navigator", {
		value: {
			geolocation: {
				getCurrentPosition(_success: any, error: (err: any) => void) {
					error({ code: 1, message: "User denied Geolocation" });
				},
			},
		},
		configurable: true,
		writable: true,
	});

	await assert.rejects(
		() => getUserPosition(1000),
		(err: any) => err?.code === 1,
	);
});

test("prioridade integrada: estação salva > GPS > default", () => {
	const norm = SAMPLE_STATIONS.map((s) => ({
		...s,
		latitude: s.latitude ?? s.lat ?? 0,
		longitude: s.longitude ?? s.lon ?? 0,
	}));

	// Sem estação salva, com GPS -> escolhe GPS e retorna distanceKm
	const fromGps = resolveActiveStation(norm, {
		storedId: loadStationId(),
		userLat: -20.345,
		userLon: -40.305,
		defaultId: "ramqar_camburi",
	});
	assert.equal(fromGps.stationId, "ramqar_ibes");
	assert.equal(fromGps.reason, "gps");
	assert.ok(fromGps.distanceKm !== null);

	// Salva estação manualmente -> na próxima visita, estação salva tem prioridade sobre GPS
	saveStationId("ramqar_laranjeiras");
	const fromSaved = resolveActiveStation(norm, {
		storedId: loadStationId(),
		userLat: -20.345,
		userLon: -40.305,
		defaultId: "ramqar_camburi",
	});
	assert.equal(fromSaved.stationId, "ramqar_laranjeiras");
	assert.equal(fromSaved.reason, "saved");
});
