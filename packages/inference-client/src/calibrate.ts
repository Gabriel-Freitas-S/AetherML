// packages/inference-client/src/calibrate.ts — Calibração bias + isotonic e clamps

import { pyRound } from "./features.ts";

export const CLAMPS: Record<string, number> = {
	pm25: 1.0,
	pm10: 2.0,
	o3: 2.0,
	no2: 3.0,
	so2: 0.5,
};

export interface IsotonicMapping {
	x: number[];
	y: number[];
}

export interface CalibrationData {
	bias?: Record<string, number>;
	isotonic?: Record<string, IsotonicMapping>;
}

/**
 * Aplica mapeamento isotônico (PAVA) por interpolação linear com saturação de borda.
 * Espelha ml/training/calibrate.py::apply_isotonic.
 */
export function applyIsotonic(
	values: number[],
	mapping?: IsotonicMapping,
): number[] {
	if (!mapping || !mapping.x || mapping.x.length === 0) {
		return [...values];
	}
	const { x: xs, y: ys } = mapping;
	const n = xs.length;
	const out: number[] = [];

	for (const v of values) {
		if (v <= xs[0]) {
			out.push(ys[0]);
		} else if (v >= xs[n - 1]) {
			out.push(ys[n - 1]);
		} else {
			// Busca binária para encontrar o intervalo [xs[j-1], xs[j]]
			let low = 0;
			let high = n;
			while (low < high) {
				const mid = (low + high) >> 1;
				if (xs[mid] <= v) {
					low = mid + 1;
				} else {
					high = mid;
				}
			}
			const j = low;
			const x0 = xs[j - 1];
			const x1 = xs[j];
			const y0 = ys[j - 1];
			const y1 = ys[j];
			const f = x1 > x0 ? (v - x0) / (x1 - x0) : 0.0;
			out.push(y0 + f * (y1 - y0));
		}
	}
	return out;
}

/**
 * Calibra valor predito de um alvo via isotonic ou bias.
 * Espelha ml/training/calibrate.py::calibrate_value.
 */
export function calibrateValue(
	target: string,
	value: number,
	cal?: CalibrationData,
): number {
	if (!cal) return value;
	const iso = cal.isotonic?.[target];
	if (iso?.x && iso.x.length > 0) {
		return applyIsotonic([value], iso)[0];
	}
	return value + (cal.bias?.[target] ?? 0.0);
}

/**
 * Aplica piso mínimo regulatório (CLAMP) e arredondamento a 2 casas.
 */
export function clampValue(target: string, value: number): number {
	const minVal = CLAMPS[target] ?? 0.5;
	return Math.max(minVal, pyRound(value, 2));
}
