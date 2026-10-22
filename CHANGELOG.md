# Changelog

## 0.2.0 — languages, citations, PDF editing and annotation, macOS and Linux

- **Interface in English, Italian and French**, chosen from the system language at first start and switchable in Settings › Language. The core's messages, the editor's search bar, dates and numbers follow the language. A separate *document language* (Italian, English, French, German, Spanish, Portuguese) drives spell checking, PDF hyphenation and bibliography terms.
- **Citations and bibliography** from a `.bib` (BibTeX/BibLaTeX) or CSL JSON file, for example exported from Zotero with Better BibTeX:
  - a *Cite* dialog (`Ctrl+Shift+C`) with search, pages, prefix and form;
  - Pandoc citation syntax in the text, with suggestions after `@`, highlighting and the full reference on hover;
  - author-year citations and reference list in HTML, EPUB, text and the preview; native Typst citations in PDF and `.typ`; biblatex in `.tex`; a `.bib` with the cited works next to Typst and LaTeX exports.
- **Notes export** to Markdown, text, LaTeX, Typst and PDF, per document or all at once, and **notes as footnotes** in exported documents (`\footnote`, `#footnote`, HTML/EPUB endnotes, Pandoc `[^1]`).
- **Text and pages in step.** A PDF can be read as extracted text, as its original pages, or **side by side** with both scrolling together; switching views keeps your place instead of jumping back to the top. Works on the edited text of a PDF too.
- **Notes and highlights on the PDF pages.** Select text on the pages (Pages or Side by side view, and the PDF editor's new *Note* tool) to add a note or a highlight; the same note shows in every view. New **highlights** (`Ctrl+Shift+H`, or the small menu that appears when selecting in documents you read): yellow, unnumbered, with an optional comment, exported with the notes but never as footnotes.
- **A live preview that follows the text**, like Typst's editor: the HTML and PDF previews scroll to the point you are reading or writing, the PDF no longer jumps to the top when it recompiles, and clicking a page of the PDF takes the text there.
- **Guided tour** at first start, always available from the ⋯ menu: for each part of the app, what it is for, how to use it and how Wrambi does it.
- **PDF editing that keeps the layout** (pdf-lib): rewrite a line in a matching standard font and colour, add text, highlight, cover, insert images; rotate, move, delete and insert pages, append another PDF; undo and redo; save a copy or replace the original with a backup.
- **macOS and Linux**: platform fonts and key names (`⌘`), native window frame on macOS, notification settings on each system; GitHub Actions build Windows, macOS (universal) and Linux (`.deb`, AppImage) installers, and test the core on all three.
- The Windows build scripts reinstall the JavaScript dependencies whenever `package-lock.json` changes, so an update brings its new packages with it.
- Fixed: PDF pages in the reader and in the PDF preview scrolled inside each page instead of the page list.
- Fixed: notes on a PDF whose text was being edited took the text's title instead of the file name and looked detached; they now keep the PDF's name, remember both the original and the edited passage, and are found again when the original is reopened. While editing the text, the original pages stay available, also when resuming a saved edit. Copies saved from the PDF editor keep the notes.
- A rewritten line in the PDF editor now extends to the column margin before its font is made smaller.

## 0.1.0 — first public version

- Distraction-free Markdown editor with a structural toolbar, autosave, drafts, Focus mode, typewriter scrolling, light and dark themes, Windows ClearType fonts and bundled fonts.
- Normal Windows window by default (minimise, maximise, snap, resize), with an optional integrated title bar. Full screen only on demand (`F11`, `Esc` to leave). The window fits the screen at start-up.
- Full-window Library of a folder of your choice:
  - page previews for PDF, EPUB, Markdown, text, LaTeX, Typst and HTML;
  - sections, folder tree, reading states, search, sorting;
  - grid and list views, rename and "show in folder".
- PDF reading (original pages, or text rebuilt as Markdown), EPUB and HTML reading.
- Notes anchored to the text, shown in red like footnotes:
  - a global Notes view;
  - right-click to delete, bulk deletion of notes whose document no longer exists, undo.
- Editing the text of PDF, EPUB and HTML documents, saved as a `_modificato` copy or over the original (with an `(originale)` backup), in the original format or another one.
- Live preview and offline export to Markdown, text, HTML, PDF (embedded Typst), EPUB, LaTeX and Typst.
- Password-protected vault (XChaCha20-Poly1305, Argon2id) in a single file, to move notes, settings, drafts and documents to another computer.
