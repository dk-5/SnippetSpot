use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Deserialize)]
pub struct VaultInput {
    pub title: String,
    pub kind: String,
    pub username: Option<String>,
    pub secret: Option<String>,
}

#[derive(Serialize)]
pub struct VaultItemDto {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub username: Option<String>,
    pub has_secret: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn validate_input(input: &VaultInput) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("title must not be empty".to_string());
    }
    if input.kind != "credential" && input.kind != "api_key" {
        return Err(format!("invalid kind: '{}'", input.kind));
    }
    Ok(())
}

fn encrypted_or_existing(existing: Vec<u8>, secret: &Option<String>) -> Result<Vec<u8>, String> {
    match secret {
        Some(s) if !s.is_empty() => crate::secrets::encrypt_secret(s),
        _ => Ok(existing),
    }
}

fn get_secret(app: &AppHandle, id: &str) -> Result<Vec<u8>, String> {
    let conn = crate::open_db(app)?;
    conn.query_row(
        "SELECT secret_enc FROM vault_items WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_list(app: AppHandle) -> Result<Vec<VaultItemDto>, String> {
    let conn = crate::open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, kind, username, secret_enc, created_at, updated_at FROM vault_items ORDER BY title COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let secret: Vec<u8> = row.get(4)?;
            Ok(VaultItemDto {
                id: row.get(0)?,
                title: row.get(1)?,
                kind: row.get(2)?,
                username: row.get(3)?,
                has_secret: !secret.is_empty(),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_create(app: AppHandle, input: VaultInput) -> Result<VaultItemDto, String> {
    validate_input(&input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();
    let secret = encrypted_or_existing(Vec::new(), &input.secret)?;
    let has_secret = !secret.is_empty();
    let conn = crate::open_db(&app)?;
    conn.execute(
        "INSERT INTO vault_items (id, title, kind, username, secret_enc, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, input.title, input.kind, input.username, secret, now.clone(), now.clone()],
    )
    .map_err(|e| e.to_string())?;
    Ok(VaultItemDto {
        id,
        title: input.title,
        kind: input.kind,
        username: input.username,
        has_secret,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn vault_update(app: AppHandle, id: String, input: VaultInput) -> Result<VaultItemDto, String> {
    validate_input(&input)?;
    let conn = crate::open_db(&app)?;
    let (existing, created_at): (Vec<u8>, String) = conn
        .query_row(
            "SELECT secret_enc, created_at FROM vault_items WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let secret = encrypted_or_existing(existing, &input.secret)?;
    let has_secret = !secret.is_empty();
    let now = crate::now_iso();
    conn.execute(
        "UPDATE vault_items SET title = ?1, kind = ?2, username = ?3, secret_enc = ?4, updated_at = ?5 WHERE id = ?6",
        rusqlite::params![input.title, input.kind, input.username, secret, now.clone(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(VaultItemDto {
        id,
        title: input.title,
        kind: input.kind,
        username: input.username,
        has_secret,
        created_at,
        updated_at: now,
    })
}

#[tauri::command]
pub fn vault_delete(app: AppHandle, id: String) -> Result<(), String> {
    let conn = crate::open_db(&app)?;
    conn.execute(
        "DELETE FROM vault_items WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn vault_reveal_secret(app: AppHandle, id: String) -> Result<String, String> {
    let blob = get_secret(&app, &id)?;
    crate::secrets::decrypt_secret(&blob)
}

#[tauri::command]
pub fn vault_copy_secret(app: AppHandle, id: String) -> Result<(), String> {
    crate::license::ensure_allowed(&app)?;
    let blob = get_secret(&app, &id)?;
    let plaintext = crate::secrets::decrypt_secret(&blob)?;
    let mut clip = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clip.set_text(plaintext).map_err(|e| e.to_string())?;
    crate::clipboard::mark_app_clipboard_write(&app);
    Ok(())
}

#[tauri::command]
pub fn vault_paste_username(app: AppHandle, id: String) -> Result<(), String> {
    crate::license::ensure_allowed(&app)?;
    let conn = crate::open_db(&app)?;
    let username: Option<String> = conn
        .query_row(
            "SELECT username FROM vault_items WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let username = username.ok_or_else(|| "vault item has no username".to_string())?;
    let mode = crate::current_paste_mode(&app);
    crate::paste::paste_text(&app, &username, &mode);
    Ok(())
}

#[tauri::command]
pub fn vault_paste_secret(app: AppHandle, id: String) -> Result<(), String> {
    crate::license::ensure_allowed(&app)?;
    let blob = get_secret(&app, &id)?;
    let plaintext = crate::secrets::decrypt_secret(&blob)?;
    let mode = crate::current_paste_mode(&app);
    crate::paste::paste_text(&app, &plaintext, &mode);
    Ok(())
}
