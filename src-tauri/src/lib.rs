mod hotkey;
mod migrate;
mod paste;
mod variables;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

struct Settings {
    hotkey: Mutex<String>,
    paste_mode: Mutex<String>,
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
            handle.manage(Settings {
                hotkey: Mutex::new(hotkey.clone()),
                paste_mode: Mutex::new(paste_mode),
            });

            apply_window_effects(&handle);

            if let Err(e) = hotkey::start_hotkey(handle.clone(), &hotkey) {
                eprintln!("[snippetspot] failed to start hotkey: {e}");
            }

            if let Err(e) = build_tray(&handle) {
                eprintln!("[snippetspot] failed to build tray: {e}");
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
            read_text_file,
            write_text_file,
            quit_app,
            get_app_version,
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

    let mut changed = false;
    if store.get("hotkey").is_none() {
        store.set("hotkey", DEFAULT_HOTKEY);
        changed = true;
    }
    if store.get("paste_mode").is_none() {
        store.set("paste_mode", DEFAULT_PASTE_MODE);
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

fn current_paste_mode(app: &AppHandle) -> String {
    if let Some(state) = app.try_state::<Settings>() {
        state.paste_mode.lock().unwrap().clone()
    } else {
        get_setting(app, "paste_mode").unwrap_or_else(|| DEFAULT_PASTE_MODE.to_string())
    }
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
fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;

    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
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
