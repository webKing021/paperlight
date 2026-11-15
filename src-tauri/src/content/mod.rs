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

use crate::db::{roots, Db};
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

/// Setting that names the document being read right now, as `<id>:<attempts>`.
///
/// A parser can do worse than panic: run out of memory or overflow its stack, which ends the
/// whole process and can't be caught. The document would then still be waiting on the next
/// launch, be read first again (newest first) and end Paperlight again, every time. So the
/// reader notes which document it is on, and gives up on one that was being read when
/// Paperlight died [`MAX_INTERRUPTED`] times in a row. Twice, not once, so that a shutdown or
/// an update that happens to interrupt a read doesn't cost a healthy document its text.
const READING_KEY: &str = "content_reading";
const MAX_INTERRUPTED: u32 = 2;

fn reading_note(conn: &Connection) -> AppResult<Option<(i64, u32)>> {
    Ok(roots::get_setting(conn, READING_KEY)?.and_then(|v| {
        let (id, attempts) = v.split_once(':')?;
        Some((id.parse().ok()?, attempts.parse().ok()?))
    }))
}

fn clear_reading_note(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [READING_KEY])?;
    Ok(())
}

/// Run once when the reader starts: marks a document that keeps ending Paperlight as failed.
fn give_up_on_crasher(db: &Db) -> AppResult<()> {
    let conn = db.writer();
    if let Some((id, attempts)) = reading_note(&conn)? {
        if attempts >= MAX_INTERRUPTED {
            conn.execute(
                "UPDATE files SET content_status = ?2 WHERE id = ?1 AND content_status = 0",
                params![id, FAILED],
            )?;
            clear_reading_note(&conn)?;
        }
    }
    Ok(())
}

/// Notes that `id` is about to be read, counting up if the last read of it never finished.
fn note_reading(db: &Db, id: i64) -> AppResult<()> {
    let conn = db.writer();
    let attempts = match reading_note(&conn)? {
        Some((previous, attempts)) if previous == id => attempts + 1,
        _ => 1,
    };
    roots::set_setting(&conn, READING_KEY, &format!("{id}:{attempts}"))
}

fn run(app: AppHandle, rx: Receiver<()>) {
    priority::enter_background();
    let state = app.state::<AppState>();
    if let Err(e) = give_up_on_crasher(&state.db) {
        eprintln!("paperlight: could not check the last read: {e}");
    }
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
            if let Err(e) = note_reading(&state.db, job.id) {
                eprintln!("paperlight: could not note the read of {}: {e}", job.path);
            }
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
    crate::db::text::set(&tx, job.id, text)?;
    // Only mark it read if the file didn't change while we were reading it.
    tx.execute(
        "UPDATE files SET content_status = ?2
         WHERE id = ?1 AND size = ?3 AND modified_at IS ?4",
        params![job.id, status, job.size, job.modified_at],
    )?;
    // The read finished (well or badly), so it is no longer "the one being read".
    clear_reading_note(&tx)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::files::{insert_batch, FileRecord};

    fn db_with_file() -> (tempfile::TempDir, Db, Job) {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("t.db")).unwrap();
        {
            let mut conn = db.writer();
            let root = roots::add_root(&mut conn, "D:\\").unwrap();
            let record = FileRecord {
                path: "D:\\bomb.xlsx".into(),
                name: "bomb.xlsx".into(),
                ext: "xlsx".into(),
                kind: "excel",
                dir: "D:".into(),
                size: 10,
                created_at: None,
                modified_at: Some(1),
            };
            let tx = conn.transaction().unwrap();
            insert_batch(&tx, root.id, 0, &[record]).unwrap();
            tx.commit().unwrap();
        }
        let job = next_jobs(&db).unwrap().remove(0);
        (tmp, db, job)
    }

    fn status(db: &Db, id: i64) -> i64 {
        db.reader()
            .query_row(
                "SELECT content_status FROM files WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn a_document_that_keeps_ending_the_app_is_given_up_on() {
        let (_tmp, db, job) = db_with_file();

        // First launch: the read starts and Paperlight dies before it is stored.
        give_up_on_crasher(&db).unwrap();
        note_reading(&db, job.id).unwrap();

        // Second launch: one interrupted read can be bad luck, so it is tried again.
        give_up_on_crasher(&db).unwrap();
        assert_eq!(status(&db, job.id), 0);
        note_reading(&db, job.id).unwrap();

        // Third launch: twice in a row is the document's doing. It is not read again.
        give_up_on_crasher(&db).unwrap();
        assert_eq!(status(&db, job.id), FAILED);
        assert!(next_jobs(&db).unwrap().is_empty());
        assert_eq!(reading_note(&db.reader()).unwrap(), None);
    }

    #[test]
    fn a_read_that_finishes_leaves_no_note_behind() {
        let (_tmp, db, job) = db_with_file();
        note_reading(&db, job.id).unwrap();
        assert_eq!(reading_note(&db.reader()).unwrap(), Some((job.id, 1)));

        store(&db, &job, DONE, Some("some text")).unwrap();
        assert_eq!(status(&db, job.id), DONE);
        assert_eq!(reading_note(&db.reader()).unwrap(), None);

        // So an interruption much later, on a new version of the file, starts counting at one.
        note_reading(&db, job.id).unwrap();
        assert_eq!(reading_note(&db.reader()).unwrap(), Some((job.id, 1)));
    }
}
