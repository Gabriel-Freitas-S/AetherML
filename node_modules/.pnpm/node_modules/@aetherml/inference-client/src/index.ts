// packages/inference-client/src/index.ts
export * from "./weather-cache.js";

export interface PredictionPoint {
	hour: number;
	pm25: number;
	pm10: number;
	o3: number;
	no2: number;
	so2: number;
	iqar: number;
	classification: "Boa" | "Moderada" | "Ruim" | "Muito Ruim" | "Péssima";
	primary: "pm25" | "pm10" | "o3" | "no2" | "so2";
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

	constructor(workerUrl: string | URL) {
		this.worker = new Worker(workerUrl, { type: "module" });
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
