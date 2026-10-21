<script lang="ts">
  import { onMount } from 'svelte';
  import { FolderOpen, KeyRound, X } from 'lucide';
  import Icon from './Icon.svelte';
  import { dialogs, inTauri, joinPath, revealInFolder } from '../lib/backend';
  import { exportVault, importVault, planVault, type VaultPlan } from '../lib/vault.svelte';
  import { formatSize, notify, settings, ui } from '../lib/state.svelte';
  import { formatNumber, t } from '../lib/i18n';

  let tab = $state<'export' | 'import'>('export');

  // Esportazione
  let pw = $state('');
  let pw2 = $state('');
  let notedDocs = $state(true);
  let wholeLibrary = $state(false);
  let plan = $state<VaultPlan | null>(null);
  let busy = $state(false);

  const libSize = $derived(ui.libraryEntries.reduce((s, e) => s + e.size, 0));
  const pwOk = $derived(pw.length >= 8 && pw === pw2);
  const pwHint = $derived(
    !pw
      ? ''
      : pw.length < 8
        ? t('Almeno 8 caratteri.')
        : pw2 && pw !== pw2
          ? t('Le due password non coincidono.')
          : pw.length < 12
            ? t('Accettabile; una frase di 4 parole è più sicura.')
            : '',
  );

  async function refreshPlan() {
    plan = await planVault({ notedDocs, wholeLibrary });
  }
  onMount(refreshPlan);

  async function doExport() {
    if (!pwOk || !plan) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `Wrambi ${stamp}.wrambi`;
    const base = settings.exportDir ?? settings.libraryRoot;
    const dest = await dialogs.saveFile(t('Salva il vault'), base ? joinPath(base, name) : name, [{ name: t('Vault di Wrambi'), extensions: ['wrambi'] }]);
    if (!dest) return;
    busy = true;
    try {
      await refreshPlan();
      const res = await exportVault(dest, pw, plan!);
      pw = pw2 = '';
      ui.vault = false;
      notify(t('Vault creato: {n} elementi, {size}.', { n: formatNumber(res.files), size: formatSize(res.bytes) }), 'ok', {
        label: t('Mostra nella cartella'),
        run: () => void revealInFolder(dest),
      });
    } catch (e) {
      notify(t('Vault non creato: {message}', { message: (e as Error).message }), 'error');
    } finally {
      busy = false;
    }
  }

  // Importazione
  let src = $state<string | null>(null);
  let ipw = $state('');
  let restoreDir = $state<string | null>(null);
  let useAsLibrary = $state(!settings.libraryRoot);

  onMount(async () => {
    if (!inTauri) return;
    const { documentDir } = await import('@tauri-apps/api/path');
    restoreDir = joinPath(await documentDir(), 'Wrambi');
  });

  async function pickVault() {
    const p = await dialogs.pickFile(t('Apri un vault'), [{ name: t('Vault di Wrambi'), extensions: ['wrambi'] }]);
    if (p) src = p;
  }
  async function pickRestore() {
    const p = await dialogs.pickFolder(t('Cartella in cui ripristinare i documenti'), restoreDir ?? undefined);
    if (p) restoreDir = p;
  }

  async function doImport() {
    if (!src || !ipw || !restoreDir) return;
    busy = true;
    try {
      const r = await importVault(src, ipw, restoreDir, useAsLibrary);
      ipw = '';
      ui.vault = false;
      notify(
        t('Vault aperto: {notes} note, {documents} documenti, {drafts} bozze.', { notes: r.notes, documents: r.documents, drafts: r.drafts }) +
          (r.usedAsLibrary ? ' ' + t('La cartella è ora la biblioteca.') : ''),
        'ok',
      );
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && !busy && (ui.vault = false)} onkeydown={(e) => e.key === 'Escape' && !busy && (ui.vault = false)}>
  <div class="sheet" role="dialog" aria-label={t('Vault cifrato')} tabindex="-1" data-busy={busy}>
    <div class="sheet-head">
      <h2><Icon icon={KeyRound} size={16} /> {t('Vault cifrato')}</h2>
      <button class="icon-btn" onclick={() => (ui.vault = false)} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
    <div class="sheet-body">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'export'} class:on={tab === 'export'} onclick={() => (tab = 'export')}>{t('Crea un vault')}</button>
        <button role="tab" aria-selected={tab === 'import'} class:on={tab === 'import'} onclick={() => (tab = 'import')}>{t('Apri un vault')}</button>
      </div>

      {#if tab === 'export'}
        <p class="lead">{t('Un unico file .wrambi, cifrato con la tua password, da copiare su una chiavetta o su un altro computer e riaprire con Wrambi. Nessun servizio online.')}</p>
        <div class="scope">
          <p>{t('Sempre inclusi e cifrati: impostazioni, stati di lettura, tutte le note, le bozze ({n}).', { n: plan?.drafts ?? '…' })}</p>
          <label class="check">
            <input type="checkbox" bind:checked={notedDocs} onchange={refreshPlan} />
            <span>{t('Copia dei documenti che hanno note ({n})', { n: plan?.noted ?? '…' })}</span>
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={wholeLibrary} onchange={refreshPlan} disabled={!ui.libraryEntries.length} />
            <span>{t('Copia di tutta la biblioteca ({n} file, {size})', { n: formatNumber(ui.libraryEntries.length), size: formatSize(libSize) })}</span>
          </label>
          {#if plan?.missing.length}
            <p class="warn">{t('Non trovati, quindi esclusi: {list}', { list: plan.missing.slice(0, 4).join(', ') + (plan.missing.length > 4 ? '…' : '') })}</p>
          {/if}
          <p class="faint small">{t('I file nella tua biblioteca restano dove sono e non vengono cifrati sul disco: il vault ne contiene una copia cifrata.')}</p>
        </div>
        <div class="grid">
          <label class="field">
            <span>{t('Password')}</span>
            <input class="input" type="password" bind:value={pw} autocomplete="new-password" />
          </label>
          <label class="field">
            <span>{t('Ripeti la password')}</span>
            <input class="input" type="password" bind:value={pw2} autocomplete="new-password" />
          </label>
        </div>
        <p class="pw-hint" class:bad={pw && !pwOk && (pw.length < 8 || (pw2 && pw !== pw2))}>{pwHint}</p>
        <p class="caution">{t('Senza la password il vault non si può aprire in alcun modo: nessuno, nemmeno Wrambi, può recuperarla.')}</p>
        <p class="faint small">{t('Cifratura XChaCha20-Poly1305 con chiave derivata dalla password tramite Argon2id (64 MiB).')}</p>
      {:else}
        <p class="lead">{t('Note, stati di lettura e bozze del vault si uniscono a quelli già presenti; i documenti vengono ricreati nella cartella che scegli, senza sovrascrivere nulla.')}</p>
        <div class="grid one">
          <div class="field">
            <span>{t('File del vault')}</span>
            <div class="pick">
              <span>{src ?? t('Nessun file scelto')}</span>
              <button class="btn slim" onclick={pickVault}><Icon icon={FolderOpen} size={14} />{t('Scegli…')}</button>
            </div>
          </div>
          <label class="field">
            <span>{t('Password')}</span>
            <input class="input" type="password" bind:value={ipw} autocomplete="current-password" />
          </label>
          <div class="field">
            <span>{t('Ripristina i documenti in')}</span>
            <div class="pick">
              <span>{restoreDir ?? t('Da scegliere')}</span>
              <button class="btn slim" onclick={pickRestore}><Icon icon={FolderOpen} size={14} />{t('Cambia')}</button>
            </div>
          </div>
          <label class="check">
            <input type="checkbox" bind:checked={useAsLibrary} />
            <span>{t('Usa questa cartella come biblioteca (le sottocartelle della biblioteca originale vengono ricreate)')}</span>
          </label>
        </div>
      {/if}
    </div>
    <div class="sheet-foot">
      <button class="btn" onclick={() => (ui.vault = false)} disabled={busy}>{t('Annulla')}</button>
      {#if tab === 'export'}
        <button class="btn primary" onclick={doExport} disabled={!pwOk || busy || !plan}>{busy ? t('Cifratura…') : t('Crea il vault…')}</button>
      {:else}
        <button class="btn primary" onclick={doImport} disabled={!src || !ipw || !restoreDir || busy}>{busy ? t('Apertura…') : t('Apri il vault')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tabs {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    margin-bottom: 14px;
    border-radius: var(--radius-m);
    background: var(--chrome);
  }
  .tabs button {
    height: 28px;
    padding: 0 14px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
  }
  .tabs button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .lead {
    margin: 0 0 14px;
    line-height: 1.55;
  }
  .scope {
    padding: 12px 14px 6px;
    border-radius: var(--radius-m);
    background: var(--chrome);
    margin-bottom: 16px;
  }
  .scope p {
    margin: 0 0 10px;
    line-height: 1.5;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-bottom: 10px;
    line-height: 1.4;
  }
  .check input {
    margin-top: 2px;
    accent-color: var(--ink);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .grid.one {
    grid-template-columns: 1fr;
  }
  .pw-hint {
    min-height: 18px;
    margin: 6px 0 4px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .pw-hint.bad {
    color: var(--rubric);
  }
  .caution {
    margin: 4px 0 6px;
    padding-left: 10px;
    border-left: 3px solid var(--rubric);
    line-height: 1.45;
  }
  .small {
    font-size: 12px;
    margin: 6px 0 0;
    line-height: 1.45;
  }
  .warn {
    color: var(--warn);
    font-size: 12px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pick span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-2);
  }
  .slim {
    height: 28px;
    padding: 0 10px;
  }
  @media (max-width: 560px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
