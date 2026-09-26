//! Discovering documents on disk and keeping the index in sync.

pub mod drives;
pub mod filters;
pub mod priority;
pub mod scanner;
pub mod watcher;

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{files, now_ms, roots, Db};
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

/// Removes indexed documents that the current exclusions or format choices no longer cover,
/// right away (no rescan). Returns how many were removed. Documents under paused locations
/// stay unless their format was turned off.
pub fn purge_excluded(db: &Db) -> AppResult<usize> {
    let (root_list, patterns, formats) = {
        let conn = db.reader();
        (
            roots::list_roots(&conn)?,
            roots::list_exclusions(&conn)?,
            filters::Formats::load(&conn)?,
        )
    };
    let ex = filters::Exclusions::new(&patterns);
    let doomed: Vec<i64> = {
        let conn = db.reader();
        let mut stmt = conn.prepare("SELECT id, path, ext FROM files")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut doomed = Vec::new();
        for row in rows {
            let (id, path, ext) = row?;
            if !formats.is_enabled(&ext) {
                doomed.push(id);
                continue;
            }
            let root = root_list
                .iter()
                .filter(|r| roots::is_within(&path, &r.path))
                .max_by_key(|r| r.path.len());
            if let Some(root) = root {
                if ex.is_excluded_below(&root.path, std::path::Path::new(&path)) {
                    doomed.push(id);
                }
            }
        }
        doomed
    };
    if doomed.is_empty() {
        return Ok(0);
    }
    let mut conn = db.writer();
    let tx = conn.transaction()?;
    let removed = files::delete_ids(&tx, &doomed)?;
    tx.commit()?;
    conn.execute_batch("PRAGMA incremental_vacuum;")?;
    Ok(removed)
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
                    crate::content::wake(&app);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn purge_removes_newly_excluded_documents_at_once() {
        let tmp = tempfile::tempdir().unwrap();
        let docs = tmp.path().join("docs");
        let tools = docs.join("DevTools").join("gh").join("share");
        fs::create_dir_all(&tools).unwrap();
        fs::create_dir_all(docs.join("Work")).unwrap();
        fs::write(tools.join("manual.pdf"), b"x").unwrap();
        fs::write(docs.join("Work").join("Plan.docx"), b"x").unwrap();
        let db = Db::open(&tmp.path().join("test.db")).unwrap();
        roots::add_root(&mut db.writer(), &docs.to_string_lossy()).unwrap();
        scanner::scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();

        assert_eq!(purge_excluded(&db).unwrap(), 0);
        let excluded = docs.join("DevTools").to_string_lossy().into_owned();
        roots::add_exclusion(&db.writer(), &excluded).unwrap();
        assert_eq!(purge_excluded(&db).unwrap(), 1);
        assert_eq!(files::stats(&db.reader()).unwrap().total, 1);

        // A rescan honours the exclusion too, and removing it brings the document back.
        let s = scanner::scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        assert_eq!((s.added, s.removed), (0, 0));
        roots::remove_exclusion(&db.writer(), &excluded).unwrap();
        let s = scanner::scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        assert_eq!(s.added, 1);

        // Turning a format off drops its documents; turning it back on finds them again.
        filters::Formats::new(&["pdf"]).save(&db.writer()).unwrap();
        assert_eq!(purge_excluded(&db).unwrap(), 1);
        let s = scanner::scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        assert_eq!((s.added, s.files_found), (0, 1));
        filters::Formats::default().save(&db.writer()).unwrap();
        let s = scanner::scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        assert_eq!(s.added, 1);
    }
}
