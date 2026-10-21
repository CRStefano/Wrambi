//! Wrambi — applicazione desktop per scrittura concentrata, biblioteca di
//! documenti e note collegate al testo.

pub mod commands;
pub mod files;
pub mod i18n;
pub mod library;
pub mod typeset;
pub mod vault;
pub mod window;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Si ricordano dimensione, posizione e ingrandimento; lo schermo intero
        // e la cornice no: si scelgono ogni volta (F11) e nelle Impostazioni.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = files::Store::new(dir)?;
            app.manage(store);
            // Rete di sicurezza: se l'interfaccia non si mostra da sola, la finestra appare comunque.
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window::fit_to_monitor(&window);
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::store_load,
            commands::store_save,
            commands::draft_save,
            commands::draft_load,
            commands::draft_delete,
            commands::draft_list,
            commands::read_text_file,
            commands::write_text_file,
            commands::read_binary_file,
            commands::write_binary_file,
            commands::file_info,
            commands::library_scan,
            commands::typst_compile,
            commands::typst_export_pdf,
            commands::vault_export,
            commands::vault_import,
            commands::open_notification_settings,
            commands::ensure_dir,
            commands::read_text_head,
            commands::free_path,
            commands::copy_beside,
            commands::rename_file,
            commands::thumb_load,
            commands::thumb_save,
            commands::prepare_window,
            commands::set_window_frame,
            commands::set_language,
        ])
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Wrambi");
}
