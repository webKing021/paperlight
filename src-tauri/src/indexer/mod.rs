//! Discovering documents on disk and keeping the index in sync.

pub mod drives;
pub mod filters;
pub mod priority;
pub mod scanner;
pub mod watcher;

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now_ms, roots, Db};
use crate::error::AppResult;
use crate::state::AppState;
use scanner::ScanMode;

/// Automatic sync on launch only happens when the index is older than this.
const AUTO_SYNC_AFTER: Duration = Duration::from_secs(12 * 60 * 60);
/// Let the window appear and settle before any automatic disk work starts.
const AUTO_SYNC_DELAY: Duration = Duration::from_secs(5);

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

/// Called at startup. Syncs quietly in the background only if the index is stale; a fresh
/// index is trusted as-is (the file watcher keeps it current while the app runs).
pub fn sync_on_launch_if_stale(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let last =
        roots::get_setting(&state.db.reader(), "last_scan_at")?.and_then(|v| v.parse::<i64>().ok());
    let Some(last) = last else {
        return Ok(()); // never scanned: onboarding lets the user start the first scan
    };
    if now_ms() - last < AUTO_SYNC_AFTER.as_millis() as i64 {
        return Ok(());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(AUTO_SYNC_DELAY);
        spawn_scan(app, ScanMode::Background);
    });
    Ok(())
}

/// Resets the `scanning` flag even if the scan thread panics.
struct ScanGuard<'a>(&'a AppState);

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.scanning.store(false, Ordering::SeqCst);
    }
}

/// Starts a sync on a background thread. Returns `false` if one is already running.
pub fn spawn_scan(app: AppHandle, mode: ScanMode) -> bool {
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
            let guard = ScanGuard(&state);
            let _ = app.emit("scan-started", mode == ScanMode::Background);
            let result = scanner::scan(&state.db, &state.cancel, mode, |p| {
                let _ = app.emit("scan-progress", p);
            });
            drop(guard);
            match result {
                Ok(summary) => {
                    let _ = app.emit("scan-finished", &summary);
                    // After the first complete scan, live watching takes over.
                    if !summary.cancelled && !watcher::is_running(&app) {
                        if let Err(e) = watcher::restart(&app) {
                            eprintln!("paperlight: could not start watcher: {e}");
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit("scan-error", e.to_string());
                }
            }
        });
    if spawned.is_err() {
        state.scanning.store(false, Ordering::SeqCst);
        return false;
    }
    true
}
