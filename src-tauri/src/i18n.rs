//! Messaggi del nucleo nella lingua dell'interfaccia (italiano, inglese, francese).
//!
//! La chiave è la frase italiana; `{0}`, `{1}`… sono i segnaposto riempiti da [`trf`].
//! Il test in fondo verifica che ogni frase usata nel codice sia nella tabella.

use std::fmt::Display;
use std::sync::atomic::{AtomicU8, Ordering};

static LANG: AtomicU8 = AtomicU8::new(0);

/// Imposta la lingua: "it", "en" o "fr" (altro: italiano).
pub fn set_language(code: &str) {
    let v = match code {
        "en" => 1,
        "fr" => 2,
        _ => 0,
    };
    LANG.store(v, Ordering::Relaxed);
}

/// Traduce una frase italiana.
pub fn tr(it: &'static str) -> &'static str {
    lookup(LANG.load(Ordering::Relaxed), it)
}

fn lookup(lang: u8, it: &'static str) -> &'static str {
    if lang == 0 {
        return it;
    }
    TABLE
        .iter()
        .find(|(k, _, _)| *k == it)
        .map(|(_, en, fr)| if lang == 1 { *en } else { *fr })
        .unwrap_or(it)
}

/// Traduce una frase con segnaposto `{0}`, `{1}`…
pub fn trf(it: &'static str, args: &[&dyn Display]) -> String {
    fill(tr(it), args)
}

fn fill(template: &str, args: &[&dyn Display]) -> String {
    let mut s = template.to_string();
    for (i, a) in args.iter().enumerate() {
        s = s.replace(&format!("{{{i}}}"), &a.to_string());
    }
    s
}

const TABLE: &[(&str, &str, &str)] = &[
    ("Operazione interrotta: {0}", "Operation interrupted: {0}", "Opération interrompue : {0}"),
    ("Dati non validi: {0}", "Invalid data: {0}", "Données non valides : {0}"),
    (
        "Apri le impostazioni delle notifiche dal pannello del sistema.",
        "Open the notification settings from your system settings.",
        "Ouvrez les réglages des notifications depuis les paramètres du système.",
    ),
    (
        "Il file è troppo grande per l'editor ({0} MB, limite {1} MB).",
        "The file is too large for the editor ({0} MB, limit {1} MB).",
        "Le fichier est trop volumineux pour l'éditeur ({0} Mo, limite {1} Mo).",
    ),
    ("La cartella {0} non esiste più.", "The folder {0} no longer exists.", "Le dossier {0} n'existe plus."),
    ("non trovato", "not found", "introuvable"),
    ("accesso negato", "access denied", "accès refusé"),
    ("Archivio sconosciuto: {0}", "Unknown store: {0}", "Archive inconnue : {0}"),
    ("JSON non valido: {0}", "Invalid JSON: {0}", "JSON non valide : {0}"),
    ("Identificativo di bozza non valido.", "Invalid draft identifier.", "Identifiant de brouillon non valide."),
    ("Percorso senza cartella.", "The path has no folder.", "Le chemin n'a pas de dossier."),
    ("Nome di file non valido.", "Invalid file name.", "Nom de fichier non valide."),
    (
        "Nome non valido: non può contenere / \\ : * ? \" < > |",
        "Invalid name: it cannot contain / \\ : * ? \" < > |",
        "Nom non valide : il ne peut pas contenir / \\ : * ? \" < > |",
    ),
    (
        "Esiste già un file chiamato «{0}» in questa cartella.",
        "A file called “{0}” already exists in this folder.",
        "Un fichier nommé « {0} » existe déjà dans ce dossier.",
    ),
    ("non è una cartella", "not a folder", "n'est pas un dossier"),
    (
        "i pacchetti Typst (@preview/…) richiedono Internet e non sono supportati da Wrambi",
        "Typst packages (@preview/…) need the Internet and are not supported by Wrambi",
        "les paquets Typst (@preview/…) nécessitent Internet et ne sont pas pris en charge par Wrambi",
    ),
    (
        "salva il documento per includere altri file dalla sua cartella",
        "save the document to include other files from its folder",
        "enregistrez le document pour inclure d'autres fichiers de son dossier",
    ),
    (
        "La password deve avere almeno {0} caratteri.",
        "The password must be at least {0} characters long.",
        "Le mot de passe doit comporter au moins {0} caractères.",
    ),
    ("Il file non è un vault di Wrambi.", "The file is not a Wrambi vault.", "Le fichier n'est pas un coffre Wrambi."),
    (
        "Questo vault è stato creato da una versione più recente di Wrambi.",
        "This vault was created by a newer version of Wrambi.",
        "Ce coffre a été créé par une version plus récente de Wrambi.",
    ),
    (
        "Password errata, oppure il file è danneggiato.",
        "Wrong password, or the file is damaged.",
        "Mot de passe incorrect, ou fichier endommagé.",
    ),
    ("Contenuto del vault non valido: {0}", "Invalid vault content: {0}", "Contenu du coffre non valide : {0}"),
    ("Impossibile leggere {0}: {1}", "Cannot read {0}: {1}", "Impossible de lire {0} : {1}"),
    ("Errore di scrittura: {0}", "Write error: {0}", "Erreur d'écriture : {0}"),
    ("Errore di cifratura: {0}", "Encryption error: {0}", "Erreur de chiffrement : {0}"),
    ("cifratura non riuscita", "encryption failed", "échec du chiffrement"),
    ("manca manifest.json", "manifest.json is missing", "manifest.json est manquant"),
    ("manca {0}", "{0} is missing", "{0} est manquant"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traduce_e_riempie_i_segnaposto() {
        // Senza toccare la lingua globale: gli altri test girano in parallelo.
        assert_eq!(fill(lookup(1, "La cartella {0} non esiste più."), &[&"C:/x"]), "The folder C:/x no longer exists.");
        assert_eq!(lookup(2, "accesso negato"), "accès refusé");
        assert_eq!(lookup(0, "accesso negato"), "accesso negato");
        assert_eq!(lookup(1, "frase che non c'è"), "frase che non c'è");
    }

    #[test]
    fn ogni_frase_usata_ha_la_traduzione() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let re_call = ["tr(\"", "trf(\""];
        let mut missing = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().unwrap() == "i18n.rs" {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            for pat in re_call {
                let mut rest = src.as_str();
                while let Some(i) = rest.find(pat) {
                    let after = &rest[i + pat.len()..];
                    // Fine della stringa: la prima " non preceduta da \.
                    let mut end = 0;
                    let bytes = after.as_bytes();
                    while end < bytes.len() && !(bytes[end] == b'"' && (end == 0 || bytes[end - 1] != b'\\')) {
                        end += 1;
                    }
                    let lit = after[..end].replace("\\\"", "\"").replace("\\\\", "\\");
                    if !TABLE.iter().any(|(k, _, _)| *k == lit) {
                        missing.push(lit);
                    }
                    rest = &after[end..];
                }
            }
        }
        assert!(missing.is_empty(), "frasi senza traduzione: {missing:?}");
    }
}
