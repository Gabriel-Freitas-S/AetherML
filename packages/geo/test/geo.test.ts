import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type Station,
	getStationCoords,
	haversineKm,
	nearestStation,
	resolveActiveStation,
	roundDistanceKm,
} from "../src/geo.ts";

const STATIONS: Station[] = [
	{
		id: "ramqar_camburi",
		name: "Camburi - Vitória",
		municipality: "Vitória",
		latitude: -20.2764,
		longitude: -40.2881,
	},
	{
		id: "ramqar_vitoria_centro",
		name: "Vitória Centro",
		municipality: "Vitória",
		latitude: -20.3196,
		longitude: -40.337,
	},
	{
		id: "ramqar_ibes",
		name: "IBES - Vila Velha",
		municipality: "Vila Velha",
		latitude: -20.3478,
		longitude: -40.3068,
	},
];

test("haversineKm calcula distâncias geográficas coerentes na Grande Vitória", () => {
	// Distância entre Camburi e Vitória Centro ≈ 6 a 8 km
	const d = haversineKm(-20.2764, -40.2881, -20.3196, -40.337);
	assert.ok(d > 6 && d < 8, `Distância calculada foi ${d} km`);
});

test("roundDistanceKm arredonda para 1 casa decimal e trata valores não-finitos", () => {
	assert.equal(roundDistanceKm(3.3419), 3.3);
	assert.equal(roundDistanceKm(3.36), 3.4);
	assert.equal(roundDistanceKm(0), 0);
	assert.equal(roundDistanceKm(Number.NaN), 0);
	assert.equal(roundDistanceKm(Number.POSITIVE_INFINITY), 0);
});

test("getStationCoords aceita tanto latitude/longitude quanto lat/lon", () => {
	assert.deepEqual(
		getStationCoords({ latitude: -20.2764, longitude: -40.2881 }),
		{ latitude: -20.2764, longitude: -40.2881 },
	);
	assert.deepEqual(getStationCoords({ lat: -20.3196, lon: -40.337 }), {
		latitude: -20.3196,
		longitude: -40.337,
	});
});

test("nearestStation localiza corretamente a estação mais próxima e expõe roundedDistanceKm", () => {
	// Ponto próximo à Praia de Camburi (-20.2800, -40.2900)
	const result = nearestStation(-20.28, -40.29, STATIONS);
	assert.equal(result.station.id, "ramqar_camburi");
	assert.ok(result.distanceKm < 1.0);
	assert.equal(result.roundedDistanceKm, roundDistanceKm(result.distanceKm));

	// Ponto no Centro de Vila Velha (-20.3450, -40.3050)
	const result2 = nearestStation(-20.345, -40.305, STATIONS);
	assert.equal(result2.station.id, "ramqar_ibes");
	assert.ok(result2.distanceKm < 1.0);
});

test("nearestStation lança erro descritivo quando a lista de estações está vazia", () => {
	assert.throws(
		() => nearestStation(-20.28, -40.29, []),
		/Nenhuma estação disponível/,
	);
});

test("nearestStation lança erro quando nenhuma estação da lista possui coordenadas válidas", () => {
	const invalidStations = [
		{
			id: "ramqar_camburi",
			name: "Camburi",
			municipality: "Vitória",
		} as unknown as Station,
		{
			id: "ramqar_ibes",
			name: "IBES",
			municipality: "Vila Velha",
			latitude: Number.NaN,
			longitude: Number.NaN,
		},
	];
	assert.throws(
		() => nearestStation(-20.28, -40.29, invalidStations),
		/coordenadas válidas|Nenhuma estação/,
	);
});

test("resolveActiveStation respeita prioridade estrita: saved > gps > default > fallback", () => {
	// 1. saved vence mesmo quando GPS aponta para outra estação
	const rSaved = resolveActiveStation(STATIONS, {
		storedId: "ramqar_vitoria_centro",
		userLat: -20.345,
		userLon: -40.305,
		defaultId: "ramqar_camburi",
	});
	assert.equal(rSaved.stationId, "ramqar_vitoria_centro");
	assert.equal(rSaved.reason, "saved");
	assert.equal(rSaved.distanceKm, null);

	// 2. storedId inválido cai para GPS e devolve distanceKm arredondado
	const rGps = resolveActiveStation(STATIONS, {
		storedId: "estacao_inexistente",
		userLat: -20.345,
		userLon: -40.305,
		defaultId: "ramqar_camburi",
	});
	assert.equal(rGps.stationId, "ramqar_ibes");
	assert.equal(rGps.reason, "gps");
	assert.equal(typeof rGps.distanceKm, "number");
	assert.ok((rGps.distanceKm ?? 99) < 1.0);

	// 3. Sem storedId e sem GPS válido cai para defaultId
	const rDefault = resolveActiveStation(STATIONS, {
		storedId: null,
		userLat: null,
		userLon: null,
		defaultId: "ramqar_vitoria_centro",
	});
	assert.equal(rDefault.stationId, "ramqar_vitoria_centro");
	assert.equal(rDefault.reason, "default");
	assert.equal(rDefault.distanceKm, null);

	// 4. Sem defaultId válido cai para a primeira estação (fallback)
	const rFallback = resolveActiveStation(STATIONS, {
		defaultId: "inexistente",
	});
	assert.equal(rFallback.stationId, "ramqar_camburi");
	assert.equal(rFallback.reason, "fallback");

	// 5. Lista vazia de estações não quebra (usa defaultId ou ramqar_camburi)
	const rEmpty = resolveActiveStation([], { defaultId: "ramqar_camburi" });
	assert.equal(rEmpty.stationId, "ramqar_camburi");
	assert.equal(rEmpty.reason, "fallback");
});
