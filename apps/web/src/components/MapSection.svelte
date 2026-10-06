<!-- apps/web/src/components/MapSection.svelte — seção "Mapa" do painel único.
     É a antiga `/mapa` (mapa grande + lista das 9 estações), movida para dentro do
     shell com as outras quatro e sem perder nada: mesmas funções de
     `currentPoint`/`globalIQAr`, mesmos links para `/estacao/[id]`, mesma
     Proveniência — que aqui é a lista completa, não um resumo.

     A estação selecionada é estado LOCAL desta seção. Ela não reescreve a
     estação ativa de "Agora": são duas perguntas diferentes (onde está pior vs.
     como está a minha estação) e acoplar as duas custaria um estado compartilhado
     que ninguém pediu. O pin e o cartão da lista se destacam entre si; o link
     leva à página da estação. -->
<script lang="ts">
import {
	CONCENTRATION_UNIT,
	POLLUTANT_LABEL,
	type PollutantKey,
	badgeClass,
	iqarAdvice,
	iqarIcon,
} from "../lib/comparison";
import { formatConcentration } from "../lib/dashboard-sections";
import RmgvMap from "./Map.svelte";

interface MapStation {
	id: string;
	name: string;
	municipality: string;
	latitude?: number;
	longitude?: number;
	lat?: number;
	lon?: number;
	iqar?: number;
	classification?: string;
	primary?: string;
	concentration?: number | null;
}

const { stations = [] }: { stations?: MapStation[] } = $props();

let selectedId = $state<string>("");

function select(id: string) {
	selectedId = id;
}

function pollutantLabel(primary?: string): string {
	if (!primary) return "—";
	return POLLUTANT_LABEL[primary as PollutantKey] ?? primary.toUpperCase();
}
</script>

<div class="anim-fade-up">
  <div class="glass-card px-5 py-4 relative overflow-hidden">
    <div class="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-sky-500 to-transparent"></div>
    <h1 class="text-2xl font-extrabold text-slate-900 flex items-center gap-2 tracking-tight">
      <span class="section-dot !w-3 !h-3"></span>
      Rede de Monitoramento da Qualidade do Ar (RAMQAr)
    </h1>
    <p class="text-slate-500 text-sm mt-1">
      Distribuição geográfica das {stations.length} estações na Grande Vitória. O pin traz o
      IQAr (faixa) e, embaixo dele, a concentração real em {CONCENTRATION_UNIT} do poluente
      dominante — é ela que mostra a diferença entre estações quando o índice arredonda.
    </p>
  </div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 anim-fade-up-d1 mt-6">
  <div class="lg:col-span-2">
    <RmgvMap stations={stations} selectedStationId={selectedId} onSelectStation={select} />
  </div>

  <div class="glass-card p-4 space-y-3 max-h-[340px] lg:max-h-[460px] overflow-y-auto">
    <h3 class="text-xs uppercase font-bold text-slate-400 tracking-wider">Estações de Monitoramento</h3>
    {#each stations as s (s.id)}
      {@const active = selectedId === s.id}
      <div
        class="bg-white p-3 rounded-xl border transition-all {active
          ? 'border-sky-400 shadow-[0_6px_18px_-8px_rgba(14,165,233,0.45)]'
          : 'border-slate-200 hover:border-sky-300'}"
      >
        <div class="flex justify-between items-start gap-2">
          <button
            type="button"
            onclick={() => select(s.id)}
            class="text-left min-h-[44px] cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-500"
            aria-pressed={active}
            aria-label={`Selecionar ${s.name} no mapa`}
          >
            <h4 class="text-sm font-bold text-slate-800">{s.name}</h4>
            <p class="text-xs text-slate-500">{s.municipality}</p>
          </button>
          <span class={`chip !text-[11px] font-mono font-bold ${badgeClass(s.classification)} shrink-0`}>
            <span class={`${iqarIcon(s.classification)} w-3.5 h-3.5`}></span>
            <span>{s.iqar}</span>
          </span>
        </div>

        <!-- Faixa por palavra + glifo (nunca só pela cor do badge) e a
             concentração como leitura neutra ao lado do número do índice. -->
        <div class="mt-1.5 text-[11px] text-slate-600 leading-snug">
          <span class="font-semibold text-slate-700">{s.classification ?? "—"}</span>
          <span class="text-slate-300 mx-1">&middot;</span>
          <span>{pollutantLabel(s.primary)}</span>
          <span class="text-slate-300 mx-1">&middot;</span>
          <span class="font-mono font-semibold text-slate-700">{formatConcentration(s.concentration)}</span>
          <span class="text-slate-500"> {CONCENTRATION_UNIT}</span>
        </div>

        <div class="mt-2 text-[11px] text-slate-500 flex items-center justify-between gap-2">
          <span class="font-mono">{s.latitude}, {s.longitude}</span>
          <a href={`/estacao/${s.id}`} class="text-sky-700 hover:underline font-semibold min-h-[44px] inline-flex items-center">
            Ver Previsão 5 Dias →
          </a>
        </div>

        {#if active && s.classification}
          <p class="mt-2 text-[11px] leading-snug text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
            {iqarAdvice(s.classification)}
          </p>
        {/if}
      </div>
    {/each}
  </div>
</div>