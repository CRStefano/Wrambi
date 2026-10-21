//! Indicizzazione della cartella biblioteca.
//!
//! Wrambi legge soltanto: non sposta, non copia e non rinomina i file.
//! L'indice (stato di lettura, note) vive nei dati dell'app, collegato al
//! percorso relativo del file dentro la biblioteca.

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use walkdir::{DirEntry, WalkDir};

/// Estensioni riconosciute.
pub const SUPPORTED: &[&str] = &["md", "markdown", "txt", "html", "htm", "tex", "typ", "pdf", "epub"];

/// Limite di sicurezza per cartelle enormi (es. un intero disco scelto per errore).
pub const MAX_ENTRIES: usize = 20_000;

/// Cartelle che non contengono documenti dell'utente.
const SKIP_DIRS: &[&str] = &["node_modules", "target", "__pycache__", "$RECYCLE.BIN", "System Volume Information"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LibraryEntry {
    /// Percorso relativo alla biblioteca, con `/` come separatore.
    pub rel: String,
    /// Percorso assoluto.
    pub path: String,
    pub name: String,
    pub ext: String,
    /// Cartella relativa che contiene il file ("" se nella radice).
    pub folder: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub root: String,
    pub entries: Vec<LibraryEntry>,
    pub truncated: bool,
    pub skipped_unreadable: usize,
}

fn is_hidden_or_skipped(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    if name.starts_with('.') || name.starts_with('~') {
        return true;
    }
    entry.file_type().is_dir() && SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name))
}

pub fn extension_of(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    SUPPORTED.contains(&ext.as_str()).then_some(ext)
}

pub fn scan(root: &Path) -> std::io::Result<ScanResult> {
    let meta = std::fs::metadata(root)?;
    if !meta.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotADirectory, crate::i18n::tr("non è una cartella")));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    let mut skipped = 0usize;

    let walker = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| !is_hidden_or_skipped(e));
    for item in walker {
        let entry = match item {
            Ok(e) => e,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(ext) = extension_of(entry.path()) else { continue };
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(md) = entry.metadata() else {
            skipped += 1;
            continue;
        };
        let rel_path = entry.path().strip_prefix(root).unwrap_or(entry.path());
        let rel = rel_path
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let folder = rel.rsplit_once('/').map(|(f, _)| f.to_string()).unwrap_or_default();
        let modified_ms = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        entries.push(LibraryEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().display().to_string(),
            rel,
            ext,
            folder,
            size: md.len(),
            modified_ms,
        });
    }
    entries.sort_by_key(|e| e.rel.to_lowercase());
    Ok(ScanResult { root: root.display().to_string(), entries, truncated, skipped_unreadable: skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indicizza_senza_toccare_i_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("Saggi/2026")).unwrap();
        std::fs::create_dir_all(root.join(".nascosta")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("Note.md"), "# Note").unwrap();
        std::fs::write(root.join("Saggi/2026/Articolo.PDF"), b"%PDF-1.4").unwrap();
        std::fs::write(root.join("Saggi/libro.epub"), b"PK").unwrap();
        std::fs::write(root.join("Saggi/foto.jpg"), b"x").unwrap();
        std::fs::write(root.join(".nascosta/segreto.md"), "x").unwrap();
        std::fs::write(root.join("node_modules/x/readme.md"), "x").unwrap();
        std::fs::write(root.join("~$bozza.txt"), "x").unwrap();

        let before: Vec<_> = walkdir::WalkDir::new(root).into_iter().map(|e| e.unwrap().path().to_path_buf()).collect();
        let res = scan(root).unwrap();
        let rels: Vec<_> = res.entries.iter().map(|e| e.rel.as_str()).collect();
        assert_eq!(rels, vec!["Note.md", "Saggi/2026/Articolo.PDF", "Saggi/libro.epub"]);
        assert_eq!(res.entries[1].ext, "pdf");
        assert_eq!(res.entries[1].folder, "Saggi/2026");
        assert_eq!(res.entries[0].folder, "");
        assert!(!res.truncated);

        let after: Vec<_> = walkdir::WalkDir::new(root).into_iter().map(|e| e.unwrap().path().to_path_buf()).collect();
        assert_eq!(before, after, "la scansione non deve creare né spostare file");
    }

    #[test]
    fn cartella_inesistente() {
        assert!(scan(Path::new("/percorso/che/non/esiste/wrambi")).is_err());
    }
}
