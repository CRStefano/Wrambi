//! Vault cifrato di Wrambi: un unico file, protetto da password, apribile
//! offline su qualunque dispositivo.
//!
//! Formato del file `.wrambi` (versione 1):
//!
//! ```text
//! "WRMBVLT1" (8 byte)  versione (1 byte)
//! m_cost u32 LE  t_cost u32 LE  p_cost u32 LE     parametri Argon2id
//! salt (16 byte)  nonce (24 byte)
//! testo cifrato = XChaCha20-Poly1305(chiave, nonce, archivio zip, AAD = intestazione)
//! ```
//!
//! La chiave (256 bit) deriva dalla password con Argon2id. L'intestazione è
//! autenticata: modificarla rende il file illeggibile. Senza password il
//! contenuto non è recuperabile in alcun modo.

use crate::i18n::{tr, trf};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;

const MAGIC: &[u8; 8] = b"WRMBVLT1";
const FORMAT_VERSION: u8 = 1;
const HEADER_LEN: usize = 8 + 1 + 12 + 16 + 24;
const MIN_PASSWORD_CHARS: usize = 8;

#[derive(Debug)]
pub enum VaultError {
    WeakPassword,
    NotAVault,
    UnsupportedVersion,
    Decrypt,
    Corrupt(String),
    ReadFile { path: String, source: std::io::Error },
    Io(std::io::Error),
    Crypto(String),
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::WeakPassword => trf("La password deve avere almeno {0} caratteri.", &[&MIN_PASSWORD_CHARS]),
            Self::NotAVault => tr("Il file non è un vault di Wrambi.").into(),
            Self::UnsupportedVersion => tr("Questo vault è stato creato da una versione più recente di Wrambi.").into(),
            Self::Decrypt => tr("Password errata, oppure il file è danneggiato.").into(),
            Self::Corrupt(m) => trf("Contenuto del vault non valido: {0}", &[m]),
            Self::ReadFile { path, source } => trf("Impossibile leggere {0}: {1}", &[path, source]),
            Self::Io(e) => trf("Errore di scrittura: {0}", &[e]),
            Self::Crypto(m) => trf("Errore di cifratura: {0}", &[m]),
        };
        f.write_str(&s)
    }
}

impl std::error::Error for VaultError {}

impl From<std::io::Error> for VaultError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Parametri Argon2id. I valori predefiniti richiedono 64 MiB e circa
/// mezzo secondo su un portatile: abbastanza da rallentare chi tenta di
/// indovinare la password, senza pesare su chi la conosce.
#[derive(Debug, Clone, Copy)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self { m_cost_kib: 64 * 1024, t_cost: 3, p_cost: 1 }
    }
}

/// Dati di Wrambi salvati nel vault, in forma di testo JSON.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct VaultData {
    pub settings: Option<String>,
    pub library: Option<String>,
    pub notes: Option<String>,
}

/// Un documento da includere: o un file sul disco (`path`) o un testo
/// in memoria (`text`, usato per le bozze).
#[derive(Debug, Clone, Deserialize)]
pub struct VaultFileIn {
    pub key: String,
    pub name: String,
    pub path: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    pub key: String,
    pub name: String,
    pub original_path: Option<String>,
    pub entry: String,
    pub is_text: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub created: String,
    pub app_version: String,
    pub files: Vec<ManifestFile>,
}

/// Un documento estratto dal vault.
#[derive(Debug, Clone, Serialize)]
pub struct RestoredFile {
    pub key: String,
    pub name: String,
    pub original_path: Option<String>,
    /// Percorso in cui il file è stato ripristinato (documenti su disco).
    pub new_path: Option<String>,
    /// Contenuto delle bozze, che tornano tra le bozze di Wrambi.
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultImport {
    pub created: String,
    pub data: VaultData,
    pub restored: Vec<RestoredFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultExportSummary {
    pub files: usize,
    pub bytes: u64,
}

fn derive_key(password: &str, salt: &[u8], params: KdfParams) -> Result<[u8; 32], VaultError> {
    let p = Params::new(params.m_cost_kib, params.t_cost, params.p_cost, Some(32))
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, p);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    Ok(key)
}

/// Cifra un contenuto arbitrario nel formato del vault.
pub fn seal(plain: &[u8], password: &str, params: KdfParams) -> Result<Vec<u8>, VaultError> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(VaultError::WeakPassword);
    }
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(FORMAT_VERSION);
    header.extend_from_slice(&params.m_cost_kib.to_le_bytes());
    header.extend_from_slice(&params.t_cost.to_le_bytes());
    header.extend_from_slice(&params.p_cost.to_le_bytes());
    header.extend_from_slice(&salt);
    header.extend_from_slice(&nonce);

    let key = derive_key(password, &salt, params)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plain, aad: &header })
        .map_err(|_| VaultError::Crypto(tr("cifratura non riuscita").into()))?;

    let mut out = header;
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decifra un contenuto nel formato del vault.
pub fn open(sealed: &[u8], password: &str) -> Result<Vec<u8>, VaultError> {
    if sealed.len() < HEADER_LEN + 16 || &sealed[..8] != MAGIC {
        return Err(VaultError::NotAVault);
    }
    if sealed[8] != FORMAT_VERSION {
        return Err(VaultError::UnsupportedVersion);
    }
    let u32_at = |i: usize| u32::from_le_bytes(sealed[i..i + 4].try_into().unwrap());
    let params = KdfParams { m_cost_kib: u32_at(9), t_cost: u32_at(13), p_cost: u32_at(17) };
    // Limiti di sicurezza: un file manipolato non deve poter esaurire la memoria.
    if params.m_cost_kib > 1024 * 1024 || params.t_cost > 64 || params.p_cost > 16 {
        return Err(VaultError::NotAVault);
    }
    let salt = &sealed[21..37];
    let nonce = &sealed[37..61];
    let header = &sealed[..HEADER_LEN];
    let key = derive_key(password, salt, params)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: &sealed[HEADER_LEN..], aad: header })
        .map_err(|_| VaultError::Decrypt)
}

fn safe_entry_name(index: usize, name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c == ' ');
    let cleaned = if cleaned.is_empty() { "documento" } else { cleaned };
    format!("files/{index:04}-{cleaned}")
}

/// Costruisce l'archivio interno (non cifrato) del vault.
pub fn build_archive(data: &VaultData, files: &[VaultFileIn], created: &str) -> Result<Vec<u8>, VaultError> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let zerr = |e: zip::result::ZipError| VaultError::Corrupt(e.to_string());

    let mut manifest_files = Vec::new();
    for (i, f) in files.iter().enumerate() {
        let entry = safe_entry_name(i, &f.name);
        let (bytes, is_text) = match (&f.text, &f.path) {
            (Some(text), _) => (text.as_bytes().to_vec(), true),
            (None, Some(path)) => {
                let bytes = std::fs::read(path)
                    .map_err(|source| VaultError::ReadFile { path: path.clone(), source })?;
                (bytes, false)
            }
            (None, None) => continue,
        };
        zip.start_file(entry.as_str(), opts).map_err(zerr)?;
        zip.write_all(&bytes)?;
        manifest_files.push(ManifestFile {
            key: f.key.clone(),
            name: f.name.clone(),
            original_path: f.path.clone(),
            entry,
            is_text,
            size: bytes.len() as u64,
        });
    }

    for (name, value) in [
        ("data/settings.json", &data.settings),
        ("data/library.json", &data.library),
        ("data/notes.json", &data.notes),
    ] {
        if let Some(v) = value {
            zip.start_file(name, opts).map_err(zerr)?;
            zip.write_all(v.as_bytes())?;
        }
    }

    let manifest = Manifest {
        format: "wrambi-vault".into(),
        version: 1,
        created: created.into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        files: manifest_files,
    };
    zip.start_file("manifest.json", opts).map_err(zerr)?;
    zip.write_all(serde_json::to_string_pretty(&manifest).unwrap().as_bytes())?;
    Ok(zip.finish().map_err(zerr)?.into_inner())
}

/// Scrive un file solo se è completo: prima un file temporaneo, poi la rinomina.
pub fn write_atomic(dest: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = dest.with_extension(format!(
        "{}.tmp-wrambi",
        dest.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, dest).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

pub fn export(
    dest: &Path,
    password: &str,
    data: &VaultData,
    files: &[VaultFileIn],
    params: KdfParams,
) -> Result<VaultExportSummary, VaultError> {
    let created = chrono::Local::now().to_rfc3339();
    let archive = build_archive(data, files, &created)?;
    let sealed = seal(&archive, password, params)?;
    write_atomic(dest, &sealed)?;
    Ok(VaultExportSummary { files: files.len(), bytes: sealed.len() as u64 })
}

/// Sceglie un nome libero nella cartella, senza mai sovrascrivere.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("documento");
    let ext = p.extension().and_then(|s| s.to_str());
    for n in 2.. {
        let file = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let c = dir.join(file);
        if !c.exists() {
            return c;
        }
    }
    unreachable!()
}

/// Dove ripristinare un documento. I documenti della biblioteca (`lib:`)
/// riprendono le loro sottocartelle, così stati di lettura e note restano
/// collegati se la cartella di ripristino diventa la nuova biblioteca.
/// Nessun percorso può uscire dalla cartella scelta.
pub fn restore_target(dir: &Path, key: &str, name: &str) -> PathBuf {
    let safe_segment = |s: &str| -> Option<String> {
        let t = s.trim();
        if t.is_empty() || t == "." || t == ".." || t.contains(['\\', ':', '<', '>', '"', '|', '?', '*']) {
            return None;
        }
        Some(t.trim_end_matches(['.', ' ']).to_string()).filter(|x| !x.is_empty())
    };
    if let Some(rel) = key.strip_prefix("lib:") {
        let parts: Vec<_> = rel.split('/').collect();
        if !parts.is_empty() {
            let mut folder = dir.to_path_buf();
            let mut ok = true;
            for seg in &parts[..parts.len().saturating_sub(1)] {
                match safe_segment(seg) {
                    Some(x) => folder.push(x),
                    None => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok {
                if let Some(file) = parts.last().and_then(|s| safe_segment(s)) {
                    let target = folder.join(&file);
                    return if target.exists() { unique_path(&folder, &file) } else { target };
                }
            }
        }
    }
    // Solo il nome del file: un vault non può scrivere fuori dalla cartella scelta.
    let file = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(safe_segment)
        .unwrap_or_else(|| "documento".into());
    unique_path(dir, &file)
}

fn read_entry(archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
    match archive.by_name(name) {
        Ok(mut f) => {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(VaultError::Corrupt(e.to_string())),
    }
}

/// Apre un vault e ripristina i documenti nella cartella indicata.
/// Le bozze non vengono scritte su disco: tornano come testo.
pub fn import(src: &Path, password: &str, restore_dir: Option<&Path>) -> Result<VaultImport, VaultError> {
    let sealed = std::fs::read(src)
        .map_err(|source| VaultError::ReadFile { path: src.display().to_string(), source })?;
    let plain = open(&sealed, password)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(plain)).map_err(|e| VaultError::Corrupt(e.to_string()))?;

    let manifest_bytes = read_entry(&mut archive, "manifest.json")?
        .ok_or_else(|| VaultError::Corrupt(tr("manca manifest.json").into()))?;
    let manifest: Manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|e| VaultError::Corrupt(e.to_string()))?;
    if manifest.format != "wrambi-vault" {
        return Err(VaultError::NotAVault);
    }

    let text_entry = |archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str| -> Result<Option<String>, VaultError> {
        Ok(read_entry(archive, name)?.map(|b| String::from_utf8_lossy(&b).into_owned()))
    };
    let data = VaultData {
        settings: text_entry(&mut archive, "data/settings.json")?,
        library: text_entry(&mut archive, "data/library.json")?,
        notes: text_entry(&mut archive, "data/notes.json")?,
    };

    if let Some(dir) = restore_dir {
        std::fs::create_dir_all(dir)?;
    }
    let mut restored = Vec::new();
    for f in &manifest.files {
        let bytes = read_entry(&mut archive, &f.entry)?
            .ok_or_else(|| VaultError::Corrupt(trf("manca {0}", &[&f.entry])))?;
        if f.key.starts_with("draft:") {
            restored.push(RestoredFile {
                key: f.key.clone(),
                name: f.name.clone(),
                original_path: f.original_path.clone(),
                new_path: None,
                text: Some(String::from_utf8_lossy(&bytes).into_owned()),
            });
            continue;
        }
        let new_path = match restore_dir {
            Some(dir) => {
                let target = restore_target(dir, &f.key, &f.name);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                write_atomic(&target, &bytes)?;
                Some(target.display().to_string())
            }
            None => None,
        };
        restored.push(RestoredFile {
            key: f.key.clone(),
            name: f.name.clone(),
            original_path: f.original_path.clone(),
            new_path,
            text: None,
        });
    }

    Ok(VaultImport { created: manifest.created, data, restored })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fast() -> KdfParams {
        KdfParams { m_cost_kib: 1024, t_cost: 1, p_cost: 1 }
    }

    #[test]
    fn cifra_e_decifra() {
        let sealed = seal(b"contenuto segreto", "password-lunga", fast()).unwrap();
        assert!(!sealed.windows(9).any(|w| w == b"contenuto"));
        assert_eq!(open(&sealed, "password-lunga").unwrap(), b"contenuto segreto");
    }

    #[test]
    fn password_errata_rifiutata() {
        let sealed = seal(b"x", "password-lunga", fast()).unwrap();
        assert!(matches!(open(&sealed, "password-sbagliata"), Err(VaultError::Decrypt)));
    }

    #[test]
    fn intestazione_manipolata_rifiutata() {
        let mut sealed = seal(b"x", "password-lunga", fast()).unwrap();
        sealed[25] ^= 1; // un byte del salt
        assert!(open(&sealed, "password-lunga").is_err());
    }

    #[test]
    fn password_troppo_corta() {
        assert!(matches!(seal(b"x", "corta", fast()), Err(VaultError::WeakPassword)));
    }

    #[test]
    fn file_non_vault() {
        assert!(matches!(open(b"ciao a tutti, questo non e' un vault di wrambi ...........", "password-lunga"), Err(VaultError::NotAVault)));
    }

    #[test]
    fn esporta_e_importa_su_un_altro_dispositivo() {
        let src = tempfile::tempdir().unwrap();
        let doc = src.path().join("Saggio.md");
        std::fs::write(&doc, "# Saggio\n\nTesto.").unwrap();
        let pdf = src.path().join("articolo.pdf");
        std::fs::write(&pdf, [0x25, 0x50, 0x44, 0x46, 0xff, 0x00]).unwrap();

        let data = VaultData {
            settings: Some("{\"theme\":\"dark\"}".into()),
            library: Some("{\"states\":{}}".into()),
            notes: Some("[{\"id\":\"n1\",\"text\":\"Nota\"}]".into()),
        };
        let files = vec![
            VaultFileIn { key: "file:Saggio".into(), name: "Saggio.md".into(), path: Some(doc.display().to_string()), text: None },
            VaultFileIn { key: "lib:articolo.pdf".into(), name: "articolo.pdf".into(), path: Some(pdf.display().to_string()), text: None },
            VaultFileIn { key: "draft:abc".into(), name: "Bozza.md".into(), path: None, text: Some("bozza".into()) },
        ];
        let vault = src.path().join("archivio.wrambi");
        let summary = export(&vault, "una password lunga", &data, &files, fast()).unwrap();
        assert_eq!(summary.files, 3);

        // "Altro dispositivo": una cartella diversa, con un file omonimo già presente.
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(dest.path().join("Saggio.md"), "esistente").unwrap();
        let imported = import(&vault, "una password lunga", Some(dest.path())).unwrap();
        assert_eq!(imported.data, data);
        assert_eq!(imported.restored.len(), 3);

        let saggio = imported.restored.iter().find(|r| r.key == "file:Saggio").unwrap();
        let new_path = PathBuf::from(saggio.new_path.as_ref().unwrap());
        assert!(new_path.ends_with("Saggio (2).md"), "non deve sovrascrivere: {new_path:?}");
        assert_eq!(std::fs::read_to_string(&new_path).unwrap(), "# Saggio\n\nTesto.");
        assert_eq!(std::fs::read_to_string(dest.path().join("Saggio.md")).unwrap(), "esistente");

        let pdf_back = imported.restored.iter().find(|r| r.key == "lib:articolo.pdf").unwrap();
        assert_eq!(std::fs::read(pdf_back.new_path.as_ref().unwrap()).unwrap(), [0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);

        let bozza = imported.restored.iter().find(|r| r.key == "draft:abc").unwrap();
        assert_eq!(bozza.text.as_deref(), Some("bozza"));
        assert!(bozza.new_path.is_none());

        assert!(matches!(import(&vault, "password sbagliata", Some(dest.path())), Err(VaultError::Decrypt)));
    }

    #[test]
    fn la_biblioteca_riprende_le_sottocartelle() {
        let dir = tempfile::tempdir().unwrap();
        let t = restore_target(dir.path(), "lib:Saggi/2026/Articolo.pdf", "Articolo.pdf");
        assert_eq!(t, dir.path().join("Saggi").join("2026").join("Articolo.pdf"));
        let evil = restore_target(dir.path(), "lib:../../Windows/x.dll", "x.dll");
        assert_eq!(evil.parent().unwrap(), dir.path());
        let abs = restore_target(dir.path(), "lib:C:/Windows/x.dll", "x.dll");
        assert_eq!(abs.parent().unwrap(), dir.path());
    }

    #[test]
    fn nomi_pericolosi_restano_nella_cartella() {
        let src = tempfile::tempdir().unwrap();
        let files = vec![VaultFileIn {
            key: "file:x".into(),
            name: "../../fuori.txt".into(),
            path: None,
            text: Some("ciao".into()),
        }];
        let vault = src.path().join("v.wrambi");
        export(&vault, "password-lunga", &VaultData::default(), &files, fast()).unwrap();
        let dest = tempfile::tempdir().unwrap();
        let imported = import(&vault, "password-lunga", Some(dest.path())).unwrap();
        let p = PathBuf::from(imported.restored[0].new_path.as_ref().unwrap());
        assert_eq!(p.parent().unwrap(), dest.path());
    }
}
