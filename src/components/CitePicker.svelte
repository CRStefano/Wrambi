<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from 'lucide';
  import Icon from './Icon.svelte';
  import { dialogs, basename } from '../lib/backend';
  import { biblio, bibIndex, refreshBibliography } from '../lib/biblio/store.svelte';
  import { describe, formatCitation, type CiteItem } from '../lib/biblio/format';
  import type { BibEntry } from '../lib/biblio/model';
  import { editor } from '../lib/editor/controller';
  import { t, tn } from '../lib/i18n';
  import { notify, save, settings, ui } from '../lib/state.svelte';

  let query = $state('');
  let locator = $state('');
  let prefix = $state('');
  let narrative = $state(false);
  let yearOnly = $state(false);
  let picked = $state<string[]>([]);
  let cursor = $state(0);
  let version = $state(0);
  let search: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  onMount(async () => {
    search?.focus();
    await refreshBibliography();
    version++;
  });

  const all = $derived.by(() => {
    void version;
    void biblio.count;
    const idx = bibIndex();
    return idx ? [...idx.byKey.values()] : [];
  });

  function norm(s: string) {
    return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  const results = $derived.by(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const scored: { e: BibEntry; d: ReturnType<typeof describe>; score: number }[] = [];
    for (const e of all) {
      const d = describe(e);
      const hay = norm(`${e.id} ${d.who} ${d.year} ${d.title} ${e.container ?? ''}`);
      if (!words.every((w) => hay.includes(w))) continue;
      // Prima chi corrisponde nella chiave o nell'autore.
      const score = words.reduce((s, w) => s + (norm(e.id).startsWith(w) ? 3 : norm(d.who).includes(w) ? 2 : 0), 0);
      scored.push({ e, d, score });
    }
    scored.sort((a, b) => b.score - a.score || a.d.who.localeCompare(b.d.who) || a.d.year.localeCompare(b.d.year));
    return scored.slice(0, 80);
  });

  $effect(() => {
    void query;
    cursor = 0;
  });

  function items(keys: string[]): CiteItem[] {
    return keys.map((key, i) => {
      const it: CiteItem = { key };
      if (i === 0 && prefix.trim() && !narrative) it.prefix = prefix.trim();
      if (i === keys.length - 1 && locator.trim()) it.locator = locator.trim();
      if (yearOnly && !narrative && keys.length === 1) it.suppressAuthor = true;
      return it;
    });
  }

  /** Il testo che si inserisce nell'editor: sintassi Pandoc. */
  function source(keys: string[]): string {
    if (!keys.length) return '';
    if (narrative) {
      const it = items([keys[0]])[0];
      return `@${it.key}` + (it.locator ? ` [${it.locator}]` : '');
    }
    const parts = items(keys).map((it) => `${it.prefix ? it.prefix + ' ' : ''}${it.suppressAuthor ? '-' : ''}@${it.key}${it.locator ? ', ' + it.locator : ''}`);
    return `[${parts.join('; ')}]`;
  }

  const target = $derived(picked.length ? picked : results[cursor] ? [results[cursor].e.id] : []);
  const preview = $derived.by(() => {
    const idx = bibIndex();
    if (!idx || !target.length) return '';
    const keys = narrative ? [target[0]] : target;
    idx.disambiguate(keys, settings.docLanguage);
    return formatCitation(items(keys), !narrative, idx, settings.docLanguage);
  });

  function toggle(key: string) {
    picked = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
  }

  function insert() {
    const text = source(narrative ? target.slice(0, 1) : target);
    if (!text) return;
    ui.cite = false;
    editor.insertCitation(text);
  }

  function cancel() {
    ui.cite = false;
    editor.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (!n) return;
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      list?.querySelectorAll('li')[cursor]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Ctrl+Invio o Invio con opere già scelte: inserisce; altrimenti sceglie quella evidenziata e inserisce.
      insert();
    } else if (e.key === ' ' && e.ctrlKey && results[cursor]) {
      e.preventDefault();
      toggle(results[cursor].e.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  async function chooseFile() {
    const p = await dialogs.pickFile(t('Bibliografia (BibTeX o CSL JSON)'), [{ name: t('Bibliografia'), extensions: ['bib', 'json'] }]);
    if (!p) return;
    settings.bibliography = p;
    save.settings();
    await refreshBibliography(true);
    version++;
    if (biblio.error) notify(biblio.error, 'error');
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && cancel()} onkeydown={onKey}>
  <div class="sheet" role="dialog" aria-label={t('Inserisci una citazione')} tabindex="-1" data-own-escape>
    <div class="sheet-head">
      <h2>{t('Inserisci una citazione')}</h2>
      <button class="icon-btn" onclick={cancel} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
    <div class="sheet-body">
      {#if !settings.bibliography || (biblio.error && !all.length)}
        <p class="empty">
          {biblio.error ?? t('Per citare serve una bibliografia: un file .bib (BibTeX o BibLaTeX) o CSL JSON, per esempio esportato da Zotero.')}
        </p>
        <button class="btn primary" onclick={chooseFile}>{t('Scegli il file della bibliografia…')}</button>
        <input class="hidden" bind:this={search} aria-hidden="true" tabindex="-1" />
      {:else}
        <input
          class="input search"
          type="search"
          bind:this={search}
          bind:value={query}
          placeholder={t('Cerca per autore, anno, titolo o chiave')}
          spellcheck="false"
          aria-controls="cite-results"
          data-own-escape
        />
        <ul class="results" id="cite-results" role="listbox" aria-multiselectable="true" bind:this={list}>
          {#each results as r, i (r.e.id)}
            <li role="option" aria-selected={picked.includes(r.e.id)} class:cur={i === cursor}>
              <button class="item" onclick={() => toggle(r.e.id)} ondblclick={() => ((picked = [r.e.id]), insert())} onmouseenter={() => (cursor = i)}>
                <input type="checkbox" checked={picked.includes(r.e.id)} tabindex="-1" aria-hidden="true" />
                <span class="who">{r.d.who || r.e.id}<span class="year">{r.d.year}</span></span>
                <span class="title">{r.d.title}</span>
                <span class="key">@{r.e.id}</span>
              </button>
            </li>
          {:else}
            <li class="none">{t('Nessuna opera trovata.')}</li>
          {/each}
        </ul>
        <p class="count faint">
          {tn(all.length, '{n} voce in {file}', '{n} voci in {file}', { file: basename(settings.bibliography) })}
          {#if picked.length}· {tn(picked.length, '{n} scelta', '{n} scelte')}{/if}
        </p>

        <div class="opts">
          <label class="field">
            <span>{t('Pagine o luogo')}</span>
            <input class="input" bind:value={locator} placeholder={t('p. 33')} spellcheck="false" />
          </label>
          <label class="field">
            <span>{t('Prima della citazione')}</span>
            <input class="input" bind:value={prefix} placeholder={t('vedi')} disabled={narrative} />
          </label>
        </div>
        <div class="modes">
          <div class="seg" role="radiogroup" aria-label={t('Forma')}>
            <button role="radio" aria-checked={!narrative} class:on={!narrative} onclick={() => (narrative = false)}>{t('(Autore anno)')}</button>
            <button role="radio" aria-checked={narrative} class:on={narrative} onclick={() => (narrative = true)}>{t('Autore (anno)')}</button>
          </div>
          <label class="check"><input type="checkbox" bind:checked={yearOnly} disabled={narrative || target.length > 1} /> {t('Solo l\'anno')}</label>
        </div>

        <div class="result">
          <span class="faint">{t('Nel testo:')}</span>
          <code>{source(narrative ? target.slice(0, 1) : target) || '—'}</code>
          {#if preview}<span class="arrow">→</span><span class="formatted">{preview}</span>{/if}
        </div>
      {/if}
    </div>
    {#if settings.bibliography && all.length}
      <div class="sheet-foot">
        <span class="hint faint">{t('Invio inserisce · clic per sceglierne più di una')}</span>
        <button class="btn" onclick={cancel}>{t('Annulla')}</button>
        <button class="btn primary" onclick={insert} disabled={!target.length}>{t('Inserisci')}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .sheet {
    width: min(620px, calc(100vw - 32px));
  }
  .search {
    width: 100%;
  }
  .hidden {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 1px;
  }
  .empty {
    margin: 0 0 14px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .results {
    margin: 10px 0 0;
    padding: 4px;
    list-style: none;
    height: min(300px, 42vh);
    overflow: auto;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
  }
  .item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'box who key' 'box title title';
    column-gap: 10px;
    row-gap: 1px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    text-align: left;
  }
  .item input {
    grid-area: box;
    margin: 3px 0 0;
    accent-color: var(--ink);
    pointer-events: none;
  }
  .cur .item {
    background: var(--chrome);
  }
  [aria-selected='true'] .item {
    background: var(--chrome-2);
  }
  .who {
    grid-area: who;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .year {
    margin-left: 8px;
    font-weight: 400;
    color: var(--ink-2);
  }
  .title {
    grid-area: title;
    font-family: var(--font);
    font-style: italic;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .key {
    grid-area: key;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-3);
  }
  .none {
    padding: 14px;
    color: var(--ink-3);
  }
  .count {
    margin: 6px 2px 0;
    font-size: 12px;
  }
  .opts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 14px;
  }
  .modes {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 12px;
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome);
  }
  .seg button {
    height: 26px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .seg button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--ink-2);
  }
  .check input {
    margin: 0;
    accent-color: var(--ink);
  }
  .result {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    margin-top: 14px;
    padding: 9px 12px;
    border-radius: var(--radius-m);
    background: var(--chrome);
    line-height: 1.45;
  }
  .result code {
    font-family: var(--mono);
    font-size: 12px;
  }
  .formatted {
    font-family: var(--font);
  }
  .arrow {
    color: var(--ink-3);
  }
  .sheet-foot .hint {
    margin-right: auto;
    font-size: 12px;
  }
  @media (max-width: 560px) {
    .opts {
      grid-template-columns: 1fr;
    }
  }
</style>
