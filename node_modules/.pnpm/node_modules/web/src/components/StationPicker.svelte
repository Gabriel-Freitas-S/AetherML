<!-- apps/web/src/components/StationPicker.svelte — Dropdown custom de estações (substitui o <select> nativo) -->
<script lang="ts">
import Icon from "./Icon.svelte";

interface StationMeta {
	id: string;
	name: string;
	municipality: string;
}

const {
	stations = [],
	activeId = "",
	onChange,
	label = "Estação de monitoramento",
}: {
	stations: StationMeta[];
	activeId?: string;
	onChange?: (id: string) => void;
	label?: string;
} = $props();

let open = $state(false);
let root = $state<HTMLElement | null>(null);

const active = $derived.by(() => stations.find((s) => s.id === activeId) ?? null);

function close() {
	open = false;
}
function pick(id: string) {
	close();
	if (id !== activeId) onChange?.(id);
}
function onKey(e: KeyboardEvent) {
	if (e.key === "Escape") close();
}
function onDocClick(e: MouseEvent) {
	if (root && !root.contains(e.target as Node)) close();
}

$effect(() => {
	if (open) {
		document.addEventListener("click", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("click", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}
});
</script>

<div bind:this={root} class="relative flex-1 sm:min-w-[260px]">
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    class="w-full flex items-center gap-2 text-left bg-white border border-slate-300 rounded-xl pl-3 pr-2.5 py-2 text-sm font-medium text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all cursor-pointer hover:border-sky-400"
  >
    <Icon name="pin" cls="w-4 h-4 text-sky-600 shrink-0" />
    <span class="flex-1 min-w-0">
      <span class="block truncate">{active?.name ?? "Selecione a estação"}</span>
      {#if active?.municipality}
        <span class="block text-[11px] font-normal text-slate-500 truncate">{active.municipality} · RAMQAr</span>
      {/if}
    </span>
    <Icon name="chevron" cls={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
  </button>

  {#if open}
    <!-- Fecha por clique fora via listener de documento; sem backdrop fixo
         (ancestral com backdrop-blur conteria o fixed e quebraria a cobertura) -->
    <ul
      role="listbox"
      aria-label={label}
      class="absolute z-[501] left-0 right-0 sm:right-auto sm:w-[320px] mt-2 max-h-[320px] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 p-1.5"
    >
      {#each stations as s}
        {@const selected = s.id === activeId}
        <li role="option" aria-selected={selected}>
          <button
            type="button"
            onclick={() => pick(s.id)}
            class={`w-full flex items-center gap-2.5 min-h-[44px] px-3 py-2 rounded-xl text-left transition-colors ${selected ? "bg-sky-50" : "hover:bg-slate-100"}`}
          >
            <span class={`w-2 h-2 rounded-full shrink-0 ${selected ? "bg-sky-600" : "bg-slate-300"}`}></span>
            <span class="flex-1 min-w-0">
              <span class={`block text-sm truncate ${selected ? "font-bold text-sky-900" : "font-medium text-slate-700"}`}>{s.name}</span>
              {#if s.municipality}
                <span class="block text-[11px] text-slate-500 truncate">{s.municipality}</span>
              {/if}
            </span>
            {#if selected}
              <Icon name="check" cls="w-4 h-4 text-sky-600 shrink-0" />
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
