//! Comandi chiamati dall'interfaccia.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::State;

use crate::files::{self, Store, TextFile};
use crate::i18n::{tr, trf};
use crate::library::{self, ScanResult};
use crate::typeset::{self, Diagnostic};
use crate::vault::{self, KdfParams, VaultData, VaultExportSummary, VaultFileIn, VaultImport};

type CmdResult<T> = Result<T, String>;

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

async fn blocking<T, F>(f: F) -> CmdResult<T>
where
    F: FnOnce() -> CmdResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| trf("Operazione interrotta: {0}", &[&e]))?
}

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    data_dir: String,
    platform: String,
}

#[tauri::command]
pub fn app_info(store: State<'_, Store>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: store.dir.display().to_string(),
        platform: std::env::consts::OS.into(),
    }
}

#[tauri::command]
pub fn store_load(store: State<'_, Store>, name: String) -> CmdResult<Option<String>> {
    store.load(&name)
}

#[tauri::command]
pub fn store_save(store: State<'_, Store>, name: String, json: String) -> CmdResult<()> {
    store.save(&name, &json)
}

#[tauri::command]
pub fn draft_save(store: State<'_, Store>, id: String, text: String) -> CmdResult<()> {
    store.save_draft(&id, &text)
}

#[tauri::command]
pub fn draft_load(store: State<'_, Store>, id: String) -> CmdResult<Option<String>> {
    store.load_draft(&id)
}

#[tauri::command]
pub fn draft_delete(store: State<'_, Store>, id: String) -> CmdResult<()> {
    store.delete_draft(&id)
}

#[derive(Serialize)]
pub struct DraftInfo {
    id: String,
    modified_ms: u64,
}

#[tauri::command]
pub fn draft_list(store: State<'_, Store>) -> Vec<DraftInfo> {
    store.list_drafts().into_iter().map(|(id, modified_ms)| DraftInfo { id, modified_ms }).collect()
}

#[tauri::command]
pub async fn read_text_file(path: String) -> CmdResult<TextFile> {
    blocking(move || files::read_text(Path::new(&path))).await
}

#[tauri::command]
pub async fn write_text_file(path: String, text: String, bom: Option<bool>) -> CmdResult<u64> {
    blocking(move || files::write_text(Path::new(&path), &text, bom.unwrap_or(false))).await
}

/// Restituisce i byte grezzi (senza passare per JSON): usato per PDF ed EPUB.
#[tauri::command]
pub async fn read_binary_file(path: String) -> CmdResult<Response> {
    let bytes = blocking(move || {
        let p = PathBuf::from(&path);
        std::fs::read(&p).map_err(|e| files::io_msg(&e, &p))
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn write_binary_file(path: String, base64: String) -> CmdResult<()> {
    blocking(move || {
        let bytes = b64().decode(base64.as_bytes()).map_err(|e| trf("Dati non validi: {0}", &[&e]))?;
        files::write_bytes(Path::new(&path), &bytes)
    })
    .await
}

#[derive(Serialize)]
pub struct FileInfo {
    exists: bool,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn file_info(path: String) -> FileInfo {
    match std::fs::metadata(&path) {
        Ok(m) => FileInfo {
            exists: true,
            is_dir: m.is_dir(),
            size: m.len(),
            modified_ms: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        },
        Err(_) => FileInfo { exists: false, is_dir: false, size: 0, modified_ms: 0 },
    }
}

#[tauri::command]
pub async fn library_scan(root: String) -> CmdResult<ScanResult> {
    blocking(move || {
        let p = PathBuf::from(&root);
        library::scan(&p).map_err(|e| files::io_msg(&e, &p))
    })
    .await
}

#[derive(Serialize)]
pub struct TypstPreview {
    /// PDF codificato in base64, assente in caso di errore.
    pdf: Option<String>,
    pages: usize,
    diagnostics: Vec<Diagnostic>,
}

#[tauri::command]
pub async fn typst_compile(
    text: String,
    root: Option<String>,
    system_fonts: Option<bool>,
    bib: Option<String>,
) -> CmdResult<TypstPreview> {
    blocking(move || {
        let out = typeset::compile_pdf(
            &text,
            root.as_deref().map(Path::new),
            system_fonts.unwrap_or(false),
            bib.as_deref(),
        );
        Ok(TypstPreview {
            pdf: out.pdf.map(|b| b64().encode(b)),
            pages: out.pages,
            diagnostics: out.diagnostics,
        })
    })
    .await
}

#[derive(Serialize)]
pub struct TypstExport {
    ok: bool,
    pages: usize,
    diagnostics: Vec<Diagnostic>,
}

#[tauri::command]
pub async fn typst_export_pdf(
    text: String,
    root: Option<String>,
    dest: String,
    system_fonts: Option<bool>,
    bib: Option<String>,
) -> CmdResult<TypstExport> {
    blocking(move || {
        let out = typeset::compile_pdf(
            &text,
            root.as_deref().map(Path::new),
            system_fonts.unwrap_or(false),
            bib.as_deref(),
        );
        match out.pdf {
            Some(pdf) => {
                files::write_bytes(Path::new(&dest), &pdf)?;
                Ok(TypstExport { ok: true, pages: out.pages, diagnostics: out.diagnostics })
            }
            None => Ok(TypstExport { ok: false, pages: 0, diagnostics: out.diagnostics }),
        }
    })
    .await
}

#[tauri::command]
pub async fn vault_export(
    dest: String,
    password: String,
    data: VaultData,
    files: Vec<VaultFileIn>,
) -> CmdResult<VaultExportSummary> {
    blocking(move || {
        vault::export(Path::new(&dest), &password, &data, &files, KdfParams::default()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn vault_import(src: String, password: String, restore_dir: Option<String>) -> CmdResult<VaultImport> {
    blocking(move || {
        vault::import(Path::new(&src), &password, restore_dir.as_deref().map(Path::new)).map_err(|e| e.to_string())
    })
    .await
}

/// Apre le impostazioni delle notifiche del sistema: Wrambi non può
/// (e non deve) cambiarle da solo.
#[tauri::command]
pub fn open_notification_settings() -> CmdResult<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:notifications"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.notifications")
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // GNOME e KDE hanno pannelli diversi: si prova il primo disponibile.
        let tries: [(&str, &[&str]); 3] = [
            ("gnome-control-center", &["notifications"]),
            ("systemsettings", &["kcm_notifications"]),
            ("xfce4-notifyd-config", &[]),
        ];
        for (cmd, args) in tries {
            if std::process::Command::new(cmd).args(args).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(tr("Apri le impostazioni delle notifiche dal pannello del sistema.").into())
    }
}

/// Crea una cartella (per esempio la biblioteca dedicata in Documenti).
#[tauri::command]
pub fn ensure_dir(path: String) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    std::fs::create_dir_all(&p).map_err(|e| files::io_msg(&e, &p))
}

/// Inizio di un file di testo, per le anteprime.
#[tauri::command]
pub async fn read_text_head(path: String, max: Option<usize>) -> CmdResult<String> {
    blocking(move || files::read_text_head(Path::new(&path), max.unwrap_or(4096).min(64 * 1024))).await
}

/// Percorso libero in una cartella (aggiunge " (2)", " (3)"… se il nome è già usato).
#[tauri::command]
pub fn free_path(dir: String, name: String) -> String {
    files::free_path(Path::new(&dir), &name).display().to_string()
}

/// Copia di sicurezza accanto al file: "nome (suffisso).ext".
#[tauri::command]
pub async fn copy_beside(path: String, suffix: String) -> CmdResult<String> {
    blocking(move || files::copy_beside(Path::new(&path), &suffix).map(|p| p.display().to_string())).await
}

#[tauri::command]
pub async fn rename_file(path: String, new_name: String) -> CmdResult<String> {
    blocking(move || files::rename_in_place(Path::new(&path), &new_name).map(|p| p.display().to_string())).await
}

/// Anteprima salvata (PNG), se esiste.
#[tauri::command]
pub async fn thumb_load(store: State<'_, Store>, key: String) -> CmdResult<Response> {
    let path = files::thumb_path(&store.dir, &key);
    let bytes = blocking(move || Ok(std::fs::read(&path).unwrap_or_default())).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn thumb_save(store: State<'_, Store>, key: String, base64: String) -> CmdResult<()> {
    let path = files::thumb_path(&store.dir, &key);
    blocking(move || {
        let bytes = b64().decode(base64.as_bytes()).map_err(|e| trf("Dati non validi: {0}", &[&e]))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| files::io_msg(&e, parent))?;
        }
        files::write_bytes(&path, &bytes)
    })
    .await
}

/* ───────────────────────────── Finestra ───────────────────────────── */

/// Prima di mostrare la finestra: cornice di Windows o integrata, e finestra
/// dentro lo schermo.
#[tauri::command]
pub fn prepare_window(window: tauri::WebviewWindow, native_frame: bool) -> CmdResult<()> {
    crate::window::prepare(&window, native_frame).map_err(|e| e.to_string())
}

/// Cambia la cornice della finestra (dalle Impostazioni).
#[tauri::command]
pub fn set_window_frame(window: tauri::WebviewWindow, native_frame: bool) -> CmdResult<()> {
    window.set_decorations(native_frame).map_err(|e| e.to_string())
}

/// Lingua dei messaggi del nucleo (la stessa dell'interfaccia).
#[tauri::command]
pub fn set_language(lang: String) {
    crate::i18n::set_language(&lang);
}
