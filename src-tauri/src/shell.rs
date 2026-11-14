//! Everything around the windows: tray icon, global hotkey, quick-search window, autostart.
//!
//! Memory rule: the web UI is by far the heaviest part of the app, so windows are destroyed
//! when closed. In the tray Paperlight is just the Rust core (a few MB), still watching files.
//! The quick-search window is created on first use and freed after 10 idle minutes.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::Color;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Theme, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::db::roots;
use crate::error::{AppError, AppResult};
use crate::indexer::{self, scanner::ScanMode};
use crate::state::AppState;

const MAIN: &str = "main";
const QUICK: &str = "quick";
/// Window colours behind the web page (match `--paper` in index.css), so a window never
/// flashes the wrong colour before the page paints.
const PAPER_LIGHT: Color = Color(255, 255, 255, 255);
const PAPER_DARK: Color = Color(27, 27, 30, 255);
/// Preferred hotkey first; the next one is used if another app already owns it.
const HOTKEYS: &[&str] = &["Alt+Space", "Ctrl+Shift+Space", "Ctrl+Alt+P"];
const QUICK_IDLE: Duration = Duration::from_secs(10 * 60);
const MAIN_SHOW_FALLBACK: Duration = Duration::from_millis(1500);

/// Started from Windows' startup list: stay in the tray, don't open a window.
pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

/// The tray's autostart item.
const STARTUP_LABEL: &str = if cfg!(windows) {
    "Start with Windows"
} else {
    "Start at login"
};

/// Settings keys.
const HOTKEY_KEY: &str = "hotkey";
const WINDOW_KEY: &str = "main_window";

#[derive(Default)]
pub struct ShellState {
    pub hotkey: Mutex<Option<String>>,
    /// The tray's "Start with Windows" check, kept in step with the Settings toggle.
    startup_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    /// The tray's "Quick search" item, relabelled when the hotkey changes.
    quick_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    quick_idle: Mutex<QuickIdle>,
}

/// When the quick window was last hidden, and whether the thread that frees it is running.
/// One thread at most, however often the window is opened and closed.
#[derive(Default)]
struct QuickIdle {
    hidden_at: Option<Instant>,
    timer_running: bool,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
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
    // Built hidden: it is shown once the page has its splash ready (`main_ready`), so the
    // window never appears as an empty black or white frame.
    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::default())
        .title("Paperlight")
        .inner_size(1200.0, 780.0)
        .min_inner_size(900.0, 560.0)
        .center()
        .background_color(PAPER_LIGHT)
        .visible(false)
        .build()
        .map_err(tauri_err)?;
    apply_theme(&window, saved_theme(app));
    restore_main_place(app, &window);
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            save_main_place(&handle);
        }
    });
    // Fallback in case the page never reports in (e.g. it failed to load).
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(MAIN_SHOW_FALLBACK);
        main_ready(&app);
    });
    Ok(())
}

/// Shows the main window the first time its page is ready to paint. Safe to call repeatedly.
pub fn main_ready(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    if window.is_visible().unwrap_or(true) {
        return;
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Where the main window was when it was last closed: outer position, inner size (physical
/// pixels) and whether it was maximised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Place {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

impl Place {
    fn parse(s: &str) -> Option<Self> {
        let mut parts = s.split(',');
        let place = Self {
            x: parts.next()?.parse().ok()?,
            y: parts.next()?.parse().ok()?,
            width: parts.next()?.parse().ok()?,
            height: parts.next()?.parse().ok()?,
            maximized: parts.next()? == "1",
        };
        (place.width >= 400 && place.height >= 300).then_some(place)
    }

    fn encode(&self) -> String {
        format!(
            "{},{},{},{},{}",
            self.x, self.y, self.width, self.height, self.maximized as u8
        )
    }

    /// True when enough of the title bar lies on a screen `(x, y, width, height)` to grab it.
    /// A window last used on a monitor that is gone must not open out of reach.
    fn reachable_on(&self, (sx, sy, sw, sh): (i32, i32, u32, u32)) -> bool {
        let (left, right) = (
            self.x.max(sx),
            (self.x + self.width as i32).min(sx + sw as i32),
        );
        let top_inside = self.y >= sy - 8 && self.y < sy + sh as i32 - 48;
        right - left >= 120 && top_inside
    }
}

fn saved_place(app: &AppHandle) -> Option<Place> {
    let state = app.state::<AppState>();
    let raw = roots::get_setting(&state.db.reader(), WINDOW_KEY).ok()??;
    Place::parse(&raw)
}

/// Puts a freshly built (still hidden) main window back where it was last time.
fn restore_main_place(app: &AppHandle, window: &WebviewWindow) {
    let Some(place) = saved_place(app) else {
        return;
    };
    let screens = window.available_monitors().unwrap_or_default();
    let reachable = screens.iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        place.reachable_on((p.x, p.y, s.width, s.height))
    });
    if reachable {
        let _ = window.set_size(PhysicalSize::new(place.width, place.height));
        let _ = window.set_position(PhysicalPosition::new(place.x, place.y));
    }
    if place.maximized {
        let _ = window.maximize();
    }
}

/// Remembers the main window's place. A maximised or minimised window keeps the last normal
/// place, so un-maximising next time gives back a sensible size.
pub fn save_main_place(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let place = if maximized || minimized {
        saved_place(app).map(|p| Place { maximized, ..p })
    } else {
        match (window.outer_position(), window.inner_size()) {
            (Ok(pos), Ok(size)) => Some(Place {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                maximized: false,
            }),
            _ => None,
        }
    };
    let Some(place) = place.or(maximized.then_some(Place {
        x: 0,
        y: 0,
        width: 1200,
        height: 780,
        maximized: true,
    })) else {
        return;
    };
    if saved_place(app) != Some(place) {
        let db = &app.state::<AppState>().db;
        let _ = roots::set_setting(&db.writer(), WINDOW_KEY, &place.encode());
    }
}

// ---------------------------------------------------------------------------------------------
// Dragging a document out
// ---------------------------------------------------------------------------------------------

/// Small picture shown under the cursor while a document is dragged.
const DRAG_ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// Starts an OS drag carrying `path` as a file. The drop target receives a copy; the original
/// is never moved. Returns as soon as the drag is queued on the main thread.
pub fn drag_out(window: &WebviewWindow, path: PathBuf) -> AppResult<()> {
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let item = drag::DragItem::Files(vec![path]);
            let image = drag::Image::Raw(DRAG_ICON.to_vec());
            let options = drag::Options {
                skip_animatation_on_cancel_or_failure: false,
                mode: drag::DragMode::Copy,
            };
            #[cfg(target_os = "linux")]
            let result = match target.gtk_window() {
                Ok(gtk) => drag::start_drag(&gtk, item, image, |_, _| {}, options),
                Err(_) => Err(drag::Error::UnsupportedWindowHandle),
            };
            #[cfg(not(target_os = "linux"))]
            let result = drag::start_drag(&target, item, image, |_, _| {}, options);
            if let Err(e) = result {
                eprintln!("paperlight: could not start dragging: {e}");
            }
        })
        .map_err(tauri_err)
}

// ---------------------------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------------------------

/// The theme picked in Paperlight; `None` follows Windows.
fn saved_theme(app: &AppHandle) -> Option<Theme> {
    let state = app.state::<AppState>();
    let mode = roots::get_setting(&state.db.reader(), "theme")
        .ok()
        .flatten();
    match mode.as_deref() {
        Some("light") => Some(Theme::Light),
        Some("dark") => Some(Theme::Dark),
        _ => None,
    }
}

/// Gives a window the theme: its title bar and the colour behind the page.
fn apply_theme(window: &WebviewWindow, theme: Option<Theme>) {
    let _ = window.set_theme(theme);
    let dark = matches!(window.theme(), Ok(Theme::Dark));
    let _ = window.set_background_color(Some(if dark { PAPER_DARK } else { PAPER_LIGHT }));
}

/// Remembers the theme ("system", "light" or "dark") and applies it to every open window.
pub fn set_theme(app: &AppHandle, mode: &str) -> AppResult<()> {
    let mode = if matches!(mode, "light" | "dark") {
        mode
    } else {
        "system"
    };
    // The UI sends this on every launch; only write when it actually changed.
    let db = &app.state::<AppState>().db;
    let current = roots::get_setting(&db.reader(), "theme")?;
    if current.as_deref() != Some(mode) {
        roots::set_setting(&db.writer(), "theme", mode)?;
    }
    let theme = saved_theme(app);
    for window in app.webview_windows().values() {
        apply_theme(window, theme);
    }
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
        .background_color(PAPER_LIGHT)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(tauri_err)?;
    apply_theme(&window, saved_theme(app));
    Ok(window)
}

/// Moves the quick window to the upper third of the screen the cursor is on (like Spotlight /
/// PowerToys Run). Done every time it is shown, so it follows you between monitors.
fn place_quick(window: &WebviewWindow) {
    let cursor = window.cursor_position().ok();
    let screens = window.available_monitors().unwrap_or_default();
    let under_cursor = cursor.and_then(|c| {
        screens.iter().find(|m| {
            let (p, s) = (m.position(), m.size());
            let (x, y) = (c.x as i32, c.y as i32);
            x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
        })
    });
    let current = window.current_monitor().ok().flatten();
    let Some(monitor) = under_cursor.or(current.as_ref()) else {
        return;
    };
    let size = monitor.size();
    let pos = monitor.position();
    let w = (680.0 * monitor.scale_factor()) as i32;
    let x = pos.x + (size.width as i32 - w) / 2;
    let y = pos.y + (size.height as f64 * 0.18) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
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
    lock(&app.state::<ShellState>().quick_idle).hidden_at = None;
    place_quick(&window);
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
    {
        let shell = app.state::<ShellState>();
        let mut idle = lock(&shell.quick_idle);
        idle.hidden_at = Some(Instant::now());
        if idle.timer_running {
            return; // the running timer picks up the new time
        }
        idle.timer_running = true;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        // `Some(time left)` while hidden, `None` once shown again.
        let left = {
            let shell = app.state::<ShellState>();
            let mut idle = lock(&shell.quick_idle);
            let left = idle
                .hidden_at
                .map(|at| QUICK_IDLE.saturating_sub(at.elapsed()));
            if left.is_none_or(|l| l.is_zero()) {
                idle.timer_running = false;
                idle.hidden_at = None;
            }
            left
        };
        match left {
            Some(left) if !left.is_zero() => std::thread::sleep(left),
            // Idle long enough: free the window. The lock is released first, because
            // destroying a window waits for the main thread, which may want that lock.
            Some(_) => {
                if let Some(window) = app.get_webview_window(QUICK) {
                    let _ = window.destroy();
                }
                return;
            }
            None => return,
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Hotkey, tray, autostart
// ---------------------------------------------------------------------------------------------

/// The hotkey the user chose in Settings, if any.
fn custom_hotkey(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let saved = roots::get_setting(&state.db.reader(), HOTKEY_KEY);
    saved.ok().flatten().filter(|k| !k.is_empty())
}

pub fn hotkey_is_custom(app: &AppHandle) -> bool {
    let current = hotkey(app);
    current.is_some() && current == custom_hotkey(app)
}

/// Registers the user's hotkey, or else the first default that is free.
fn register_hotkey(app: &AppHandle) {
    let custom = custom_hotkey(app);
    let candidates = custom
        .iter()
        .map(String::as_str)
        .chain(HOTKEYS.iter().copied());
    let mut registered = None;
    for key in candidates {
        if app.global_shortcut().register(key).is_ok() {
            registered = Some(key.to_string());
            break;
        }
    }
    if registered.is_none() {
        eprintln!("paperlight: no global hotkey available");
    }
    *lock(&app.state::<ShellState>().hotkey) = registered;
}

/// Changes the quick-search hotkey. `None` returns to the defaults. If the new keys can't be
/// registered (another app owns them), the previous hotkey is put back and an error returned.
pub fn set_hotkey(app: &AppHandle, keys: Option<&str>) -> AppResult<Option<String>> {
    let shortcuts = app.global_shortcut();
    let previous = hotkey(app);
    if let Some(old) = &previous {
        let _ = shortcuts.unregister(old.as_str());
    }
    let db = &app.state::<AppState>().db;
    match keys.map(str::trim).filter(|k| !k.is_empty()) {
        Some(keys) => {
            if shortcuts.register(keys).is_err() {
                if let Some(old) = &previous {
                    let _ = shortcuts.register(old.as_str());
                }
                return Err(AppError::msg(format!(
                    "{keys} can't be used: another app already has it, or the system reserves it."
                )));
            }
            roots::set_setting(&db.writer(), HOTKEY_KEY, keys)?;
            *lock(&app.state::<ShellState>().hotkey) = Some(keys.to_string());
        }
        None => {
            roots::set_setting(&db.writer(), HOTKEY_KEY, "")?;
            register_hotkey(app);
        }
    }
    let now = hotkey(app);
    if let Some(item) = lock(&app.state::<ShellState>().quick_item).as_ref() {
        let _ = item.set_text(quick_label(now.as_deref()));
    }
    Ok(now)
}

fn quick_label(hotkey: Option<&str>) -> String {
    match hotkey {
        Some(key) => format!("Quick search\t{}", key.replace("Super", "Win")),
        None => "Quick search".to_string(),
    }
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
    let quick_label = quick_label(hotkey(app).as_deref());
    let open =
        MenuItem::with_id(app, "open", "Open Paperlight", true, None::<&str>).map_err(tauri_err)?;
    let quick =
        MenuItem::with_id(app, "quick", quick_label, true, None::<&str>).map_err(tauri_err)?;
    let rescan =
        MenuItem::with_id(app, "rescan", "Rescan now", true, None::<&str>).map_err(tauri_err)?;
    let startup = CheckMenuItem::with_id(
        app,
        "startup",
        STARTUP_LABEL,
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

    *lock(&app.state::<ShellState>().startup_item) = Some(startup.clone());
    *lock(&app.state::<ShellState>().quick_item) = Some(quick.clone());
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
            "quit" => {
                save_main_place(app);
                app.exit(0)
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_place_round_trips_and_rejects_nonsense() {
        let place = Place {
            x: -1200,
            y: 40,
            width: 1100,
            height: 700,
            maximized: true,
        };
        assert_eq!(Place::parse(&place.encode()), Some(place));
        assert_eq!(Place::parse(""), None);
        assert_eq!(Place::parse("0,0,10,10,0"), None); // too small to be a real window
        assert_eq!(Place::parse("a,b,c,d,e"), None);
    }

    #[test]
    fn window_is_only_restored_where_it_can_be_reached() {
        let screen = (0, 0, 1920, 1080);
        let at = |x, y| Place {
            x,
            y,
            width: 1000,
            height: 700,
            maximized: false,
        };
        assert!(at(100, 100).reachable_on(screen));
        assert!(at(-800, 100).reachable_on(screen)); // 200 px still on screen
        assert!(!at(-950, 100).reachable_on(screen)); // only a sliver left
        assert!(!at(2500, 100).reachable_on(screen)); // on a monitor that is gone
        assert!(!at(100, 1060).reachable_on(screen)); // title bar below the screen
    }
}
