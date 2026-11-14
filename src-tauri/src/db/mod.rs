//! SQLite storage. One connection for writes and one for reads; WAL mode lets the UI keep
//! querying while a scan is writing.

pub mod files;
pub mod roots;
mod schema;
pub mod tags;
pub mod text;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::AppResult;

pub struct Db {
    path: PathBuf,
    write: Mutex<Connection>,
    read: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut write = Connection::open(path)?;
        // Only takes effect on a brand-new database; lets deletions shrink the file later.
        write.execute_batch("PRAGMA auto_vacuum = INCREMENTAL;")?;
        configure(&write)?;
        if schema::migrate(&mut write)? {
            // A migration may have dropped or rewritten tables: hand the freed pages back.
            release_free_pages(&write)?;
        }
        // Start with an empty write-ahead log; journal_size_limit keeps it small afterwards.
        write.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        let read = Connection::open(path)?;
        configure(&read)?;
        Ok(Self {
            path: path.to_path_buf(),
            write: Mutex::new(write),
            read: Mutex::new(read),
        })
    }

    pub fn writer(&self) -> MutexGuard<'_, Connection> {
        self.write.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Bytes the index takes on disk (database plus write-ahead log).
    pub fn size_on_disk(&self) -> u64 {
        let mut total = 0;
        for suffix in ["", "-wal", "-shm"] {
            let mut p = self.path.clone().into_os_string();
            p.push(suffix);
            total += std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        }
        total
    }

    pub fn reader(&self) -> MutexGuard<'_, Connection> {
        self.read.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn configure(conn: &Connection) -> AppResult<()> {
    text::register(conn)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -8000;
         PRAGMA busy_timeout = 5000;
         PRAGMA journal_size_limit = 1048576;",
    )?;
    Ok(())
}

/// Hands the pages freed by deletions back to the OS, so the index file shrinks.
///
/// `PRAGMA incremental_vacuum` frees one page per step, so it has to be stepped to the end;
/// running it through `execute_batch` (a single step) releases next to nothing.
pub fn release_free_pages(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare("PRAGMA incremental_vacuum")?;
    let mut rows = stmt.query([])?;
    while rows.next()?.is_some() {}
    Ok(())
}

/// Current time as unix milliseconds.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn freed_pages_are_given_back() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("v.db")).unwrap();
        let conn = db.writer();
        conn.execute_batch(
            "CREATE TABLE junk (x BLOB);
             WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400)
             INSERT INTO junk SELECT randomblob(4000) FROM n;
             DROP TABLE junk;",
        )
        .unwrap();
        let free = |c: &Connection| -> i64 {
            c.query_row("PRAGMA freelist_count", [], |r| r.get(0))
                .unwrap()
        };
        assert!(free(&conn) > 300);
        release_free_pages(&conn).unwrap();
        assert_eq!(free(&conn), 0);
    }

    /// Migrates a *copy* of a real index and times searches on it:
    /// `PAPERLIGHT_TEST_DB=<copy of paperlight.db> cargo test --release migrates_a_real_index -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn migrates_a_real_index() {
        let path = std::path::PathBuf::from(std::env::var_os("PAPERLIGHT_TEST_DB").unwrap());
        let before = std::fs::metadata(&path).unwrap().len();
        let started = Instant::now();
        let db = Db::open(&path).unwrap();
        println!("opened (and migrated) in {:?}", started.elapsed());
        db.writer()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        println!("size: {before} -> {} bytes", db.size_on_disk());
        let conn = db.reader();
        let (docs, pending): (i64, i64) = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM doc_text),
                        (SELECT COUNT(*) FROM files WHERE content_status = 0)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        println!("documents with text: {docs}, queued to be read again: {pending}");
        let check: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(check, "ok");
        for text in ["the", "an", "report", "invoice", "total amount", "re"] {
            for limit in [7, 200] {
                let t = Instant::now();
                let page = crate::search::search(
                    &conn,
                    &crate::search::SearchQuery {
                        text: text.into(),
                        limit: Some(limit),
                        ..Default::default()
                    },
                )
                .unwrap();
                let passages = page.items.iter().filter(|r| r.snippet.is_some()).count();
                println!(
                    "search {text:>13} (top {limit:>3}): {:>4} hits, {passages:>3} passages, {:>6.2} ms",
                    page.total,
                    t.elapsed().as_secs_f64() * 1000.0
                );
            }
        }
    }
}
