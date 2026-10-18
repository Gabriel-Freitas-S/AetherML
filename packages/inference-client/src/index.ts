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
	requestId?: string;
	points: PredictionPoint[];
	saabas: SaabasContribution[];
	latencyMs: number;
	baseValue?: number;
}

export interface WorkerErrorMsg {
	type: "error";
	message: string;
	stationId?: string;
	requestId?: string;
}

export interface WorkerExplainResultMsg {
	type: "explain_result";
	stationId: string;
	requestId?: string;
	target: string;
	baseValue: number;
	contributions: SaabasContribution[];
}

export type WorkerOutMsg =
	| WorkerReadyMsg
	| WorkerResultMsg
	| WorkerExplainResultMsg
	| WorkerErrorMsg;

export class AetherInferenceClient {
	private worker: Worker;
	private isReady = false;
	private readyCallbacks: Array<() => void> = [];
	private reqCounter = 0;

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
		const reqId = `req_${++this.reqCounter}_${stationId}`;
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				const data = e.data;
				if (data.type === "result") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					const matchStation = data.stationId === stationId;
					if (matchReq && matchStation) {
						this.worker.removeEventListener("message", handler);
						resolve(data);
					}
				} else if (data.type === "error") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					const matchStation = data.stationId
						? data.stationId === stationId
						: true;
					if (matchReq && matchStation) {
						this.worker.removeEventListener("message", handler);
						reject(new Error(data.message));
					}
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "predict",
				stationId,
				requestId: reqId,
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
		requestId?: string;
	}): Promise<WorkerResultMsg> {
		const reqId =
			params.requestId || `req_${++this.reqCounter}_${params.stationId}`;
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				const data = e.data;
				if (data.type === "result") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					const matchStation = data.stationId === params.stationId;
					if (matchReq && matchStation) {
						this.worker.removeEventListener("message", handler);
						resolve(data);
					}
				} else if (data.type === "error") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					const matchStation = data.stationId
						? data.stationId === params.stationId
						: true;
					if (matchReq && matchStation) {
						this.worker.removeEventListener("message", handler);
						reject(new Error(data.message));
					}
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "predict_forecast",
				...params,
				requestId: reqId,
			});
		});
	}

	simulate(
		baseRow: number[],
		deltas: Record<string, number>,
		featureNames: string[],
	): Promise<WorkerResultMsg> {
		const reqId = `req_${++this.reqCounter}_simulation`;
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				const data = e.data;
				if (data.type === "result") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					if (matchReq && data.stationId === "simulation") {
						this.worker.removeEventListener("message", handler);
						resolve(data);
					}
				} else if (data.type === "error") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					if (matchReq) {
						this.worker.removeEventListener("message", handler);
						reject(new Error(data.message));
					}
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "simulate",
				base: baseRow,
				deltas,
				featureNames,
				requestId: reqId,
			});
		});
	}

	explain(params: {
		stationId: string;
		features: number[];
		target?: string;
		requestId?: string;
	}): Promise<{
		stationId: string;
		target: string;
		baseValue: number;
		contributions: SaabasContribution[];
	}> {
		const reqId =
			params.requestId ||
			`req_${++this.reqCounter}_explain_${params.stationId}`;
		return new Promise((resolve, reject) => {
			const handler = (e: MessageEvent<WorkerOutMsg>) => {
				const data = e.data;
				if (data.type === "explain_result") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					const matchStation = data.stationId === params.stationId;
					if (matchReq && matchStation) {
						this.worker.removeEventListener("message", handler);
						resolve({
							stationId: data.stationId,
							target: data.target,
							baseValue: data.baseValue,
							contributions: data.contributions,
						});
					}
				} else if (data.type === "error") {
					const matchReq = data.requestId ? data.requestId === reqId : true;
					const matchStation = data.stationId
						? data.stationId === params.stationId
						: true;
					if (matchReq && matchStation) {
						this.worker.removeEventListener("message", handler);
						reject(new Error(data.message));
					}
				}
			};
			this.worker.addEventListener("message", handler);
			this.worker.postMessage({
				type: "explain",
				stationId: params.stationId,
				requestId: reqId,
				features: params.features,
				target: params.target,
			});
		});
	}

	terminate() {
		this.worker.terminate();
	}
}
