// packages/core-iqar/src/iqar.ts — CONAMA 491/2018 puro (cliente + server compartilham)
export type Pollutant = "pm25" | "pm10" | "o3" | "no2" | "so2";
export type Classification =
	| "Boa"
	| "Moderada"
	| "Ruim"
	| "Muito Ruim"
	| "Péssima";

interface Band {
	iIni: number;
	iFim: number;
	cIni: number;
	cFim: number;
	cls: Classification;
}

// cFim = Infinity normalizado por faixa; iFim Péssima = 300 (saturação p/ UI)
const TABLE: Record<Pollutant, Band[]> = {
	pm25: [
		{ iIni: 0, iFim: 40, cIni: 0, cFim: 15, cls: "Boa" },
		{ iIni: 41, iFim: 80, cIni: 15, cFim: 25, cls: "Moderada" },
		{ iIni: 81, iFim: 120, cIni: 25, cFim: 50, cls: "Ruim" },
		{ iIni: 121, iFim: 200, cIni: 50, cFim: 75, cls: "Muito Ruim" },
		{ iIni: 201, iFim: 300, cIni: 75, cFim: 150, cls: "Péssima" },
	],
	pm10: [
		{ iIni: 0, iFim: 40, cIni: 0, cFim: 50, cls: "Boa" },
		{ iIni: 41, iFim: 80, cIni: 50, cFim: 100, cls: "Moderada" },
		{ iIni: 81, iFim: 120, cIni: 100, cFim: 150, cls: "Ruim" },
		{ iIni: 121, iFim: 200, cIni: 150, cFim: 250, cls: "Muito Ruim" },
		{ iIni: 201, iFim: 300, cIni: 250, cFim: 500, cls: "Péssima" },
	],
	o3: [
		{ iIni: 0, iFim: 40, cIni: 0, cFim: 100, cls: "Boa" },
		{ iIni: 41, iFim: 80, cIni: 100, cFim: 130, cls: "Moderada" },
		{ iIni: 81, iFim: 120, cIni: 130, cFim: 160, cls: "Ruim" },
		{ iIni: 121, iFim: 200, cIni: 160, cFim: 200, cls: "Muito Ruim" },
		{ iIni: 201, iFim: 300, cIni: 200, cFim: 400, cls: "Péssima" },
	],
	no2: [
		{ iIni: 0, iFim: 40, cIni: 0, cFim: 200, cls: "Boa" },
		{ iIni: 41, iFim: 80, cIni: 200, cFim: 240, cls: "Moderada" },
		{ iIni: 81, iFim: 120, cIni: 240, cFim: 320, cls: "Ruim" },
		{ iIni: 121, iFim: 200, cIni: 320, cFim: 1130, cls: "Muito Ruim" },
		{ iIni: 201, iFim: 300, cIni: 1130, cFim: 2260, cls: "Péssima" },
	],
	so2: [
		{ iIni: 0, iFim: 40, cIni: 0, cFim: 20, cls: "Boa" },
		{ iIni: 41, iFim: 80, cIni: 20, cFim: 40, cls: "Moderada" },
		{ iIni: 81, iFim: 120, cIni: 40, cFim: 365, cls: "Ruim" },
		{ iIni: 121, iFim: 200, cIni: 365, cFim: 800, cls: "Muito Ruim" },
		{ iIni: 201, iFim: 300, cIni: 800, cFim: 1600, cls: "Péssima" },
	],
};

export function individualIndex(
	p: Pollutant,
	conc: number,
): { index: number; classification: Classification } {
	const c = Math.max(0, conc);
	const bands = TABLE[p];
	const band = bands.find((b) => c <= b.cFim) ?? bands[bands.length - 1];
	const idx = Math.round(
		band.iIni +
			((band.iFim - band.iIni) / (band.cFim - band.cIni)) * (c - band.cIni),
	);
	return { index: idx, classification: band.cls };
}

export function globalIQAr(concs: Record<Pollutant, number>): {
	iqar: number;
	classification: Classification;
	primary: Pollutant;
} {
	let best: Pollutant = "pm25";
	let bestIdx = -1;
	let bestCls: Classification = "Boa";
	for (const p of Object.keys(concs) as Pollutant[]) {
		const { index, classification } = individualIndex(p, concs[p]);
		if (index > bestIdx) {
			bestIdx = index;
			best = p;
			bestCls = classification;
		}
	}
	return { iqar: bestIdx, classification: bestCls, primary: best };
}

export const ADVICE: Record<string, string> = {
	Ruim: "Grupos sensíveis (crianças, idosos, asmáticos): evite exercício intenso ao ar livre.",
	"Muito Ruim":
		"Toda a população: reduza atividades externas e mantenha ambientes ventilados.",
	Péssima:
		"Toda a população: permaneça em ambientes internos; risco sanitário grave.",
};
