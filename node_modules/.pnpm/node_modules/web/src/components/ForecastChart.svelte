<!-- apps/web/src/components/ForecastChart.svelte — Gráfico SVG Reativo Svelte 5 (Runes) -->
<script lang="ts">
import type { PredictionPoint } from "@aetherml/inference-client";

const {
	points = [],
	activePollutant = "iqar",
}: { points: PredictionPoint[]; activePollutant?: string } = $props();

let currentPollutant = $state(activePollutant);
let hoveredPoint = $state<PredictionPoint | null>(null);

const width = 800;
const height = 280;
const padding = { top: 20, right: 30, bottom: 40, left: 45 };

const plotWidth = width - padding.left - padding.right;
const plotHeight = height - padding.top - padding.bottom;

// Escala Y máxima adaptativa (mínimo 150 para caber faixas)
const maxY = $derived.by(() => {
	if (!points.length) return 150;
	const maxVal = Math.max(
		...points.map((p) => {
			if (currentPollutant === "iqar") return p.iqar;
			return (p as any)[currentPollutant] ?? 0;
		}),
	);
	return Math.max(160, Math.ceil((maxVal * 1.25) / 20) * 20);
});

function getX(hour: number): number {
	const maxHour = Math.max(
		1,
		points.length > 0 ? points[points.length - 1].hour : 119,
	);
	return padding.left + (hour / maxHour) * plotWidth;
}

const xMarkers = $derived.by(() => {
	if (points.length > 50) {
		const bounds = [0, 24, 48, 72, 96].filter((h) => h < points.length);
		const marks = bounds.map((h, i) => ({ h, label: tickLabel(h, i === 0) }));
		marks.push({ h: points[points.length - 1]?.hour ?? 119, label: "+120h" });
		return marks;
	}
	return [0, 6, 12, 18, 24, 30, 36, 42, 47].map((h) => ({ h, label: `+${h}h` }));
});

// "Hoje 18/09" / "Sáb 19/09" a partir do timestamp do ponto (fuso de Brasília)
function tickLabel(h: number, isFirst: boolean): string {
	const p = points.find((q) => q.hour === h) ?? points[h];
	const ts = (p as any)?.timestamp as string | undefined;
	if (!ts) return isFirst ? "Hoje" : `Dia ${h / 24 + 1} (+${h}h)`;
	const d = new Date(ts);
	const parts = new Intl.DateTimeFormat("pt-BR", {
		timeZone: "America/Sao_Paulo",
		weekday: "short",
		day: "2-digit",
		month: "2-digit",
	}).formatToParts(d);
	const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
	let wd = get("weekday").replace(".", "");
	wd = wd.charAt(0).toUpperCase() + wd.slice(1);
	return isFirst ? `Hoje ${get("day")}/${get("month")}` : `${wd} ${get("day")}/${get("month")}`;
}

function getY(val: number): number {
	return padding.top + plotHeight - (Math.min(val, maxY) / maxY) * plotHeight;
}

const pathD = $derived.by(() => {
	if (!points.length) return "";
	return points.reduce((acc, p, i) => {
		const val =
			currentPollutant === "iqar"
				? p.iqar
				: ((p as any)[currentPollutant] ?? 0);
		const x = getX(p.hour);
		const y = getY(val);
		return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
	}, "");
});

const areaD = $derived.by(() => {
	if (!points.length) return "";
	const firstX = getX(points[0].hour);
	const lastX = getX(points[points.length - 1].hour);
	const baseY = getY(0);
	return `${pathD} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
});

// Hover estável: um único overlay captura o mouse e resolve o ponto mais
// próximo (120 listeners onmouseenter/onmouseleave causavam flicker).
function pointFromEvent(e: MouseEvent): void {
	const target = e.currentTarget as SVGRectElement | null;
	const svg = target?.ownerSVGElement;
	if (!svg || !points.length) return;
	const r = svg.getBoundingClientRect();
	if (r.width === 0) return;
	const sx = ((e.clientX - r.left) / r.width) * width;
	const idx = Math.round(((sx - padding.left) / plotWidth) * (points.length - 1));
	hoveredPoint = points[Math.max(0, Math.min(points.length - 1, idx))];
}

// Cor da série por poluente (contraste sobre fundo claro)
const lineColor = $derived.by(() => {
	switch (currentPollutant) {
		case "pm25":
			return "#059669";
		case "pm10":
			return "#d97706";
		case "o3":
			return "#7c3aed";
		case "no2":
			return "#ea580c";
		case "so2":
			return "#db2777";
		default:
			return "#0284c7";
	}
});
</script>

<div class="glass-card p-5">
  <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
    <div>
      <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse"></span>
        Série Preditiva de 5 Dias (120 Horas) por Machine Learning
      </h3>
      <p class="text-xs text-slate-500">Previsão horária contínua calculada por modelos LightGBM via WASM SIMD client-side</p>
    </div>

    <!-- Seletor de Poluente -->
    <div class="flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs overflow-x-auto">
      {#each [
        { id: 'iqar', label: 'IQAr Global' },
        { id: 'pm25', label: 'PM2.5' },
        { id: 'pm10', label: 'PM10' },
        { id: 'o3', label: 'O₃' },
        { id: 'no2', label: 'NO₂' },
        { id: 'so2', label: 'SO₂' }
      ] as item}
        <button
          class="px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap {currentPollutant === item.id ? 'bg-gradient-to-r from-sky-600 to-emerald-500 text-white font-bold shadow' : 'text-slate-600 hover:text-slate-900 hover:bg-white'}"
          onclick={() => currentPollutant = item.id}
        >
          {item.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="relative w-full overflow-x-auto">
    <svg viewBox="0 0 {width} {height}" class="fchart w-full h-auto min-w-[600px] select-none" role="img" aria-label="Série preditiva de 5 dias">
      <!-- Faixas de Fundo CONAMA 491 (se for IQAr) -->
      {#if currentPollutant === 'iqar'}
        <!-- Boa (0-40) -->
        <rect x="{padding.left}" y="{getY(40)}" width="{plotWidth}" height="{getY(0) - getY(40)}" fill="#10b981" fill-opacity="0.14" />
        <!-- Moderada (40-80) -->
        <rect x="{padding.left}" y="{getY(80)}" width="{plotWidth}" height="{getY(40) - getY(80)}" fill="#f59e0b" fill-opacity="0.14" />
        <!-- Ruim (80-120) -->
        <rect x="{padding.left}" y="{getY(120)}" width="{plotWidth}" height="{getY(80) - getY(120)}" fill="#f97316" fill-opacity="0.14" />
        <!-- Muito Ruim (120-200) -->
        {#if maxY >= 120}
          <rect x="{padding.left}" y="{getY(Math.min(maxY, 200))}" width="{plotWidth}" height="{getY(120) - getY(Math.min(maxY, 200))}" fill="#ef4444" fill-opacity="0.14" />
        {/if}
        <!-- Rótulos das faixas (dentro da área do gráfico, alinhados à direita) -->
        <text x="{width - padding.right - 6}" y="{getY(20)}" fill="#059669" text-anchor="end" dominant-baseline="middle" style="font-size:10px;font-weight:700">Boa</text>
        {#if maxY >= 80}
          <text x="{width - padding.right - 6}" y="{getY(60)}" fill="#b45309" text-anchor="end" dominant-baseline="middle" style="font-size:10px;font-weight:700">Mod</text>
        {/if}
        {#if maxY >= 120}
          <text x="{width - padding.right - 6}" y="{getY(100)}" fill="#c2410c" text-anchor="end" dominant-baseline="middle" style="font-size:10px;font-weight:700">Ruim</text>
        {/if}
      {/if}

      <!-- Linhas de Grade Horizontal -->
      {#each [0, 40, 80, 120, 160, 200] as gridVal}
        {#if gridVal <= maxY}
          <line
            x1="{padding.left}"
            y1="{getY(gridVal)}"
            x2="{width - padding.right}"
            y2="{getY(gridVal)}"
            stroke="#cbd5e1"
            stroke-dasharray="3 3"
            stroke-width="1"
          />
          <text
            x="{padding.left - 8}"
            y="{getY(gridVal) + 4}"
            fill="#64748b"
            text-anchor="end"
            style="font-size:11px;font-weight:600"
          >
            {gridVal}
          </text>
        {/if}
      {/each}

      <!-- Marcadores de Tempo X -->
      {#each xMarkers as marker}
        <line
          x1="{getX(marker.h)}"
          y1="{padding.top}"
          x2="{getX(marker.h)}"
          y2="{height - padding.bottom}"
          stroke="#e2e8f0"
          stroke-width="1"
        />
        <text
          x="{getX(marker.h)}"
          y="{height - padding.bottom + 20}"
          fill="#64748b"
          text-anchor="middle"
          style="font-size:11px;font-weight:600"
        >
          {marker.label}
        </text>
      {/each}

      <!-- Área Sob a Curva -->
      <path d="{areaD}" fill="url(#chartGradient)" />

      <!-- Halo da Linha Principal -->
      <path
        d="{pathD}"
        fill="none"
        stroke={lineColor}
        stroke-width="8"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.25"
      />

      <!-- Linha Principal -->
      <path
        d="{pathD}"
        fill="none"
        stroke={lineColor}
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- Gradiente -->
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={lineColor} stop-opacity="0.45" />
          <stop offset="100%" stop-color={lineColor} stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Pontos Interativos e Hover -->
      {#each points as p}
        {@const val = currentPollutant === 'iqar' ? p.iqar : ((p as any)[currentPollutant] ?? 0)}
        {@const cx = getX(p.hour)}
        {@const cy = getY(val)}
        <circle
          cx="{cx}"
          cy="{cy}"
          r="5"
          fill={lineColor}
          stroke="#ffffff"
          stroke-width="2"
          opacity="0.95"
          pointer-events="none"
        />
      {/each}

      <!-- Linha vertical de Hover -->
      {#if hoveredPoint}
        {@const hVal = currentPollutant === 'iqar' ? hoveredPoint.iqar : ((hoveredPoint as any)[currentPollutant] ?? 0)}
        <line
          x1="{getX(hoveredPoint.hour)}"
          y1="{padding.top}"
          x2="{getX(hoveredPoint.hour)}"
          y2="{height - padding.bottom}"
          stroke="#38bdf8"
          stroke-width="1.5"
          stroke-dasharray="4 2"
        />
        <circle
          cx="{getX(hoveredPoint.hour)}"
          cy="{getY(hVal)}"
          r="6"
          fill="#38bdf8"
          stroke="#ffffff"
          stroke-width="2"
          pointer-events="none"
        />
      {/if}

      <!-- Overlay único de hover (por cima de tudo, abaixo do tooltip HTML) -->
      <rect
        x="{padding.left}"
        y="{padding.top}"
        width="{plotWidth}"
        height="{plotHeight}"
        fill="transparent"
        style="cursor: crosshair"
        onmousemove={pointFromEvent}
        onmouseleave={() => (hoveredPoint = null)}
        onclick={pointFromEvent}
      />
    </svg>

    <!-- Tooltip Hover Flutuante -->
    {#if hoveredPoint}
      {@const val = currentPollutant === 'iqar' ? hoveredPoint.iqar : ((hoveredPoint as any)[currentPollutant] ?? 0)}
      <div
        class="absolute top-2 right-4 bg-white/95 border border-slate-200 rounded-lg p-2.5 text-xs shadow-xl backdrop-blur-md"
      >
        <div class="font-bold text-sky-700">Horizonte: +{hoveredPoint.hour}h</div>
        <div class="text-slate-800 font-mono text-sm mt-0.5">
          {currentPollutant.toUpperCase()}: <span class="font-bold">{val}</span>
        </div>
        <div class="mt-1 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full {
            hoveredPoint.classification === 'Boa' ? 'bg-emerald-500' :
            hoveredPoint.classification === 'Moderada' ? 'bg-amber-500' :
            hoveredPoint.classification === 'Ruim' ? 'bg-orange-500' :
            hoveredPoint.classification === 'Muito Ruim' ? 'bg-red-500' : 'bg-purple-500'
          }"></span>
          <span class="text-slate-600">{hoveredPoint.classification}</span>
          {#if hoveredPoint.primary}
            <span class="text-slate-400 text-[10px]">({hoveredPoint.primary.toUpperCase()})</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Trava o tamanho dos textos do SVG: vence qualquer regra global/herdada,
     que trata atributo font-size como apresentação (especificidade zero). */
  .fchart text {
    font-family: 'Outfit', system-ui, sans-serif;
    letter-spacing: 0;
  }
</style>
