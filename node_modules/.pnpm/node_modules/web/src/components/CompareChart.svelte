<!-- apps/web/src/components/CompareChart.svelte — Real (sólida) vs IA (tracejada) -->
<script lang="ts">
const {
	labels = [],
	real = [],
	pred = [],
	unit = "µg/m³",
	color = "#34d399",
	title = "Real vs IA",
	version = "",
}: {
	labels: string[];
	real: number[];
	pred: number[];
	unit?: string;
	color?: string;
	title?: string;
	version?: string;
} = $props();

let hovered = $state<number | null>(null);

const width = 800;
const height = 260;
const padding = { top: 16, right: 16, bottom: 38, left: 48 };
const plotWidth = width - padding.left - padding.right;
const plotHeight = height - padding.top - padding.bottom;

const maxY = $derived.by(() => {
	const all = [...real, ...pred];
	if (!all.length) return 100;
	return Math.max(10, Math.ceil((Math.max(...all) * 1.2) / 10) * 10);
});

function getX(i: number): number {
	return padding.left + (i / Math.max(1, real.length - 1)) * plotWidth;
}
function getY(v: number): number {
	return padding.top + plotHeight - (Math.min(v, maxY) / maxY) * plotHeight;
}
function lineOf(arr: number[]): string {
	return arr.reduce(
		(acc, v, i) => (i === 0 ? `M ${getX(i)} ${getY(v)}` : `${acc} L ${getX(i)} ${getY(v)}`),
		"",
	);
}
const realD = $derived.by(() => lineOf(real));
const predD = $derived.by(() => lineOf(pred));

const ticks = $derived.by(() => {
	const idx = [0, 42, 84, 126, real.length - 1].filter((i) => i < real.length);
	return [...new Set(idx)];
});
function shortLabel(iso: string): string {
	// "2026-09-11T21:00" -> "11/09 21h"
	const d = iso.slice(8, 10);
	const m = iso.slice(5, 7);
	const h = iso.slice(11, 13);
	return `${d}/${m} ${h}h`;
}

// Hover estável via overlay único (mesmo motivo do ForecastChart).
function indexFromEvent(e: MouseEvent): void {
	const target = e.currentTarget as SVGRectElement | null;
	const svg = target?.ownerSVGElement;
	if (!svg || !real.length) return;
	const r = svg.getBoundingClientRect();
	if (r.width === 0) return;
	const sx = ((e.clientX - r.left) / r.width) * width;
	hovered = Math.max(0, Math.min(real.length - 1, Math.round(((sx - padding.left) / plotWidth) * (real.length - 1))));
}
</script>

<div class="glass-card p-5">
  <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
    <h3 class="text-base font-bold text-slate-800">{title} <span class="text-xs font-medium text-slate-500">· {unit}</span></h3>
    <div class="flex items-center gap-4 text-xs font-semibold">
      <span class="flex items-center gap-1.5 text-slate-700">
        <i class="inline-block w-6 h-0.5 rounded" style="background:{color}"></i> Real (CAMS)
      </span>
      <span class="flex items-center gap-1.5 text-slate-500">
        <i class="inline-block w-6 border-t-2 border-dashed" style="border-color:{color}"></i> IA {version}
      </span>
    </div>
  </div>

  <div class="relative w-full overflow-x-auto">
    <svg viewBox="0 0 {width} {height}" class="fchart w-full h-auto min-w-[600px] select-none" role="img" aria-label={title}>
      {#each [0, 0.25, 0.5, 0.75, 1] as f}
        {@const v = Math.round(maxY * f)}
        <line x1="{padding.left}" y1="{getY(v)}" x2="{width - padding.right}" y2="{getY(v)}" stroke="#cbd5e1" stroke-dasharray="3 3" stroke-width="1" />
        <text x="{padding.left - 8}" y="{getY(v) + 4}" fill="#64748b" text-anchor="end" style="font-size:11px;font-weight:600">{v}</text>
      {/each}

      {#each ticks as i}
        <text x="{getX(i)}" y="{height - padding.bottom + 20}" fill="#64748b" text-anchor="middle" style="font-size:11px;font-weight:600">{shortLabel(labels[i] ?? "")}</text>
      {/each}

      <path d="{realD}" fill="none" stroke={color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <path d="{predD}" fill="none" stroke={color} stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round" opacity="0.85" />

      {#if hovered != null && real[hovered] != null}
        <line x1="{getX(hovered)}" y1="{padding.top}" x2="{getX(hovered)}" y2="{height - padding.bottom}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 2" opacity="0.7" pointer-events="none" />
        <circle cx="{getX(hovered)}" cy="{getY(real[hovered])}" r="5" fill={color} stroke="#fff" stroke-width="2" pointer-events="none" />
        <circle cx="{getX(hovered)}" cy="{getY(pred[hovered])}" r="5" fill="#0f172a" stroke={color} stroke-width="2" stroke-dasharray="2 1" pointer-events="none" />
      {/if}

      <!-- Overlay único de hover -->
      <rect
        x="{padding.left}"
        y="{padding.top}"
        width="{plotWidth}"
        height="{plotHeight}"
        fill="transparent"
        style="cursor: crosshair"
        onmousemove={indexFromEvent}
        onmouseleave={() => (hovered = null)}
        onclick={indexFromEvent}
      />
    </svg>

    {#if hovered != null && real[hovered] != null}
      <div class="absolute top-2 right-4 bg-white/95 border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-xl backdrop-blur-md">
        <div class="font-bold text-slate-800">{shortLabel(labels[hovered] ?? "")}</div>
        <div class="font-mono mt-0.5 text-slate-600">Real <strong style="color:{color}">{real[hovered]}</strong> · IA <strong class="text-slate-800">{pred[hovered]}</strong></div>
        <div class="text-slate-500 font-mono">erro {Math.abs(real[hovered] - pred[hovered]).toFixed(1)} {unit}</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .fchart text {
    font-family: 'Outfit', system-ui, sans-serif;
    letter-spacing: 0;
  }
</style>
