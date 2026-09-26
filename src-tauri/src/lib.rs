mod commands;
mod db;
mod error;
mod indexer;
mod state;

use tauri::Manager;

use crate::db::{roots, Db};
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("paperlight.db");
            let db = Db::open(&db_path)?;
            indexer::seed_defaults(&db)?;
            let has_scanned = roots::get_setting(&db.reader(), "last_scan_at")?.is_some();
            app.manage(AppState::new(db));

            // After the first scan, refresh the index quietly on every launch so changes made
            // while Paperlight was closed show up.
            if has_scanned {
                indexer::spawn_scan(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_overview,
            commands::list_files,
            commands::add_root,
            commands::remove_root,
            commands::set_root_enabled,
            commands::list_exclusions,
            commands::add_exclusion,
            commands::remove_exclusion,
            commands::start_scan,
            commands::cancel_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paperlight");
}
