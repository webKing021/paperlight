use std::sync::atomic::AtomicBool;

use crate::db::Db;

pub struct AppState {
    pub db: Db,
    pub scanning: AtomicBool,
    pub cancel: AtomicBool,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            scanning: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        }
    }
}
