import assert from "node:assert/strict";
import { test } from "node:test";
import {
	getStationCoords,
	nearestStation,
	resolveActiveStation,
} from "../src/geo.ts";

// Formato real de apps/web/public/data/stations-data.json (lat/lon)
const MIXED: any[] = [
	{
		id: "ramqar_camburi",
		name: "Camburi - Vitória",
		municipality: "Vitória",
		lat: -20.2764,
		lon: -40.2881,
	},
	{
		id: "ramqar_ibes",
		name: "IBES - Vila Velha",
		municipality: "Vila Velha",
		latitude: -20.3478,
		longitude: -40.3068,
	},
	{
		id: "ramqar_cariacica",
		name: "Cariacica",
		municipality: "Cariacica",
		lat: -20.3042,
		lon: -40.3726,
	},
];

test("getStationCoords normaliza lat/lon e latitude/longitude", () => {
	assert.deepEqual(getStationCoords(MIXED[0] as any), {
		latitude: -20.2764,
		longitude: -40.2881,
	});
	assert.deepEqual(getStationCoords(MIXED[1] as any), {
		latitude: -20.3478,
		longitude: -40.3068,
	});
});

test("nearestStation funciona com estações em formato lat/lon (stations-data.json)", () => {
	// Ponto próximo à Praia de Camburi
	const r = nearestStation(-20.28, -40.29, MIXED as any);
	assert.equal(r.station.id, "ramqar_camburi");
	assert.ok(r.distanceKm < 1.0, `dist=${r.distanceKm}`);
});

test("resolveActiveStation prioriza storedId válido sobre GPS", () => {
	const r = resolveActiveStation(MIXED as any, {
		storedId: "ramqar_ibes",
		userLat: -20.28,
		userLon: -40.29, // perto de Camburi, mas o salvo vence
		defaultId: "ramqar_camburi",
	});
	assert.equal(r.stationId, "ramqar_ibes");
	assert.equal(r.reason, "saved");
});

test("resolveActiveStation usa GPS (nearest) quando não há storedId", () => {
	const r = resolveActiveStation(MIXED as any, {
		storedId: null,
		userLat: -20.28,
		userLon: -40.29,
		defaultId: "ramqar_cariacica",
	});
	assert.equal(r.stationId, "ramqar_camburi");
	assert.equal(r.reason, "gps");
});

test("resolveActiveStation ignora storedId inválido e cai para default/primeira", () => {
	const r1 = resolveActiveStation(MIXED as any, {
		storedId: "id_inexistente",
		defaultId: "ramqar_cariacica",
	});
	assert.equal(r1.stationId, "ramqar_cariacica");
	assert.equal(r1.reason, "default");

	const r2 = resolveActiveStation(MIXED as any, {});
	assert.equal(r2.stationId, "ramqar_camburi");
	assert.equal(r2.reason, "fallback");
});
