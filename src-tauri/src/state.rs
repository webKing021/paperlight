use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;
use std::sync::Mutex;

use crate::db::Db;
use crate::indexer::watcher::Watch;

pub struct AppState {
    pub db: Db,
    pub scanning: AtomicBool,
    pub cancel: AtomicBool,
    pub watch: Mutex<Option<Watch>>,
    /// Wakes the background text reader.
    pub content_wake: Mutex<Option<Sender<()>>>,
    /// Held while duplicates are being checked, so two checks never read the same files.
    pub dupes: Mutex<()>,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            scanning: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            watch: Mutex::new(None),
            content_wake: Mutex::new(None),
            dupes: Mutex::new(()),
        }
    }
}
