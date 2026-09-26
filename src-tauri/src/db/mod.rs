//! SQLite storage. One connection for writes and one for reads; WAL mode lets the UI keep
//! querying while a scan is writing.

pub mod files;
pub mod roots;
mod schema;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::AppResult;

pub struct Db {
    write: Mutex<Connection>,
    read: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut write = Connection::open(path)?;
        configure(&write)?;
        schema::migrate(&mut write)?;
        let read = Connection::open(path)?;
        configure(&read)?;
        Ok(Self {
            write: Mutex::new(write),
            read: Mutex::new(read),
        })
    }

    pub fn writer(&self) -> MutexGuard<'_, Connection> {
        self.write.lock().unwrap_or_else(|e| e.into_inner())
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
         PRAGMA cache_size = -16000;
         PRAGMA busy_timeout = 5000;",
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
