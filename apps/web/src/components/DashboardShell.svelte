<!-- apps/web/src/components/DashboardShell.svelte — o painel único.
     Cinco seções (Agora · Mapa · Precisão · Previsão · Holdout) numa rota, com a
     navegação do produto em dois itens (Dashboard · Docs).

     TRÊS decisões que sustentam o resto do arquivo:

     1. `initialSection` vem da ROTA, não da URL em tempo de build. `/mapa`,
        `/precisao`, `/comparacao-previsao` e `/comparacao` continuam existindo,
        continuam devolvendo 200 e continuam renderizando o MESMO painel — só com
        outra seção selecionada. Nenhuma rota foi apagada e nenhuma passou a
        renderizar uma view divergente.

     2. O `href` de cada aba É a rota canônica. Sem JavaScript, clicar numa aba
        navega e a seção chega certa. Com JavaScript, o clique é interceptado, a
        seção troca sem recarregar e `history.replaceState` grava a rota real na
        barra de endereços — então copiar a URL continua sendo um link que abre
        na seção certa. Um mecanismo serve os dois casos.

     3. ATIVAÇÃO PREGUIÇOSA DOS DADOS. Só a seção ativa é montada (`{#if}`), e
        todo painel pesado busca o seu artefato só em `onMount`. Abrir `/` custa
        um artefato (`stations-data.json`), não quatro. Os três artefatos de
        comparação (117 KB + 83 KB + 80 KB) continuam no precache do service
        worker, então a seção segue disponível offline quando é a pedida.

     O custo que sobra é o do bundle JS: os cinco painéis dividem um chunk. É
     custo estático, versionado e coberto por CacheFirst, ao contrário de 280 KB
     de JSON que o resident não pediu para baixar na primeira visita. Em troca,
     voltar para "Agora" remonte o painel e refaz o fetch da série — o preço de
     uma página de verdade em vez de cinco páginas que se imitam. -->
<script lang="ts">
import {
	DASHBOARD_SECTIONS,
	type SectionId,
	moveSection,
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
	coastal?: boolean;
	downwind_tubarao?: boolean;
	bridge_proximity?: boolean;
}

/**
 * Estação com IQAr e concentração do poluente dominante, como `pages/index.astro`
 * e `pages/mapa.astro` montam no build. Declarada aqui porque o shell entrega a
 * lista intacta à seção "Mapa" — ele não recalcula IQAr em lugar nenhum, e não
 * pode começar a hacerlo.
 */
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
	evalData = null,
}: {
	stationsMeta?: StationMeta[];
	initialStationId?: string;
	initialBundle?: Record<string, unknown> | null;
	initialMapStations?: MapStation[];
	initialSection?: SectionId | string;
	evalData?: Record<string, unknown> | null;
} = $props();

let active = $state<SectionId>(resolveSection(initialSection));
const section = $derived(sectionById(active));

/**
 * Troca de seção sem recarregar e reescreve a barra de endereços.
 *
 * `replaceState` e não `pushState`: folhear seções não deve encher o botão
 * "voltar" de passos que a pessoa não pediu para desfazer.
 */
function activate(id: SectionId) {
	active = id;
	if (typeof window === "undefined") return;
	const next = new URL(sectionById(id).href, window.location.href);
	// Preserva a barra final que o servidor realmente serviu: gravar "/mapa" numa
	// página aberta em "/mapa/" faria o próximo F5 pagar um 308.
	if (window.location.pathname.endsWith("/") && !next.pathname.endsWith("/")) {
		next.pathname = `${next.pathname}/`;
	}
	window.history.replaceState(null, "", `${next.pathname}${next.search}`);
}

function onTabClick(event: MouseEvent, id: SectionId) {
	// Botão do meio, ctrl/⌘+clique e "abrir em nova aba" continuam sendo
	// navegação: nesses casos ir para a rota é o comportamento esperado.
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	if (event.button !== 0) return;
	event.preventDefault();
	activate(id);
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

let tabStrip = $state<HTMLElement | null>(null);
let hint = $state<EdgeHint>("none");

/**
 * Mede, e não adivinha, quanto da tira está escondido.
 *
 * A 360px as cinco abas somam 417px numa caixa de 312px: 105px ficam de fora e a
 * quinta seção, "Holdout", some inteira atrás da borda arredondada. O
 * `overflow-x-auto` não anuncia isso — em toque a barra de rolagem é sobreposta
 * e desaparece depois do primeiro gesto. O esmaecimento só acende quando existe
 * conteúdo escondido NAQUELA ponta, e apaga quando a janela cresce e a tira
 * passa a caber.
 */
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

<!-- Sem margem negativa de propósito. `main` é item flex e o island é filho
     direto dele: um `-mx-6` aqui descola do eixo da coluna e faz `main` recusar
     encolher (`min-width: auto` no flex item), empurrando a página 22px para
     fora da janela. Full-bleed se resolve no próprio elemento. -->
<div
	class="sticky top-16 z-40 pt-2 pb-2 bg-slate-50/95 backdrop-blur-md border-b border-slate-200/80"
>
  <!-- O `relative` é do invólucro, não da tira: as pontas esmaecidas precisam
       ficar POR CIMA da caixa arredondada, e ficariam roladas junto com as abas
       se fossem filhas do elemento que rola. `pointer-events-none` para o toque
       atravessar até a aba que está embaixo do esmaecimento. -->
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
          href={item.href}
          aria-selected={on}
          aria-controls="painel-secao"
          tabindex={on ? 0 : -1}
          onclick={(e) => onTabClick(e, item.id)}
          onkeydown={(e) => onTabKeydown(e, item.id)}
          class="flex items-center justify-center whitespace-nowrap min-h-[44px] px-4 rounded-full text-sm transition-colors {on
            ? 'bg-sky-700 text-white font-semibold shadow-sm'
            : 'text-slate-600 font-medium hover:text-sky-800 hover:bg-sky-50'}"
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
    <AccuracyDashboard initialData={evalData} />
  {:else if active === "previsao"}
    <ForecastComparePanel />
  {:else}
    <ComparisonPanel />
  {/if}
</div>