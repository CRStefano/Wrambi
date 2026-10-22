<script lang="ts">
  import { onMount } from 'svelte';
  import { PenLine, MessageSquareText, Trash2, FileOutput, NotebookPen, Highlighter } from 'lucide';
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state.svelte';

  const ICONS = { open: MessageSquareText, edit: PenLine, delete: Trash2, export: FileOutput, note: NotebookPen, highlight: Highlighter };

  let menu: HTMLDivElement;
  let left = $state(ui.contextMenu?.x ?? 0);
  let top = $state(ui.contextMenu?.y ?? 0);

  onMount(() => {
    const r = menu.getBoundingClientRect();
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  });

  function close() {
    ui.contextMenu = null;
  }

  function run(fn: () => unknown) {
    close();
    void fn();
  }

  function onkey(e: KeyboardEvent) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
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
<div
  class="dismiss"
  onclick={close}
  oncontextmenu={(e) => {
    e.preventDefault();
    close();
  }}
></div>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="menu" role="menu" tabindex="-1" bind:this={menu} style="left:{left}px; top:{top}px" onkeydown={onkey} data-own-escape>
  {#each ui.contextMenu?.items ?? [] as item, i (i)}
    {#if item.separatorBefore}<div class="sep" role="separator"></div>{/if}
    <button role="menuitem" class:danger={item.danger} onclick={() => run(item.run)}>
      {#if item.icon}<Icon icon={ICONS[item.icon]} size={15} />{/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .dismiss {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
  .menu {
    position: fixed;
    z-index: 61;
    min-width: 200px;
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
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--rule);
  }
</style>
