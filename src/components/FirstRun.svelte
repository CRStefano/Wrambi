<script lang="ts">
  import { FolderOpen, FolderPlus } from 'lucide';
  import Icon from './Icon.svelte';
  import { backend, dialogs, inTauri, joinPath } from '../lib/backend';
  import { setLibraryRoot } from '../lib/library.svelte';
  import { notify, save, settings, ui } from '../lib/state.svelte';
  import { editor } from '../lib/editor/controller';
  import { DOC_LANGS, LANGS, t, type Lang } from '../lib/i18n';

  let busy = $state(false);

  function finish() {
    settings.firstRunDone = true;
    save.settings();
    ui.firstRun = false;
    editor.focus();
    // Subito dopo, il giro di Wrambi (si può rimandare).
    if (!settings.tourSeen) ui.tour = 0;
  }

  async function chooseExisting() {
    const p = await dialogs.pickFolder(t('Scegli la cartella della biblioteca'));
    if (!p) return;
    busy = true;
    await setLibraryRoot(p);
    busy = false;
    finish();
    ui.home = true;
  }

  async function createDedicated() {
    busy = true;
    try {
      let base = 'C:/Users/Documenti';
      if (inTauri) {
        const { documentDir } = await import('@tauri-apps/api/path');
        base = await documentDir();
      }
      const p = joinPath(base, t('Biblioteca Wrambi'));
      await backend.ensureDir(p);
      await setLibraryRoot(p);
      notify(t('Biblioteca creata in {path}. Metti qui i documenti da leggere e scrivere.', { path: p }), 'ok');
      finish();
    } catch (e) {
      notify(t('Impossibile creare la cartella: {message}', { message: (e as Error).message }), 'error');
    } finally {
      busy = false;
    }
  }

  function setLanguage(l: Lang) {
    settings.language = l;
    // La lingua dei documenti segue quella scelta, finché non la si cambia nelle impostazioni.
    if (DOC_LANGS.some((d) => d.id === l)) settings.docLanguage = l;
    save.settings();
    editor.configure({ lang: settings.docLanguage });
  }
</script>

<div class="first" role="dialog" aria-label={t('Benvenuto in Wrambi')}>
  <div class="inner">
    <div class="langs" role="radiogroup" aria-label={t('Lingua')}>
      {#each LANGS as l (l.id)}
        <button role="radio" aria-checked={settings.language === l.id} class:on={settings.language === l.id} onclick={() => setLanguage(l.id)} lang={l.id}>{l.label}</button>
      {/each}
    </div>
    <img class="logo" src="/logo.png" alt="" width="72" height="72" />
    <h1>Wrambi<span class="dot" aria-hidden="true"></span></h1>
    <p class="lead">{t('Una pagina per scrivere, una biblioteca per leggere, le note in rosso a margine.')}</p>

    <h2>{t('Da quale cartella prendo i tuoi documenti?')}</h2>
    <p class="explain">
      {t('Wrambi indicizza i file Markdown, testo, LaTeX, Typst, HTML, PDF ed EPUB della cartella che scegli e delle sue sottocartelle.')}
      {t('Non li sposta e non li copia (li rinomina solo se glielo chiedi): ricorda cosa hai letto e le note che ci hai scritto.')}
    </p>

    <div class="choices">
      <button class="choice" onclick={chooseExisting} disabled={busy}>
        <Icon icon={FolderOpen} size={20} />
        <span><b>{t('Usa una cartella che ho già')}</b><small>{t('Per esempio quella con i tuoi saggi, articoli e libri.')}</small></span>
      </button>
      <button class="choice" onclick={createDedicated} disabled={busy}>
        <Icon icon={FolderPlus} size={20} />
        <span><b>{t('Crea «{name}» in Documenti', { name: t('Biblioteca Wrambi') })}</b><small>{t('Una cartella nuova, solo per Wrambi.')}</small></span>
      </button>
    </div>
    <button class="later" onclick={finish} disabled={busy}>{t('Scelgo più tardi: per ora voglio solo scrivere')}</button>
    <p class="foot">{t('Nessun account, nessun cloud. Puoi cambiare cartella e lingua quando vuoi nelle Impostazioni.')}</p>
  </div>
</div>

<style>
  .first {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    background: var(--page);
    overflow: auto;
    animation: fade 240ms ease;
  }
  .inner {
    width: min(620px, calc(100vw - 48px));
    padding: 48px 0;
  }
  .langs {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    margin: 0 0 28px;
    border-radius: var(--radius-m);
    background: var(--chrome);
  }
  .langs button {
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .langs button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .logo {
    display: block;
    width: 72px;
    height: 72px;
    margin: 0 0 22px;
  }
  h1 {
    margin: 0 0 6px;
    font-family: 'Literata Variable', Georgia, serif;
    font-size: 64px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1;
    color: var(--ink);
  }
  .dot {
    display: inline-block;
    width: 0.16em;
    height: 0.16em;
    margin-left: 0.06em;
    border-radius: 50%;
    background: var(--rubric);
  }
  .lead {
    margin: 0 0 40px;
    font-family: 'Literata Variable', Georgia, serif;
    font-size: 19px;
    font-style: italic;
    color: var(--ink-2);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 600;
  }
  .explain {
    margin: 0 0 22px;
    line-height: 1.6;
    color: var(--ink-2);
    font-size: 13.5px;
  }
  .choices {
    display: grid;
    gap: 10px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-l);
    background: var(--raised);
    text-align: left;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .choice:hover {
    border-color: var(--ink-3);
    box-shadow: var(--shadow-s);
  }
  .choice :global(svg) {
    flex: none;
    color: var(--ink-2);
  }
  .choice span {
    display: grid;
    gap: 3px;
  }
  .choice b {
    font-size: 14px;
    font-weight: 600;
  }
  .choice small {
    color: var(--ink-3);
    font-size: 12.5px;
  }
  .later {
    margin-top: 14px;
    padding: 6px 0;
    border: 0;
    background: transparent;
    color: var(--link);
    font-size: 13px;
  }
  .later:hover {
    text-decoration: underline;
  }
  .foot {
    margin: 28px 0 0;
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
