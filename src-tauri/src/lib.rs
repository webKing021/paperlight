mod commands;
mod content;
mod db;
mod dupes;
mod error;
mod indexer;
mod search;
mod shell;
mod state;

use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::db::Db;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Must be first: a second launch just brings the running Paperlight forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            shell::focus_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| shell::on_hotkey(app, event.state()))
                .build(),
        )
        .setup(|app| {
            // PAPERLIGHT_DATA_DIR keeps a separate index (demos, screenshots, testing).
            let data_dir = match std::env::var_os("PAPERLIGHT_DATA_DIR") {
                Some(dir) => std::path::PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            let db_path = data_dir.join("paperlight.db");
            let db = Db::open(&db_path)?;
            indexer::seed_defaults(&db)?;
            app.manage(AppState::new(db));
            let reader = content::start(app.handle())?;
            *app.state::<AppState>()
                .content_wake
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(reader);
            indexer::sync_on_launch_if_stale(app.handle())?;
            let indexed =
                db::roots::get_setting(&app.state::<AppState>().db.reader(), "last_scan_at")?
                    .is_some();
            if indexed {
                if let Err(e) = indexer::watcher::restart(app.handle()) {
                    eprintln!("paperlight: could not start watcher: {e}");
                }
            }
            shell::setup(app.handle())?;
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
            commands::file_details,
            commands::preview_pdf,
            commands::shell_info,
            commands::set_autostart,
            commands::hide_quick,
            commands::show_main,
            commands::get_settings,
            commands::reset_index,
            commands::storage_insights,
            commands::find_duplicates,
            commands::list_formats,
            commands::set_formats,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Paperlight");

    app.run(|_app, event| {
        // Closing the last window keeps Paperlight in the tray (watching files). Only "Quit"
        // from the tray menu, which exits with a code, really ends the app.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
