mod commands;
mod db;
mod error;
mod indexer;
mod search;
mod state;

use tauri::Manager;

use crate::db::Db;
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
            app.manage(AppState::new(db));
            indexer::sync_on_launch_if_stale(app.handle())?;
            let indexed =
                db::roots::get_setting(&app.state::<AppState>().db.reader(), "last_scan_at")?
                    .is_some();
            if indexed {
                if let Err(e) = indexer::watcher::restart(app.handle()) {
                    eprintln!("paperlight: could not start watcher: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_overview,
            commands::list_files,
            commands::search_files,
            commands::open_file,
            commands::reveal_file,
            commands::add_root,
            commands::remove_root,
            commands::set_root_enabled,
            commands::list_exclusions,
            commands::add_exclusion,
            commands::remove_exclusion,
            commands::start_scan,
            commands::cancel_scan,
            commands::set_favourite,
            commands::list_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::set_file_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paperlight");
}
