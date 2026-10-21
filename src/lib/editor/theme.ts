/**
 * Tema dell'editor. Usa solo variabili CSS: cambiare tema, font o
 * dimensione non ricostruisce l'editor e non interrompe la digitazione.
 */
import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--page)',
    color: 'var(--ink)',
    fontSize: 'var(--fs)',
  },
  '&.cm-focused': { outline: 'none' },
  // Sfondo opaco anche sul contenitore che scorre: è la condizione perché
  // WebView2 usi l'antialiasing ClearType (testo nitido) invece di quello in scala di grigi.
  '.cm-scroller': {
    backgroundColor: 'var(--page)',
    fontFamily: 'var(--font)',
    lineHeight: 'var(--lh)',
    overflowX: 'hidden',
    scrollBehavior: 'auto',
  },
  '.cm-content': {
    maxWidth: 'var(--measure)',
    width: '100%',
    margin: '0 auto',
    padding: 'var(--page-top, 9vh) 32px 45vh',
    caretColor: 'var(--ink)',
    backgroundColor: 'var(--page)',
    fontVariantLigatures: 'common-ligatures',
    fontFeatureSettings: '"kern" 1',
  },
  '.cm-line': { padding: '0' },
  '.cm-dropCursor': { borderLeft: '2px solid var(--ink-3)' },
  '&.thick-caret .cm-cursor': { borderLeft: '2.5px solid var(--ink)', marginLeft: '-1.25px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--sel) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--sel) 55%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid var(--ink-4)' },

  /* Blocchi Markdown */
  '.cm-h1': { paddingTop: '0.55em !important', paddingBottom: '0.15em !important' },
  '.cm-h2': { paddingTop: '0.7em !important', paddingBottom: '0.1em !important' },
  '.cm-h3, .cm-h4': { paddingTop: '0.5em !important' },
  '.cm-quote': {
    borderLeft: '3px solid var(--rule)',
    paddingLeft: '0.9em !important',
    color: 'var(--ink-2)',
  },
  '.cm-codeblock': {
    backgroundColor: 'var(--chrome)',
    fontFamily: 'var(--mono)',
    fontSize: '0.84em',
    padding: '0 0.9em !important',
  },
  '.cm-codeblock-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '0.3em !important' },
  '.cm-codeblock-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', paddingBottom: '0.3em !important' },
  '.cm-md-tag, .cm-md-tag *': { color: 'var(--ink-4) !important', fontSize: '0.8em' },
  '.cm-blank': { lineHeight: '0.95' },
  '.cm-u': { textDecoration: 'underline', textUnderlineOffset: '0.16em', textDecorationThickness: '1px' },
  '.cm-pagemark': {
    color: 'var(--ink-3)',
    fontFamily: 'var(--ui)',
    fontSize: '0.62em',
    textAlign: 'center',
    letterSpacing: '0.04em',
    padding: '0.8em 0 !important',
  },

  /* Note: il rosso di rubrica */
  '.cm-note': {
    color: 'var(--rubric)',
    backgroundColor: 'var(--rubric-wash)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--rubric-line)',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '0.2em',
    borderRadius: '2px',
    cursor: 'pointer',
    transition: 'background-color 300ms',
  },
  '.cm-note .cm-note': { backgroundColor: 'transparent' },
  '.cm-note-flash': { backgroundColor: 'color-mix(in srgb, var(--rubric) 26%, transparent)' },
  '.cm-note-ref': {
    color: 'var(--rubric)',
    fontFamily: 'var(--ui)',
    fontSize: '0.6em',
    fontWeight: '700',
    verticalAlign: 'super',
    lineHeight: '0',
    padding: '0 2px 0 1px',
    cursor: 'pointer',
    userSelect: 'none',
  },

  /* Focus: le righe fuori dal paragrafo corrente si attenuano */
  // Colore invece di opacità: niente livelli trasparenti, il testo resta nitido.
  '.cm-dim, .cm-dim *': { color: 'color-mix(in srgb, var(--ink) 28%, var(--page)) !important' },
  '.cm-dim .cm-note, .cm-dim .cm-note-ref': { color: 'color-mix(in srgb, var(--rubric) 35%, var(--page)) !important' },

  /* Ricerca */
  '.cm-panels': {
    backgroundColor: 'var(--chrome)',
    color: 'var(--ink)',
    fontFamily: 'var(--ui)',
    fontSize: '13px',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--rule)' },
  '.cm-search': { padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  '.cm-search input, .cm-search button, .cm-search label': { fontSize: '12.5px' },
  '.cm-textfield': {
    border: '1px solid var(--rule)',
    borderRadius: '5px',
    background: 'var(--page)',
    padding: '4px 8px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    background: 'var(--raised)',
    border: '1px solid var(--rule)',
    borderRadius: '5px',
    padding: '3px 10px',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 22%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--warn) 45%, transparent)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--ink-2)', fontSize: '18px', right: '10px', top: '6px' },
});
