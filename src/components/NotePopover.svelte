<script lang="ts">
  import { onMount } from 'svelte';
  import { Trash2, X } from 'lucide';
  import Icon from './Icon.svelte';
  import { createNote, deleteNote, updateNote } from '../lib/docs.svelte';
  import { editor } from '../lib/editor/controller';
  import { doc, formatDate, notesStore, settings, ui } from '../lib/state.svelte';
  import { keys, t } from '../lib/i18n';

  const p = ui.popover!;
  const existing = p.noteId ? notesStore.list.find((n) => n.id === p.noteId) : null;
  let text = $state(existing?.text ?? '');
  let area: HTMLTextAreaElement;

  const number = $derived.by(() => {
    if (!existing || existing.orphan) return null;
    const ranges = editor.noteRanges().filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
    const i = ranges.findIndex((r) => r.id === existing.id);
    return i >= 0 ? i + 1 : null;
  });

  const quote = existing?.quote ?? p.draft?.quote ?? '';

  onMount(() => {
    area.focus();
    area.setSelectionRange(text.length, text.length);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  function onInput() {
    if (!existing) return;
    clearTimeout(timer);
    timer = setTimeout(() => updateNote(existing.id, text), 400);
  }

  function close(commit = true) {
    clearTimeout(timer);
    if (existing && commit) updateNote(existing.id, text);
    ui.popover = null;
    editor.focus();
  }

  function add() {
    if (p.draft) createNote(p.draft, text);
    ui.popover = null;
    editor.focus();
  }

  function remove() {
    if (!existing) return;
    clearTimeout(timer);
    ui.popover = null;
    deleteNote(existing.id);
    editor.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (existing) close(true);
      else add();
    }
  }

  function excerpt(s: string) {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > 180 ? t.slice(0, 179) + '…' : t;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="backdrop" onclick={() => (existing ? close(true) : close(false))}></div>
<div class="pop" class:above={!p.below} style="left:{p.x}px;top:{p.y}px" role="dialog" aria-label={t('Nota')} tabindex="-1" onkeydown={onKey}>
  <header>
    <span class="num">{number ?? (existing ? '–' : '+')}</span>
    <blockquote>{excerpt(quote)}</blockquote>
    <button class="icon-btn" onclick={() => close(!!existing)} aria-label={t('Chiudi')}><Icon icon={X} size={15} /></button>
  </header>
  {#if existing?.orphan}
    <p class="orphan">{t('Il testo annotato non è più nel documento: la nota è conservata ma non è collegata a nessun punto.')}</p>
  {/if}
  <textarea bind:this={area} bind:value={text} oninput={onInput} placeholder={t('Scrivi la nota…')} rows="4" spellcheck="true" lang={settings.docLanguage}></textarea>
  <footer>
    {#if existing}
      <span class="date">{existing.updated !== existing.created ? t('Modificata {date}', { date: formatDate(existing.updated) }) : t('Creata {date}', { date: formatDate(existing.updated) })}</span>
      <button class="btn danger slim" onclick={remove}><Icon icon={Trash2} size={14} />{t('Elimina')}</button>
      <button class="btn primary slim" onclick={() => close(true)}>{t('Fatto')}</button>
    {:else}
      <span class="date">{doc.mode === 'read' ? t('Collegata al testo estratto') : t('{keys} per aggiungere', { keys: keys('Ctrl+') + t('Invio') })}</span>
      <button class="btn slim" onclick={() => close(false)}>{t('Annulla')}</button>
      <button class="btn primary slim" onclick={add}>{t('Aggiungi nota')}</button>
    {/if}
  </footer>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .pop {
    position: fixed;
    z-index: 41;
    width: 360px;
    padding: 12px 12px 10px 14px;
    background: var(--raised);
    border: 1px solid var(--rule);
    border-top: 3px solid var(--rubric);
    border-radius: 3px 3px var(--radius-l) var(--radius-l);
    box-shadow: var(--shadow);
    animation: drop 150ms var(--ease);
  }
  .pop.above {
    animation-name: lift;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @keyframes lift {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .num {
    flex: none;
    min-width: 22px;
    font-family: var(--font);
    font-size: 22px;
    font-weight: 600;
    line-height: 1;
    color: var(--rubric);
    padding-top: 2px;
  }
  blockquote {
    flex: 1;
    margin: 2px 0 0;
    font-family: var(--font);
    font-size: 13.5px;
    font-style: italic;
    line-height: 1.4;
    color: var(--ink-2);
    max-height: 4.2em;
    overflow: hidden;
  }
  header .icon-btn {
    margin: -4px -4px 0 0;
  }
  .orphan {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--warn);
    line-height: 1.4;
  }
  textarea {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 9px 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-s);
    background: var(--page);
    font-family: var(--font);
    font-size: 14.5px;
    line-height: 1.5;
    resize: vertical;
    min-height: 92px;
    max-height: 340px;
    outline: none;
  }
  textarea:focus {
    border-color: var(--rubric-line);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .date {
    flex: 1;
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .slim {
    height: 28px;
    padding: 0 11px;
  }
</style>
