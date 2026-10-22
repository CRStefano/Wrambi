<script lang="ts">
  import { Search, X, TriangleAlert, Trash2, FileOutput } from 'lucide';
  import Icon from './Icon.svelte';
  import { deleteNotes, displayName } from '../lib/docs.svelte';
  import { goToNote } from '../lib/notes/go';
  import { deleteDocumentNotes, noteMenu } from '../lib/notes/manage';
  import { notesExportMenu, notesTitle } from '../lib/notes/export';
  import { keys, t } from '../lib/i18n';
  import { doc, formatDate, notesStore, ui, type Note } from '../lib/state.svelte';

  let scope = $state<'doc' | 'all'>('all');
  let query = $state('');

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return notesStore.list
      .filter((n) => (scope === 'doc' ? n.docKey === doc.key : true))
      .filter((n) => !q || n.text.toLowerCase().includes(q) || n.quote.toLowerCase().includes(q) || n.docName.toLowerCase().includes(q))
      .sort((a, b) => (scope === 'doc' ? a.from - b.from : b.updated - a.updated));
  });

  /** In "Tutte" le note sono raggruppate per documento, il più recente in alto. */
  const groups = $derived.by(() => {
    const map = new Map<string, Note[]>();
    for (const n of filtered) {
      const list = map.get(n.docKey) ?? [];
      list.push(n);
      map.set(n.docKey, list);
    }
    return [...map.entries()];
  });

  const inDoc = $derived(notesStore.list.filter((n) => n.docKey === doc.key).length);

  const go = (n: Note) => void goToNote(n);

  function excerpt(s: string, max = 160) {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
</script>

<aside class="notes" aria-label={t('Note')}>
  <header>
    <h2>{t('Note')}</h2>
    <div class="head-tools">
      <button class="icon-btn" onclick={(e) => notesExportMenu(e, filtered, notesTitle(filtered))} disabled={!filtered.length} title={t('Esporta queste note (Markdown, testo, LaTeX, Typst, PDF)')} aria-label={t('Esporta le note')}><Icon icon={FileOutput} size={16} /></button>
      <button class="icon-btn" onclick={() => (ui.notes = false)} title={t('Chiudi')} aria-label={t('Chiudi le note')}><Icon icon={X} size={16} /></button>
    </div>
  </header>

  <div class="scope" role="radiogroup" aria-label={t('Quali note')}>
    <button role="radio" aria-checked={scope === 'doc'} class:on={scope === 'doc'} onclick={() => (scope = 'doc')}>{t('Questo documento')} <span class="n">{inDoc}</span></button>
    <button role="radio" aria-checked={scope === 'all'} class:on={scope === 'all'} onclick={() => (scope = 'all')}>{t('Tutte')} <span class="n">{notesStore.list.length}</span></button>
  </div>

  <label class="search">
    <Icon icon={Search} size={15} />
    <input type="search" placeholder={t('Cerca nelle note')} bind:value={query} />
  </label>

  <div class="list">
    {#if !notesStore.list.length}
      <div class="empty">
        <p>{t('Nessuna nota, per ora.')}</p>
        <p class="faint">{t('Seleziona una parola o un passo nel testo e premi {keys}: il testo annotato diventa rosso e si apre come una nota a piè di pagina.', { keys: keys('Ctrl+M') })}</p>
      </div>
    {:else if !filtered.length}
      <p class="msg">{scope === 'doc' ? t('Questo documento non ha note.') : t('Nessuna nota corrisponde.')}</p>
    {/if}

    {#each groups as [key, items] (key)}
      <section>
        <div class="group-head">
          {#if scope === 'all'}
            <h3 class:current={key === doc.key}>{displayName(items[0].docName)}</h3>
          {/if}
          <button class="del-all exp" onclick={(e) => notesExportMenu(e, items, notesTitle(items))} title={t('Esporta le note di questo documento')}>
            <Icon icon={FileOutput} size={12} />{t('Esporta')}
          </button>
          <button class="del-all" onclick={() => deleteDocumentNotes(items)} title={t('Elimina tutte le note di questo documento')}>
            <Icon icon={Trash2} size={12} />{items.length === 1 ? t('Elimina') : t('Elimina tutte')}
          </button>
        </div>
        <ol>
          {#each items as n (n.id)}
            <li>
              <button class="note" class:orphan={n.orphan} class:hl={n.kind === 'highlight'} onclick={() => go(n)} oncontextmenu={(e) => noteMenu(e, n)}>
                <blockquote>{excerpt(n.quote, 120)}</blockquote>
                {#if n.text}
                  <p class="body">{excerpt(n.text, 220)}</p>
                {:else if n.kind === 'highlight'}
                  <p class="body faint">{t('Evidenziato')}</p>
                {:else}
                  <p class="body faint">{t('(nota vuota)')}</p>
                {/if}
                <span class="meta">
                  {#if n.orphan}
                    <span class="warn" title={t('Il testo annotato non è più nel documento')}><Icon icon={TriangleAlert} size={12} /> {t('testo non trovato')}</span>
                  {/if}
                  <span>{formatDate(n.updated)}</span>
                  {#if scope === 'doc'}<span class="doc">{displayName(n.docName)}</span>{/if}
                </span>
              </button>
              <button class="del" onclick={() => deleteNotes([n.id])} aria-label={t('Elimina la nota')} title={t('Elimina la nota')}><Icon icon={Trash2} size={13} /></button>
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  </div>
</aside>

<style>
  .notes {
    flex: none;
    width: 340px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--chrome);
    border-left: 1px solid var(--rule);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 6px 16px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .head-tools {
    display: flex;
    gap: 2px;
  }
  .scope {
    display: flex;
    gap: 2px;
    margin: 4px 12px 0;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome-2);
  }
  .scope button {
    flex: 1;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .scope button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .n {
    color: var(--ink-3);
    font-size: 11px;
    margin-left: 3px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 12px 6px;
    padding: 0 10px;
    height: 32px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-s);
    background: var(--page);
    color: var(--ink-3);
  }
  .search:focus-within {
    border-color: var(--focus);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--chrome);
    padding: 4px 8px 16px;
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 14px;
  }
  .group-head h3 {
    flex: 1;
    min-width: 0;
  }
  .del-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 10px 2px 4px auto;
    padding: 2px 6px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink-3);
    font-size: 11.5px;
    opacity: 0;
  }
  section:hover .del-all,
  .del-all:focus-visible {
    opacity: 1;
  }
  .del-all:hover,
  .del:hover {
    background: var(--rubric-wash);
    color: var(--rubric);
  }
  .del-all + .del-all {
    margin-left: 0;
  }
  .del-all.exp:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  li {
    position: relative;
  }
  .del {
    position: absolute;
    top: 5px;
    right: 5px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: var(--raised);
    color: var(--ink-3);
    opacity: 0;
  }
  li:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  h3 {
    margin: 14px 8px 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h3.current::after {
    content: ' (aperto)';
    font-weight: 400;
    color: var(--ink-3);
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 6px;
  }
  .note.hl {
    border-left-color: var(--marker-strong);
  }
  .note {
    display: block;
    width: 100%;
    padding: 10px 12px 9px;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--rubric);
    border-radius: 2px var(--radius-m) var(--radius-m) 2px;
    background: var(--raised);
    color: var(--ink);
    text-align: left;
  }
  .note:hover {
    border-color: var(--ink-4);
    border-left-color: var(--rubric);
  }
  .note.orphan {
    border-left-color: var(--ink-4);
  }
  blockquote {
    margin: 0 0 6px;
    font-family: var(--font);
    font-size: 13.5px;
    font-style: italic;
    line-height: 1.4;
    color: var(--rubric);
  }
  /* Evidenziazioni: il passo su fondo giallo, come nel testo. */
  .hl blockquote {
    color: var(--ink);
    font-style: normal;
  }
  .hl blockquote {
    padding: 2px 5px;
    border-radius: 3px;
    background: var(--marker);
  }
  .orphan blockquote {
    color: var(--ink-3);
    text-decoration: line-through;
  }
  .body {
    margin: 0 0 6px;
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .doc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--warn);
  }
  .empty,
  .msg {
    padding: 14px 10px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .empty p {
    margin: 0 0 8px;
  }
</style>
