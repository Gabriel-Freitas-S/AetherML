import {
	defineConfig,
	presetAttributify,
	presetIcons,
	presetUno,
} from "unocss";

export default defineConfig({
	presets: [
		presetUno(),
		presetAttributify(),
		presetIcons({
			scale: 1.2,
			warn: true,
		}),
	],
	theme: {
		colors: {
			brand: {
				50: "#ecfeff",
				100: "#cffafe",
				200: "#a5f3fc",
				300: "#67e8f9",
				400: "#22d3ee",
				500: "#06b6d4",
				600: "#0891b2",
				700: "#0e7490",
				800: "#155e75",
				900: "#164e63",
			},
			iqar: {
				boa: "#10b981", // 0-40 (Verde)
				moderada: "#f59e0b", // 41-80 (Amarelo/Âmbar)
				ruim: "#f97316", // 81-120 (Laranja)
				muitoruim: "#ef4444", // 121-200 (Vermelho)
				pessima: "#a855f7", // >200 (Roxo)
			},
		},
	},
	shortcuts: {
		// Tema claro "app de meteo": cartões brancos, bordas ardósia suaves
		"glass-card":
			"bg-white/85 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-[0_8px_30px_-12px_rgba(15,40,60,0.18)]",
		"glass-card-hover":
			"transition-all duration-200 hover:border-sky-400/60 hover:shadow-[0_12px_36px_-10px_rgba(14,165,233,0.35)] hover:-translate-y-0.5",
		"chip":
			"inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border",
		"btn-primary":
			"inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-sky-600 to-emerald-500 hover:from-sky-500 hover:to-emerald-400 shadow-lg shadow-sky-500/25 transition-all active:scale-95 disabled:opacity-50",
		"btn-ghost":
			"inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-sky-400 hover:text-sky-700 transition-all active:scale-95",
		"input-select":
			"w-full appearance-none bg-white border border-slate-300 rounded-xl pl-3 pr-9 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all cursor-pointer",
		"icon-btn":
			"inline-flex items-center justify-center rounded-xl transition-colors focus-visible:outline-none",
		"section-title": "text-lg font-bold text-slate-800 flex items-center gap-2",
		"section-dot": "w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_12px_rgba(14,165,233,0.5)]",
		"badge-boa":
			"bg-emerald-50 text-emerald-700 border border-emerald-200",
		"badge-moderada":
			"bg-amber-50 text-amber-700 border border-amber-200",
		"badge-ruim":
			"bg-orange-50 text-orange-700 border border-orange-200",
		"badge-muitoruim": "bg-red-50 text-red-700 border border-red-200",
		"badge-pessima":
			"bg-purple-50 text-purple-700 border border-purple-200",
	},
});
