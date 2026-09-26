//! The IPC surface: everything the UI can ask the Rust core to do.

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::files::{self, ListQuery, Page, Stats};
use crate::db::roots::{self, Root};
use crate::error::AppResult;
use crate::indexer;
use crate::indexer::scanner::ScanMode;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub stats: Stats,
    pub roots: Vec<Root>,
    pub last_scan_at: Option<i64>,
    pub scanning: bool,
}

#[tauri::command]
pub fn get_overview(state: State<'_, AppState>) -> AppResult<Overview> {
    let conn = state.db.reader();
    Ok(Overview {
        stats: files::stats(&conn)?,
        roots: roots::list_roots(&conn)?,
        last_scan_at: roots::get_setting(&conn, "last_scan_at")?.and_then(|v| v.parse().ok()),
        scanning: state.scanning.load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub fn list_files(state: State<'_, AppState>, query: ListQuery) -> AppResult<Page> {
    files::list_files(&state.db.reader(), &query)
}

#[tauri::command]
pub fn add_root(state: State<'_, AppState>, path: String) -> AppResult<Root> {
    roots::add_root(&mut state.db.writer(), &path)
}

#[tauri::command]
pub fn remove_root(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    roots::remove_root(&state.db.writer(), id)
}

#[tauri::command]
pub fn set_root_enabled(state: State<'_, AppState>, id: i64, enabled: bool) -> AppResult<()> {
    roots::set_root_enabled(&state.db.writer(), id, enabled)
}

#[tauri::command]
pub fn list_exclusions(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    roots::list_exclusions(&state.db.reader())
}

#[tauri::command]
pub fn add_exclusion(state: State<'_, AppState>, pattern: String) -> AppResult<()> {
    roots::add_exclusion(&state.db.writer(), &pattern)
}

#[tauri::command]
pub fn remove_exclusion(state: State<'_, AppState>, pattern: String) -> AppResult<()> {
    roots::remove_exclusion(&state.db.writer(), &pattern)
}

/// A scan the user asked for runs at full speed. Returns `false` if one is already running.
#[tauri::command]
pub fn start_scan(app: AppHandle) -> bool {
    indexer::spawn_scan(app, ScanMode::Foreground)
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}
