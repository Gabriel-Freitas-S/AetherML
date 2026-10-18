<!-- apps/web/src/components/DashboardShell.svelte — o painel único.
     Quatro seções (Agora · Mapa · Precisão · Confronto) numa rota, com a seção
     Confronto reunindo as duas sub-abas de comparação (Previsão 120h à frente |
     Holdout 168h de validação) e a navegação do produto em dois itens
     (Dashboard · Docs). -->
<script lang="ts">
import {
	CONFRONTO_SUBTABS,
	type ConfrontoSubtab,
	DASHBOARD_SECTIONS,
	type SectionId,
	moveConfrontoSubtab,
	moveSection,
	resolveConfrontoSubtab,
	resolveSection,
	sectionById,
} from "../lib/dashboard-sections";
import { type EdgeHint, computeEdgeHint } from "../lib/tab-affordance";
import AccuracyDashboard from "./AccuracyDashboard.svelte";
import ComparisonPanel from "./ComparisonPanel.svelte";
import Dashboard from "./Dashboard.svelte";
import ForecastComparePanel from "./ForecastComparePanel.svelte";
import MapSection from "./MapSection.svelte";

interface StationMeta {
	id: string;
	name: string;
	municipality: string;
	lat?: number;
	lon?: number;
	latitude?: number;
	longitude?: number;
	coastal?: boolean;
	downwind_tubarao?: boolean;
	bridge_proximity?: boolean;
	traffic_heavy?: boolean;
	urban_canyon?: boolean;
}

interface MapStation {
	id: string;
	name: string;
	municipality: string;
	latitude: number;
	longitude: number;
	iqar: number;
	classification: string;
	primary: string;
	concentration: number | null;
}

const {
	stationsMeta = [],
	initialStationId = "ramqar_camburi",
	initialBundle = null,
	initialMapStations = [],
	initialSection = "agora",
	initialSubtab,
	evalData = null,
}: {
	stationsMeta?: StationMeta[];
	initialStationId?: string;
	initialBundle?: Record<string, unknown> | null;
	initialMapStations?: MapStation[];
	initialSection?: SectionId | string;
	initialSubtab?: ConfrontoSubtab | string;
	evalData?: Record<string, unknown> | null;
} = $props();

let active = $state<SectionId>(resolveSection(initialSection));
let activeSubtab = $state<ConfrontoSubtab>(
	resolveConfrontoSubtab(initialSubtab ?? initialSection),
);
const section = $derived(sectionById(active));
const currentSubtabItem = $derived(
	CONFRONTO_SUBTABS.find((t) => t.id === activeSubtab) ?? CONFRONTO_SUBTABS[0],
);

function syncUrl(targetHref: string) {
	if (typeof window === "undefined") return;
	const next = new URL(targetHref, window.location.href);
	if (window.location.pathname.endsWith("/") && !next.pathname.endsWith("/")) {
		next.pathname = `${next.pathname}/`;
	}
	window.history.replaceState(null, "", `${next.pathname}${next.search}`);
}

/**
 * Troca de seção sem recarregar e reescreve a barra de endereços.
 */
function activate(id: SectionId) {
	active = id;
	if (id === "confronto") {
		syncUrl(currentSubtabItem.href);
	} else {
		syncUrl(sectionById(id).href);
	}
}

function activateSubtab(sub: ConfrontoSubtab) {
	active = "confronto";
	activeSubtab = sub;
	const found =
		CONFRONTO_SUBTABS.find((t) => t.id === sub) ?? CONFRONTO_SUBTABS[0];
	syncUrl(found.href);
}

function onTabClick(event: MouseEvent, id: SectionId) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	if (event.button !== 0) return;
	event.preventDefault();
	activate(id);
}

function onSubtabClick(event: MouseEvent, sub: ConfrontoSubtab) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	if (event.button !== 0) return;
	event.preventDefault();
	activateSubtab(sub);
}

/** setas movem e ativam (automatic activation), Home/End vão às pontas. */
function onTabKeydown(event: KeyboardEvent, id: SectionId) {
	const index = DASHBOARD_SECTIONS.findIndex((s) => s.id === id);
	let target: SectionId | null = null;
	if (event.key === "ArrowRight") target = moveSection(id, 1);
	else if (event.key === "ArrowLeft") target = moveSection(id, -1);
	else if (event.key === "Home") target = DASHBOARD_SECTIONS[0].id;
	else if (event.key === "End") target = DASHBOARD_SECTIONS.at(-1)?.id ?? id;
	else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		return;
	} else return;
	event.preventDefault();
	activate(target ?? DASHBOARD_SECTIONS[index < 0 ? 0 : index].id);
	const el = document.getElementById(`tab-${target}`);
	if (el) el.focus();
}

function onSubtabKeydown(event: KeyboardEvent, sub: ConfrontoSubtab) {
	let target: ConfrontoSubtab | null = null;
	if (event.key === "ArrowRight") target = moveConfrontoSubtab(sub, 1);
	else if (event.key === "ArrowLeft") target = moveConfrontoSubtab(sub, -1);
	else if (event.key === "Home") target = CONFRONTO_SUBTABS[0].id;
	else if (event.key === "End") target = CONFRONTO_SUBTABS.at(-1)?.id ?? sub;
	else return;
	event.preventDefault();
	activateSubtab(target);
	const el = document.getElementById(`subtab-${target}`);
	if (el) el.focus();
}

let tabStrip = $state<HTMLElement | null>(null);
let hint = $state<EdgeHint>("none");

$effect(() => {
	const el = tabStrip;
	if (!el) return;
	const measure = () => {
		hint = computeEdgeHint(el.scrollWidth, el.clientWidth, el.scrollLeft);
	};
	measure();
	const ro = new ResizeObserver(measure);
	ro.observe(el);
	el.addEventListener("scroll", measure, { passive: true });
	return () => {
		ro.disconnect();
		el.removeEventListener("scroll", measure);
	};
});
</script>

<div
	class="sticky top-16 z-40 pt-2 pb-2 bg-slate-50/95 backdrop-blur-md border-b border-slate-200/80"
>
  <div class="relative">
    <div
      class="flex gap-1 overflow-x-auto bg-white border border-slate-200 rounded-full shadow-sm p-1"
      role="tablist"
      aria-label="Seções do painel"
      bind:this={tabStrip}
    >
      {#each DASHBOARD_SECTIONS as item (item.id)}
        {@const on = item.id === active}
        <a
          id={`tab-${item.id}`}
          role="tab"
          href={item.id === "confronto" ? currentSubtabItem.href : item.href}
          aria-selected={on}
          aria-controls="painel-secao"
          tabindex={on ? 0 : -1}
          onclick={(e) => onTabClick(e, item.id)}
          onkeydown={(e) => onTabKeydown(e, item.id)}
          class="flex-1 sm:flex-initial flex items-center justify-center whitespace-nowrap min-h-[44px] px-3 sm:px-4 rounded-full text-xs sm:text-sm transition-colors {on
            ? 'bg-sky-700 text-white font-semibold shadow-sm'
            : 'text-slate-600 font-medium hover:text-sky-800 hover:bg-slate-100'}"
        >
          {item.label}
        </a>
      {/each}
    </div>
    {#if hint === "start" || hint === "both"}
      <div aria-hidden="true" class="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white to-transparent z-10"></div>
    {/if}
    {#if hint === "end" || hint === "both"}
      <div aria-hidden="true" class="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent z-10"></div>
    {/if}
  </div>
  <p class="mt-1.5 px-1 text-[11px] leading-snug text-slate-500">{section.hint}</p>
</div>

<div
  id="painel-secao"
  role="tabpanel"
  aria-labelledby={`tab-${active}`}
>
  {#if active === "agora"}
    <Dashboard
      stationsMeta={stationsMeta}
      initialStationId={initialStationId}
      initialBundle={initialBundle}
    />
  {:else if active === "mapa"}
    <MapSection stations={initialMapStations} />
  {:else if active === "precisao"}
    <AccuracyDashboard initialData={evalData as any} />
  {:else}
    <!-- Seção Confronto: sub-abas internas (Previsão 120h à frente | Holdout 168h de validação) -->
    <div class="mt-4 mb-5">
      <div class="glass-card p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div
          class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-full md:w-auto"
          role="tablist"
          aria-label="Janela de confronto Modelo vs Open-Meteo"
        >
          {#each CONFRONTO_SUBTABS as sub (sub.id)}
            {@const subOn = sub.id === activeSubtab}
            <a
              id={`subtab-${sub.id}`}
              role="tab"
              href={sub.href}
              aria-selected={subOn}
              aria-controls="painel-confronto-janela"
              tabindex={subOn ? 0 : -1}
              onclick={(e) => onSubtabClick(e, sub.id)}
              onkeydown={(e) => onSubtabKeydown(e, sub.id)}
              class="flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg text-xs sm:text-sm transition-all {subOn
                ? 'bg-sky-700 text-white font-bold shadow-sm'
                : 'text-slate-700 font-semibold hover:text-sky-800 hover:bg-white'}"
            >
              <span class="{sub.id === 'previsao' ? 'i-ph-calendar-dots-fill' : 'i-ph-scales-fill'} w-4 h-4 shrink-0"></span>
              <span>{sub.label}</span>
            </a>
          {/each}
        </div>
        <div class="flex items-center gap-2 text-xs px-1 {activeSubtab === 'previsao' ? 'text-amber-900' : 'text-emerald-900'}">
          <span class="{activeSubtab === 'previsao' ? 'i-ph-warning-octagon-fill text-amber-600' : 'i-ph-shield-check-fill text-emerald-600'} w-4 h-4 shrink-0"></span>
          <span class="leading-snug font-medium">{currentSubtabItem.natureNotice}</span>
        </div>
      </div>
    </div>

    <div
      id="painel-confronto-janela"
      role="tabpanel"
      aria-labelledby={`subtab-${activeSubtab}`}
    >
      {#if activeSubtab === "previsao"}
        <ForecastComparePanel onSwitchToHoldout={() => activateSubtab("holdout")} />
      {:else}
        <ComparisonPanel onSwitchToPrevisao={() => activateSubtab("previsao")} />
      {/if}
    </div>
  {/if}
</div>