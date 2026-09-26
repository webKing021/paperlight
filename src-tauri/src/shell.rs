//! Everything around the windows: tray icon, global hotkey, quick-search window, autostart.
//!
//! Memory rule: the web UI is by far the heaviest part of the app, so windows are destroyed
//! when closed. In the tray Paperlight is just the Rust core (a few MB), still watching files.
//! The quick-search window is created on first use and freed after 10 idle minutes.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::error::{AppError, AppResult};
use crate::indexer::{self, scanner::ScanMode};

const MAIN: &str = "main";
const QUICK: &str = "quick";
const PAPER: Color = Color(245, 243, 238, 255);
/// Preferred hotkey first; the next one is used if another app already owns it.
const HOTKEYS: &[&str] = &["Alt+Space", "Ctrl+Shift+Space", "Ctrl+Alt+P"];
const QUICK_IDLE: Duration = Duration::from_secs(10 * 60);

/// Started from Windows' startup list: stay in the tray, don't open a window.
pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

#[derive(Default)]
pub struct ShellState {
    pub hotkey: Mutex<Option<String>>,
    /// The tray's "Start with Windows" check, kept in step with the Settings toggle.
    startup_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    /// Bumped every time the quick window is shown, so a pending idle-close can tell it's stale.
    quick_generation: AtomicU64,
}

/// Brings Paperlight forward (used when it is launched a second time).
pub fn focus_main(app: &AppHandle) {
    off_main_thread(app, open_main);
}

pub fn setup(app: &AppHandle) -> AppResult<()> {
    app.manage(ShellState::default());
    register_hotkey(app);
    build_tray(app)?;
    if !started_hidden() {
        show_main(app)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------------------------

pub fn show_main(app: &AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        window.show().map_err(tauri_err)?;
        window.set_focus().map_err(tauri_err)?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::default())
        .title("Paperlight")
        .inner_size(1200.0, 780.0)
        .min_inner_size(900.0, 560.0)
        .center()
        .background_color(PAPER)
        .build()
        .map_err(tauri_err)?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Quick search window
// ---------------------------------------------------------------------------------------------

fn quick_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    if let Some(window) = app.get_webview_window(QUICK) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, QUICK, WebviewUrl::default())
        .title("Paperlight quick search")
        .inner_size(680.0, 460.0)
        .resizable(false)
        .decorations(false)
        // Undecorated + shadow = native Windows 11 rounded corners and drop shadow.
        .shadow(true)
        .background_color(PAPER)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(tauri_err)?;
    // Upper third of the screen the cursor is on, like Spotlight / PowerToys Run.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let scale = monitor.scale_factor();
        let w = (680.0 * scale) as i32;
        let x = pos.x + (size.width as i32 - w) / 2;
        let y = pos.y + (size.height as f64 * 0.18) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
    Ok(window)
}

pub fn toggle_quick(app: &AppHandle) {
    let visible = app
        .get_webview_window(QUICK)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide_quick(app);
    } else if let Err(e) = show_quick(app) {
        eprintln!("paperlight: could not open quick search: {e}");
    }
}

fn show_quick(app: &AppHandle) -> AppResult<()> {
    let window = quick_window(app)?;
    app.state::<ShellState>()
        .quick_generation
        .fetch_add(1, Ordering::SeqCst);
    window.show().map_err(tauri_err)?;
    window.set_focus().map_err(tauri_err)?;
    Ok(())
}

/// Hides the quick window and frees it after a while if it isn't used again.
pub fn hide_quick(app: &AppHandle) {
    let Some(window) = app.get_webview_window(QUICK) else {
        return;
    };
    let _ = window.hide();
    let shell = app.state::<ShellState>();
    let generation = shell.quick_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUICK_IDLE);
        let current = app
            .state::<ShellState>()
            .quick_generation
            .load(Ordering::SeqCst);
        if current == generation {
            if let Some(window) = app.get_webview_window(QUICK) {
                let _ = window.destroy();
            }
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Hotkey, tray, autostart
// ---------------------------------------------------------------------------------------------

fn register_hotkey(app: &AppHandle) {
    for key in HOTKEYS {
        if app.global_shortcut().register(*key).is_ok() {
            *app.state::<ShellState>()
                .hotkey
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some((*key).to_string());
            return;
        }
    }
    eprintln!("paperlight: no global hotkey available");
}

/// Handler for the global-shortcut plugin.
pub fn on_hotkey(app: &AppHandle, state: ShortcutState) {
    if state == ShortcutState::Pressed {
        off_main_thread(app, toggle_quick);
    }
}

/// Creating windows from a synchronous handler on the main thread can deadlock on Windows,
/// so window work triggered by events runs on a short-lived helper thread.
pub fn off_main_thread(app: &AppHandle, f: fn(&AppHandle)) {
    let app = app.clone();
    std::thread::spawn(move || f(&app));
}

fn open_main(app: &AppHandle) {
    if let Err(e) = show_main(app) {
        eprintln!("paperlight: could not open window: {e}");
    }
}

pub fn hotkey(app: &AppHandle) -> Option<String> {
    app.state::<ShellState>()
        .hotkey
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn set_autostart(app: &AppHandle, on: bool) -> AppResult<()> {
    let launcher = app.autolaunch();
    let result = if on {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| AppError::msg(format!("Could not change startup setting: {e}")))?;
    if let Some(item) = app
        .state::<ShellState>()
        .startup_item
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        let _ = item.set_checked(on);
    }
    Ok(())
}

fn build_tray(app: &AppHandle) -> AppResult<()> {
    let quick_label = match hotkey(app) {
        Some(key) => format!("Quick search\t{key}"),
        None => "Quick search".to_string(),
    };
    let open =
        MenuItem::with_id(app, "open", "Open Paperlight", true, None::<&str>).map_err(tauri_err)?;
    let quick =
        MenuItem::with_id(app, "quick", quick_label, true, None::<&str>).map_err(tauri_err)?;
    let rescan =
        MenuItem::with_id(app, "rescan", "Rescan now", true, None::<&str>).map_err(tauri_err)?;
    let startup = CheckMenuItem::with_id(
        app,
        "startup",
        "Start with Windows",
        true,
        autostart_enabled(app),
        None::<&str>,
    )
    .map_err(tauri_err)?;
    let quit =
        MenuItem::with_id(app, "quit", "Quit Paperlight", true, None::<&str>).map_err(tauri_err)?;
    let sep1 = PredefinedMenuItem::separator(app).map_err(tauri_err)?;
    let sep2 = PredefinedMenuItem::separator(app).map_err(tauri_err)?;
    let menu = Menu::with_items(
        app,
        &[&open, &quick, &sep1, &rescan, &startup, &sep2, &quit],
    )
    .map_err(tauri_err)?;

    *app.state::<ShellState>()
        .startup_item
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(startup.clone());
    let startup_item = startup.clone();
    let mut tray = TrayIconBuilder::with_id("paperlight")
        .tooltip("Paperlight: every document, one search away")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => off_main_thread(app, open_main),
            "quick" => off_main_thread(app, toggle_quick),
            "rescan" => {
                indexer::spawn_scan(app.clone(), ScanMode::Foreground);
            }
            "startup" => {
                let on = !autostart_enabled(app);
                let ok = set_autostart(app, on).is_ok();
                let _ = startup_item.set_checked(if ok { on } else { !on });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                off_main_thread(tray.app_handle(), open_main);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app).map_err(tauri_err)?;
    Ok(())
}

fn tauri_err(e: impl std::fmt::Display) -> AppError {
    AppError::msg(e.to_string())
}
