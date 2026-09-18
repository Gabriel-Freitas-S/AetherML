import assert from "node:assert/strict";
import { test } from "node:test";
import { type Station, haversineKm, nearestStation } from "../src/geo.ts";

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

test("nearestStation localiza corretamente a estação mais próxima de coordenadas dadas", () => {
	// Ponto próximo à Praia de Camburi (-20.2800, -40.2900)
	const result = nearestStation(-20.28, -40.29, STATIONS);
	assert.equal(result.station.id, "ramqar_camburi");
	assert.ok(result.distanceKm < 1.0);

	// Ponto no Centro de Vila Velha (-20.3450, -40.3050)
	const result2 = nearestStation(-20.345, -40.305, STATIONS);
	assert.equal(result2.station.id, "ramqar_ibes");
	assert.ok(result2.distanceKm < 1.0);
});
