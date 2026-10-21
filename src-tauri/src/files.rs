//! Lettura e scrittura dei file dell'utente e dei dati interni di Wrambi.

use crate::i18n::{tr, trf};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::vault::write_atomic;

/// Dimensione massima di un file di testo aperto nell'editor (32 MiB).
pub const MAX_TEXT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct TextFile {
    pub text: String,
    /// "utf-8", "utf-8-bom", "utf-16le", "utf-16be" oppure "windows-1252".
    pub encoding: String,
    pub modified_ms: u64,
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Mappa Windows-1252 per i byte 0x80–0x9F (il resto coincide con Latin-1).
const CP1252_HIGH: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

pub fn decode_text(bytes: &[u8]) -> (String, &'static str) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "utf-8-bom");
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return (String::from_utf16_lossy(&units), "utf-16le");
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        return (String::from_utf16_lossy(&units), "utf-16be");
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), "utf-8"),
        // File di vecchi programmi Windows: Windows-1252, non UTF-8.
        Err(_) => (
            bytes
                .iter()
                .map(|&b| match b {
                    0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize],
                    _ => b as char,
                })
                .collect(),
            "windows-1252",
        ),
    }
}

pub fn read_text(path: &Path) -> Result<TextFile, String> {
    let md = std::fs::metadata(path).map_err(|e| io_msg(&e, path))?;
    if md.len() > MAX_TEXT_BYTES {
        return Err(trf(
            "Il file è troppo grande per l'editor ({0} MB, limite {1} MB).",
            &[&(md.len() / (1024 * 1024)), &(MAX_TEXT_BYTES / (1024 * 1024))],
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| io_msg(&e, path))?;
    let (text, encoding) = decode_text(&bytes);
    Ok(TextFile { text, encoding: encoding.into(), modified_ms: modified_ms(path) })
}

/// Scrive testo in UTF-8 (con BOM solo se il file lo aveva), in modo atomico.
pub fn write_text(path: &Path, text: &str, bom: bool) -> Result<u64, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(trf("La cartella {0} non esiste più.", &[&parent.display()]));
        }
    }
    let mut bytes = Vec::with_capacity(text.len() + 3);
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(text.as_bytes());
    write_atomic(path, &bytes).map_err(|e| io_msg(&e, path))?;
    Ok(modified_ms(path))
}

pub fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic(path, bytes).map_err(|e| io_msg(&e, path))
}

pub fn io_msg(e: &std::io::Error, path: &Path) -> String {
    use std::io::ErrorKind::*;
    let what = match e.kind() {
        NotFound => tr("non trovato"),
        PermissionDenied => tr("accesso negato"),
        _ => "",
    };
    if what.is_empty() {
        format!("{}: {}", path.display(), e)
    } else {
        format!("{}: {}", path.display(), what)
    }
}

/// Dati interni di Wrambi (impostazioni, indice, note, bozze) nella cartella dell'app.
pub struct Store {
    pub dir: PathBuf,
}

/// Solo questi documenti JSON possono essere letti e scritti dall'interfaccia.
const STORE_NAMES: &[&str] = &["settings", "library", "notes", "session"];

impl Store {
    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir.join("drafts"))?;
        Ok(Self { dir })
    }

    fn json_path(&self, name: &str) -> Result<PathBuf, String> {
        if !STORE_NAMES.contains(&name) {
            return Err(trf("Archivio sconosciuto: {0}", &[&name]));
        }
        Ok(self.dir.join(format!("{name}.json")))
    }

    pub fn load(&self, name: &str) -> Result<Option<String>, String> {
        let path = self.json_path(name)?;
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io_msg(&e, &path)),
        }
    }

    pub fn save(&self, name: &str, json: &str) -> Result<(), String> {
        serde_json::from_str::<serde_json::Value>(json).map_err(|e| trf("JSON non valido: {0}", &[&e]))?;
        let path = self.json_path(name)?;
        // Copia di sicurezza della versione precedente.
        if path.exists() {
            let _ = std::fs::copy(&path, path.with_extension("json.bak"));
        }
        write_atomic(&path, json.as_bytes()).map_err(|e| io_msg(&e, &path))
    }

    fn draft_path(&self, id: &str) -> Result<PathBuf, String> {
        let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !ok {
            return Err(tr("Identificativo di bozza non valido.").into());
        }
        Ok(self.dir.join("drafts").join(format!("{id}.md")))
    }

    pub fn save_draft(&self, id: &str, text: &str) -> Result<(), String> {
        let p = self.draft_path(id)?;
        write_atomic(&p, text.as_bytes()).map_err(|e| io_msg(&e, &p))
    }

    pub fn load_draft(&self, id: &str) -> Result<Option<String>, String> {
        let p = self.draft_path(id)?;
        match std::fs::read_to_string(&p) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io_msg(&e, &p)),
        }
    }

    pub fn delete_draft(&self, id: &str) -> Result<(), String> {
        let p = self.draft_path(id)?;
        match std::fs::remove_file(&p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io_msg(&e, &p)),
        }
    }

    pub fn list_drafts(&self) -> Vec<(String, u64)> {
        let Ok(rd) = std::fs::read_dir(self.dir.join("drafts")) else { return vec![] };
        rd.filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                if p.extension()?.to_str()? != "md" {
                    return None;
                }
                Some((p.file_stem()?.to_str()?.to_string(), modified_ms(&p)))
            })
            .collect()
    }
}

/// Primi `max` byte di un file di testo, per le anteprime della biblioteca.
pub fn read_text_head(path: &Path, max: usize) -> Result<String, String> {
    use std::io::Read;
    let f = std::fs::File::open(path).map_err(|e| io_msg(&e, path))?;
    let mut buf = Vec::with_capacity(max.min(1 << 20));
    f.take(max as u64).read_to_end(&mut buf).map_err(|e| io_msg(&e, path))?;
    // Un carattere UTF-8 tagliato a metà alla fine viene scartato.
    let mut end = buf.len();
    while end > 0 && end > buf.len().saturating_sub(4) && std::str::from_utf8(&buf[..end]).is_err() {
        end -= 1;
    }
    let slice = if std::str::from_utf8(&buf[..end]).is_ok() { &buf[..end] } else { &buf[..] };
    Ok(decode_text(slice).0)
}

/// Divide "nome.ext" in ("nome", Some("ext")).
fn split_name(name: &str) -> (&str, Option<&str>) {
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    (stem, p.extension().and_then(|e| e.to_str()))
}

/// Un percorso libero nella cartella: "nome.ext", poi "nome (2).ext", "nome (3).ext"…
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    crate::vault::unique_path(dir, name)
}

/// Copia un file accanto a sé con un suffisso, senza mai sovrascrivere:
/// "Saggio.pdf" → "Saggio (originale).pdf".
pub fn copy_beside(src: &Path, suffix: &str) -> Result<PathBuf, String> {
    let dir = src.parent().ok_or(tr("Percorso senza cartella."))?;
    let name = src.file_name().and_then(|n| n.to_str()).ok_or(tr("Nome di file non valido."))?;
    let (stem, ext) = split_name(name);
    let target_name = match ext {
        Some(e) => format!("{stem} ({suffix}).{e}"),
        None => format!("{stem} ({suffix})"),
    };
    let target = free_path(dir, &target_name);
    std::fs::copy(src, &target).map_err(|e| io_msg(&e, src))?;
    Ok(target)
}

/// Rinomina un file nella sua cartella. Rifiuta nomi che escono dalla cartella o già usati.
pub fn rename_in_place(src: &Path, new_name: &str) -> Result<PathBuf, String> {
    let clean = new_name.trim();
    if clean.is_empty() || clean.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) || clean == "." || clean == ".." {
        return Err(tr("Nome non valido: non può contenere / \\ : * ? \" < > |").into());
    }
    let dir = src.parent().ok_or(tr("Percorso senza cartella."))?;
    let target = dir.join(clean);
    if target == src {
        return Ok(target);
    }
    // Su Windows "a.md" e "A.md" sono lo stesso file: si rinomina passando da un nome temporaneo.
    let same_ignoring_case = target.to_string_lossy().to_lowercase() == src.to_string_lossy().to_lowercase();
    if target.exists() && !same_ignoring_case {
        return Err(trf("Esiste già un file chiamato «{0}» in questa cartella.", &[&clean]));
    }
    if same_ignoring_case {
        let tmp = dir.join(format!(".wrambi-rinomina-{}", std::process::id()));
        std::fs::rename(src, &tmp).map_err(|e| io_msg(&e, src))?;
        std::fs::rename(&tmp, &target).map_err(|e| io_msg(&e, &target))?;
    } else {
        std::fs::rename(src, &target).map_err(|e| io_msg(&e, src))?;
    }
    Ok(target)
}

/// Cache delle anteprime della biblioteca (immagini PNG nella cartella dati).
pub fn thumb_path(store_dir: &Path, key: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    store_dir.join("thumbs").join(format!("{:016x}.png", h.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn riconosce_le_codifiche() {
        assert_eq!(decode_text("città".as_bytes()), ("città".into(), "utf-8"));
        assert_eq!(decode_text(&[0xEF, 0xBB, 0xBF, b'a']), ("a".into(), "utf-8-bom"));
        assert_eq!(decode_text(&[0xFF, 0xFE, b'a', 0, 0xE0, 0]), ("aà".into(), "utf-16le"));
        // "perché" in Windows-1252 e le virgolette curve 0x93/0x94
        assert_eq!(decode_text(&[b'p', b'e', b'r', b'c', b'h', 0xE9, b' ', 0x93, b'x', 0x94]), ("perché “x”".into(), "windows-1252"));
    }

    #[test]
    fn scrittura_atomica_e_bom() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        write_text(&p, "ciao", true).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), [0xEF, 0xBB, 0xBF, b'c', b'i', b'a', b'o']);
        write_text(&p, "nuovo", false).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "nuovo");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "nessun file temporaneo deve restare");
    }

    #[test]
    fn archivio_interno() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(store.load("notes").unwrap(), None);
        store.save("notes", "[1,2]").unwrap();
        assert_eq!(store.load("notes").unwrap().as_deref(), Some("[1,2]"));
        assert!(store.save("notes", "non json").is_err());
        assert!(store.load("../segreti").is_err());
        store.save_draft("abc-123", "bozza").unwrap();
        assert_eq!(store.load_draft("abc-123").unwrap().as_deref(), Some("bozza"));
        assert_eq!(store.list_drafts().len(), 1);
        assert!(store.save_draft("../x", "no").is_err());
        store.delete_draft("abc-123").unwrap();
        assert_eq!(store.load_draft("abc-123").unwrap(), None);
    }

    #[test]
    fn inizio_di_un_file_senza_caratteri_spezzati() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        std::fs::write(&p, "perché sì").unwrap();
        // "perch" + i primi byte di "é" (2 byte): il carattere spezzato viene tolto.
        assert_eq!(read_text_head(&p, 6).unwrap(), "perch");
        assert_eq!(read_text_head(&p, 100).unwrap(), "perché sì");
    }

    #[test]
    fn copia_accanto_senza_sovrascrivere() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Saggio.pdf");
        std::fs::write(&p, b"uno").unwrap();
        let c1 = copy_beside(&p, "originale").unwrap();
        assert!(c1.ends_with("Saggio (originale).pdf"));
        let c2 = copy_beside(&p, "originale").unwrap();
        assert!(c2.ends_with("Saggio (originale) (2).pdf"));
        assert_eq!(std::fs::read(&c1).unwrap(), b"uno");
        assert_eq!(free_path(dir.path(), "Saggio_modificato.pdf"), dir.path().join("Saggio_modificato.pdf"));
    }

    #[test]
    fn rinomina() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("vecchio.md");
        std::fs::write(&p, "x").unwrap();
        std::fs::write(dir.path().join("occupato.md"), "y").unwrap();
        assert!(rename_in_place(&p, "occupato.md").is_err());
        assert!(rename_in_place(&p, "../fuori.md").is_err());
        let n = rename_in_place(&p, "nuovo.md").unwrap();
        assert!(n.ends_with("nuovo.md") && n.exists() && !p.exists());
        let n2 = rename_in_place(&n, "Nuovo.md").unwrap();
        assert!(n2.ends_with("Nuovo.md") && n2.exists());
    }
}
