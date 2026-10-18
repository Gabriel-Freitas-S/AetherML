// apps/web/src/lib/shell-props.ts — Props compartilhados de build para todas as rotas do DashboardShell.
//
// Garante que entrar diretamente por `/mapa`, `/precisao`, `/confronto`,
// `/comparacao` ou `/comparacao-previsao` e alternar para as abas "Agora" ou
// "Mapa" nunca monte os painéis com listas de estações vazias.

import { globalIQAr } from "@aetherml/core-iqar";
import modelEval from "../../public/data/model-eval.json";
import stationsData from "../../public/data/stations-data.json";
import { currentPoint } from "./current-point";
import { dominantConcentration } from "./dashboard-sections";

interface ObservedBlock {
	pm25: number;
	pm10: number;
	o3: number;
	no2: number;
	so2: number;
}

interface StationSeries {
	station: {
		id: string;
		name: string;
		municipality: string;
		lat: number;
		lon: number;
		latitude?: number;
		longitude?: number;
		coastal?: boolean;
		downwind_tubarao?: boolean;
		bridge_proximity?: boolean;
		traffic_heavy?: boolean;
		urban_canyon?: boolean;
	};
	points: { timestamp: string; observed: ObservedBlock }[];
}

export function getShellStaticProps(nowMs = Date.now()) {
	const bundle = stationsData as unknown as Record<string, StationSeries>;
	const initialStationId = "ramqar_camburi";
	const defaultStationData = bundle[initialStationId];

	const stationsMeta = Object.values(bundle).map((item) => ({
		...item.station,
		id: item.station.id,
		name: item.station.name,
		municipality: item.station.municipality,
		lat: item.station.lat,
		lon: item.station.lon,
		latitude: item.station.latitude ?? item.station.lat,
		longitude: item.station.longitude ?? item.station.lon,
		coastal: item.station.coastal,
		downwind_tubarao: item.station.downwind_tubarao,
		bridge_proximity: item.station.bridge_proximity,
		traffic_heavy: item.station.traffic_heavy,
		urban_canyon: item.station.urban_canyon,
	}));

	const initialMapStations = Object.values(bundle)
		.map((item) => {
			const picked = currentPoint(item.points, nowMs);
			if (!picked) return null;
			const res = globalIQAr(picked.point.observed);
			return {
				id: item.station.id,
				name: item.station.name,
				municipality: item.station.municipality,
				latitude: item.station.latitude ?? item.station.lat,
				longitude: item.station.longitude ?? item.station.lon,
				iqar: res.iqar,
				classification: res.classification,
				primary: res.primary,
				concentration: dominantConcentration(
					picked.point.observed,
					res.primary,
				),
			};
		})
		.filter((s) => s !== null);

	const initialBundle = defaultStationData
		? { [initialStationId]: defaultStationData }
		: null;

	return {
		stationsMeta,
		initialStationId,
		initialBundle,
		initialMapStations,
		evalData: modelEval as Record<string, unknown>,
	};
}
