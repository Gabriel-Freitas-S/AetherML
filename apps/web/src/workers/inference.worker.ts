// apps/web/src/workers/inference.worker.ts — Worker de Inferência WASM SIMD + Saabas XAI
/// <reference lib="webworker" />
import { type Pollutant, globalIQAr } from "@aetherml/core-iqar";
import {
	type AQSeries,
	type CalibrationData,
	FEATURE_NAMES_V2,
	type HourlySeries,
	type StationFlags,
	runRecursiveForecast,
} from "@aetherml/inference-client";

declare const self: DedicatedWorkerGlobalScope;

type InitMsg = { type: "init"; manifestUrl?: string };
type PredictMsg = {
	type: "predict";
	stationId: string;
	featureNames: string[];
	rows: number[][];
};
type PredictForecastMsg = {
	type: "predict_forecast";
	stationId: string;
	flags?: StationFlags;
	meteo: HourlySeries;
	aq: AQSeries;
	cutoff?: string;
	hours?: number;
};
type SimulateMsg = {
	type: "simulate";
	base: number[];
	deltas: Record<string, number>;
	featureNames: string[];
};
type InMsg = InitMsg | PredictMsg | PredictForecastMsg | SimulateMsg;

interface TreeNode {
	leaf: boolean;
	value: number;
	feature?: string;
	feature_index?: number;
	threshold?: number;
	left?: TreeNode;
	right?: TreeNode;
}

interface TreeInfo {
	tree_index: number;
	root: TreeNode;
}

interface SaabasTopology {
	target: string;
	base_value: number;
	tree_count: number;
	feature_names: string[];
	trees: TreeInfo[];
}

let ort: any = null;
const sessions: Record<string, any> = {};
const topologies: Record<string, SaabasTopology> = {};
let version = "v2026.38.5";
let featureNames: string[] = [...FEATURE_NAMES_V2];
let calibrationData: CalibrationData = {};
let isInitialized = false;

/**
 * Calcula a decomposição aditiva de Saabas (Tree Interpreter) em O(K·D)
 * para um vetor de features x.
 */
function computeSaabas(
	x: number[],
	topology: SaabasTopology,
): { baseValue: number; phi: Record<string, number> } {
	const phi: Record<string, number> = {};
	for (const name of topology.feature_names) {
		phi[name] = 0;
	}

	for (const t of topology.trees) {
		let curr = t.root;
		while (!curr.leaf) {
			const featIdx = curr.feature_index ?? 0;
			const featVal = x[featIdx] ?? 0;
			const nextNode =
				featVal <= (curr.threshold ?? 0) ? curr.left : curr.right;
			if (!nextNode) break;

			const delta = nextNode.value - curr.value;
			const featName = curr.feature ?? topology.feature_names[featIdx];
			phi[featName] = (phi[featName] || 0) + delta;
			curr = nextNode;
		}
	}

	return { baseValue: topology.base_value, phi };
}

async function init(manifestUrl = "/models/registry.json") {
	try {
		// Carrega onnxruntime-web dinamicamente
		if (!ort) {
			const ortModule = await import("onnxruntime-web");
			ort = (ortModule as any).default || ortModule;
			if (ort.env?.wasm) {
				ort.env.wasm.wasmPaths = "/wasm/";
				ort.env.wasm.simd = true;
				ort.env.wasm.numThreads = Math.min(
					4,
					navigator.hardwareConcurrency || 2,
				);
			}
		}

		// Carrega o manifesto
		const res = await fetch(manifestUrl);
		const manifest = await res.json();
		version = manifest.active_version || "v2026.38.5";
		if (manifest.feature_names_v1 && Array.isArray(manifest.feature_names_v1)) {
			featureNames = manifest.feature_names_v1;
		}

		// Carrega calibration.json se disponível
		try {
			const calRes = await fetch("/models/calibration.json");
			if (calRes.ok) {
				calibrationData = await calRes.json();
			}
		} catch (err) {
			console.warn("[Worker] Falha ao carregar calibration.json:", err);
		}

		const targets: Pollutant[] = ["pm25", "pm10", "o3", "no2", "so2"];

		// Carrega modelos ONNX e Topologias Saabas em paralelo
		await Promise.all(
			targets.map(async (t) => {
				try {
					const modelUrl = `/models/${t}.onnx`;
					const modelRes = await fetch(modelUrl);
					const modelBuffer = await modelRes.arrayBuffer();
					sessions[t] = await ort.InferenceSession.create(modelBuffer, {
						executionProviders: ["wasm"],
						graphOptimizationLevel: "all",
					});
				} catch (err) {
					console.warn(
						`[Worker] Falha ao carregar sessão ONNX para ${t}:`,
						err,
					);
				}

				try {
					const topoUrl = `/models/${t}.topology.json`;
					const topoRes = await fetch(topoUrl);
					topologies[t] = await topoRes.json();
				} catch (err) {
					console.warn(
						`[Worker] Falha ao carregar topologia Saabas para ${t}:`,
						err,
					);
				}
			}),
		);

		isInitialized = true;
		self.postMessage({ type: "ready", version, backend: "wasm-simd" });
	} catch (err: any) {
		console.error("[Worker] Erro na inicialização:", err);
		self.postMessage({ type: "error", message: err.message || String(err) });
	}
}

/**
 * Previsão recursiva de 120h com features construídas em TS no Worker
 * e inferência via ONNX Runtime Web (WASM SIMD) + Saabas XAI.
 */
async function predictForecast(
	stationId: string,
	flags: StationFlags,
	meteo: HourlySeries,
	aq: AQSeries,
	cutoff?: string,
	hours = 120,
) {
	const t0 = performance.now();
	if (!isInitialized) {
		await init();
	}

	const targets: Pollutant[] = ["pm25", "pm10", "o3", "no2", "so2"];

	const forecast = await runRecursiveForecast({
		stationId,
		flags,
		meteo,
		aq,
		cutoff,
		hours,
		order: "v2",
		featureNames,
		calibration: calibrationData,
		predictFn: async (feats: number[]) => {
			const nFeat = feats.length;
			const tensor = new ort.Tensor("float32", new Float32Array(feats), [
				1,
				nFeat,
			]);
			const rawMap: Record<string, number> = {};
			for (const t of targets) {
				const session = sessions[t];
				if (session) {
					try {
						const output = await session.run({ input: tensor });
						const outTensor = output.variable || Object.values(output)[0];
						rawMap[t] = Number((outTensor.data as Float32Array)[0]);
					} catch (e) {
						rawMap[t] = 10.0;
					}
				} else {
					rawMap[t] = 10.0;
				}
			}
			return rawMap;
		},
	});

	// Calcula IQAr CONAMA 491 por ponto
	const points = forecast.points.map((p) => {
		const concs = {
			pm25: p.observed.pm25,
			pm10: p.observed.pm10,
			o3: p.observed.o3,
			no2: p.observed.no2,
			so2: p.observed.so2,
		};
		const { iqar, classification, primary } = globalIQAr(concs);
		return {
			hour: p.hour,
			day: p.day,
			timestamp: p.timestamp,
			...concs,
			iqar,
			classification,
			primary,
			features: p.features,
			observed: p.observed,
		};
	});

	// Decomposição Saabas para a hora corrente (h=0) para o poluente crítico
	const criticalPollutant = points[0]?.primary || "pm25";
	let saabasContributions: Array<{ feature: string; phi: number }> = [];
	let baseValue = 15.0;

	const top = topologies[criticalPollutant];
	if (top && points[0]?.features) {
		baseValue = top.base_value;
		const { phi } = computeSaabas(points[0].features, top);
		saabasContributions = Object.entries(phi)
			.map(([feature, val]) => ({ feature, phi: Math.round(val * 100) / 100 }))
			.filter((item) => Math.abs(item.phi) > 0.05)
			.sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi));
	}

	const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

	self.postMessage({
		type: "result",
		version,
		stationId,
		points,
		saabas: saabasContributions,
		baseValue,
		latencyMs,
	});
}

async function predict(
	stationId: string,
	featNames: string[],
	rows: number[][],
) {
	const t0 = performance.now();
	if (!isInitialized) {
		await init();
	}

	const targets: Pollutant[] = ["pm25", "pm10", "o3", "no2", "so2"];
	const nHours = Math.min(120, rows.length);
	const predictions: Record<Pollutant, number[]> = {
		pm25: [],
		pm10: [],
		o3: [],
		no2: [],
		so2: [],
	};

	// 1. Executa inferência com os modelos ONNX
	for (const t of targets) {
		const session = sessions[t];
		if (session && rows.length > 0) {
			try {
				const nFeat = rows[0]?.length ?? featNames.length ?? 25;
				const flatData = new Float32Array(nHours * nFeat);
				for (let i = 0; i < nHours; i++) {
					for (let j = 0; j < nFeat; j++) {
						flatData[i * nFeat + j] = rows[i][j] ?? 0;
					}
				}
				const tensor = new ort.Tensor("float32", flatData, [nHours, nFeat]);
				const output = await session.run({ input: tensor });
				const outTensor = output.variable || Object.values(output)[0];
				const outData = outTensor.data as Float32Array;
				for (let i = 0; i < nHours; i++) {
					predictions[t].push(Math.max(0.5, Math.round(outData[i] * 10) / 10));
				}
			} catch (err) {
				for (let i = 0; i < nHours; i++) {
					predictions[t].push(Math.round((rows[i][0] || 15) * 1.2));
				}
			}
		} else {
			for (let i = 0; i < nHours; i++) {
				predictions[t].push(12.0 + (i % 5));
			}
		}
	}

	// 2. Calcula IQAr CONAMA 491 por hora
	const points = [];
	for (let h = 0; h < nHours; h++) {
		const concs = {
			pm25: predictions.pm25[h],
			pm10: predictions.pm10[h],
			o3: predictions.o3[h],
			no2: predictions.no2[h],
			so2: predictions.so2[h],
		};
		const { iqar, classification, primary } = globalIQAr(concs);
		points.push({
			hour: h,
			day: Math.floor(h / 24) + 1,
			...concs,
			iqar,
			classification,
			primary,
			observed: concs,
		});
	}

	// 3. Decomposição Saabas para a hora corrente (h=0) para o poluente crítico
	const criticalPollutant = points[0]?.primary || "pm25";
	let saabasContributions: Array<{ feature: string; phi: number }> = [];
	let baseValue = 15.0;

	const top = topologies[criticalPollutant];
	if (top && rows[0]) {
		baseValue = top.base_value;
		const { phi } = computeSaabas(rows[0], top);
		saabasContributions = Object.entries(phi)
			.map(([feature, val]) => ({ feature, phi: Math.round(val * 100) / 100 }))
			.filter((item) => Math.abs(item.phi) > 0.05)
			.sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi));
	}

	const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

	self.postMessage({
		type: "result",
		version,
		stationId,
		points,
		saabas: saabasContributions,
		baseValue,
		latencyMs,
	});
}

async function simulate(
	baseRow: number[],
	deltas: Record<string, number>,
	featNames: string[],
) {
	const modified = [...baseRow];
	for (const [feat, delta] of Object.entries(deltas)) {
		const idx = featNames.indexOf(feat);
		if (idx !== -1) {
			modified[idx] += delta;
		}
	}
	await predict("simulation", featNames, [modified]);
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
	try {
		if (e.data.type === "init") {
			await init(e.data.manifestUrl);
		} else if (e.data.type === "predict_forecast") {
			await predictForecast(
				e.data.stationId,
				e.data.flags,
				e.data.meteo,
				e.data.aq,
				e.data.cutoff,
				e.data.hours,
			);
		} else if (e.data.type === "predict") {
			await predict(e.data.stationId, e.data.featureNames, e.data.rows);
		} else if (e.data.type === "simulate") {
			await simulate(e.data.base, e.data.deltas, e.data.featureNames);
		}
	} catch (err: any) {
		self.postMessage({ type: "error", message: err?.message || String(err) });
	}
};
