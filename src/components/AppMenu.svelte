<script lang="ts">
  import { Compass, CopyPlus, FileOutput, FilePlus, FolderOpen, Keyboard, KeyRound, Save, Search, Settings, SquarePen } from 'lucide';
  import { startTour } from '../lib/tour';
  import Icon from './Icon.svelte';
  import { actions } from '../lib/actions';
  import { doc, ui } from '../lib/state.svelte';
  import { keys as k, t, tk } from '../lib/i18n';

  type Item = { label: string; keys?: string; icon: typeof FilePlus; run: () => void; disabled?: boolean } | 'sep';

  const items: Item[] = $derived([
    { label: tk('Nuovo documento'), keys: 'Ctrl+N', icon: FilePlus, run: actions.newDocument },
    { label: tk('Apri…'), keys: 'Ctrl+O', icon: FolderOpen, run: actions.openDocument },
    doc.mode === 'read'
      ? { label: tk('Modifica il testo'), icon: SquarePen, run: actions.edit, disabled: !doc.readKind }
      : { label: doc.derived && !doc.derived.targetFormat ? tk('Salva le modifiche…') : doc.draftId && !doc.derived ? tk('Salva come file…') : tk('Salva'), keys: 'Ctrl+S', icon: Save, run: () => void actions.save() },
    { label: tk('Salva una copia…'), keys: 'Ctrl+Shift+S', icon: CopyPlus, run: actions.saveAs, disabled: doc.mode !== 'edit' },
    'sep',
    { label: tk('Esporta…'), keys: 'Ctrl+Shift+E', icon: FileOutput, run: actions.openExport },
    { label: tk('Cerca nel documento'), keys: 'Ctrl+F', icon: Search, run: actions.find },
    { label: tk('Vault cifrato…'), icon: KeyRound, run: actions.openVault },
    'sep',
    { label: tk('Impostazioni'), keys: 'Ctrl+,', icon: Settings, run: actions.openSettings },
    { label: tk('Scorciatoie da tastiera'), keys: 'Ctrl+/', icon: Keyboard, run: actions.openShortcuts },
    { label: tk('Tour di Wrambi'), icon: Compass, run: startTour },
  ]);

  function pick(fn: () => void) {
    ui.menu = false;
    fn();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="dismiss" onclick={() => (ui.menu = false)}></div>
<div class="menu" role="menu">
  {#each items as item, i (i)}
    {#if item === 'sep'}
      <div class="sep" role="separator"></div>
    {:else}
      <button role="menuitem" disabled={item.disabled} onclick={() => pick(item.run)}>
        <Icon icon={item.icon} size={16} />
        <span class="label">{t(item.label)}</span>
        {#if item.keys}<span class="keys">{k(item.keys)}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .dismiss {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 36px;
    z-index: 31;
    width: 270px;
    padding: 5px;
    background: var(--raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow);
    animation: rise 140ms var(--ease);
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink);
    text-align: left;
  }
  button:hover {
    background: var(--chrome);
  }
  button:disabled {
    opacity: 0.4;
  }
  button :global(svg) {
    color: var(--ink-2);
  }
  .label {
    flex: 1;
  }
  .keys {
    color: var(--ink-3);
    font-size: 11.5px;
  }
  .sep {
    height: 1px;
    margin: 5px 6px;
    background: var(--rule);
  }
</style>
