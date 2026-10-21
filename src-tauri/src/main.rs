// Nessuna finestra di console su Windows nella versione finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wrambi_lib::run()
}
