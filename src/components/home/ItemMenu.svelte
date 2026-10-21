<script lang="ts">
  import { Check, FileOutput, FolderSearch, PenLine, SquarePen, BookOpen, Trash2 } from 'lucide';
  import Icon from '../Icon.svelte';
  import { revealInFolder } from '../../lib/backend';
  import { deleteDraft, openItem, type HomeItem } from '../../lib/home.svelte';
  import { READ_LABELS, readState, setReadState, type ReadState } from '../../lib/state.svelte';
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';

  let { item, x, y, onclose, onrename }: { item: HomeItem; x: number; y: number; onclose: () => void; onrename: (item: HomeItem) => void } = $props();

  let menu: HTMLDivElement;
  const readable = $derived(['pdf', 'epub', 'html', 'htm'].includes(item.ext) && item.kind === 'file');
  const st = $derived(readState(item.key));
  const STATES: ReadState[] = ['unread', 'reading', 'read'];

  let left = $state(0);
  let top = $state(0);
  onMount(() => {
    const r = menu.getBoundingClientRect();
    left = Math.min(x, window.innerWidth - r.width - 8);
    top = Math.min(y, window.innerHeight - r.height - 8);
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  });

  function run(fn: () => unknown) {
    // Prima l'azione: chiudere il menu toglie di mezzo anche il documento a cui si riferisce.
    void fn();
    onclose();
  }

  function onkey(e: KeyboardEvent) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="dismiss" onclick={onclose} oncontextmenu={(e) => { e.preventDefault(); onclose(); }}></div>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="menu" role="menu" tabindex="-1" bind:this={menu} style="left:{left || x}px; top:{top || y}px" onkeydown={onkey} data-own-escape>
  <button role="menuitem" onclick={() => run(() => openItem(item))}>
    <Icon icon={readable ? BookOpen : PenLine} size={15} /><span>{readable ? t('Apri per leggere') : t('Apri')}</span>
  </button>
  {#if item.ext === 'pdf' && item.kind === 'file'}
    <button role="menuitem" onclick={() => run(() => openItem(item, 'pdfedit'))}>
      <Icon icon={SquarePen} size={15} /><span>{t('Modifica il PDF')}</span>
    </button>
  {/if}
  {#if readable}
    <button role="menuitem" onclick={() => run(() => openItem(item, 'edit'))}>
      <Icon icon={SquarePen} size={15} /><span>{t('Modifica il testo')}</span>
    </button>
  {/if}
  <button role="menuitem" onclick={() => run(() => openItem(item, 'export'))}>
    <Icon icon={FileOutput} size={15} /><span>{t('Esporta…')}</span>
  </button>
  {#if item.kind === 'file'}
    <div class="sep" role="separator"></div>
    {#each STATES as s (s)}
      <button role="menuitemradio" aria-checked={st === s} onclick={() => run(() => setReadState(item.key, s))}>
        <span class="tick">{#if st === s}<Icon icon={Check} size={14} />{/if}</span>
        <span class="state-mark {s}"></span><span>{t(READ_LABELS[s])}</span>
      </button>
    {/each}
    <div class="sep" role="separator"></div>
    <button role="menuitem" onclick={() => run(() => onrename(item))}>
      <Icon icon={PenLine} size={15} /><span>{t('Rinomina')}</span><span class="keys">F2</span>
    </button>
    <button role="menuitem" onclick={() => run(() => revealInFolder(item.path!))}>
      <Icon icon={FolderSearch} size={15} /><span>{t('Mostra nella cartella')}</span>
    </button>
  {:else if item.draftId}
    <div class="sep" role="separator"></div>
    <button role="menuitem" class="danger" onclick={() => run(() => deleteDraft(item.draftId!))}>
      <Icon icon={Trash2} size={15} /><span>{item.editOf ? t('Scarta le modifiche') : t('Elimina la bozza')}</span>
    </button>
  {/if}
</div>

<style>
  .dismiss {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .menu {
    position: fixed;
    z-index: 41;
    min-width: 220px;
    padding: 5px;
    background: var(--raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow);
    animation: rise 120ms var(--ease);
    outline: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink);
    text-align: left;
  }
  button:hover,
  button:focus-visible {
    background: var(--chrome);
    outline: none;
  }
  button :global(svg) {
    color: var(--ink-2);
  }
  .danger,
  .danger :global(svg) {
    color: var(--rubric);
  }
  .keys {
    margin-left: auto;
    color: var(--ink-3);
    font-size: 11px;
  }
  .tick {
    display: inline-grid;
    place-items: center;
    width: 15px;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--rule);
  }
  .state-mark {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--unread);
    margin-left: -4px;
  }
  .state-mark.reading {
    border-color: var(--reading);
    background: linear-gradient(90deg, var(--reading) 50%, transparent 50%);
  }
  .state-mark.read {
    border-color: var(--read);
    background: var(--read);
  }
</style>
