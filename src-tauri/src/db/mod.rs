//! SQLite storage. One connection for writes and one for reads; WAL mode lets the UI keep
//! querying while a scan is writing.

pub mod files;
pub mod roots;
mod schema;
pub mod tags;

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
        schema::migrate(&mut write)?;
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

/// Current time as unix milliseconds.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
