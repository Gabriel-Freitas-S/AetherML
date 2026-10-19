import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { AetherInferenceClient } from "../src/index.ts";

class MockWorker extends EventEmitter {
	public postMessageCalls: any[] = [];
	postMessage(msg: any) {
		this.postMessageCalls.push(msg);
	}
	terminate() {}
}

test("waitForReady resolve quando worker envia mensagem 'ready'", async () => {
	const worker = new MockWorker();
	const client = new AetherInferenceClient(worker as any);

	let resolved = false;
	const readyPromise = client.waitForReady().then(() => {
		resolved = true;
	});

	assert.equal(resolved, false);
	// Emite ready
	if (worker.onmessage) {
		worker.onmessage({
			data: { type: "ready", version: "v2026.42.1", backend: "wasm-simd" },
		} as any);
	}
	await readyPromise;
	assert.equal(resolved, true);
});

test("waitForReady rejeita com erro quando worker falha na inicialização", async () => {
	const worker = new MockWorker();
	const client = new AetherInferenceClient(worker as any);

	const readyPromise = client.waitForReady();

	// Emite erro de inicialização
	if (worker.onmessage) {
		worker.onmessage({
			data: {
				type: "error",
				message: "SHA-256 mismatch no modelo pm25.onnx",
			},
		} as any);
	}

	await assert.rejects(
		async () => {
			await readyPromise;
		},
		{
			name: "Error",
			message: "SHA-256 mismatch no modelo pm25.onnx",
		},
	);

	// Chamada subsequente também deve rejeitar imediatamente em vez de travar
	await assert.rejects(
		async () => {
			await client.waitForReady();
		},
		{
			name: "Error",
			message: "SHA-256 mismatch no modelo pm25.onnx",
		},
	);
});
