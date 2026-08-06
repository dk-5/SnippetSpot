use std::path::{Path, PathBuf};

use chrono::Utc;
use tauri::{AppHandle, Manager};

pub(crate) const DEFAULT_BACKUP_RETENTION: u32 = 10;

#[derive(serde::Serialize)]
pub struct BackupInfoDto {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub created_at: String,
}

fn backups_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|d| d.join("backups"))
        .unwrap_or_default()
}

fn backup_name(now: &chrono::DateTime<Utc>) -> String {
    format!("snippetspot-{}.db", now.format("%Y%m%d-%H%M%S"))
}

pub(crate) fn create_backup(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = backups_dir(app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(backup_name(&Utc::now()));
    std::fs::copy(crate::app_db_path(app), &dest).map_err(|e| e.to_string())?;
    let config_dir = app.path().app_config_dir().unwrap_or_default();
    let settings = config_dir.join("settings.json");
    if settings.exists() {
        let _ = std::fs::copy(&settings, dir.join("settings.json"));
    }
    Ok(dest)
}

pub fn run_startup_backup(app: &AppHandle) {
    let dir = backups_dir(app);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[snippetspot] failed to create backups dir: {e}");
        return;
    }
    let retention = get_retention(app) as usize;
    if has_backup_same_minute(&dir, &Utc::now()) {
        prune_backups(&dir, retention);
        return;
    }
    match create_backup(app) {
        Ok(_) => {
            prune_backups(&dir, retention);
        }
        Err(e) => eprintln!("[snippetspot] startup backup failed: {e}"),
    }
}

fn has_backup_same_minute(dir: &Path, now: &chrono::DateTime<Utc>) -> bool {
    let minute = now.format("%Y%m%d-%H%M").to_string();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("snippetspot-") && name.contains(&minute) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn prune_backups(backups_dir: &Path, retention: usize) -> usize {
    let mut dbs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(backups_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("db") {
                dbs.push(path);
            }
        }
    }
    dbs.sort();
    let mut deleted = 0;
    while dbs.len() > retention {
        if let Some(oldest) = dbs.first() {
            if std::fs::remove_file(oldest).is_ok() {
                deleted += 1;
            }
        }
        dbs.remove(0);
    }
    deleted
}

fn get_retention(app: &AppHandle) -> u32 {
    if let Some(settings) = app.try_state::<crate::Settings>() {
        *settings.backup_retention.lock().unwrap()
    } else {
        get_retention_setting(app).unwrap_or(DEFAULT_BACKUP_RETENTION)
    }
}

fn get_retention_setting(app: &AppHandle) -> Option<u32> {
    crate::get_setting_value(app, "backup_retention")?
        .as_u64()
        .map(|v| v as u32)
}

#[tauri::command]
pub fn backup_now(app: AppHandle) -> Result<BackupInfoDto, String> {
    let path = create_backup(&app)?;
    let dir = backups_dir(&app);
    let retention = get_retention(&app) as usize;
    prune_backups(&dir, retention);
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let created_at = metadata
        .modified()
        .ok()
        .map(|t| -> chrono::DateTime<Utc> { t.into() })
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default();
    Ok(BackupInfoDto {
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        created_at,
    })
}

#[tauri::command]
pub fn backup_list(app: AppHandle) -> Result<Vec<BackupInfoDto>, String> {
    let dir = backups_dir(&app);
    let mut infos = Vec::new();
    if !dir.exists() {
        return Ok(infos);
    }
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("db") {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let created_at = metadata
            .modified()
            .ok()
            .map(|t| -> chrono::DateTime<Utc> { t.into() })
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
            .unwrap_or_default();
        infos.push(BackupInfoDto {
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string(),
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            created_at,
        });
    }
    infos.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(infos)
}

#[tauri::command]
pub fn backup_restore(app: AppHandle, path: String) -> Result<(), String> {
    let dir = backups_dir(&app);
    let canonical_dir = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    let canonical_src = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canonical_src.starts_with(&canonical_dir) {
        return Err("path is not inside the backups directory".to_string());
    }
    std::fs::copy(&canonical_src, crate::app_db_path(&app)).map_err(|e| e.to_string())?;
    let settings = dir.join("settings.json");
    if settings.exists() {
        let config_dir = app.path().app_config_dir().unwrap_or_default();
        let _ = std::fs::copy(&settings, config_dir.join("settings.json"));
    }
    Ok(())
}

#[tauri::command]
pub fn backup_get_retention(app: AppHandle) -> u32 {
    get_retention(&app)
}

#[tauri::command]
pub fn backup_set_retention(app: AppHandle, n: u32) -> Result<(), String> {
    let n = n.max(1);
    if let Some(settings) = app.try_state::<crate::Settings>() {
        *settings.backup_retention.lock().unwrap() = n;
    }
    crate::set_setting_value(
        &app,
        "backup_retention",
        serde_json::Value::Number(n.into()),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_newest_n() {
        let dir = std::env::temp_dir().join(format!(
            "snippetspot-backup-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..6 {
            std::fs::write(
                dir.join(format!("snippetspot-20260806-10000{i}.db")),
                b"x",
            )
            .unwrap();
        }
        std::fs::write(dir.join("settings.json"), b"{}").unwrap();
        let deleted = prune_backups(&dir, 3);
        assert_eq!(deleted, 3);
        let remaining_dbs = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("db"))
            .count();
        assert_eq!(remaining_dbs, 3);
        assert!(dir.join("settings.json").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_noop_when_under_cap() {
        let dir = std::env::temp_dir().join(format!(
            "snippetspot-backup-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..2 {
            std::fs::write(
                dir.join(format!("snippetspot-20260806-10000{i}.db")),
                b"x",
            )
            .unwrap();
        }
        let deleted = prune_backups(&dir, 5);
        assert_eq!(deleted, 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backup_names_are_minute_ordered() {
        let first = backup_name(&Utc::now());
        let earlier = format!("snippetspot-20260101-000000.db");
        assert!(earlier < first);
    }
}
