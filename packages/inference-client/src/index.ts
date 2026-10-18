// packages/inference-client/src/index.ts
export * from "./weather-cache.ts";
export * from "./features.ts";
export * from "./calibrate.ts";
export * from "./forecast.ts";

import type { StationFlags } from "./features.ts";
import type { AQSeries, HourlySeries } from "./forecast.ts";

export interface PredictionPoint {
	hour: number;
	day?: number;
	timestamp?: string;
	pm25: number;
	pm10: number;
	o3: number;
	no2: number;
	so2: number;
	iqar: number;
	classification: "Boa" | "Moderada" | "Ruim" | "Muito Ruim" | "Péssima";
	primary: "pm25" | "pm10" | "o3" | "no2" | "so2";
	features?: number[];
	observed?: {
		pm25: number;
		pm10: number;
		o3: number;
		no2: number;
		so2: number;
	};
}

export interface SaabasContribution {
	feature: string;
	phi: number;
}

export interface WorkerReadyMsg {
	type: "ready";
	version: string;
	backend: "wasm-simd" | "wasm";
}

export interface WorkerResultMsg {
	type: "result";
	version: string;
	stationId: string;
	points: PredictionPoint[];
	saabas: SaabasContribution[];
	latencyMs: number;
	baseValue?: number;
}

export interface WorkerErrorMsg {
	type: "error";
	message: string;
}

export type WorkerOutMsg = WorkerReadyMsg | WorkerResultMsg | WorkerErrorMsg;

export class AetherInferenceClient {
	private worker: Worker;
	private isReady = false;
	private readyCallbacks: Array<() => void> = [];

	constructor(workerOrUrl: string | URL | Worker) {
		if (typeof Worker !== "undefined" && workerOrUrl instanceof Worker) {
			this.worker = workerOrUrl;
		} else {
			this.worker = new Worker(workerOrUrl, { type: "module" });
		}
		this.worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
			if (e.data.type === "ready") {
				this.isReady = true;
				for (const cb of this.readyCallbacks) {
					cb();
				}
				this.readyCallbacks = [];
			}
		};
	}

	async waitForReady(): Promise<void> {
		if (this.isReady) return;
		return new Promise((resolve) => {
			this.readyCallbacks.push(resolve);
		});
	}

	init(manifestUrl: string) {
		this.worker.postMessage({ type: "init", manifestUrl });
	}

	predict(
		stationId: string,
		featureNames: string[],
		rows: number[][],
	): Promise<WorkerResultMsg> {
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				if (e.data.type === "result") {
					this.worker.removeEventListener("message", handler);
					resolve(e.data);
				} else if (e.data.type === "error") {
					this.worker.removeEventListener("message", handler);
					reject(new Error(e.data.message));
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "predict",
				stationId,
				featureNames,
				rows,
			});
		});
	}

	predictForecast(params: {
		stationId: string;
		flags?: StationFlags;
		meteo: HourlySeries;
		aq: AQSeries;
		cutoff?: string;
		hours?: number;
	}): Promise<WorkerResultMsg> {
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				if (e.data.type === "result") {
					this.worker.removeEventListener("message", handler);
					resolve(e.data);
				} else if (e.data.type === "error") {
					this.worker.removeEventListener("message", handler);
					reject(new Error(e.data.message));
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "predict_forecast",
				...params,
			});
		});
	}

	simulate(
		baseRow: number[],
		deltas: Record<string, number>,
		featureNames: string[],
	): Promise<WorkerResultMsg> {
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				if (e.data.type === "result") {
					this.worker.removeEventListener("message", handler);
					resolve(e.data);
				} else if (e.data.type === "error") {
					this.worker.removeEventListener("message", handler);
					reject(new Error(e.data.message));
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "simulate",
				base: baseRow,
				deltas,
				featureNames,
			});
		});
	}

	terminate() {
		this.worker.terminate();
	}
}
