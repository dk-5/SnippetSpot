use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const DEFAULT_CLIPBOARD_HISTORY_ENABLED: bool = true;
pub(crate) const DEFAULT_CLIPBOARD_HISTORY_CAP: usize = 500;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const APP_WRITE_SUPPRESSION: Duration = Duration::from_secs(1);
const MAX_ENTRY_LENGTH: usize = 5000;
const RETENTION_DAYS: i64 = 7;

pub struct ClipboardState {
    pub enabled: Mutex<bool>,
    pub cap: Mutex<usize>,
    pub last_app_write: Mutex<Instant>,
}

#[derive(serde::Serialize)]
pub struct ClipboardEntryDto {
    pub id: String,
    pub content: String,
    pub pinned: bool,
    pub created_at: String,
}

pub fn mark_app_clipboard_write(app: &AppHandle) {
    if let Some(state) = app.try_state::<ClipboardState>() {
        *state.last_app_write.lock().unwrap() = Instant::now();
    }
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<String> = None;
        loop {
            std::thread::sleep(POLL_INTERVAL);
            if !clipboard_enabled(&app) {
                continue;
            }
            let text = arboard::Clipboard::new()
                .and_then(|mut clip| clip.get_text().map(|t| t.to_string()))
                .ok();
            let Some(text) = text else { continue };
            if text.is_empty()
                || text.chars().count() > MAX_ENTRY_LENGTH
                || crate::secrets::looks_like_secret(&text)
            {
                continue;
            }
            if last.as_deref() == Some(text.as_str()) {
                continue;
            }
            if let Some(state) = app.try_state::<ClipboardState>() {
                if state.last_app_write.lock().unwrap().elapsed() < APP_WRITE_SUPPRESSION {
                    continue;
                }
            }
            last = Some(text.clone());
            let cap = clipboard_cap(&app);
            let id = uuid::Uuid::new_v4().to_string();
            let created_at = crate::now_iso();
            let mut changed = false;
            if let Ok(conn) = crate::open_db(&app) {
                if conn
                    .execute(
                        "INSERT INTO clipboard_entries (id, content, created_at, pinned) VALUES (?1, ?2, ?3, 0)",
                        rusqlite::params![id, text, created_at],
                    )
                    .map_err(|e| e.to_string())
                    .and_then(|_| prune(&conn, cap))
                    .is_ok()
                {
                    changed = true;
                }
            }
            if changed {
                let _ = app.emit("clipboard-history-changed", ());
            }
        }
    });
}

fn clipboard_enabled(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<ClipboardState>() {
        *state.enabled.lock().unwrap()
    } else if let Some(settings) = app.try_state::<crate::Settings>() {
        *settings.clipboard_enabled.lock().unwrap()
    } else {
        get_enabled_setting(app).unwrap_or(DEFAULT_CLIPBOARD_HISTORY_ENABLED)
    }
}

fn clipboard_cap(app: &AppHandle) -> usize {
    if let Some(state) = app.try_state::<ClipboardState>() {
        *state.cap.lock().unwrap()
    } else if let Some(settings) = app.try_state::<crate::Settings>() {
        *settings.clipboard_cap.lock().unwrap()
    } else {
        get_cap_setting(app).unwrap_or(DEFAULT_CLIPBOARD_HISTORY_CAP)
    }
}

fn get_enabled_setting(app: &AppHandle) -> Option<bool> {
    crate::get_setting_value(app, "clipboard_history_enabled")?.as_bool()
}

fn get_cap_setting(app: &AppHandle) -> Option<usize> {
    crate::get_setting_value(app, "clipboard_history_cap")?
        .as_u64()
        .map(|v| v as usize)
}

fn prune(conn: &Connection, cap: usize) -> Result<(), String> {
    prune_at(conn, cap, chrono::Utc::now())
}

fn prune_at(
    conn: &Connection,
    cap: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), String> {
    let cutoff = retention_cutoff(now);
    conn.execute(
        "DELETE FROM clipboard_entries WHERE created_at < ?1",
        rusqlite::params![cutoff.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()],
    )
    .map_err(|e| e.to_string())?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM clipboard_entries", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let to_delete = oldest_to_delete(total, cap);
    if to_delete > 0 {
        conn.execute(
            "DELETE FROM clipboard_entries WHERE id IN (
                SELECT id FROM clipboard_entries ORDER BY created_at ASC, id ASC LIMIT ?1
            )",
            rusqlite::params![to_delete],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn retention_cutoff(now: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc> {
    now - chrono::Duration::days(RETENTION_DAYS)
}

fn oldest_to_delete(total: i64, cap: usize) -> i64 {
    (total - cap as i64).max(0)
}

#[tauri::command]
pub fn clipboard_get_enabled(app: AppHandle) -> bool {
    clipboard_enabled(&app)
}

#[tauri::command]
pub fn clipboard_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<ClipboardState>() {
        *state.enabled.lock().unwrap() = enabled;
    }
    if let Some(settings) = app.try_state::<crate::Settings>() {
        *settings.clipboard_enabled.lock().unwrap() = enabled;
    }
    crate::set_setting_value(
        &app,
        "clipboard_history_enabled",
        serde_json::Value::Bool(enabled),
    )?;
    Ok(())
}

#[tauri::command]
pub fn clipboard_get_cap(app: AppHandle) -> u32 {
    clipboard_cap(&app) as u32
}

#[tauri::command]
pub fn clipboard_set_cap(app: AppHandle, cap: u32) -> Result<(), String> {
    if let Some(state) = app.try_state::<ClipboardState>() {
        *state.cap.lock().unwrap() = cap as usize;
    }
    if let Some(settings) = app.try_state::<crate::Settings>() {
        *settings.clipboard_cap.lock().unwrap() = cap as usize;
    }
    crate::set_setting_value(
        &app,
        "clipboard_history_cap",
        serde_json::Value::Number(cap.into()),
    )?;
    Ok(())
}

#[tauri::command]
pub fn clipboard_list(app: AppHandle) -> Result<Vec<ClipboardEntryDto>, String> {
    let conn = crate::open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, content, pinned, created_at FROM clipboard_entries ORDER BY pinned DESC, created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let pinned: i64 = row.get(2)?;
            Ok(ClipboardEntryDto {
                id: row.get(0)?,
                content: row.get(1)?,
                pinned: pinned != 0,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_delete(app: AppHandle, id: String) -> Result<(), String> {
    let conn = crate::open_db(&app)?;
    conn.execute("DELETE FROM clipboard_entries WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-history-changed", ());
    Ok(())
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle) -> Result<(), String> {
    let conn = crate::open_db(&app)?;
    conn.execute("DELETE FROM clipboard_entries", [])
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-history-changed", ());
    Ok(())
}

#[tauri::command]
pub fn clipboard_toggle_pin(app: AppHandle, id: String) -> Result<(), String> {
    let conn = crate::open_db(&app)?;
    conn.execute(
        "UPDATE clipboard_entries SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-history-changed", ());
    Ok(())
}

#[tauri::command]
pub fn clipboard_paste(app: AppHandle, id: String) -> Result<(), String> {
    let conn = crate::open_db(&app)?;
    let content: String = conn
        .query_row(
            "SELECT content FROM clipboard_entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mode = crate::current_paste_mode(&app);
    crate::paste::paste_text(&app, &content, &mode);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oldest_to_delete_counts_excess() {
        assert_eq!(oldest_to_delete(10, 5), 5);
        assert_eq!(oldest_to_delete(5, 5), 0);
        assert_eq!(oldest_to_delete(3, 500), 0);
        assert_eq!(oldest_to_delete(0, 0), 0);
    }

    #[test]
    fn cutoff_is_exactly_seven_days() {
        let now = chrono::Utc::now();
        let cutoff = retention_cutoff(now);
        assert_eq!(
            now.signed_duration_since(cutoff).num_seconds(),
            7 * 24 * 60 * 60
        );
    }

    #[test]
    fn secret_text_is_filtered() {
        assert!(crate::secrets::looks_like_secret("my key sk-1234567890"));
        assert!(crate::secrets::looks_like_secret("BEGIN RSA PRIVATE KEY"));
        assert!(!crate::secrets::looks_like_secret("hello world"));
    }
}
