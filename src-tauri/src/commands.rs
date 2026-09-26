//! The IPC surface: everything the UI can ask the Rust core to do.

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::files::{self, FileRow, KindUsage, ListQuery, Page, Stats};
use crate::db::now_ms;
use crate::db::roots::{self, Root};
use crate::db::tags::{self, Tag};
use crate::dupes::{self, DupGroup};
use crate::error::{AppError, AppResult};
use crate::indexer;
use crate::indexer::filters::{Formats, EXTENSIONS};
use crate::indexer::scanner::ScanMode;
use crate::indexer::watcher;
use crate::search::{self, SearchQuery};
use crate::shell;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub stats: Stats,
    pub roots: Vec<Root>,
    pub last_scan_at: Option<i64>,
    pub scanning: bool,
    /// Number of folders being watched live, or `None` if not watching.
    pub watching: Option<usize>,
    /// Documents whose text is still waiting to be read.
    pub content_pending: i64,
    /// Extensions the user chose not to index.
    pub disabled_formats: Vec<String>,
}

#[tauri::command]
pub fn get_overview(app: AppHandle, state: State<'_, AppState>) -> AppResult<Overview> {
    let conn = state.db.reader();
    Ok(Overview {
        stats: files::stats(&conn)?,
        roots: roots::list_roots(&conn)?,
        last_scan_at: roots::get_setting(&conn, "last_scan_at")?.and_then(|v| v.parse().ok()),
        scanning: state.scanning.load(Ordering::SeqCst),
        watching: watcher::watched_locations(&app),
        content_pending: crate::content::pending_count(&conn)?,
        disabled_formats: Formats::load(&conn)?.disabled_list(),
    })
}

#[tauri::command]
pub fn list_files(state: State<'_, AppState>, query: ListQuery) -> AppResult<Page> {
    files::list_files(&state.db.reader(), &query)
}

#[tauri::command]
pub fn search_files(state: State<'_, AppState>, query: SearchQuery) -> AppResult<Page> {
    search::search(&state.db.reader(), &query)
}

/// Looks up an indexed document by id. The UI can only ever open files that are in the index,
/// never arbitrary paths. A file that vanished since the last sync is dropped from the index.
fn existing_path(state: &AppState, id: i64) -> AppResult<String> {
    let path = files::path_of(&state.db.reader(), id)?
        .ok_or_else(|| AppError::msg("This document is no longer in the index."))?;
    if !std::path::Path::new(&path).exists() {
        files::delete_ids(&state.db.writer(), &[id])?;
        return Err(AppError::msg(
            "This file was moved or deleted. It has been removed from Paperlight.",
        ));
    }
    Ok(path)
}

#[tauri::command]
pub fn open_file(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let path = existing_path(&state, id)?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::msg(format!("Windows could not open the file: {e}")))?;
    files::record_open(&state.db.writer(), id, now_ms())
}

#[tauri::command]
pub fn reveal_file(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let path = existing_path(&state, id)?;
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|e| AppError::msg(format!("Could not open the folder: {e}")))
}

/// Opens one of Paperlight's own web pages in the browser. The UI names a page rather than
/// passing a URL, so it can't be used to open arbitrary addresses.
#[tauri::command]
pub fn open_website(page: String) -> AppResult<()> {
    let url = match page.as_str() {
        "author" => "https://github.com/webKing021",
        "repo" => "https://github.com/webKing021/paperlight",
        "releases" => "https://github.com/webKing021/paperlight/releases",
        "issues" => "https://github.com/webKing021/paperlight/issues",
        _ => return Err(AppError::msg("Unknown page")),
    };
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| AppError::msg(format!("Could not open the browser: {e}")))
}

#[tauri::command]
pub fn add_root(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<Root> {
    let root = roots::add_root(&mut state.db.writer(), &path)?;
    watcher::refresh(&app);
    Ok(root)
}

#[tauri::command]
pub fn remove_root(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    roots::remove_root(&state.db.writer(), id)?;
    watcher::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn set_root_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    enabled: bool,
) -> AppResult<()> {
    roots::set_root_enabled(&state.db.writer(), id, enabled)?;
    watcher::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn list_exclusions(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    roots::list_exclusions(&state.db.reader())
}

/// Adds an exclusion and drops the documents it now covers at once. Returns how many.
#[tauri::command]
pub fn add_exclusion(
    app: AppHandle,
    state: State<'_, AppState>,
    pattern: String,
) -> AppResult<usize> {
    roots::add_exclusion(&state.db.writer(), &pattern)?;
    let removed = indexer::purge_excluded(&state.db)?;
    watcher::refresh(&app);
    if removed > 0 {
        let _ = app.emit(
            "index-changed",
            &watcher::Applied {
                removed: removed as u64,
                ..Default::default()
            },
        );
    }
    Ok(removed)
}

#[tauri::command]
pub fn remove_exclusion(
    app: AppHandle,
    state: State<'_, AppState>,
    pattern: String,
) -> AppResult<()> {
    roots::remove_exclusion(&state.db.writer(), &pattern)?;
    watcher::refresh(&app);
    Ok(())
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

#[tauri::command]
pub fn set_favourite(state: State<'_, AppState>, id: i64, on: bool) -> AppResult<()> {
    tags::set_favourite(&state.db.writer(), id, on)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> AppResult<Vec<Tag>> {
    tags::list_tags(&state.db.reader())
}

#[tauri::command]
pub fn create_tag(state: State<'_, AppState>, name: String) -> AppResult<Tag> {
    tags::create_tag(&state.db.writer(), &name)
}

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    color: String,
) -> AppResult<()> {
    tags::update_tag(&state.db.writer(), id, &name, &color)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    tags::delete_tag(&state.db.writer(), id)
}

#[tauri::command]
pub fn set_file_tag(
    state: State<'_, AppState>,
    file_id: i64,
    tag_id: i64,
    on: bool,
) -> AppResult<()> {
    tags::set_file_tag(&state.db.writer(), file_id, tag_id, on)
}

#[tauri::command]
pub fn file_details(state: State<'_, AppState>, id: i64) -> AppResult<files::Details> {
    files::details(&state.db.reader(), id)?
        .ok_or_else(|| AppError::msg("This document is no longer in the index."))
}

/// PDFs up to this size can be previewed; larger ones just show their details.
const MAX_PREVIEW_BYTES: u64 = 30 * 1024 * 1024;

/// Raw bytes of an indexed PDF for the preview panel (by id only, never an arbitrary path).
#[tauri::command]
pub fn preview_pdf(state: State<'_, AppState>, id: i64) -> AppResult<tauri::ipc::Response> {
    let path = existing_path(&state, id)?;
    if !path.to_ascii_lowercase().ends_with(".pdf") {
        return Err(AppError::msg("Only PDFs can be previewed."));
    }
    if std::fs::metadata(&path)?.len() > MAX_PREVIEW_BYTES {
        return Err(AppError::msg("This PDF is too large to preview."));
    }
    Ok(tauri::ipc::Response::new(std::fs::read(&path)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    /// The global quick-search hotkey, if one could be registered.
    pub hotkey: Option<String>,
    pub autostart: bool,
}

#[tauri::command]
pub fn shell_info(app: AppHandle) -> ShellInfo {
    ShellInfo {
        hotkey: shell::hotkey(&app),
        autostart: shell::autostart_enabled(&app),
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> AppResult<()> {
    shell::set_autostart(&app, on)
}

/// Async so the window calls run off the main thread (see `shell::off_main_thread`).
#[tauri::command]
pub async fn set_theme(app: AppHandle, mode: String) -> AppResult<()> {
    shell::set_theme(&app, &mode)
}

/// The main window's page has its splash ready: show the window (see `shell::show_main`).
#[tauri::command]
pub async fn main_ready(app: AppHandle) {
    shell::main_ready(&app);
}

#[tauri::command]
pub fn hide_quick(app: AppHandle) {
    shell::hide_quick(&app);
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    shell::focus_main(&app);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    #[serde(flatten)]
    pub root: Root,
    /// Documents indexed in this location.
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    pub roots: Vec<RootInfo>,
    pub exclusions: Vec<String>,
    /// Bytes the index takes on disk.
    pub index_bytes: u64,
    pub hotkey: Option<String>,
    pub autostart: bool,
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> AppResult<SettingsInfo> {
    let conn = state.db.reader();
    let counts = files::count_by_root(&conn)?;
    let roots = roots::list_roots(&conn)?
        .into_iter()
        .map(|root| RootInfo {
            count: counts.get(&root.id).copied().unwrap_or(0),
            root,
        })
        .collect();
    Ok(SettingsInfo {
        roots,
        exclusions: roots::list_exclusions(&conn)?,
        index_bytes: state.db.size_on_disk(),
        hotkey: shell::hotkey(&app),
        autostart: shell::autostart_enabled(&app),
    })
}

/// Empties the index and starts a fresh scan. Files on disk are not touched.
#[tauri::command]
pub fn reset_index(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if state.scanning.load(Ordering::SeqCst) {
        return Err(AppError::msg(
            "A scan is running. Stop it or wait for it to finish, then try again.",
        ));
    }
    files::reset_all(&mut state.db.writer())?;
    let _ = app.emit("index-changed", &watcher::Applied::default());
    indexer::spawn_scan(app, ScanMode::Foreground);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInsights {
    pub by_kind: Vec<KindUsage>,
    pub largest: Vec<FileRow>,
    pub index_bytes: u64,
}

#[tauri::command]
pub fn storage_insights(state: State<'_, AppState>) -> AppResult<StorageInsights> {
    let conn = state.db.reader();
    Ok(StorageInsights {
        by_kind: files::usage_by_kind(&conn)?,
        largest: files::largest(&conn, 12)?,
        index_bytes: state.db.size_on_disk(),
    })
}

/// Finds identical documents. Reads only files that share a size with another one, on a
/// background-priority worker; progress arrives as `dupes-progress` events.
#[tauri::command]
pub async fn find_duplicates(app: AppHandle) -> AppResult<Vec<DupGroup>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _one_at_a_time = state.dupes.lock().unwrap_or_else(|e| e.into_inner());
        dupes::find(&state.db, |p| {
            let _ = app.emit("dupes-progress", p);
        })
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub ext: &'static str,
    pub kind: &'static str,
    pub enabled: bool,
    /// Documents of this format in the index.
    pub count: i64,
    /// Whether the text inside is read (otherwise found by name only).
    pub reads_text: bool,
}

#[tauri::command]
pub fn list_formats(state: State<'_, AppState>) -> AppResult<Vec<FormatInfo>> {
    let conn = state.db.reader();
    let formats = Formats::load(&conn)?;
    let counts = files::count_by_ext(&conn)?;
    Ok(EXTENSIONS
        .iter()
        .map(|&(ext, kind)| FormatInfo {
            ext,
            kind,
            enabled: formats.is_enabled(ext),
            count: counts.get(ext).copied().unwrap_or(0),
            reads_text: crate::content::extract::reads_text(ext),
        })
        .collect())
}

/// Chooses which formats are indexed. Documents of formats turned off leave the index at once;
/// the UI starts a rescan when a format is turned on. Returns how many were removed.
#[tauri::command]
pub fn set_formats(
    app: AppHandle,
    state: State<'_, AppState>,
    disabled: Vec<String>,
) -> AppResult<usize> {
    Formats::new(&disabled).save(&state.db.writer())?;
    let removed = indexer::purge_excluded(&state.db)?;
    watcher::refresh(&app);
    let _ = app.emit(
        "index-changed",
        &watcher::Applied {
            removed: removed as u64,
            ..Default::default()
        },
    );
    Ok(removed)
}
