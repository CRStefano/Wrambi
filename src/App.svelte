<script lang="ts">
  import { onMount } from 'svelte';
  import { backend, inTauri } from './lib/backend';
  import { displayName, flushDocument, openPath, restoreSession } from './lib/docs.svelte';
  import { actions, handleGlobalKey, windowApi } from './lib/actions';
  import { refreshIfStale, scanLibrary } from './lib/library.svelte';
  import { fontFamily, MEASURES, flushPersistence, leaveGuard, loadAll, settings, ui, doc } from './lib/state.svelte';
  import { onBibliographyChange, refreshBibliography } from './lib/biblio/store.svelte';
  import { editor } from './lib/editor/controller';
  import { pdfEdit } from './lib/pdfedit/session.svelte';
  import { t } from './lib/i18n';
  import { IS_MAC } from './lib/platform';
  import TitleBar from './components/TitleBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import EditorPane from './components/EditorPane.svelte';
  import Home from './components/home/Home.svelte';
  import NotesPanel from './components/NotesPanel.svelte';
  import Preview from './components/Preview.svelte';
  import NotePopover from './components/NotePopover.svelte';
  import LinkDialog from './components/LinkDialog.svelte';
  import CitePicker from './components/CitePicker.svelte';
  import SettingsSheet from './components/SettingsSheet.svelte';
  import ExportSheet from './components/ExportSheet.svelte';
  import SaveSheet from './components/SaveSheet.svelte';
  import VaultSheet from './components/VaultSheet.svelte';
  import ShortcutsSheet from './components/ShortcutsSheet.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import Tour from './components/Tour.svelte';
  import Toasts from './components/Toasts.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import Banner from './components/Banner.svelte';

  let systemDark = $state(typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

  // Tema, font e misure come variabili CSS: nessun ricalcolo dell'editor.
  $effect(() => {
    const theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
    ui.resolvedTheme = theme;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty('--fs', `${settings.fontSize}px`);
    root.style.setProperty('--lh', String(settings.lineHeight));
    root.style.setProperty('--measure', MEASURES[settings.measure]);
    root.style.setProperty('--font', fontFamily(settings.font));
    try {
      localStorage.setItem('wrambi:theme', settings.theme);
    } catch {
      /* non essenziale */
    }
  });

  // Lingua dell'interfaccia: attributo lang (lettori di schermo, sillabazione) e messaggi del programma.
  $effect(() => {
    document.documentElement.lang = settings.language;
    void backend.setLanguage(settings.language).catch(() => {});
    editor.configure({ uiLang: settings.language });
  });

  // Il titolo della finestra (barra del sistema e barra delle applicazioni).
  $effect(() => {
    const name = ui.home ? t('Biblioteca') : doc.draftId && !doc.derived ? doc.title || t('Senza titolo') : displayName(doc.name);
    if (!inTauri || !ui.ready) return;
    void windowApi().then((w) => w?.setTitle(name ? `${name} — Wrambi` : 'Wrambi').catch(() => {}));
  });

  onMount(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => (systemDark = mq.matches);
    mq.addEventListener('change', onScheme);

    const onKey = (e: KeyboardEvent) => handleGlobalKey(e);
    window.addEventListener('keydown', onKey, { capture: true });
    const onFocus = () => {
      if (settings.libraryRoot) refreshIfStale();
      // Zotero può aver aggiornato il .bib mentre la finestra era in secondo piano.
      if (settings.bibliography) void refreshBibliography();
    };
    window.addEventListener('focus', onFocus);
    const onContext = (e: MouseEvent) => {
      // Solo il menu contestuale dell'editor (correttore ortografico, copia/incolla).
      const t = e.target as HTMLElement;
      if (!t.closest('.cm-content, input, textarea, .doc-preview')) e.preventDefault();
    };
    window.addEventListener('contextmenu', onContext);
    const onDrop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', onDrop);
    window.addEventListener('drop', onDrop);

    let unlistenClose: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;

    (async () => {
      try {
        await loadAll();
      } catch (e) {
        console.error(e);
      }
      ui.firstRun = !settings.firstRunDone;
      // Chi ha già scelto lingua e cartella (anche in una versione precedente) riceve il giro una volta.
      if (!ui.firstRun && !settings.tourSeen) ui.tour = 0;
      onBibliographyChange(() => editor.refreshCitations());
      void refreshBibliography(true);
      await restoreSession();
      if (settings.libraryRoot) void scanLibrary({ quiet: true });
      ui.ready = true;

      const w = await windowApi();
      if (w) {
        // Su macOS la finestra usa sempre la cornice del sistema (semafori a sinistra).
        await backend.prepareWindow(IS_MAC || settings.titleBar === 'windows').catch((e) => console.error(e));
        await w.show();
        await w.setFocus();
        unlistenClose = await w.onCloseRequested(async (event) => {
          // Modifiche a un PDF non salvate: si chiede prima di chiudere.
          if (leaveGuard.fn && !(await leaveGuard.fn())) {
            event.preventDefault();
            return;
          }
          // Il salvataggio finale avviene prima che la finestra si chiuda.
          await flushDocument();
          await flushPersistence();
        });
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlistenDrop = await getCurrentWebview().onDragDropEvent(async (ev) => {
          if (ev.payload.type === 'drop' && ev.payload.paths.length) await openPath(ev.payload.paths[0]);
        });
      }
    })();

    const beforeUnload = () => {
      void flushDocument();
      void flushPersistence();
    };
    if (!inTauri) window.addEventListener('beforeunload', beforeUnload);

    return () => {
      mq.removeEventListener('change', onScheme);
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('dragover', onDrop);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', beforeUnload);
      unlistenClose?.();
      unlistenDrop?.();
    };
  });
</script>

<div class="app" class:focus={ui.focus} class:fullscreen={ui.fullscreen} class:ready={ui.ready}>
  <TitleBar />
  <!-- Il banner parla del testo estratto: mentre si modificano le pagine del PDF non serve. -->
  {#if doc.banner && !ui.focus && !ui.home && !pdfEdit.active}
    <Banner />
  {/if}
  <main class="workspace">
    {#if ui.home}
      <Home />
    {/if}
    <section class="page" aria-label={t('Documento')} data-tour="page">
      <EditorPane />
    </section>
    {#if ui.preview}
      <Preview />
    {/if}
    {#if ui.notes}
      <NotesPanel />
    {/if}
  </main>
  {#if !ui.home}
    <StatusBar />
  {/if}

  {#if ui.popover}
    <NotePopover />
  {/if}
  {#if ui.contextMenu}
    <ContextMenu />
  {/if}
  {#if ui.link}
    <LinkDialog />
  {/if}
  {#if ui.cite}
    <CitePicker />
  {/if}
  {#if ui.settings}
    <SettingsSheet />
  {/if}
  {#if ui.exportOpen}
    <ExportSheet />
  {/if}
  {#if ui.saveSheet}
    <SaveSheet />
  {/if}
  {#if ui.vault}
    <VaultSheet />
  {/if}
  {#if ui.shortcuts}
    <ShortcutsSheet />
  {/if}
  {#if ui.firstRun && ui.ready}
    <FirstRun />
  {/if}
  {#if ui.tour != null && ui.ready && !ui.firstRun}
    <Tour />
  {/if}
  <Toasts />
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100vh;
    background: var(--page);
  }
  .workspace {
    grid-row: 3;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .page {
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
  }
  /* In Focus barra e stato si ritirano sopra la pagina e ricompaiono al passaggio del mouse. */
  .app.focus {
    grid-template-rows: 0 0 1fr 0;
  }
  .app.focus :global(.titlebar),
  .app.focus :global(.statusbar) {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 20;
    opacity: 0;
    transition: opacity 220ms ease 120ms;
  }
  .app.focus :global(.titlebar) {
    top: 0;
  }
  .app.focus :global(.statusbar) {
    bottom: 0;
  }
  .app.focus :global(.titlebar:hover),
  .app.focus :global(.titlebar:focus-within),
  .app.focus :global(.statusbar:hover),
  .app.focus :global(.statusbar:focus-within) {
    opacity: 1;
    transition-delay: 0ms;
  }
</style>
