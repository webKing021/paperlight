//! Background reading of document text for full-text search.
//!
//! One thread, background CPU/disk priority, asleep (blocked on a channel) whenever there is
//! nothing to read. Newest documents are read first. Each file is read on a short-lived
//! helper thread with a panic guard and a timeout, so a corrupt or pathological document can
//! never crash or stall Paperlight. Text is re-read only when a file's size or date changes.

pub mod extract;

use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Db;
use crate::error::AppResult;
use crate::indexer::priority;
use crate::state::AppState;
use extract::Extracted;

// content_status: 0 = waiting, 1 = read, 2 = skipped, 3 = failed
const DONE: i64 = 1;
const SKIPPED: i64 = 2;
const FAILED: i64 = 3;

const TIMEOUT: Duration = Duration::from_secs(20);
/// A short breather between files keeps disk usage gentle during large backlogs.
const PAUSE: Duration = Duration::from_millis(15);
const BATCH: i64 = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentProgress {
    /// Documents still waiting to be read.
    pub pending: i64,
}

struct Job {
    id: i64,
    path: String,
    ext: String,
    size: i64,
    modified_at: Option<i64>,
}

/// Starts the reader thread; keep the returned sender to wake it.
pub fn start(app: &AppHandle) -> std::io::Result<Sender<()>> {
    let (tx, rx) = mpsc::channel();
    let app = app.clone();
    std::thread::Builder::new()
        .name("paperlight-content".into())
        .spawn(move || run(app, rx))?;
    Ok(tx)
}

/// Tells the reader there may be new or changed documents.
pub fn wake(app: &AppHandle) {
    let state = app.state::<AppState>();
    let guard = state.content_wake.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = guard.as_ref() {
        let _ = tx.send(());
    }
}

fn run(app: AppHandle, rx: Receiver<()>) {
    priority::enter_background();
    let state = app.state::<AppState>();
    let mut last_emit = Instant::now();
    let mut busy = false;
    loop {
        while rx.try_recv().is_ok() {} // coalesce wake-ups
        let jobs = next_jobs(&state.db).unwrap_or_default();
        if jobs.is_empty() {
            if busy {
                busy = false;
                let _ = app.emit("content-progress", ContentProgress { pending: 0 });
            }
            // Sleep until something changes; ends when the app shuts down.
            if rx.recv().is_err() {
                return;
            }
            continue;
        }
        busy = true;
        for job in jobs {
            let (status, text) = read_with_timeout(&job);
            if let Err(e) = store(&state.db, &job, status, text.as_deref()) {
                eprintln!("paperlight: could not store text of {}: {e}", job.path);
            }
            if last_emit.elapsed() > Duration::from_millis(700) {
                last_emit = Instant::now();
                let pending = pending_count(&state.db.reader()).unwrap_or(0);
                let _ = app.emit("content-progress", ContentProgress { pending });
            }
            std::thread::sleep(PAUSE);
        }
    }
}

fn next_jobs(db: &Db) -> AppResult<Vec<Job>> {
    let conn = db.reader();
    let mut stmt = conn.prepare_cached(
        "SELECT id, path, ext, size, modified_at FROM files
         WHERE content_status = 0 ORDER BY modified_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([BATCH], |r| {
        Ok(Job {
            id: r.get(0)?,
            path: r.get(1)?,
            ext: r.get(2)?,
            size: r.get(3)?,
            modified_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn pending_count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM files WHERE content_status = 0",
        [],
        |r| r.get(0),
    )?)
}

fn read_with_timeout(job: &Job) -> (i64, Option<String>) {
    let (tx, rx) = mpsc::channel();
    let path = PathBuf::from(&job.path);
    let ext = job.ext.clone();
    let spawned = std::thread::Builder::new()
        .name("paperlight-read".into())
        .spawn(move || {
            priority::enter_background();
            let result =
                std::panic::catch_unwind(AssertUnwindSafe(|| extract::extract(&path, &ext)));
            let _ = tx.send(result);
        });
    if spawned.is_err() {
        return (FAILED, None);
    }
    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(Ok(Extracted::Text(text)))) => (DONE, Some(text)),
        Ok(Ok(Ok(Extracted::Unsupported))) => (SKIPPED, None),
        // An error, a panic inside a parser, or a timeout (the helper thread is abandoned).
        _ => (FAILED, None),
    }
}

fn store(db: &Db, job: &Job, status: i64, text: Option<&str>) -> AppResult<()> {
    let mut conn = db.writer();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM content_fts WHERE rowid = ?1", [job.id])?;
    if let Some(text) = text.filter(|t| !t.is_empty()) {
        tx.execute(
            "INSERT INTO content_fts (rowid, body) VALUES (?1, ?2)",
            params![job.id, text],
        )?;
    }
    // Only mark it read if the file didn't change while we were reading it.
    tx.execute(
        "UPDATE files SET content_status = ?2
         WHERE id = ?1 AND size = ?3 AND modified_at IS ?4",
        params![job.id, status, job.size, job.modified_at],
    )?;
    tx.commit()?;
    Ok(())
}
