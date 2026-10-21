/**
 * Esportazione delle note: un documento con, per ogni nota, il passo
 * annotato e il testo della nota. Si compone in Markdown e si converte con
 * gli stessi generatori dei documenti (Markdown, testo, LaTeX, Typst, PDF).
 */
import { backend, dialogs, dirname, joinPath, safeFileName } from '../backend';
import { converter } from '../convert/client';
import { displayName } from '../docs.svelte';
import { firstError } from '../exporter';
import { locale, t, tk, tn } from '../i18n';
import { notify, settings, type Note } from '../state.svelte';
import { revealInFolder } from '../backend';
import { openMenuAt } from './manage';

export type NotesFormat = 'md' | 'txt' | 'tex' | 'typ' | 'pdf';

const LABELS: Record<NotesFormat, string> = {
  md: tk('Markdown (.md)'),
  txt: tk('Testo semplice (.txt)'),
  tex: tk('LaTeX (.tex)'),
  typ: tk('Typst (.typ)'),
  pdf: tk('PDF'),
};

/** Protegge i caratteri che il Markdown interpreterebbe, lasciando leggibile il testo. */
export function mdEscape(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((para) =>
      para
        .split('\n')
        .map((line) =>
          line
            .trim()
            .replace(/[\\`*_[\]<>|~]/g, '\\$&')
            .replace(/^([#>+-]|=+$)/, '\\$1')
            .replace(/^(\d+)([.)])/, '$1\\$2'),
        )
        .filter(Boolean)
        .join('\\\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

function quote(text: string): string {
  return mdEscape(text)
    .split('\n')
    .map((l) => (l ? '> ' + l : '>'))
    .join('\n');
}

/** Il documento delle note, in Markdown. */
export function notesMarkdown(notes: Note[], title: string, now = new Date()): string {
  const byDoc = new Map<string, Note[]>();
  for (const n of notes) {
    const list = byDoc.get(n.docKey) ?? [];
    list.push(n);
    byDoc.set(n.docKey, list);
  }
  const date = now.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
  const out: string[] = [`# ${mdEscape(title)}`, `*${tn(notes.length, '{n} nota', '{n} note')} · ${mdEscape(t('esportate il {date}', { date }))}*`];
  const multi = byDoc.size > 1;
  for (const list of byDoc.values()) {
    if (multi) out.push(`## ${mdEscape(displayName(list[0].docName))}`);
    for (const n of [...list].sort((a, b) => a.from - b.from)) {
      if (n.quote.trim()) out.push(quote(n.quote));
      out.push(n.text.trim() ? mdEscape(n.text) : `*${t('(nota vuota)')}*`);
      if (n.orphan) out.push(`*${t('Il passo annotato non è più nel documento.')}*`);
    }
  }
  return out.join('\n\n') + '\n';
}

/** Nome proposto per il file: «Note - Saggio.md». */
function suggested(title: string, format: NotesFormat): string {
  return safeFileName(title) + '.' + format;
}

export async function exportNotes(notes: Note[], title: string, format: NotesFormat): Promise<void> {
  if (!notes.length) return;
  const name = suggested(title, format);
  const dir = settings.exportDir ?? settings.libraryRoot;
  const dest = await dialogs.saveFile(t('Esporta le note'), dir ? joinPath(dir, name) : name, [
    { name: t(LABELS[format]), extensions: [format] },
  ]);
  if (!dest) return;
  try {
    const md = notesMarkdown(notes, title);
    const opts = { plain: false, title, lang: settings.docLanguage };
    if (format === 'md') await backend.writeText(dest, md);
    else if (format === 'pdf') {
      const typ = (await converter.convert(md, 'typ', opts)).text;
      const res = await backend.typstExportPdf(typ, dirname(dest), dest, settings.systemFonts, null);
      if (!res.ok) throw new Error(firstError(res.diagnostics));
    } else await backend.writeText(dest, (await converter.convert(md, format, opts)).text);
    notify(tn(notes.length, 'Nota esportata.', '{n} note esportate.'), 'ok', { label: t('Mostra nella cartella'), run: () => void revealInFolder(dest) });
  } catch (e) {
    notify(t('Esportazione non riuscita: {message}', { message: (e as Error).message }), 'error');
  }
}

/** Menu dei formati, sotto il pulsante «Esporta» di un elenco di note. */
export function notesExportMenu(e: MouseEvent, notes: Note[], title: string) {
  e.preventDefault();
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openMenuAt(
    r.left,
    r.bottom + 4,
    (Object.keys(LABELS) as NotesFormat[]).map((f) => ({
      label: t(LABELS[f]),
      run: () => exportNotes(notes, title, f),
    })),
  );
}

/** Titolo del documento delle note: «Note - Saggio» o «Note di Wrambi». */
export function notesTitle(notes: Note[]): string {
  const docs = new Set(notes.map((n) => n.docKey));
  if (docs.size === 1) return t('Note - {doc}', { doc: displayName(notes[0].docName) });
  return t('Note di Wrambi');
}
