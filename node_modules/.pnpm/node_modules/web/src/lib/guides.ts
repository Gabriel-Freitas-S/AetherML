// apps/web/src/lib/guides.ts — Índice único da documentação (trilhas + ordem)
export interface Guide {
	slug: string;
	number: string;
	title: string;
	badge: string;
	icon: string;
	summary: string;
	track: "start" | "tech";
}

export const GUIDES: Guide[] = [
	{
		slug: "guia-rapido",
		number: "★",
		title: "Leia o app em 2 minutos",
		badge: "Comece aqui",
		icon: "gauge",
		summary: "O que cada número, cor e gráfico significa — sem jargão.",
		track: "start",
	},
	{
		slug: "saude-por-faixa",
		number: "★",
		title: "O que fazer em cada faixa",
		badge: "Saúde",
		icon: "shield",
		summary: "De Boa a Péssima: quem pode sair, quem deve se cuidar e quando.",
		track: "start",
	},
	{
		slug: "faq",
		number: "★",
		title: "Perguntas frequentes",
		badge: "FAQ",
		icon: "info",
		summary: "Dados, precisão, offline, GPS e por que o número muda.",
		track: "start",
	},
	{
		slug: "01-visao-arquitetura",
		number: "01",
		title: "Visão Geral e Arquitetura",
		badge: "Arquitetura & Edge",
		icon: "cpu",
		summary: "Inferência na borda via WASM SIMD-128 e matriz do sistema.",
		track: "tech",
	},
	{
		slug: "02-resolucao-conama-491",
		number: "02",
		title: "CONAMA 491/2018 e cálculo do IQAr",
		badge: "Norma CONAMA",
		icon: "shield",
		summary: "Interpolação linear, tabela de faixas e critérios de saúde.",
		track: "tech",
	},
	{
		slug: "03-pipeline-ml-features",
		number: "03",
		title: "Pipeline de ML e Features V1/V2",
		badge: "Pipeline & ONNX",
		icon: "activity",
		summary: "Features canônicas, restrições monotônicas, calibração e ONNX.",
		track: "tech",
	},
	{
		slug: "04-explicabilidade-saabas-xai",
		number: "04",
		title: "Explicabilidade (Saabas XAI)",
		badge: "XAI Client-Side",
		icon: "flask",
		summary: "Decomposição aditiva O(K·D) no navegador e leitura física.",
		track: "tech",
	},
	{
		slug: "05-pwa-resiliencia-offline",
		number: "05",
		title: "PWA e resiliência offline",
		badge: "PWA & Offline",
		icon: "layers",
		summary: "Cache multinível, COOP/COEP e IndexedDB.",
		track: "tech",
	},
	{
		slug: "06-api-rest-schema-d1",
		number: "06",
		title: "API REST, D1 e DB-First",
		badge: "D1 & Quota Guard",
		icon: "database",
		summary: "Schema relacional, endpoints e proteção de cotas.",
		track: "tech",
	},
	{
		slug: "07-simulador-alertas-push",
		number: "07",
		title: "Vigilância e alertas push",
		badge: "Vigilância & VAPID",
		icon: "alert",
		summary: "Dinâmica da RMGV, Haversine e Web Push com VAPID.",
		track: "tech",
	},
	{
		slug: "08-guia-desenvolvimento-tdd",
		number: "08",
		title: "Guia do desenvolvedor e TDD",
		badge: "TDD & Monorepo",
		icon: "check",
		summary: "Workspaces, ciclo Red-Green-Refactor e build no Pages.",
		track: "tech",
	},
	{
		slug: "09-dados-reais-backtest",
		number: "09",
		title: "Dados reais, backtest e precisão",
		badge: "Metodologia & Métricas",
		icon: "globe",
		summary: "Fontes, fim do sintético, holdout 7d e 91,9%.",
		track: "tech",
	},
];

export function neighbors(slug: string): { prev: Guide | null; next: Guide | null } {
	const i = GUIDES.findIndex((g) => g.slug === slug);
	return {
		prev: i > 0 ? GUIDES[i - 1] : null,
		next: i >= 0 && i < GUIDES.length - 1 ? GUIDES[i + 1] : null,
	};
}
