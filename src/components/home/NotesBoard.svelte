<script lang="ts">
  import { FileOutput, FileQuestion, Trash2, TriangleAlert } from 'lucide';
  import Icon from '../Icon.svelte';
  import { deleteNotes, displayName } from '../../lib/docs.svelte';
  import { goToNote } from '../../lib/notes/go';
  import { deleteDocumentNotes, deleteOrphanedDocNotes, documentExists, noteMenu } from '../../lib/notes/manage';
  import { formatDate, notesStore, type Note } from '../../lib/state.svelte';
  import { notesExportMenu, notesTitle } from '../../lib/notes/export';
  import { keys, t, tn } from '../../lib/i18n';

  let { query = '' }: { query?: string } = $props();

  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Note[]>();
    const list = notesStore.list
      .filter((n) => !q || `${n.text} ${n.quote} ${n.docName}`.toLowerCase().includes(q))
      .sort((a, b) => b.updated - a.updated);
    for (const n of list) {
      const l = map.get(n.docKey) ?? [];
      l.push(n);
      map.set(n.docKey, l);
    }
    // Nel gruppo, le note seguono l'ordine del testo.
    return [...map.entries()].map(([k, l]) => [k, [...l].sort((a, b) => a.from - b.from)] as const);
  });

  /** Documenti che non esistono più (file cancellati o spostati, bozze eliminate). */
  let missing = $state<Set<string>>(new Set());
  $effect(() => {
    const firsts = groups.map(([, l]) => l[0]);
    let alive = true;
    void Promise.all(firsts.map(async (n) => [n.docKey, await documentExists(n)] as const)).then((res) => {
      if (alive) missing = new Set(res.filter(([, ok]) => !ok).map(([k]) => k));
    });
    return () => {
      alive = false;
    };
  });
  const orphaned = $derived(groups.filter(([k]) => missing.has(k)).flatMap(([, l]) => l));

  function open(n: Note) {
    if (missing.has(n.docKey)) return;
    void goToNote(n);
  }

  function excerpt(s: string, max: number) {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
</script>

{#if !notesStore.list.length}
  <div class="empty">
    <p class="big">{t('Nessuna nota, per ora.')}</p>
    <p>{t('Apri un documento, seleziona una parola o un passo e premi {keys}. Il testo annotato diventa rosso e la nota compare qui, insieme a quelle di tutti gli altri documenti.', { keys: keys('Ctrl+M') })}</p>
  </div>
{:else if !groups.length}
  <p class="msg">{t('Nessuna nota corrisponde a «{query}».', { query })}</p>
{:else}
  {#if orphaned.length}
    <div class="orphans">
      <Icon icon={FileQuestion} size={16} />
      <span>{missing.size === 1 ? tn(orphaned.length, '{n} nota appartiene a un documento che non esiste più.', '{n} note appartengono a un documento che non esiste più.') : tn(orphaned.length, '{n} nota appartiene a documenti che non esistono più.', '{n} note appartengono a {docs} documenti che non esistono più.', { docs: missing.size })}</span>
      <button class="btn slim danger" onclick={() => deleteOrphanedDocNotes(orphaned)}><Icon icon={Trash2} size={14} />{t('Elimina queste note')}</button>
    </div>
  {/if}
  <div class="top">
    <p class="hint">{t('Tasto destro su una nota per aprirla o eliminarla.')}</p>
    <button class="btn slim" onclick={(e) => { const all = groups.flatMap(([, l]) => l); notesExportMenu(e, all, notesTitle(all)); }}>
      <Icon icon={FileOutput} size={14} />{query ? t('Esporta queste note') : t('Esporta tutte le note')}
    </button>
  </div>
  <div class="board">
    {#each groups as [key, notes] (key)}
      {@const gone = missing.has(key)}
      <section class="group" class:gone>
        <header>
          {#if gone}
            <span class="doc gone-doc" title={t('Il documento non si trova più')}>{displayName(notes[0].docName)}</span>
            <span class="tag">{t('documento non trovato')}</span>
          {:else}
            <button class="doc" onclick={() => goToNote(notes[0])} title={t('Apri il documento alla prima nota')}>{displayName(notes[0].docName)}</button>
          {/if}
          <span class="count">{tn(notes.length, '{n} nota', '{n} note')}</span>
          <button class="del-all exp" onclick={(e) => notesExportMenu(e, [...notes], notesTitle([...notes]))} title={t('Esporta le note di questo documento')}>
            <Icon icon={FileOutput} size={13} />{t('Esporta')}
          </button>
          <button class="del-all" onclick={() => deleteDocumentNotes([...notes])} title={t('Elimina tutte le note di questo documento')}>
            <Icon icon={Trash2} size={13} />{notes.length === 1 ? t('Elimina la nota') : t('Elimina tutte')}
          </button>
        </header>
        <div class="cards">
          {#each notes as n (n.id)}
            <div class="card-wrap">
              <button class="card" class:orphan={n.orphan || gone} class:hl={n.kind === 'highlight'} onclick={() => open(n)} oncontextmenu={(e) => noteMenu(e, n)} title={gone ? t('Il documento non esiste più') : t('Apri la nota')}>
                <blockquote>{excerpt(n.quote, 140)}</blockquote>
                {#if n.text}<p class="body">{excerpt(n.text, 320)}</p>{:else if n.kind === 'highlight'}<p class="body faint">{t('Evidenziato')}</p>{:else}<p class="body faint">{t('(nota vuota)')}</p>{/if}
                <span class="meta">
                  {#if n.orphan && !gone}<span class="warn"><Icon icon={TriangleAlert} size={12} /> {t('testo non trovato')}</span>{/if}
                  <span>{formatDate(n.updated)}</span>
                </span>
              </button>
              <button class="del" onclick={() => deleteNotes([n.id])} aria-label={t('Elimina la nota')} title={t('Elimina la nota')}><Icon icon={Trash2} size={14} /></button>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .board {
    display: grid;
    gap: 30px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
  }
  .doc {
    padding: 0;
    border: 0;
    background: transparent;
    font-family: var(--font);
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
    text-align: left;
  }
  .doc:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .count {
    color: var(--ink-3);
    font-size: 12px;
  }
  .cards {
    columns: 280px;
    column-gap: 14px;
  }
  .card-wrap {
    position: relative;
    margin: 0 0 14px;
    break-inside: avoid;
  }
  .card {
    display: block;
    width: 100%;
    padding: 12px 14px 10px;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--rubric);
    border-radius: 2px var(--radius-m) var(--radius-m) 2px;
    background: var(--raised);
    text-align: left;
    color: var(--ink);
  }
  .card.hl {
    border-left-color: var(--marker-strong);
  }
  .card:hover {
    border-color: var(--ink-4);
    border-left-color: var(--rubric);
  }
  .card.orphan {
    border-left-color: var(--ink-4);
  }
  .del {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: var(--raised);
    color: var(--ink-3);
    opacity: 0;
  }
  .card-wrap:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    background: var(--rubric-wash);
    color: var(--rubric);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .top .hint {
    margin: 0;
  }
  .del-all + .del-all {
    margin-left: 0;
  }
  .del-all.exp:hover {
    background: var(--chrome-2) !important;
    color: var(--ink) !important;
  }
  .del-all {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    padding: 3px 8px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink-3);
    font-size: 12px;
    opacity: 0;
  }
  .group:hover .del-all,
  .group.gone .del-all,
  .del-all:focus-visible {
    opacity: 1;
  }
  .del-all:hover {
    background: var(--rubric-wash);
    color: var(--rubric);
  }
  .gone-doc {
    color: var(--ink-3);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .tag {
    padding: 1px 7px;
    border-radius: 4px;
    background: var(--chrome-2);
    color: var(--ink-2);
    font-size: 11.5px;
  }
  .orphans {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 760px;
    margin: 0 0 18px;
    padding: 10px 12px 10px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
    color: var(--ink-2);
  }
  .orphans span {
    flex: 1;
  }
  .slim {
    height: 28px;
    padding: 0 10px;
  }
  .hint {
    margin: -4px 0 16px;
    font-size: 12px;
    color: var(--ink-3);
  }
  blockquote {
    margin: 0 0 7px;
    font-family: var(--font);
    font-size: 14px;
    font-style: italic;
    line-height: 1.45;
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
    margin: 0 0 8px;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .meta {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--warn);
  }
  .empty {
    max-width: 460px;
    margin: 60px auto;
    line-height: 1.6;
    color: var(--ink-2);
    text-align: center;
  }
  .big {
    font-family: var(--font);
    font-size: 19px;
    color: var(--ink);
  }
  .msg {
    color: var(--ink-2);
  }
</style>
