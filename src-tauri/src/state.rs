use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use crate::db::Db;
use crate::indexer::watcher::Watch;

pub struct AppState {
    pub db: Db,
    pub scanning: AtomicBool,
    pub cancel: AtomicBool,
    pub watch: Mutex<Option<Watch>>,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            scanning: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            watch: Mutex::new(None),
        }
    }
}
