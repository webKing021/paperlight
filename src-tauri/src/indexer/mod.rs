//! Discovering documents on disk and keeping the index in sync.

pub mod drives;
pub mod filters;
pub mod scanner;

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{roots, Db};
use crate::error::AppResult;
use crate::state::AppState;

/// First run: watch every fixed drive and install the default exclusions.
pub fn seed_defaults(db: &Db) -> AppResult<()> {
    let mut conn = db.writer();
    if roots::get_setting(&conn, "seeded")?.is_some() {
        return Ok(());
    }
    for pattern in filters::DEFAULT_EXCLUSIONS {
        roots::add_exclusion(&conn, pattern)?;
    }
    for root in drives::default_roots() {
        // A failure here (e.g. overlapping roots) must not block startup.
        let _ = roots::add_root(&mut conn, &root);
    }
    roots::set_setting(&conn, "seeded", "1")?;
    Ok(())
}

/// Resets the `scanning` flag even if the scan thread panics.
struct ScanGuard<'a>(&'a AppState);

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.scanning.store(false, Ordering::SeqCst);
    }
}

/// Starts a full scan on a background thread. Returns `false` if one is already running.
pub fn spawn_scan(app: AppHandle) -> bool {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return false;
    }
    state.cancel.store(false, Ordering::SeqCst);

    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("paperlight-scan".into())
        .spawn(move || {
            let app = handle;
            let state = app.state::<AppState>();
            let _guard = ScanGuard(&state);
            let _ = app.emit("scan-started", ());
            let result = scanner::scan(&state.db, &state.cancel, |p| {
                let _ = app.emit("scan-progress", p);
            });
            drop(_guard);
            match result {
                Ok(summary) => {
                    let _ = app.emit("scan-finished", &summary);
                }
                Err(e) => {
                    let _ = app.emit("scan-error", e.to_string());
                }
            }
        });
    if spawned.is_err() {
        app.state::<AppState>()
            .scanning
            .store(false, Ordering::SeqCst);
        return false;
    }
    true
}
