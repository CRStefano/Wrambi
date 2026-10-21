//! La finestra principale: cornice di Windows o integrata, e posizione sempre
//! dentro lo schermo (anche su portatili piccoli o con il ridimensionamento
//! di Windows al 125–150%).

use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// Rettangolo in pixel fisici.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Quota massima dell'area di lavoro occupata dalla finestra alla partenza.
const MAX_W: f64 = 0.94;
const MAX_H: f64 = 0.92;

/// Se la finestra è più grande dell'area di lavoro (lo schermo senza la barra
/// delle applicazioni) o ne esce, restituisce posizione e dimensione corrette.
pub fn fit(area: Rect, window: Rect) -> Option<Rect> {
    let max_w = ((area.w as f64) * MAX_W) as u32;
    let max_h = ((area.h as f64) * MAX_H) as u32;
    let w = window.w.min(max_w.max(1));
    let h = window.h.min(max_h.max(1));
    let resized = w != window.w || h != window.h;

    let right = area.x + area.w as i32;
    let bottom = area.y + area.h as i32;
    // La barra del titolo deve restare raggiungibile, e la finestra dentro lo schermo.
    let outside = window.y < area.y
        || window.x < area.x - 8
        || window.x + w as i32 > right + 8
        || window.y + h as i32 > bottom + 8;

    if !resized && !outside {
        return None;
    }
    Some(Rect {
        x: area.x + (area.w as i32 - w as i32) / 2,
        y: area.y + (area.h as i32 - h as i32) / 2,
        w,
        h,
    })
}

/// Adatta la finestra allo schermo in cui si trova (se non è ingrandita).
pub fn fit_to_monitor<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }
    let monitor = match window.current_monitor()? {
        Some(m) => m,
        None => match window.primary_monitor()? {
            Some(m) => m,
            None => return Ok(()),
        },
    };
    let wa = monitor.work_area();
    let area = Rect { x: wa.position.x, y: wa.position.y, w: wa.size.width, h: wa.size.height };
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let pos = window.outer_position()?;
    // Alcuni sistemi (Linux senza gestore delle finestre) riportano una cornice
    // più piccola del contenuto: si prende la misura maggiore.
    let current = Rect { x: pos.x, y: pos.y, w: outer.width.max(inner.width), h: outer.height.max(inner.height) };
    if let Some(r) = fit(area, current) {
        // La dimensione si imposta sull'interno: si toglie lo spessore della cornice.
        let dw = current.w.saturating_sub(inner.width);
        let dh = current.h.saturating_sub(inner.height);
        window.set_size(PhysicalSize::new(r.w.saturating_sub(dw).max(1), r.h.saturating_sub(dh).max(1)))?;
        window.set_position(PhysicalPosition::new(r.x, r.y))?;
    }
    Ok(())
}

/// Prepara la finestra prima di mostrarla: cornice scelta e posizione nello schermo.
pub fn prepare<R: Runtime>(window: &WebviewWindow<R>, native_frame: bool) -> tauri::Result<()> {
    if window.is_decorated()? != native_frame {
        window.set_decorations(native_frame)?;
    }
    fit_to_monitor(window)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP_125: Rect = Rect { x: 0, y: 0, w: 1920, h: 1020 }; // 1920×1080 meno la barra delle applicazioni

    #[test]
    fn finestra_che_sta_nello_schermo_non_si_tocca() {
        assert_eq!(fit(LAPTOP_125, Rect { x: 200, y: 80, w: 1400, h: 860 }), None);
    }

    #[test]
    fn finestra_troppo_alta_si_riduce_e_si_centra() {
        // 1280×860 logici al 150% = 1920×1290 fisici: più alta dello schermo.
        let r = fit(LAPTOP_125, Rect { x: 0, y: -135, w: 1920, h: 1290 }).unwrap();
        assert!(r.h <= (1020.0 * MAX_H) as u32 && r.w <= (1920.0 * MAX_W) as u32);
        assert!(r.y >= 0 && r.y + r.h as i32 <= 1020);
        assert!(r.x >= 0 && r.x + r.w as i32 <= 1920);
    }

    #[test]
    fn barra_del_titolo_fuori_dallo_schermo_torna_visibile() {
        let r = fit(LAPTOP_125, Rect { x: 300, y: -20, w: 1200, h: 800 }).unwrap();
        assert_eq!((r.w, r.h), (1200, 800));
        assert!(r.y >= 0);
    }

    #[test]
    fn secondo_schermo_a_destra() {
        let area = Rect { x: 1920, y: 0, w: 2560, h: 1400 };
        assert_eq!(fit(area, Rect { x: 2200, y: 100, w: 1600, h: 1000 }), None);
        let r = fit(area, Rect { x: 4300, y: 100, w: 1600, h: 1000 }).unwrap();
        assert!(r.x >= 1920 && r.x + r.w as i32 <= 1920 + 2560);
    }
}
