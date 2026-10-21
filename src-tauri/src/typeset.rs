//! Compilazione Typst → PDF con il compilatore Typst integrato.
//!
//! Wrambi non richiede programmi esterni per produrre un PDF impaginato:
//! il testo viene convertito in sorgente Typst (lato interfaccia) e qui
//! compilato con la libreria `typst`. I file inclusi (immagini, altri .typ)
//! vengono letti, al momento della compilazione, dalla cartella del documento.
//! La bibliografia delle citazioni arriva invece dalla memoria, come file
//! virtuale [`VIRTUAL_BIB`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Datelike;
use serde::Serialize;
use typst::diag::{FileError, FileResult, Severity};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{DiagSpanKind, FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World, WorldExt};
use typst_kit::fonts::FontStore;
use typst_layout::PagedDocument;

/// Font disponibili al compilatore: quelli incorporati in Typst
/// (Libertinus Serif, New Computer Modern, DejaVu Sans Mono) e, se
/// richiesto, quelli installati nel sistema. La scansione avviene una volta.
static FONTS_EMBEDDED: OnceLock<FontStore> = OnceLock::new();
static FONTS_SYSTEM: OnceLock<FontStore> = OnceLock::new();
static LIBRARY: OnceLock<LazyHash<Library>> = OnceLock::new();
/// Serializza le compilazioni: la cache interna di Typst è globale.
static COMPILE_LOCK: Mutex<()> = Mutex::new(());

/// Il file .bib con le opere citate, servito dalla memoria (vedi `exporter.ts`).
pub const VIRTUAL_BIB: &str = "/wrambi-citazioni.bib";

fn fonts(include_system: bool) -> &'static FontStore {
    if include_system {
        FONTS_SYSTEM.get_or_init(|| {
            let mut store = FontStore::new();
            store.extend(typst_kit::fonts::embedded());
            store.extend(typst_kit::fonts::system());
            store
        })
    } else {
        FONTS_EMBEDDED.get_or_init(|| {
            let mut store = FontStore::new();
            store.extend(typst_kit::fonts::embedded());
            store
        })
    }
}

fn library() -> &'static LazyHash<Library> {
    LIBRARY.get_or_init(|| LazyHash::new(Library::default()))
}

/// Un "mondo" Typst minimo: il file principale arriva dalla memoria
/// (il testo dell'editor, anche non salvato), gli altri file dal disco.
struct WrambiWorld {
    root: Option<PathBuf>,
    main_id: FileId,
    main: Source,
    fonts: &'static FontStore,
    cache: Mutex<HashMap<FileId, Bytes>>,
    bib: Option<Bytes>,
}

impl WrambiWorld {
    fn new(text: String, root: Option<PathBuf>, include_system_fonts: bool, bib: Option<String>) -> Self {
        let vpath = VirtualPath::new("/main.typ").expect("percorso virtuale valido");
        // Un id "unico" evita che il testo in memoria venga confuso con un
        // eventuale main.typ reale nella stessa cartella.
        let main_id = FileId::unique(RootedPath::new(VirtualRoot::Project, vpath));
        let main = Source::new(main_id, text);
        Self {
            root,
            main_id,
            main,
            fonts: fonts(include_system_fonts),
            cache: Mutex::new(HashMap::new()),
            bib: bib.map(Bytes::from_string),
        }
    }

    fn read(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(bytes) = self.cache.lock().unwrap().get(&id) {
            return Ok(bytes.clone());
        }
        match id.root() {
            VirtualRoot::Project => {
                if let Some(bib) = &self.bib {
                    if id.vpath().get_with_slash() == VIRTUAL_BIB {
                        return Ok(bib.clone());
                    }
                }
            }
            VirtualRoot::Package(_) => {
                return Err(FileError::Other(Some(
                    crate::i18n::tr("i pacchetti Typst (@preview/…) richiedono Internet e non sono supportati da Wrambi").into(),
                )))
            }
        }
        let root = self.root.as_ref().ok_or_else(|| {
            FileError::Other(Some(
                crate::i18n::tr("salva il documento per includere altri file dalla sua cartella").into(),
            ))
        })?;
        let path = id
            .vpath()
            .realize(root)
            .map_err(|_| FileError::AccessDenied)?;
        let data = std::fs::read(&path).map_err(|e| FileError::from_io(e, &path))?;
        let bytes = Bytes::new(data);
        self.cache.lock().unwrap().insert(id, bytes.clone());
        Ok(bytes)
    }
}

impl World for WrambiWorld {
    fn library(&self) -> &LazyHash<Library> {
        library()
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.fonts.book()
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            return Ok(self.main.clone());
        }
        let bytes = self.read(id)?;
        let text = std::str::from_utf8(bytes.as_slice())
            .map_err(|_| FileError::InvalidUtf8)?
            .to_string();
        Ok(Source::new(id, text))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main_id {
            return Ok(Bytes::from_string(self.main.text().to_string()));
        }
        self.read(id)
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.font(index)
    }

    fn today(&self, offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        let now = match offset {
            None => chrono::Local::now().naive_local(),
            Some(off) => {
                let secs = off.seconds() as i64;
                (chrono::Utc::now() + chrono::Duration::seconds(secs)).naive_utc()
            }
        };
        Datetime::from_ymd(now.year(), now.month() as u8, now.day() as u8)
    }
}

/// Un errore o avviso di compilazione, con la riga (da 1) quando è nel testo principale.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Diagnostic {
    pub error: bool,
    pub message: String,
    pub line: Option<usize>,
    pub hints: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CompileOutcome {
    /// PDF prodotto, se la compilazione è riuscita.
    #[serde(skip)]
    pub pdf: Option<Vec<u8>>,
    pub pages: usize,
    pub diagnostics: Vec<Diagnostic>,
}

fn convert_diags(world: &WrambiWorld, diags: &[typst::diag::SourceDiagnostic]) -> Vec<Diagnostic> {
    diags
        .iter()
        .map(|d| {
            let line = match d.span.get() {
                DiagSpanKind::Detached => None,
                DiagSpanKind::Number { id, .. } | DiagSpanKind::Range { id, .. }
                    if id == world.main_id =>
                {
                    world
                        .range(d.span)
                        .and_then(|r| world.main.lines().byte_to_line(r.start))
                        .map(|l| l + 1)
                }
                _ => None,
            };
            Diagnostic {
                error: d.severity == Severity::Error,
                message: d.message.to_string(),
                line,
                hints: d.hints.iter().map(|h| h.v.to_string()).collect(),
            }
        })
        .collect()
}

/// Compila un sorgente Typst in PDF.
///
/// `root` è la cartella da cui risolvere i file inclusi (di solito quella del documento).
/// `bib` è il BibLaTeX delle opere citate, letto da Typst come [`VIRTUAL_BIB`].
pub fn compile_pdf(text: &str, root: Option<&Path>, include_system_fonts: bool, bib: Option<&str>) -> CompileOutcome {
    let _guard = COMPILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let world = WrambiWorld::new(
        text.to_string(),
        root.map(Path::to_path_buf),
        include_system_fonts,
        bib.map(str::to_string),
    );
    let warned = typst::compile::<PagedDocument>(&world);
    let mut diagnostics = convert_diags(&world, &warned.warnings);

    let outcome = match warned.output {
        Ok(doc) => {
            let pages = doc.pages().len();
            match typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()) {
                Ok(pdf) => CompileOutcome { pdf: Some(pdf), pages, diagnostics },
                Err(errs) => {
                    diagnostics.extend(convert_diags(&world, &errs));
                    CompileOutcome { pdf: None, pages: 0, diagnostics }
                }
            }
        }
        Err(errs) => {
            diagnostics.extend(convert_diags(&world, &errs));
            CompileOutcome { pdf: None, pages: 0, diagnostics }
        }
    };
    // Libera la memoria della cache incrementale non più utile.
    typst::comemo::evict(10);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compila_un_documento_semplice() {
        let out = compile_pdf("= Titolo\n\nCiao *mondo*, _corsivo_.\n\n- uno\n- due\n", None, false, None);
        assert!(out.diagnostics.iter().all(|d| !d.error), "{:?}", out.diagnostics);
        let pdf = out.pdf.expect("pdf atteso");
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(out.pages, 1);
    }

    #[test]
    fn riporta_la_riga_degli_errori() {
        let out = compile_pdf("Riga uno\n\n#let x = \n#nonesiste()\n", None, false, None);
        assert!(out.pdf.is_none());
        let err = out.diagnostics.iter().find(|d| d.error).expect("errore atteso");
        assert!(err.line.is_some(), "{:?}", out.diagnostics);
    }

    #[test]
    fn i_file_inclusi_si_leggono_dalla_cartella() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("parte.typ"), "Testo incluso").unwrap();
        let out = compile_pdf("#include \"parte.typ\"", Some(dir.path()), false, None);
        assert!(out.pdf.is_some(), "{:?}", out.diagnostics);
    }

    #[test]
    fn compila_il_campione_generato_da_wrambi() {
        // Il file viene generato dai test dell'interfaccia (npm test): verifica che
        // il Typst prodotto dalla conversione sia sempre compilabile.
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/campione.typ");
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!("campione.typ assente: esegui prima `npm test`");
            return;
        };
        let out = compile_pdf(&text, None, false, None);
        let errors: Vec<_> = out.diagnostics.iter().filter(|d| d.error).collect();
        assert!(errors.is_empty(), "errori: {errors:?}");
        let pdf = out.pdf.expect("pdf atteso");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn la_bibliografia_arriva_dalla_memoria() {
        let bib = "@book{rossi2020,\n  author = {Rossi, Mario},\n  title = {Il tempo},\n  date = {2020},\n  publisher = {Einaudi},\n  location = {Torino}\n}\n";
        let src = "#set text(lang: \"it\")\nCome dice #cite(label(\"rossi2020\"), form: \"prose\"), e altri #cite(label(\"rossi2020\"), supplement: [p. 3]).#footnote[Una nota.]\n\n#bibliography(\"wrambi-citazioni.bib\", style: \"chicago-author-date\")\n";
        let out = compile_pdf(src, None, false, Some(bib));
        let errors: Vec<_> = out.diagnostics.iter().filter(|d| d.error).collect();
        assert!(errors.is_empty(), "errori: {errors:?}");
        assert!(out.pdf.is_some());
        // Senza bibliografia in memoria il file non esiste.
        let out = compile_pdf(src, None, false, None);
        assert!(out.pdf.is_none());
    }

    #[test]
    fn compila_le_citazioni_generate_da_wrambi() {
        // Generati da `npm test` (tests/biblio.test.ts): citazioni, note e bibliografia.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let (Ok(text), Ok(bib)) = (
            std::fs::read_to_string(dir.join("citazioni.typ")),
            std::fs::read_to_string(dir.join("citazioni.bib")),
        ) else {
            eprintln!("citazioni.typ assente: esegui prima `npm test`");
            return;
        };
        let out = compile_pdf(&text, None, false, Some(&bib));
        let errors: Vec<_> = out.diagnostics.iter().filter(|d| d.error).collect();
        assert!(errors.is_empty(), "errori: {errors:?}");
        let pdf = out.pdf.expect("pdf atteso");
        if let Ok(path) = std::env::var("WRAMBI_DUMP_PDF") {
            std::fs::write(path, &pdf).unwrap();
        }
    }

    #[test]
    fn senza_cartella_le_inclusioni_spiegano_il_motivo() {
        let out = compile_pdf("#include \"parte.typ\"", None, false, None);
        assert!(out.pdf.is_none());
        assert!(out.diagnostics.iter().any(|d| d.message.contains("salva il documento")), "{:?}", out.diagnostics);
    }
}
