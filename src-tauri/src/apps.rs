use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub struct AppsState {
    pub items: Mutex<Vec<AppItem>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AppItem {
    pub name: String,
    pub path: String,
}

const UWP_CACHE_FRESH_SECS: u64 = 24 * 60 * 60;

pub fn start_enumeration(app: AppHandle) {
    std::thread::spawn(move || {
        let base = enumerate_apps_base();
        let (cached_uwp, fresh) = load_uwp_cache(&app);
        let mut items = base.clone();
        items.extend(cached_uwp);
        let items = dedupe_and_sort(items);
        if let Some(state) = app.try_state::<AppsState>() {
            *state.items.lock().unwrap() = items.clone();
        }
        save_cache(&app, &items);
        crate::startup_log(&app, &format!("apps enumerated: {} items", items.len()));
        let _ = app.emit("apps-changed", ());

        if fresh {
            return;
        }
        let fresh_uwp = enumerate_apps_uwp();
        save_uwp_cache(&app, &fresh_uwp);
        let mut all = base;
        all.extend(fresh_uwp);
        let all = dedupe_and_sort(all);
        if let Some(state) = app.try_state::<AppsState>() {
            *state.items.lock().unwrap() = all.clone();
        }
        save_cache(&app, &all);
        crate::startup_log(&app, &format!("apps refreshed (uwp): {} items", all.len()));
        let _ = app.emit("apps-changed", ());
    });
}

#[tauri::command]
pub fn app_list(app: AppHandle) -> Vec<AppItem> {
    let items = if let Some(state) = app.try_state::<AppsState>() {
        let mut guard = state.items.lock().unwrap();
        if guard.is_empty() {
            let cached = load_cache(&app);
            if !cached.is_empty() {
                *guard = cached;
            }
        }
        guard.clone()
    } else {
        Vec::new()
    };
    filter_and_limit(&items, "", usize::MAX)
}

fn cache_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("apps.json"))
}

#[derive(Serialize, Deserialize)]
struct UwpCache {
    timestamp: u64,
    items: Vec<AppItem>,
}

fn uwp_cache_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("uwp.json"))
}

fn load_uwp_cache(app: &AppHandle) -> (Vec<AppItem>, bool) {
    let Some(path) = uwp_cache_path(app) else {
        return (Vec::new(), false);
    };
    let Ok(json) = std::fs::read_to_string(path) else {
        return (Vec::new(), false);
    };
    let Ok(cache) = serde_json::from_str::<UwpCache>(&json) else {
        return (Vec::new(), false);
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let fresh = now.saturating_sub(cache.timestamp) < UWP_CACHE_FRESH_SECS;
    (cache.items, fresh)
}

fn save_uwp_cache(app: &AppHandle, items: &[AppItem]) {
    let Some(path) = uwp_cache_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cache = UwpCache {
        timestamp: now,
        items: items.to_vec(),
    };
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = std::fs::write(path, json);
    }
}

fn load_cache(app: &AppHandle) -> Vec<AppItem> {
    let Some(path) = cache_path(app) else {
        return Vec::new();
    };
    match std::fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_cache(app: &AppHandle, items: &[AppItem]) {
    let Some(path) = cache_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match serde_json::to_string(items) {
        Ok(json) => {
            let _ = std::fs::write(path, json);
        }
        Err(_) => {}
    }
}

#[tauri::command]
pub fn app_launch(app: AppHandle, path: String) -> Result<(), String> {
    crate::license::ensure_allowed(&app)?;
    launch_path(&path)
}

fn filter_and_limit(items: &[AppItem], query: &str, limit: usize) -> Vec<AppItem> {
    let needle = query.trim().to_lowercase();
    items
        .iter()
        .filter(|item| needle.is_empty() || item.name.to_lowercase().contains(&needle))
        .take(limit)
        .cloned()
        .collect()
}

fn dedupe_and_sort(items: Vec<AppItem>) -> Vec<AppItem> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::with_capacity(items.len());
    for item in items {
        if seen.insert(normalize_path(&item.path)) {
            result.push(item);
        }
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

fn normalize_path(path: &str) -> String {
    std::path::Path::new(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string())
        .to_lowercase()
}

fn parse_startapps_json(json: &str) -> Vec<AppItem> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let entries = match value {
        serde_json::Value::Array(arr) => arr,
        serde_json::Value::Object(_) => vec![value],
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries {
        let (Some(name), Some(app_id)) = (
            entry.get("Name").and_then(|v| v.as_str()),
            entry.get("AppID").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        if !app_id.contains('!') {
            continue;
        }
        out.push(AppItem {
            name: name.to_string(),
            path: format!("shell:AppsFolder\\{app_id}"),
        });
    }
    out
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    pub fn enumerate_apps_base() -> Vec<AppItem> {
        let mut items = Vec::new();
        collect_start_menu(&mut items);
        collect_registry(&mut items);
        dedupe_and_sort(items)
    }

    pub fn enumerate_apps_uwp() -> Vec<AppItem> {
        let mut items = Vec::new();
        collect_uwp(&mut items);
        items
    }

    fn collect_uwp(items: &mut Vec<AppItem>) {
        use std::os::windows::process::CommandExt;

        let Ok(output) = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x08000000)
            .output()
        else {
            return;
        };
        items.extend(parse_startapps_json(&String::from_utf8_lossy(
            &output.stdout,
        )));
    }

    pub fn launch_path(path: &str) -> Result<(), String> {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide = HSTRING::from(path);
        let result =
            unsafe { ShellExecuteW(None, None, PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL) };
        if (result.0 as isize) <= 32 {
            Err(format!("failed to launch '{path}'"))
        } else {
            Ok(())
        }
    }

    fn collect_start_menu(items: &mut Vec<AppItem>) {
        let mut roots = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            roots.push(
                std::path::PathBuf::from(appdata).join("Microsoft\\Windows\\Start Menu\\Programs"),
            );
        }
        roots.push(std::path::PathBuf::from(
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
        ));
        for root in roots {
            walk_dir(&root, items);
        }
    }

    fn walk_dir(dir: &std::path::Path, items: &mut Vec<AppItem>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if file_name.eq_ignore_ascii_case("Startup") && path.is_dir() {
                continue;
            }
            if path.is_dir() {
                walk_dir(&path, items);
            } else if file_name.to_ascii_lowercase().ends_with(".lnk") {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                items.push(AppItem {
                    name,
                    path: path.to_string_lossy().into_owned(),
                });
            }
        }
    }

    fn collect_registry(items: &mut Vec<AppItem>) {
        for (root, subkey_path) in registry_roots() {
            let Ok(subkey) = root.open_subkey(subkey_path) else {
                continue;
            };
            for key_name in subkey.enum_keys().flatten() {
                let Ok(exe_path) = subkey
                    .open_subkey(&key_name)
                    .and_then(|k| k.get_value::<String, _>(""))
                else {
                    continue;
                };
                let name = strip_exe(&key_name);
                items.push(AppItem {
                    name,
                    path: exe_path,
                });
            }
        }
    }

    fn registry_roots() -> Vec<(RegKey, &'static str)> {
        vec![
            (
                RegKey::predef(HKEY_LOCAL_MACHINE),
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            ),
            (
                RegKey::predef(HKEY_CURRENT_USER),
                "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            ),
        ]
    }

    fn strip_exe(key_name: &str) -> String {
        if key_name.len() > 4 && key_name[key_name.len() - 4..].eq_ignore_ascii_case(".exe") {
            key_name[..key_name.len() - 4].to_string()
        } else {
            key_name.to_string()
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;

    pub fn enumerate_apps_base() -> Vec<AppItem> {
        Vec::new()
    }

    pub fn enumerate_apps_uwp() -> Vec<AppItem> {
        Vec::new()
    }

    pub fn launch_path(_path: &str) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_by_name_case_insensitively() {
        let items = vec![
            AppItem {
                name: "Firefox".into(),
                path: "C:\\ff.exe".into(),
            },
            AppItem {
                name: "Notepad".into(),
                path: "C:\\np.exe".into(),
            },
        ];
        let result = filter_and_limit(&items, "FIRE", usize::MAX);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Firefox");
    }

    #[test]
    fn filter_respects_limit() {
        let items = vec![
            AppItem {
                name: "Alpha".into(),
                path: "C:\\a.exe".into(),
            },
            AppItem {
                name: "Alphabet".into(),
                path: "C:\\b.exe".into(),
            },
        ];
        let result = filter_and_limit(&items, "alph", 1);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Alpha");
    }

    #[test]
    fn dedupes_by_lowercase_path_and_sorts() {
        let items = vec![
            AppItem {
                name: "Visual Studio Code".into(),
                path: "C:\\Program Files\\Microsoft VS Code\\Code.exe".into(),
            },
            AppItem {
                name: "Code".into(),
                path: "c:\\program files\\microsoft vs code\\code.exe".into(),
            },
            AppItem {
                name: "Notepad".into(),
                path: "C:\\Windows\\Notepad.exe".into(),
            },
        ];
        let result = dedupe_and_sort(items);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "Notepad");
        assert_eq!(result[1].name, "Visual Studio Code");
    }

    #[test]
    fn startapps_includes_store_apps_only() {
        let json = r#"[{"Name":"WhatsApp","AppID":"5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"},{"Name":"Notepad","AppID":"Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"},{"Name":"Chrome","AppID":"Chrome"}]"#;
        let result = parse_startapps_json(json);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "WhatsApp");
        assert_eq!(
            result[0].path,
            "shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"
        );
        assert_eq!(result[1].name, "Notepad");
    }

    #[test]
    fn startapps_handles_single_object() {
        let json = r#"{"Name":"Terminal","AppID":"Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"}"#;
        let result = parse_startapps_json(json);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Terminal");
    }

    #[test]
    fn startapps_bad_json_returns_empty() {
        assert!(parse_startapps_json("not json").is_empty());
        assert!(parse_startapps_json("").is_empty());
        assert!(parse_startapps_json("42").is_empty());
    }
}
