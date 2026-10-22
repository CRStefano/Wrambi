<script lang="ts">
  import {
    ChevronRight,
    Clock,
    Ellipsis,
    FilePlus,
    FileText,
    Folder,
    FolderOpen,
    LayoutGrid,
    Library,
    List,
    MessageSquareText,
    NotebookPen,
    RefreshCw,
    Search,
  } from 'lucide';
  import Icon from '../Icon.svelte';
  import PageThumb from './PageThumb.svelte';
  import ItemMenu from './ItemMenu.svelte';
  import NotesBoard from './NotesBoard.svelte';
  import { basename, dialogs, normPath, revealInFolder } from '../../lib/backend';
  import { openWithDialog } from '../../lib/docs.svelte';
  import { scanLibrary, setLibraryRoot, TYPE_LABELS } from '../../lib/library.svelte';
  import {
    draftItems,
    fileItem,
    folderTree,
    inFolder,
    matches,
    newDocumentHere,
    noteCounts,
    openItem,
    pendingEdits,
    recentItems,
    renameItem,
    sortItems,
    stateCounts,
    type FolderNode,
    type HomeItem,
  } from '../../lib/home.svelte';
  import { READ_LABELS, doc, formatDate, formatSize, notesStore, readState, save, settings, ui, type HomeSection, type ReadState } from '../../lib/state.svelte';
  import { formatNumber, keys, t, tk, tn } from '../../lib/i18n';

  let query = $state('');
  let limit = $state(120);
  let menu = $state<{ item: HomeItem; x: number; y: number } | null>(null);
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let expanded = $state<Record<string, boolean>>({});

  const files = $derived(ui.libraryEntries.map(fileItem));
  const byPath = $derived(new Map(files.map((f) => [normPath(f.path!), f])));
  const drafts = $derived(draftItems());
  const plainDrafts = $derived(drafts.filter((d) => !d.editOf));
  const counts = $derived(stateCounts(ui.libraryEntries));
  const notesBy = $derived(noteCounts());
  const pending = $derived(pendingEdits());
  const tree = $derived(folderTree(ui.libraryEntries));

  const section = $derived(ui.homeSection);
  const folder = $derived(ui.homeFolder ?? '');

  const SECTION_TITLES: Record<HomeSection, string> = {
    all: tk('Tutti i documenti'),
    recent: tk('Recenti'),
    drafts: tk('Bozze e modifiche'),
    notes: tk('Note'),
    unread: tk('Non letti'),
    reading: tk('In lettura'),
    read: tk('Letti'),
    folder: '',
  };

  const items = $derived.by(() => {
    let list: HomeItem[];
    switch (section) {
      case 'recent':
        return recentItems(byPath).filter((i) => matches(i, query));
      case 'drafts':
        list = drafts;
        break;
      case 'unread':
      case 'reading':
      case 'read':
        list = files.filter((f) => readState(f.key) === section);
        break;
      case 'folder':
        // Con la ricerca si cerca anche nelle sottocartelle.
        list = files.filter((f) => inFolder(f, folder, !!query.trim()));
        list = list.concat(plainDrafts.filter((d) => d.folder === folder));
        break;
      default:
        list = [...files, ...plainDrafts];
    }
    return sortItems(
      list.filter((i) => matches(i, query)),
      settings.homeSort,
    );
  });

  const subfolders = $derived.by(() => {
    if (section !== 'folder') return [];
    const find = (nodes: FolderNode[]): FolderNode[] | null => {
      for (const n of nodes) {
        if (n.path === folder) return n.children;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return folder === '' ? tree : (find(tree) ?? []);
  });

  // Ogni cambio di vista riparte dai primi documenti.
  $effect(() => {
    void section;
    void folder;
    void query;
    limit = 120;
  });

  const shown = $derived(items.slice(0, limit));

  function more(node: HTMLElement) {
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) limit += 120;
    });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  function go(s: HomeSection, f: string | null = null) {
    ui.homeSection = s;
    ui.homeFolder = f;
    menu = null;
  }

  function crumbs(path: string) {
    const parts = path ? path.split('/') : [];
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
  }

  const isOpen = (i: HomeItem) =>
    (i.draftId != null && doc.draftId === i.draftId) || (i.path != null && doc.path != null && normPath(doc.path) === normPath(i.path) && !doc.draftId);

  function openMenu(e: MouseEvent, item: HomeItem) {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = e.type === 'contextmenu' ? { item, x: e.clientX, y: e.clientY } : { item, x: r.left, y: r.bottom + 4 };
  }

  function startRename(item: HomeItem) {
    if (item.kind !== 'file') return;
    renaming = item.id;
    renameValue = item.title;
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('input[data-rename]');
      input?.focus();
      input?.select();
    });
  }

  async function finishRename(item: HomeItem, commit: boolean) {
    if (renaming !== item.id) return;
    renaming = null;
    if (commit) await renameItem(item, renameValue);
  }

  function cardKey(e: KeyboardEvent, item: HomeItem) {
    if (e.key === 'F2') {
      e.preventDefault();
      startRename(item);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      menu = { item, x: r.left + 20, y: r.top + 40 };
    }
  }

  async function chooseFolder() {
    const p = await dialogs.pickFolder(t('Scegli la cartella della biblioteca'), settings.libraryRoot ?? undefined);
    if (p) await setLibraryRoot(p);
  }

  function setView(v: 'grid' | 'list') {
    settings.homeView = v;
    save.settings();
  }
  function setSort(e: Event) {
    settings.homeSort = (e.currentTarget as HTMLSelectElement).value as typeof settings.homeSort;
    save.settings();
  }

  const READ_SECTIONS: ReadState[] = ['unread', 'reading', 'read'];
  const EMPTY_STATE: Record<ReadState, string> = { unread: tk('Nessun documento non letto.'), reading: tk('Nessun documento in lettura.'), read: tk('Nessun documento letto.') };
  const typeLabel = (i: HomeItem) => (i.kind === 'draft' && !i.editOf ? t('Bozza') : TYPE_LABELS[i.ext] ? t(TYPE_LABELS[i.ext]) : i.ext.toUpperCase());
  const folderLabel = (i: HomeItem) =>
    i.kind === 'draft'
      ? i.editOf
        ? i.editSaved
          ? t('Testo modificabile di {name}', { name: i.editOf })
          : t('Modifiche a {name}', { name: i.editOf })
        : t('Bozza di Wrambi')
      : i.folder || (settings.libraryRoot ? basename(settings.libraryRoot) : '');

  function toggleNode(path: string) {
    expanded[path] = !expanded[path];
  }
  const openAncestors = $derived.by(() => {
    const s = new Set<string>();
    if (section === 'folder' && folder) {
      const parts = folder.split('/');
      for (let i = 1; i <= parts.length; i++) s.add(parts.slice(0, i).join('/'));
    }
    return s;
  });
</script>

{#snippet node(n: FolderNode, depth: number)}
  {@const open = expanded[n.path] ?? openAncestors.has(n.path)}
  <li>
    <div class="nav-row" class:on={section === 'folder' && folder === n.path} style="--depth:{depth}">
      {#if n.children.length}
        <button class="twisty" class:open onclick={() => toggleNode(n.path)} aria-label={open ? t('Chiudi') : t('Apri')} aria-expanded={open}>
          <Icon icon={ChevronRight} size={13} />
        </button>
      {:else}
        <span class="twisty"></span>
      {/if}
      <button class="nav-btn" onclick={() => go('folder', n.path)} title={n.path}>
        <Icon icon={section === 'folder' && folder === n.path ? FolderOpen : Folder} size={15} />
        <span class="label">{n.name}</span>
        <span class="n">{n.count}</span>
      </button>
    </div>
    {#if open && n.children.length}
      <ul>
        {#each n.children as c (c.path)}{@render node(c, depth + 1)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

{#snippet badges(i: HomeItem)}
  {@const nn = notesBy.get(i.key) ?? 0}
  {#if nn && i.kind === 'file'}<span class="b-notes" title={tn(nn, '{n} nota', '{n} note')}>{nn}</span>{/if}
{/snippet}

<div class="home" role="region" aria-label={t('Biblioteca')}>
  <aside class="side" data-tour="home">
    <button class="new" onclick={newDocumentHere} title={section === 'folder' && folder ? t('Nuovo documento nella cartella {folder}', { folder }) : `${t('Nuovo documento')} (${keys('Ctrl+N')})`}>
      <Icon icon={FilePlus} size={16} /> {t('Nuovo documento')}
    </button>

    <nav aria-label={t('Sezioni')}>
      <ul>
        <li>
          <button class="nav-btn top" class:on={section === 'all'} onclick={() => go('all')}>
            <Icon icon={Library} size={16} /><span class="label">{t('Tutti i documenti')}</span><span class="n">{files.length + plainDrafts.length}</span>
          </button>
        </li>
        <li>
          <button class="nav-btn top" class:on={section === 'recent'} onclick={() => go('recent')}>
            <Icon icon={Clock} size={16} /><span class="label">{t('Recenti')}</span>
          </button>
        </li>
        <li>
          <button class="nav-btn top" class:on={section === 'drafts'} onclick={() => go('drafts')}>
            <Icon icon={NotebookPen} size={16} /><span class="label">{t('Bozze e modifiche')}</span><span class="n">{drafts.length || ''}</span>
          </button>
        </li>
        <li>
          <button class="nav-btn top notes" class:on={section === 'notes'} onclick={() => go('notes')}>
            <Icon icon={MessageSquareText} size={16} /><span class="label">{t('Note')}</span><span class="n">{notesStore.list.length || ''}</span>
          </button>
        </li>
      </ul>

      {#if settings.libraryRoot}
        <h3>{t('Lettura')}</h3>
        <ul>
          {#each READ_SECTIONS as s (s)}
            <li>
              <button class="nav-btn top" class:on={section === s} onclick={() => go(s)}>
                <span class="state-mark {s}"></span><span class="label">{t(READ_LABELS[s])}</span><span class="n">{counts[s]}</span>
              </button>
            </li>
          {/each}
        </ul>

        <h3>{t('Cartelle')}</h3>
        <ul class="tree">
          <li>
            <div class="nav-row" class:on={section === 'folder' && folder === ''} style="--depth:0">
              <span class="twisty"></span>
              <button class="nav-btn" onclick={() => go('folder', '')} title={settings.libraryRoot}>
                <Icon icon={FolderOpen} size={15} /><span class="label">{basename(settings.libraryRoot)}</span>
              </button>
            </div>
          </li>
          {#each tree as n (n.path)}{@render node(n, 1)}{/each}
        </ul>
      {/if}
    </nav>

    <footer class="side-foot">
      {#if settings.libraryRoot}
        <button class="foot-btn" onclick={() => revealInFolder(settings.libraryRoot!)} title={settings.libraryRoot}>
          <Icon icon={FolderOpen} size={14} /><span>{basename(settings.libraryRoot)}</span>
        </button>
        <button class="icon-btn" class:spin={ui.libraryScanning} onclick={() => scanLibrary()} title={t('Aggiorna l\'elenco')} aria-label={t('Aggiorna l\'elenco')}><Icon icon={RefreshCw} size={14} /></button>
        <button class="link-btn" onclick={chooseFolder}>{t('Cambia')}</button>
      {:else}
        <button class="link-btn" onclick={chooseFolder}>{t('Scegli la cartella della biblioteca')}</button>
      {/if}
    </footer>
  </aside>

  <section class="main">
    <header class="main-head">
      <div class="heading">
        {#if section === 'folder'}
          <nav class="crumbs" aria-label={t('Percorso')}>
            <button onclick={() => go('folder', '')}>{settings.libraryRoot ? basename(settings.libraryRoot) : t('Biblioteca')}</button>
            {#each crumbs(folder) as c (c.path)}
              <Icon icon={ChevronRight} size={15} />
              <button onclick={() => go('folder', c.path)} class:last={c.path === folder}>{c.name}</button>
            {/each}
          </nav>
        {:else}
          <h1>{t(SECTION_TITLES[section])}</h1>
        {/if}
        {#if section !== 'notes'}<span class="count">{formatNumber(items.length)}</span>{/if}
      </div>
      <div class="tools">
        <label class="search">
          <Icon icon={Search} size={15} />
          <input id="home-search" type="search" placeholder={section === 'notes' ? t('Cerca nelle note') : t('Cerca per nome')} bind:value={query} data-own-escape />
        </label>
        {#if section !== 'notes'}
          {#if section !== 'recent'}
            <select class="sort" value={settings.homeSort} onchange={setSort} aria-label={t('Ordina')}>
              <option value="modified">{t('Modificati di recente')}</option>
              <option value="name">{t('Nome')}</option>
              <option value="type">{t('Tipo')}</option>
            </select>
          {/if}
          <div class="seg" role="radiogroup" aria-label={t('Vista')}>
            <button role="radio" aria-checked={settings.homeView === 'grid'} class:on={settings.homeView === 'grid'} onclick={() => setView('grid')} title={t('Pagine')} aria-label={t('Vista a pagine')}>
              <Icon icon={LayoutGrid} size={15} />
            </button>
            <button role="radio" aria-checked={settings.homeView === 'list'} class:on={settings.homeView === 'list'} onclick={() => setView('list')} title={t('Elenco')} aria-label={t('Vista a elenco')}>
              <Icon icon={List} size={15} />
            </button>
          </div>
        {/if}
      </div>
    </header>

    <div class="scroll">
      {#if section === 'notes'}
        <NotesBoard {query} />
      {:else}
        {#if !settings.libraryRoot && (section === 'all' || section === 'folder')}
          <div class="intro">
            <p class="big">{t('La biblioteca è una cartella del tuo computer.')}</p>
            <p>{t('Wrambi mostra i documenti che contiene (Markdown, testo, LaTeX, Typst, HTML, PDF ed EPUB) senza spostarli né copiarli. Puoi aprirli, leggerli, annotarli, modificarli ed esportarli da qui.')}</p>
            <div class="intro-actions">
              <button class="btn primary" onclick={chooseFolder}><Icon icon={FolderOpen} size={15} />{t('Scegli la cartella')}</button>
              <button class="btn" onclick={() => openWithDialog().then(() => (ui.home = false))}><Icon icon={FileText} size={15} />{t('Apri un singolo file…')}</button>
            </div>
          </div>
        {:else if ui.libraryError && section !== 'drafts' && section !== 'recent'}
          <p class="msg error">{t('Cartella non raggiungibile: {message}', { message: ui.libraryError })}</p>
        {/if}

        {#if subfolders.length && !query.trim()}
          <div class="folders">
            {#each subfolders as f (f.path)}
              <button class="folder-chip" onclick={() => go('folder', f.path)}>
                <Icon icon={Folder} size={16} /><span class="label">{f.name}</span><span class="n">{f.count}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if !items.length && (settings.libraryRoot || section === 'drafts' || section === 'recent')}
          <p class="msg">
            {#if query.trim()}{t('Nessun documento corrisponde a «{query}».', { query })}
            {:else if section === 'drafts'}{t('Nessuna bozza. I documenti nuovi restano qui finché non li salvi come file; qui trovi anche le modifiche a PDF ed EPUB non ancora salvate.')}
            {:else if section === 'recent'}{t('Ancora nessun documento aperto.')}
            {:else if section === 'folder' && subfolders.length}{t('Questa cartella contiene solo sottocartelle.')}
            {:else if section === 'folder' || section === 'all'}{t('Nessun documento in questa cartella. Wrambi riconosce Markdown, testo, LaTeX, Typst, HTML, PDF ed EPUB.')}
            {:else}{t(EMPTY_STATE[section as ReadState])}{/if}
          </p>
        {/if}

        {#if settings.homeView === 'grid'}
          <div class="grid" role="list">
            {#each shown as i (i.id)}
              <div class="item" role="listitem" class:current={isOpen(i)}>
                <button
                  class="page"
                  onclick={() => openItem(i)}
                  oncontextmenu={(e) => openMenu(e, i)}
                  onkeydown={(e) => cardKey(e, i)}
                  title={i.path ?? i.title}
                  aria-label={t('Apri {name}', { name: i.title })}
                >
                  <PageThumb path={i.kind === 'draft' ? null : i.path} draftId={i.draftId} ext={i.ext} modified={i.modified || null} title={i.title} />
                  <span class="b-type">{typeLabel(i)}</span>
                  {@render badges(i)}
                  {#if i.path && pending.has(normPath(i.path))}<span class="b-edit" title={t('Hai modifiche al testo non ancora salvate in un file')}>{t('Modifiche da salvare')}</span>{/if}
                  {#if i.editOf && !i.editSaved}<span class="b-edit">{t('Da salvare')}</span>{/if}
                </button>
                <div class="caption">
                  {#if i.kind === 'file'}<span class="state-mark {readState(i.key)}" title={t(READ_LABELS[readState(i.key)])}></span>{/if}
                  {#if renaming === i.id}
                    <input
                      class="rename"
                      data-rename
                      data-own-escape
                      bind:value={renameValue}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') finishRename(i, true);
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          finishRename(i, false);
                        }
                      }}
                      onblur={() => finishRename(i, true)}
                      spellcheck="false"
                    />
                  {:else}
                    <span class="title" title={i.title}>{i.title}</span>
                  {/if}
                  <button class="more" onclick={(e) => openMenu(e, i)} aria-label={t('Azioni per {name}', { name: i.title })} title={t('Azioni')}><Icon icon={Ellipsis} size={16} /></button>
                </div>
                <div class="sub" class:indent={i.kind === 'file'}>
                  <span class="where">{isOpen(i) ? t('Aperto ora') : folderLabel(i)}</span>
                  {#if i.modified}<span class="when">{formatDate(i.modified)}</span>{/if}
                </div>
              </div>
            {/each}
          </div>
        {:else if items.length}
          <div class="rows" role="table" aria-label={t('Documenti')}>
            <div class="row head" role="row">
              <span role="columnheader"></span><span role="columnheader">{t('Nome')}</span><span role="columnheader">{t('Tipo')}</span><span role="columnheader">{t('Note')}</span><span role="columnheader">{t('Modificato')}</span><span role="columnheader">{t('Dimensione')}</span><span></span>
            </div>
            {#each shown as i (i.id)}
              <!-- svelte-ignore a11y_interactive_supports_focus (il menu si apre anche dal pulsante «Azioni») -->
              <div class="row" role="row" class:current={isOpen(i)} oncontextmenu={(e) => openMenu(e, i)}>
                <span role="cell">{#if i.kind === 'file'}<span class="state-mark {readState(i.key)}" title={t(READ_LABELS[readState(i.key)])}></span>{/if}</span>
                <span role="cell" class="r-name">
                  {#if renaming === i.id}
                    <input
                      class="rename"
                      data-rename
                      data-own-escape
                      bind:value={renameValue}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') finishRename(i, true);
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          finishRename(i, false);
                        }
                      }}
                      onblur={() => finishRename(i, true)}
                      spellcheck="false"
                    />
                  {:else}
                    <button class="r-open" onclick={() => openItem(i)} onkeydown={(e) => cardKey(e, i)} title={i.path ?? i.title}>
                      <span class="title">{i.title}</span>
                      <span class="where">{isOpen(i) ? t('Aperto ora') : folderLabel(i)}</span>
                    </button>
                  {/if}
                </span>
                <span role="cell" class="faint">{typeLabel(i)}</span>
                <span role="cell">{#if notesBy.get(i.key) && i.kind === 'file'}<span class="b-notes inline">{notesBy.get(i.key)}</span>{/if}</span>
                <span role="cell" class="faint">{i.modified ? formatDate(i.modified) : ''}</span>
                <span role="cell" class="faint">{i.size ? formatSize(i.size) : ''}</span>
                <span role="cell"><button class="more" onclick={(e) => openMenu(e, i)} aria-label={t('Azioni per {name}', { name: i.title })}><Icon icon={Ellipsis} size={16} /></button></span>
              </div>
            {/each}
          </div>
        {/if}
        {#if shown.length < items.length}
          <div class="sentinel" use:more>{t('Altri documenti…')}</div>
        {/if}
        {#if ui.libraryTruncated && section === 'all'}
          <p class="msg">{t('La cartella contiene molti file: sono indicizzati i primi {n}.', { n: formatNumber(ui.libraryEntries.length) })}</p>
        {/if}
      {/if}
    </div>
  </section>
</div>

{#if menu}
  <ItemMenu item={menu.item} x={menu.x} y={menu.y} onclose={() => (menu = null)} onrename={startRename} />
{/if}

<style>
  .home {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: grid;
    grid-template-columns: 252px minmax(0, 1fr);
    background: var(--chrome);
  }

  /* ───── Colonna di sinistra ───── */
  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--page);
    border-right: 1px solid var(--rule);
  }
  .new {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 14px 12px 10px;
    height: 38px;
    padding: 0 14px;
    border: 1px solid var(--ink);
    border-radius: var(--radius-m);
    background: var(--ink);
    color: var(--page);
    font-weight: 600;
  }
  .new:hover {
    filter: brightness(1.15);
  }
  nav[aria-label='Sezioni'] {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 8px 12px;
    background: var(--page);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  h3 {
    margin: 18px 10px 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-3);
  }
  .nav-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink-2);
    text-align: left;
  }
  .nav-btn:hover {
    background: var(--chrome);
    color: var(--ink);
  }
  .nav-btn.on,
  .nav-row.on .nav-btn {
    background: var(--chrome-2);
    color: var(--ink);
    font-weight: 600;
  }
  .nav-btn.notes :global(svg) {
    color: var(--rubric);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    color: var(--ink-3);
    font-size: 11.5px;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .nav-row {
    display: flex;
    align-items: center;
    padding-left: calc(var(--depth) * 12px);
  }
  .nav-row .nav-btn {
    padding-left: 4px;
    height: 30px;
  }
  .twisty {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 24px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-3);
  }
  .twisty :global(svg) {
    transition: transform 120ms;
  }
  .twisty.open :global(svg) {
    transform: rotate(90deg);
  }
  .side-foot {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-top: 1px solid var(--rule);
    font-size: 12px;
  }
  .foot-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 28px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink-2);
  }
  .foot-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot-btn:hover {
    background: var(--chrome);
  }
  .link-btn {
    border: 0;
    background: transparent;
    color: var(--link);
    padding: 4px 6px;
  }
  .spin :global(svg) {
    animation: spin 900ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ───── Contenuto ───── */
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .main-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 28px 14px 32px;
    background: var(--chrome);
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-family: var(--font);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .count {
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    color: var(--ink-3);
  }
  .crumbs button {
    padding: 2px 6px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    font-family: var(--font);
    font-size: 20px;
    font-weight: 500;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumbs button:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  .crumbs button.last {
    color: var(--ink);
    font-weight: 600;
    font-size: 24px;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 260px;
    height: 32px;
    padding: 0 10px;
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
  .sort {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-s);
    background: var(--page);
    color: var(--ink);
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome-2);
  }
  .seg button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
  }
  .seg button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 32px 40px;
    background: var(--chrome);
  }

  .folders {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 24px;
  }
  .folder-chip {
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: 260px;
    height: 38px;
    padding: 0 14px 0 12px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
    color: var(--ink);
  }
  .folder-chip :global(svg) {
    color: var(--ink-3);
  }
  .folder-chip:hover {
    border-color: var(--ink-4);
  }

  /* Vista a pagine: fogli su un piano, con il nome sotto. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
    gap: 30px 24px;
  }
  .item {
    min-width: 0;
  }
  .page {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: var(--sheet);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--ink) 9%, transparent),
      0 1px 2px rgba(20, 28, 40, 0.06),
      0 4px 14px rgba(20, 28, 40, 0.06);
    overflow: hidden;
    transition:
      box-shadow 160ms var(--ease),
      transform 160ms var(--ease);
  }
  .page:hover {
    transform: translateY(-2px);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent),
      0 2px 4px rgba(20, 28, 40, 0.08),
      0 10px 26px rgba(20, 28, 40, 0.12);
  }
  .item.current .page {
    box-shadow:
      0 0 0 2px var(--ink),
      0 4px 14px rgba(20, 28, 40, 0.08);
  }
  .b-type {
    position: absolute;
    left: 7px;
    bottom: 7px;
    padding: 1px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--raised) 88%, transparent);
    box-shadow: 0 0 0 1px var(--rule);
    color: var(--ink-2);
    font-family: var(--ui);
    font-size: 10.5px;
    font-weight: 600;
  }
  .b-notes {
    position: absolute;
    top: 7px;
    right: 7px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--rubric);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }
  .b-notes.inline {
    position: static;
    display: inline-block;
  }
  .b-edit {
    position: absolute;
    right: 7px;
    bottom: 7px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--warn);
    color: #fff;
    font-size: 10.5px;
    font-weight: 600;
  }
  .caption {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin-top: 10px;
  }
  .caption .state-mark {
    margin-top: 5px;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-weight: 600;
    line-height: 1.35;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .more {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    margin: -2px -4px 0 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink-3);
    opacity: 0;
  }
  .item:hover .more,
  .row:hover .more,
  .more:focus-visible {
    opacity: 1;
  }
  .more:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  .sub {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 3px;
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .sub.indent {
    padding-left: 16px;
  }
  .when {
    flex: none;
    white-space: nowrap;
  }
  .where {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 24px;
    margin-top: -3px;
    padding: 0 6px;
    border: 1px solid var(--focus);
    border-radius: 4px;
    background: var(--page);
    outline: none;
    font-weight: 600;
  }

  /* Vista a elenco */
  .rows {
    display: grid;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
    overflow: hidden;
  }
  .row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 96px 56px 120px 84px 36px;
    align-items: center;
    min-height: 46px;
    padding: 0 8px 0 12px;
    border-top: 1px solid var(--rule);
  }
  .row.head {
    min-height: 32px;
    border-top: 0;
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .row:not(.head):hover {
    background: var(--chrome);
  }
  .row.current {
    box-shadow: inset 3px 0 0 var(--ink);
  }
  .r-open {
    display: grid;
    width: 100%;
    padding: 6px 0;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .r-open .title {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .r-open .where {
    font-size: 11.5px;
    color: var(--ink-3);
  }

  .state-mark {
    flex: none;
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--unread);
  }
  .state-mark.reading {
    border-color: var(--reading);
    background: linear-gradient(90deg, var(--reading) 50%, transparent 50%);
  }
  .state-mark.read {
    border-color: var(--read);
    background: var(--read);
  }

  .intro {
    max-width: 560px;
    margin: 40px 0 30px;
    line-height: 1.6;
    color: var(--ink-2);
  }
  .big {
    font-family: var(--font);
    font-size: 20px;
    color: var(--ink);
    margin: 0 0 8px;
  }
  .intro-actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .msg {
    max-width: 620px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .msg.error {
    color: var(--rubric);
  }
  .sentinel {
    padding: 24px;
    text-align: center;
    color: var(--ink-3);
  }

  @media (max-width: 900px) {
    .home {
      grid-template-columns: 210px minmax(0, 1fr);
    }
    .search {
      width: 180px;
    }
    .row {
      grid-template-columns: 28px minmax(0, 1fr) 80px 48px 100px 36px;
    }
    .row > :nth-child(6) {
      display: none;
    }
  }
</style>
