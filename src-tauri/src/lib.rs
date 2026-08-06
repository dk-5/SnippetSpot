mod apps;
mod backup;
mod clipboard;
mod hotkey;
mod migrate;
mod paste;
mod secrets;
mod variables;
mod vault;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize};

pub(crate) struct Settings {
    pub(crate) hotkey: Mutex<String>,
    pub(crate) paste_mode: Mutex<String>,
    pub(crate) clipboard_enabled: Mutex<bool>,
    pub(crate) clipboard_cap: Mutex<usize>,
    pub(crate) backup_retention: Mutex<u32>,
    pub(crate) show_popup_on_startup: Mutex<bool>,
}

const DEFAULT_HOTKEY: &str = "Alt+Space";
const DEFAULT_PASTE_MODE: &str = "paste";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            do_show_popup(app);
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:snippetspot.db", migrate::migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let settings = load_settings(&handle);
            let hotkey = settings.hotkey.lock().unwrap().clone();
            let paste_mode = settings.paste_mode.lock().unwrap().clone();
            let clipboard_enabled = *settings.clipboard_enabled.lock().unwrap();
            let clipboard_cap = *settings.clipboard_cap.lock().unwrap();
            let backup_retention = *settings.backup_retention.lock().unwrap();
            let show_popup_on_startup = *settings.show_popup_on_startup.lock().unwrap();
            handle.manage(Settings {
                hotkey: Mutex::new(hotkey.clone()),
                paste_mode: Mutex::new(paste_mode),
                clipboard_enabled: Mutex::new(clipboard_enabled),
                clipboard_cap: Mutex::new(clipboard_cap),
                backup_retention: Mutex::new(backup_retention),
                show_popup_on_startup: Mutex::new(show_popup_on_startup),
            });
            handle.manage(clipboard::ClipboardState {
                enabled: Mutex::new(clipboard_enabled),
                cap: Mutex::new(clipboard_cap),
                last_app_write: Mutex::new(std::time::Instant::now()),
            });
            let pending_show_popup = Arc::new(AtomicBool::new(show_popup_on_startup));
            handle.manage(apps::AppsState {
                items: Mutex::new(Vec::new()),
            });
            apps::start_enumeration(handle.clone());

            if let Err(e) = hotkey::start_hotkey(handle.clone(), &hotkey) {
                eprintln!("[snippetspot] failed to start hotkey: {e}");
            }

            if let Err(e) = build_tray(&handle) {
                eprintln!("[snippetspot] failed to build tray: {e}");
            }

            clipboard::start_watcher(handle.clone());
            {
                let backup_handle = handle.clone();
                std::thread::spawn(move || backup::run_startup_backup(&backup_handle));
            }

            if show_popup_on_startup {
                let listener_handle = handle.clone();
                let listener_pending = pending_show_popup.clone();
                let _ = handle.listen("popup-ready", move |_| {
                    if listener_pending.swap(false, Ordering::SeqCst) {
                        apply_window_effects(&listener_handle);
                        crate::do_show_popup(&listener_handle);
                    }
                });
                let fallback_handle = handle.clone();
                std::thread::spawn(move || {
                    for _ in 0..60 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if !pending_show_popup.load(Ordering::SeqCst) {
                            return;
                        }
                    }
                    if pending_show_popup.swap(false, Ordering::SeqCst) {
                        apply_window_effects(&fallback_handle);
                        crate::do_show_popup(&fallback_handle);
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "popup" {
                    let _ = window.hide();
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "manager" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            show_popup,
            hide_popup,
            toggle_popup,
            open_manager,
            paste_snippet,
            expand_variables,
            get_hotkey,
            set_hotkey,
            get_paste_mode,
            set_paste_mode,
            get_autostart,
            set_autostart,
            get_show_on_startup,
            set_show_on_startup,
            apps::app_list,
            apps::app_launch,
            read_text_file,
            write_text_file,
            quit_app,
            get_app_version,
            vault::vault_list,
            vault::vault_create,
            vault::vault_update,
            vault::vault_delete,
            vault::vault_reveal_secret,
            vault::vault_copy_secret,
            vault::vault_paste_username,
            vault::vault_paste_secret,
            clipboard::clipboard_get_enabled,
            clipboard::clipboard_set_enabled,
            clipboard::clipboard_get_cap,
            clipboard::clipboard_set_cap,
            clipboard::clipboard_list,
            clipboard::clipboard_delete,
            clipboard::clipboard_clear,
            clipboard::clipboard_toggle_pin,
            clipboard::clipboard_paste,
            backup::backup_now,
            backup::backup_list,
            backup::backup_restore,
            backup::backup_get_retention,
            backup::backup_set_retention,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub(crate) fn do_show_popup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("popup") {
        if let Ok(position) = app.cursor_position() {
            if let Ok(monitors) = app.available_monitors() {
                if let Some(monitor) = monitors.iter().find(|m| {
                    let p = m.position();
                    let s = m.size();
                    position.x >= p.x as f64
                        && position.x <= (p.x + s.width as i32) as f64
                        && position.y >= p.y as f64
                        && position.y <= (p.y + s.height as i32) as f64
                }) {
                    let work_area = monitor.work_area();
                    let size = window
                        .outer_size()
                        .unwrap_or_else(|_| PhysicalSize::new(680, 460));
                    let x = work_area.position.x
                        + ((work_area.size.width as i32 - size.width as i32) / 2).max(0);
                    let y = work_area.position.y
                        + ((work_area.size.height as i32 - size.height as i32) / 2).max(0);
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
            }
        }
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("popup-shown", ());
    }
}

pub(crate) fn do_hide_popup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("popup") {
        let _ = window.hide();
    }
}

fn do_open_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("manager") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn apply_window_effects(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("popup") {
        use tauri::window::{Effect, EffectState, EffectsBuilder};

        let acrylic = EffectsBuilder::new()
            .effect(Effect::Acrylic)
            .state(EffectState::FollowsWindowActiveState)
            .build();
        if window.set_effects(acrylic).is_err() {
            let blur = EffectsBuilder::new()
                .effect(Effect::Blur)
                .state(EffectState::FollowsWindowActiveState)
                .build();
            let _ = window.set_effects(blur);
        }
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "open", "Open Launcher", true, None::<&str>)?;
    let manager = MenuItem::with_id(app, "manager", "Open Manager", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &manager, &separator, &quit])?;

    let _tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => do_show_popup(app),
            "manager" => do_open_manager(app),
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
                do_show_popup(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn load_settings(app: &AppHandle) -> crate::Settings {
    use tauri_plugin_store::StoreExt;

    let store = match app.store("settings.json") {
        Ok(store) => store,
        Err(e) => {
            eprintln!("[snippetspot] failed to open settings store: {e}");
            return Settings {
                hotkey: Mutex::new(DEFAULT_HOTKEY.to_string()),
                paste_mode: Mutex::new(DEFAULT_PASTE_MODE.to_string()),
                clipboard_enabled: Mutex::new(clipboard::DEFAULT_CLIPBOARD_HISTORY_ENABLED),
                clipboard_cap: Mutex::new(clipboard::DEFAULT_CLIPBOARD_HISTORY_CAP),
                backup_retention: Mutex::new(backup::DEFAULT_BACKUP_RETENTION),
                show_popup_on_startup: Mutex::new(false),
            };
        }
    };

    let hotkey = store
        .get("hotkey")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());
    let paste_mode = store
        .get("paste_mode")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| DEFAULT_PASTE_MODE.to_string());
    let clipboard_enabled = store
        .get("clipboard_history_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(clipboard::DEFAULT_CLIPBOARD_HISTORY_ENABLED);
    let clipboard_cap = store
        .get("clipboard_history_cap")
        .and_then(|v| v.as_u64().map(|n| n as usize))
        .unwrap_or(clipboard::DEFAULT_CLIPBOARD_HISTORY_CAP);
    let backup_retention = store
        .get("backup_retention")
        .and_then(|v| v.as_u64().map(|n| n as u32))
        .unwrap_or(backup::DEFAULT_BACKUP_RETENTION);
    let show_popup_on_startup = store
        .get("show_popup_on_startup")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut changed = false;
    if store.get("hotkey").is_none() {
        store.set("hotkey", DEFAULT_HOTKEY);
        changed = true;
    }
    if store.get("paste_mode").is_none() {
        store.set("paste_mode", DEFAULT_PASTE_MODE);
        changed = true;
    }
    if store.get("clipboard_history_enabled").is_none() {
        store.set("clipboard_history_enabled", clipboard::DEFAULT_CLIPBOARD_HISTORY_ENABLED);
        changed = true;
    }
    if store.get("clipboard_history_cap").is_none() {
        store.set("clipboard_history_cap", clipboard::DEFAULT_CLIPBOARD_HISTORY_CAP);
        changed = true;
    }
    if store.get("backup_retention").is_none() {
        store.set("backup_retention", backup::DEFAULT_BACKUP_RETENTION);
        changed = true;
    }
    if store.get("show_popup_on_startup").is_none() {
        store.set("show_popup_on_startup", false);
        changed = true;
    }
    if changed {
        if let Err(e) = store.save() {
            eprintln!("[snippetspot] failed to persist settings: {e}");
        }
    }

    Settings {
        hotkey: Mutex::new(hotkey),
        paste_mode: Mutex::new(paste_mode),
        clipboard_enabled: Mutex::new(clipboard_enabled),
        clipboard_cap: Mutex::new(clipboard_cap),
        backup_retention: Mutex::new(backup_retention),
        show_popup_on_startup: Mutex::new(show_popup_on_startup),
    }
}

fn get_setting(app: &AppHandle, key: &str) -> Option<String> {
    use tauri_plugin_store::StoreExt;

    app.store("settings.json")
        .ok()?
        .get(key)
        .and_then(|v| v.as_str().map(str::to_string))
}

fn set_setting(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set(key, value);
    store.save().map_err(|e| e.to_string())
}

pub(crate) fn current_paste_mode(app: &AppHandle) -> String {
    if let Some(state) = app.try_state::<Settings>() {
        state.paste_mode.lock().unwrap().clone()
    } else {
        get_setting(app, "paste_mode").unwrap_or_else(|| DEFAULT_PASTE_MODE.to_string())
    }
}

pub(crate) fn app_db_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .map(|d| d.join("snippetspot.db"))
        .unwrap_or_default()
}

pub(crate) fn open_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let path = app_db_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub(crate) fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub(crate) fn get_setting_value(app: &AppHandle, key: &str) -> Option<serde_json::Value> {
    use tauri_plugin_store::StoreExt;

    app.store("settings.json").ok()?.get(key)
}

pub(crate) fn set_setting_value(
    app: &AppHandle,
    key: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set(key, value);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_popup(app: AppHandle) {
    do_show_popup(&app);
}

#[tauri::command]
fn hide_popup(app: AppHandle) {
    do_hide_popup(&app);
}

#[tauri::command]
fn toggle_popup(app: AppHandle) {
    let visible = app
        .get_webview_window("popup")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        do_hide_popup(&app);
    } else {
        do_show_popup(&app);
    }
}

#[tauri::command]
fn open_manager(app: AppHandle) {
    do_open_manager(&app);
}

#[tauri::command]
fn paste_snippet(app: AppHandle, content: String) {
    let clipboard = arboard::Clipboard::new()
        .and_then(|mut clip| clip.get_text().map(|t| t.to_string()))
        .ok();
    let expanded = variables::expand_variables(&content, clipboard.as_deref());
    let mode = current_paste_mode(&app);
    paste::paste_text(&app, &expanded, &mode);
}

#[tauri::command]
fn expand_variables(text: String) -> String {
    let clipboard = arboard::Clipboard::new()
        .and_then(|mut clip| clip.get_text().map(|t| t.to_string()))
        .ok();
    variables::expand_variables(&text, clipboard.as_deref())
}

#[tauri::command]
fn get_hotkey(app: AppHandle) -> String {
    if let Some(state) = app.try_state::<Settings>() {
        state.hotkey.lock().unwrap().clone()
    } else {
        get_setting(&app, "hotkey").unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
    }
}

#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    hotkey::parse_hotkey(&hotkey)?;
    hotkey::update_hotkey(&hotkey)?;
    set_setting(&app, "hotkey", &hotkey)?;
    if let Some(state) = app.try_state::<Settings>() {
        *state.hotkey.lock().unwrap() = hotkey;
    }
    Ok(())
}

#[tauri::command]
fn get_paste_mode(app: AppHandle) -> String {
    current_paste_mode(&app)
}

#[tauri::command]
fn set_paste_mode(app: AppHandle, mode: String) -> Result<(), String> {
    if mode != "paste" && mode != "type" {
        return Err(format!("invalid paste mode: '{mode}'"));
    }
    set_setting(&app, "paste_mode", &mode)?;
    if let Some(state) = app.try_state::<Settings>() {
        *state.paste_mode.lock().unwrap() = mode;
    }
    Ok(())
}

#[tauri::command]
fn get_autostart(_app: AppHandle) -> bool {
    autostart_enabled()
}

#[tauri::command]
fn set_autostart(_app: AppHandle, enabled: bool) -> Result<(), String> {
    autostart_set(enabled)
}

#[tauri::command]
fn get_show_on_startup(app: AppHandle) -> bool {
    if let Some(state) = app.try_state::<Settings>() {
        *state.show_popup_on_startup.lock().unwrap()
    } else {
        crate::get_setting_value(&app, "show_popup_on_startup")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }
}

#[tauri::command]
fn set_show_on_startup(app: AppHandle, enabled: bool) -> Result<(), String> {
    autostart_set(enabled)?;
    crate::set_setting_value(&app, "show_popup_on_startup", serde_json::Value::Bool(enabled))?;
    if let Some(state) = app.try_state::<Settings>() {
        *state.show_popup_on_startup.lock().unwrap() = enabled;
    }
    Ok(())
}

const AUTOSTART_VALUE: &str = "SnippetSpot";
const AUTOSTART_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

fn autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(AUTOSTART_RUN_KEY) {
        return key.get_value::<String, _>(AUTOSTART_VALUE).is_ok();
    }
    false
}

fn autostart_set(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(AUTOSTART_RUN_KEY, KEY_QUERY_VALUE | KEY_SET_VALUE)
        .map_err(|e| e.to_string())?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(AUTOSTART_VALUE, &format!("\"{}\"", exe.display()))
            .map_err(|e| e.to_string())
    } else {
        match key.delete_value(AUTOSTART_VALUE) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
