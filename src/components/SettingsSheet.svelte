<script lang="ts">
  import { onMount } from 'svelte';
  import { FolderOpen, X, ExternalLink, RefreshCw } from 'lucide';
  import Icon from './Icon.svelte';
  import { backend, basename, dialogs, inTauri, revealInFolder } from '../lib/backend';
  import { biblio, refreshBibliography } from '../lib/biblio/store.svelte';
  import { editor } from '../lib/editor/controller';
  import { DOC_LANGS, LANGS, t, tn, type Lang } from '../lib/i18n';
  import { setLibraryRoot } from '../lib/library.svelte';
  import { IS_MAC, OS_NAME } from '../lib/platform';
  import { FONTS, notify, save, settings, ui, type Measure, type ThemeChoice } from '../lib/state.svelte';

  let info = $state<{ version: string; data_dir: string } | null>(null);
  onMount(async () => {
    info = await backend.appInfo().catch(() => null);
    void refreshBibliography(true);
  });

  function set<K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) {
    settings[k] = v;
    save.settings();
    if (k === 'spellcheck' || k === 'typewriter' || k === 'caret') editor.configure({ [k]: v } as never);
    if (k === 'focusDim') editor.configure({ focusDim: ui.focus && (v as boolean) });
    if (k === 'docLanguage') editor.configure({ lang: v as string });
  }

  function setFrame(v: 'windows' | 'wrambi') {
    set('titleBar', v);
    void backend
      .setWindowFrame(v === 'windows')
      .catch((e) => notify(t('Non è stato possibile cambiare la finestra: {message}', { message: (e as Error).message }), 'error'));
  }

  async function chooseLibrary() {
    const p = await dialogs.pickFolder(t('Cartella della biblioteca'), settings.libraryRoot ?? undefined);
    if (p) await setLibraryRoot(p);
  }
  async function chooseExport() {
    const p = await dialogs.pickFolder(t('Cartella predefinita per le esportazioni'), settings.exportDir ?? settings.libraryRoot ?? undefined);
    if (p) set('exportDir', p);
  }
  async function chooseBibliography() {
    const p = await dialogs.pickFile(
      t('Bibliografia (BibTeX o CSL JSON)'),
      [
        { name: t('Bibliografia'), extensions: ['bib', 'json'] },
        { name: t('Tutti i file'), extensions: ['*'] },
      ],
      settings.bibliography ?? settings.libraryRoot ?? undefined,
    );
    if (!p) return;
    set('bibliography', p);
    await refreshBibliography(true);
    if (biblio.error) notify(biblio.error, 'error');
    else notify(tn(biblio.count, 'Bibliografia caricata: {n} voce.', 'Bibliografia caricata: {n} voci.'), 'ok');
  }
  async function removeBibliography() {
    set('bibliography', null);
    await refreshBibliography(true);
  }
  async function systemNotifications() {
    try {
      await backend.openNotificationSettings();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  const THEMES: { id: ThemeChoice; label: string }[] = $derived([
    { id: 'light', label: t('Carta') },
    { id: 'dark', label: t('Notte') },
    { id: 'system', label: t('Come {os}', { os: OS_NAME }) },
  ]);
  const MEASURE_LABELS: Record<Measure, string> = $derived({ narrow: t('Stretta'), medium: t('Media'), wide: t('Ampia') });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && (ui.settings = false)} onkeydown={(e) => e.key === 'Escape' && (ui.settings = false)}>
  <div class="sheet wide" role="dialog" aria-label={t('Impostazioni')} tabindex="-1">
    <div class="sheet-head">
      <h2>{t('Impostazioni')}</h2>
      <button class="icon-btn" onclick={() => (ui.settings = false)} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
    <div class="sheet-body">
      <section>
        <h3>{t('Lingua')}</h3>
        <div class="row">
          <span class="label">{t('Interfaccia')}</span>
          <div class="seg" role="radiogroup" aria-label={t('Lingua dell\'interfaccia')}>
            {#each LANGS as l (l.id)}
              <button role="radio" aria-checked={settings.language === l.id} class:on={settings.language === l.id} onclick={() => set('language', l.id as Lang)} lang={l.id}>{l.label}</button>
            {/each}
          </div>
        </div>
        <div class="row">
          <label class="label" for="doclang">{t('Lingua dei documenti')}</label>
          <select id="doclang" class="input select" value={settings.docLanguage} onchange={(e) => set('docLanguage', e.currentTarget.value)}>
            {#each DOC_LANGS as l (l.id)}
              <option value={l.id}>{l.label}</option>
            {/each}
          </select>
        </div>
        <p class="note-text">{t('La lingua dei documenti guida il controllo ortografico, la sillabazione del PDF e i termini di bibliografie e note («Bibliografia», «a cura di»…).')}</p>
      </section>

      <section>
        <h3>{t('Aspetto')}</h3>
        <div class="row">
          <span class="label">{t('Tema')}</span>
          <div class="themes">
            {#each THEMES as th (th.id)}
              <button class="theme {th.id}" class:on={settings.theme === th.id} onclick={() => set('theme', th.id)}>
                <span class="swatch"><i></i><i></i><i></i></span>{th.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="row top">
          <span class="label">{t('Carattere')}</span>
          <div class="font-groups">
            {#each [['system', t('Di {os}: disegnati per lo schermo, i più nitidi', { os: OS_NAME })], ['wrambi', t('Inclusi in Wrambi')]] as [group, title] (group)}
              <p class="group-title">{title}</p>
              <div class="fonts">
                {#each FONTS.filter((f) => f.group === group) as f (f.id)}
                  <button class="font" class:on={settings.font === f.id} onclick={() => set('font', f.id)} style="font-family:{f.family}">
                    <span class="name">{f.label}</span>
                    <span class="note">{t(f.note)}</span>
                  </button>
                {/each}
              </div>
            {/each}
          </div>
        </div>
        <div class="row">
          <label class="label" for="fs">{t('Dimensione')}</label>
          <div class="slider">
            <input id="fs" type="range" min="13" max="32" step="1" value={settings.fontSize} oninput={(e) => set('fontSize', Number(e.currentTarget.value))} />
            <output>{settings.fontSize} px</output>
          </div>
        </div>
        <div class="row">
          <label class="label" for="lh">{t('Interlinea')}</label>
          <div class="slider">
            <input id="lh" type="range" min="1.35" max="2.1" step="0.05" value={settings.lineHeight} oninput={(e) => set('lineHeight', Number(e.currentTarget.value))} />
            <output>{new Intl.NumberFormat(settings.language, { minimumFractionDigits: 2 }).format(settings.lineHeight)}</output>
          </div>
        </div>
        <div class="row">
          <span class="label">{t('Larghezza della pagina')}</span>
          <div class="seg">
            {#each Object.entries(MEASURE_LABELS) as [id, label] (id)}
              <button class:on={settings.measure === id} onclick={() => set('measure', id as Measure)}>{label}</button>
            {/each}
          </div>
        </div>
      </section>

      <section>
        <h3>{t('Scrittura')}</h3>
        <label class="check"><input type="checkbox" checked={settings.spellcheck} onchange={(e) => set('spellcheck', e.currentTarget.checked)} /> {t('Controllo ortografico del sistema, nella lingua dei documenti')}</label>
        <label class="check"><input type="checkbox" checked={settings.focusDim} onchange={(e) => set('focusDim', e.currentTarget.checked)} /> {t('In Focus, attenua i paragrafi diversi da quello in cui scrivi')}</label>
        <label class="check"><input type="checkbox" checked={settings.typewriter} onchange={(e) => set('typewriter', e.currentTarget.checked)} /> {t('Macchina da scrivere: la riga corrente resta al centro')}</label>
        <div class="row caret-row">
          <span class="label">{t('Cursore')}</span>
          <div class="seg">
            <button class:on={settings.caret === 'system'} onclick={() => set('caret', 'system')}>{t('Di {os}', { os: OS_NAME })}</button>
            <button class:on={settings.caret === 'thick'} onclick={() => set('caret', 'thick')}>{t('Più spesso')}</button>
          </div>
        </div>
        <p class="note-text">{t('«Di {os}» segue lampeggio e spessore impostati nel sistema (per esempio nelle opzioni di accessibilità).', { os: OS_NAME })}</p>
        {#if !IS_MAC}
          <div class="row caret-row">
            <span class="label">{t('Finestra')}</span>
            <div class="seg">
              <button class:on={settings.titleBar === 'windows'} onclick={() => setFrame('windows')}>{t('Barra di {os}', { os: OS_NAME })}</button>
              <button class:on={settings.titleBar === 'wrambi'} onclick={() => setFrame('wrambi')}>{t('Integrata')}</button>
            </div>
          </div>
          <p class="note-text">{t('Con la barra del sistema la finestra si riduce a icona, si ingrandisce, si affianca e si ridimensiona come ogni programma. «Integrata» usa una sola barra sottile, con i pulsanti in alto a destra. Lo schermo intero solo quando lo scegli: F11, ed Esc per uscire.')}</p>
        {/if}
      </section>

      <section>
        <h3>{t('Biblioteca')}</h3>
        <div class="row">
          <span class="label">{t('Cartella')}</span>
          <div class="path">
            <span title={settings.libraryRoot ?? ''}>{settings.libraryRoot ?? t('Nessuna')}</span>
            <button class="btn slim" onclick={chooseLibrary}><Icon icon={FolderOpen} size={14} />{t('Cambia')}</button>
          </div>
        </div>
        <label class="check"><input type="checkbox" checked={settings.autoReading} onchange={(e) => set('autoReading', e.currentTarget.checked)} /> {t('Segna come «In lettura» i documenti della biblioteca quando li apri')}</label>
        <p class="note-text">{t('I file restano dove sono: Wrambi li legge e ricorda stato di lettura e note nei propri dati.')}</p>
      </section>

      <section>
        <h3>{t('Citazioni e bibliografia')}</h3>
        <div class="row">
          <span class="label">{t('File della bibliografia')}</span>
          <div class="path">
            <span title={settings.bibliography ?? ''}>{settings.bibliography ? basename(settings.bibliography) : t('Nessuno')}</span>
            {#if settings.bibliography}
              <button class="icon-btn" onclick={() => refreshBibliography(true)} title={t('Rileggi')} aria-label={t('Rileggi')}><Icon icon={RefreshCw} size={14} /></button>
            {/if}
            <button class="btn slim" onclick={chooseBibliography}><Icon icon={FolderOpen} size={14} />{t('Scegli')}</button>
            {#if settings.bibliography}<button class="btn slim" onclick={removeBibliography}>{t('Togli')}</button>{/if}
          </div>
        </div>
        {#if biblio.error}
          <p class="note-text error">{biblio.error}</p>
        {:else if settings.bibliography}
          <p class="note-text">{tn(biblio.count, '{n} voce disponibile per le citazioni.', '{n} voci disponibili per le citazioni.')}</p>
        {/if}
        <p class="note-text">
          {t('Cita con «Cita» nella barra o con {keys}: Wrambi scrive [@chiave] (come Pandoc) e nelle esportazioni compone citazioni e bibliografia autore-anno. In LaTeX e Typst le citazioni restano native, con il file .bib accanto.', { keys: IS_MAC ? '⌘⇧C' : 'Ctrl+Shift+C' })}
        </p>
        <details class="howto">
          <summary>{t('Come collegare Zotero')}</summary>
          <ol>
            <li>{t('In Zotero installa il componente aggiuntivo Better BibTeX (gratuito).')}</li>
            <li>{t('Tasto destro sulla raccolta › Esporta raccolta… › formato «Better BibLaTeX», con «Mantieni aggiornato» attivo.')}</li>
            <li>{t('Qui sopra scegli il file .bib esportato: quando Zotero lo aggiorna, Wrambi lo rilegge da solo.')}</li>
          </ol>
          <p>{t('Senza Better BibTeX va bene anche l\'esportazione «BibLaTeX» o «CSL JSON» di Zotero, da ripetere quando aggiungi opere. Funzionano anche i .bib di JabRef, Mendeley e simili.')}</p>
        </details>
      </section>

      <section>
        <h3>{t('Esportazione')}</h3>
        <div class="row">
          <span class="label">{t('Cartella predefinita')}</span>
          <div class="path">
            <span title={settings.exportDir ?? ''}>{settings.exportDir ?? t('La cartella del documento')}</span>
            <button class="btn slim" onclick={chooseExport}><Icon icon={FolderOpen} size={14} />{t('Scegli')}</button>
            {#if settings.exportDir}<button class="btn slim" onclick={() => set('exportDir', null)}>{t('Ripristina')}</button>{/if}
          </div>
        </div>
        <label class="check"><input type="checkbox" checked={settings.exportNotes} onchange={(e) => set('exportNotes', e.currentTarget.checked)} /> {t('Includi le note di Wrambi come note a piè di pagina')}</label>
        <label class="check"><input type="checkbox" checked={settings.systemFonts} onchange={(e) => set('systemFonts', e.currentTarget.checked)} /> {t('PDF: rendi disponibili a Typst i font installati nel sistema (il primo PDF richiede qualche secondo in più)')}</label>
      </section>

      <section>
        <h3>{t('Non disturbare')}</h3>
        <p class="note-text">
          {t('Con «Non disturbare» attivo, Wrambi trattiene i propri avvisi (salvataggi, conferme) e te li riassume quando lo disattivi; gli errori compaiono comunque.')}
          {t('Non può silenziare le notifiche del sistema o di altre app: per quelle usa la modalità «Non disturbare» (o «Full immersion») del sistema.')}
        </p>
        {#if inTauri}
          <button class="btn slim" onclick={systemNotifications}><Icon icon={ExternalLink} size={14} />{t('Apri le impostazioni delle notifiche di {os}', { os: OS_NAME })}</button>
        {/if}
      </section>

      <section class="last">
        <h3>{t('Dati')}</h3>
        <p class="note-text">
          {t('Impostazioni, note, stati di lettura e bozze sono salvati sul computer, in chiaro, nella cartella dei dati di Wrambi. Per una copia cifrata usa il vault (menu ⋯).')}
        </p>
        {#if info}
          <div class="path">
            <span title={info.data_dir}>{info.data_dir}</span>
            {#if inTauri}<button class="btn slim" onclick={() => revealInFolder(info!.data_dir)}><Icon icon={FolderOpen} size={14} />{t('Mostra')}</button>{/if}
          </div>
          <p class="faint version">Wrambi {info.version}</p>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .wide {
    width: min(680px, calc(100vw - 32px));
  }
  section {
    padding: 14px 0 16px;
    border-bottom: 1px solid var(--rule);
  }
  section.last {
    border-bottom: 0;
  }
  h3 {
    margin: 0 0 12px;
    font-size: 13px;
    font-weight: 600;
  }
  .row {
    display: grid;
    grid-template-columns: 150px 1fr;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .row.top {
    align-items: start;
  }
  .label {
    color: var(--ink-2);
  }
  .themes {
    display: flex;
    gap: 8px;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px 0 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
  }
  .theme.on {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .swatch {
    display: inline-flex;
    width: 30px;
    height: 20px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--rule);
  }
  .swatch i {
    flex: 1;
  }
  .light .swatch i:nth-child(1) {
    background: #fcfcfb;
  }
  .light .swatch i:nth-child(2) {
    background: #1e2430;
  }
  .light .swatch i:nth-child(3) {
    background: #c8102e;
  }
  .dark .swatch i:nth-child(1) {
    background: #1d2230;
  }
  .dark .swatch i:nth-child(2) {
    background: #dce1ea;
  }
  .dark .swatch i:nth-child(3) {
    background: #ff7383;
  }
  .system .swatch i:nth-child(1) {
    background: #fcfcfb;
  }
  .system .swatch i:nth-child(2) {
    background: #1d2230;
  }
  .system .swatch i:nth-child(3) {
    background: linear-gradient(90deg, #c8102e, #ff7383);
  }
  .font-groups {
    display: grid;
    gap: 6px;
  }
  .group-title {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .caret-row {
    margin-top: 6px;
  }
  .fonts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .font {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
    text-align: left;
  }
  .font.on {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .font .name {
    font-size: 16px;
    color: var(--ink);
  }
  .font .note {
    font-family: var(--ui);
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .slider input {
    flex: 1;
    accent-color: var(--ink);
  }
  output {
    width: 52px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
  }
  .seg {
    display: inline-flex;
    justify-self: start;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome);
  }
  .seg button {
    height: 28px;
    padding: 0 14px;
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
  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0 0 10px;
    line-height: 1.4;
  }
  .check input {
    margin-top: 2px;
    accent-color: var(--ink);
  }
  .path {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .path span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .slim {
    height: 28px;
    padding: 0 10px;
  }
  .note-text {
    margin: 0 0 10px;
    color: var(--ink-2);
    line-height: 1.5;
    font-size: 12.5px;
  }
  .version {
    margin: 8px 0 0;
    font-size: 12px;
  }
  .note-text.error {
    color: var(--rubric);
  }
  .select {
    justify-self: start;
    height: 30px;
    min-width: 180px;
    padding: 0 8px;
  }
  .howto {
    margin: 4px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .howto summary {
    cursor: pointer;
    color: var(--ink);
  }
  .howto ol {
    margin: 8px 0;
    padding-left: 20px;
  }
  .howto p {
    margin: 0;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 1fr;
    }
    .fonts {
      grid-template-columns: 1fr;
    }
  }
</style>
