<script lang="ts">
  import { ArrowLeft, Columns2, Ellipsis, Focus, LayoutGrid, MessageSquareText, Minimize2, Minus, Square, Copy, X } from 'lucide';
  import Icon from './Icon.svelte';
  import Toolbar from './Toolbar.svelte';
  import AppMenu from './AppMenu.svelte';
  import { actions, windowApi } from '../lib/actions';
  import { inTauri } from '../lib/backend';
  import { IS_MAC } from '../lib/platform';
  import { displayName } from '../lib/docs.svelte';
  import { doc, notesStore, settings, ui } from '../lib/state.svelte';
  import { onMount } from 'svelte';
  import { keys, t } from '../lib/i18n';

  let maximized = $state(false);
  const noteCount = $derived(notesStore.list.length);
  const title = $derived(doc.draftId && !doc.derived ? doc.title || t('Senza titolo') : displayName(doc.name));
  const fullKeys = IS_MAC ? '⌃⌘F' : 'F11';

  onMount(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const w = await windowApi();
      if (!w) return;
      maximized = await w.isMaximized();
      unlisten = await w.onResized(async () => {
        maximized = await w.isMaximized();
        ui.fullscreen = await w.isFullscreen();
      });
    })();
    return () => unlisten?.();
  });

  async function win(action: 'min' | 'max' | 'close') {
    const w = await windowApi();
    if (!w) return;
    if (action === 'min') await w.minimize();
    else if (action === 'max') await w.toggleMaximize();
    else await w.close();
  }
</script>

<header class="titlebar" data-tauri-drag-region>
  <div class="left" data-tauri-drag-region>
    <button
      class="icon-btn"
      aria-pressed={ui.home}
      title={ui.home ? t('Torna al documento (Esc)') : `${t('Biblioteca: documenti, bozze e note')} (${keys('Ctrl+Shift+L')})`}
      aria-label={t('Biblioteca')}
      onclick={actions.toggleLibrary}
    >
      <Icon icon={LayoutGrid} />
    </button>
    {#if ui.home}
      <div class="doc-title" data-tauri-drag-region>
        <span class="name" data-tauri-drag-region>{t('Biblioteca')}</span>
      </div>
    {:else}
      <div class="doc-title" data-tauri-drag-region title={doc.path ?? t('Bozza conservata da Wrambi')}>
        <span class="name" data-tauri-drag-region>{title}</span>
        {#if doc.mode === 'edit' && doc.dirty}
          <span class="dirty" aria-label={t('Modifiche non ancora salvate')} title={t('Modifiche non ancora salvate')}></span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="center" data-tauri-drag-region>
    {#if !ui.home}
      <Toolbar />
    {/if}
  </div>

  <div class="right" data-tauri-drag-region>
    {#if ui.home}
      <button class="back" onclick={actions.toggleLibrary} title={t('Torna al documento (Esc)')}>
        <Icon icon={ArrowLeft} size={15} /><span>{title}</span>
      </button>
    {:else}
    <button class="icon-btn" data-tour="preview" aria-pressed={ui.preview} title={`${t('Anteprima e conversione')} (${keys('Ctrl+Shift+P')})`} aria-label={t('Anteprima')} onclick={actions.togglePreview}>
      <Icon icon={Columns2} />
    </button>
    <button class="icon-btn notes-btn" data-tour="notes" aria-pressed={ui.notes} title={`${t('Tutte le note')} (${keys('Ctrl+Shift+N')})`} aria-label={t('Note')} onclick={actions.toggleNotes}>
      <Icon icon={MessageSquareText} />
      {#if noteCount}<span class="count">{noteCount}</span>{/if}
    </button>
    <button class="icon-btn" aria-pressed={ui.focus} title={`${t('Focus')} (${keys('Ctrl+Shift+F')})`} aria-label={t('Focus')} onclick={() => actions.toggleFocus()}>
      <Icon icon={Focus} />
    </button>
    {/if}
    <div class="menu-anchor">
      <button class="icon-btn" data-tour="menu" aria-pressed={ui.menu} aria-haspopup="menu" title={t('Menu')} aria-label={t('Menu')} onclick={() => (ui.menu = !ui.menu)}>
        <Icon icon={Ellipsis} />
      </button>
      {#if ui.menu}
        <AppMenu />
      {/if}
    </div>
    {#if ui.fullscreen}
      <button class="exit-full" onclick={actions.toggleFullscreen} title={t('Esci dallo schermo intero ({keys} o Esc)', { keys: fullKeys })}>
        <Icon icon={Minimize2} size={14} /><span>{t('Esci dallo schermo intero')}</span>
      </button>
    {:else if inTauri && !IS_MAC && settings.titleBar === 'wrambi'}
      <div class="winctl">
        <button class="wc" aria-label={t('Riduci a icona')} onclick={() => win('min')}><Icon icon={Minus} size={15} stroke={1.5} /></button>
        <button class="wc" aria-label={maximized ? t('Ripristina') : t('Ingrandisci')} onclick={() => win('max')}>
          <Icon icon={maximized ? Copy : Square} size={maximized ? 13 : 12} stroke={1.5} />
        </button>
        <button class="wc close" aria-label={t('Chiudi')} onclick={() => win('close')}><Icon icon={X} size={16} stroke={1.5} /></button>
      </div>
    {/if}
  </div>
</header>

<style>
  .titlebar {
    grid-row: 1;
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
    align-items: center;
    height: var(--bar-h);
    padding-left: 8px;
    background: var(--page);
    border-bottom: 1px solid var(--rule);
    position: relative;
    z-index: 10;
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 100%;
  }
  .right {
    justify-content: flex-end;
  }
  .center {
    display: flex;
    justify-content: center;
    min-width: 0;
  }
  .doc-title {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 0 8px;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dirty {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-3);
  }
  .notes-btn {
    position: relative;
  }
  .exit-full {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    margin: 0 8px 0 4px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-s);
    background: var(--raised);
    color: var(--ink-2);
    font-size: 12px;
  }
  .exit-full:hover {
    color: var(--ink);
    background: var(--chrome);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 280px;
    height: 30px;
    padding: 0 12px 0 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-s);
    background: var(--raised);
    color: var(--ink);
    font-weight: 500;
  }
  .back:hover {
    background: var(--chrome);
  }
  .back span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    position: absolute;
    top: 2px;
    right: 0;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--rubric);
    color: var(--page);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  .menu-anchor {
    position: relative;
    margin-right: 4px;
  }
  .winctl {
    display: flex;
    height: 100%;
    margin-left: 4px;
  }
  .wc {
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--ink-2);
  }
  .wc:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  .wc.close:hover {
    background: #c42b1c;
    color: #fff;
  }
  @media (max-width: 860px) {
    .titlebar {
      grid-template-columns: auto 1fr auto;
    }
    .doc-title {
      display: none;
    }
  }
</style>
