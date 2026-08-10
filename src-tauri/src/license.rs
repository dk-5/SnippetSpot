use base64::Engine;
#[cfg(test)]
use ed25519_dalek::Signer;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub const LICENSE_PUBLIC_KEY: [u8; 32] = [
    0x8b, 0xe1, 0xaf, 0xd2, 0x65, 0xe4, 0x7d, 0xf9, 0x3a, 0xb8, 0x65, 0x42, 0x52, 0x27, 0x10, 0x39,
    0xe4, 0xc3, 0x13, 0xfb, 0x83, 0x48, 0xcb, 0x6e, 0x04, 0xef, 0x24, 0x74, 0x79, 0x07, 0x26, 0x0d,
];

const PREFIX: &str = "SS1-";

pub const TRIAL_DAYS: u32 = 14;
pub const LICENSE_GRACE_DAYS: u32 = 14;
const SETTINGS_INSTALL_ID: &str = "install_id";
const SETTINGS_TRIAL_STARTED_AT: &str = "trial_started_at";
const SETTINGS_LICENSE_KEY: &str = "license_key";
const SETTINGS_LICENSE_ACTIVATED_AT: &str = "license_activated_at";
const REGISTER_URL: &str = "https://snippetspot.netlify.app/.netlify/functions/register";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub status: String,
    pub trial_days: u32,
    pub trial_days_left: i64,
    pub trial_ended: bool,
    pub licensed_email: Option<String>,
    pub license_expires_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub email: String,
    pub tier: String,
    pub issued_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

fn parse_key(key: &str, public: &[u8; 32]) -> Result<LicensePayload, String> {
    let body = key
        .strip_prefix(PREFIX)
        .ok_or_else(|| "Invalid license key".to_string())?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body)
        .map_err(|_| "Invalid license key".to_string())?;
    if decoded.len() < 64 {
        return Err("Invalid license key".to_string());
    }
    let (sig, payload_bytes) = decoded.split_at(64);
    let vk = ed25519_dalek::VerifyingKey::from_bytes(public)
        .map_err(|_| "Invalid license key".to_string())?;
    let signature =
        ed25519_dalek::Signature::from_slice(sig).map_err(|_| "Invalid license key".to_string())?;
    vk.verify_strict(payload_bytes, &signature)
        .map_err(|_| "Invalid license key".to_string())?;
    let payload: LicensePayload =
        serde_json::from_slice(payload_bytes).map_err(|_| "Invalid license key".to_string())?;
    if let Some(expires_at) = &payload.expires_at {
        let expires = chrono::DateTime::parse_from_rfc3339(expires_at)
            .map_err(|_| "Invalid license key".to_string())?;
        if chrono::Utc::now() > expires.with_timezone(&chrono::Utc) {
            return Err("License has expired".to_string());
        }
    }
    Ok(payload)
}

#[cfg(test)]
fn encode_key(signing: &ed25519_dalek::SigningKey, payload: &LicensePayload) -> String {
    let payload_bytes = serde_json::to_vec(payload).expect("serialize payload");
    let signature = signing.sign(&payload_bytes);
    let mut combined = Vec::with_capacity(64 + payload_bytes.len());
    combined.extend_from_slice(&signature.to_bytes());
    combined.extend_from_slice(&payload_bytes);
    format!(
        "{}{}",
        PREFIX,
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(combined)
    )
}

fn get_str(app: &AppHandle, key: &str) -> Option<String> {
    crate::get_setting_value(app, key).and_then(|v| v.as_str().map(str::to_string))
}

fn set_str(app: &AppHandle, key: &str, value: &str) {
    let _ = crate::set_setting_value(app, key, serde_json::Value::String(value.to_string()));
}

fn stored_license_key(app: &AppHandle) -> String {
    crate::get_setting_value(app, SETTINGS_LICENSE_KEY)
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn ensure_initialized(app: &AppHandle) {
    if get_str(app, SETTINGS_INSTALL_ID).is_none() {
        set_str(app, SETTINGS_INSTALL_ID, &uuid::Uuid::new_v4().to_string());
    }
    if get_str(app, SETTINGS_TRIAL_STARTED_AT).is_none() {
        set_str(
            app,
            SETTINGS_TRIAL_STARTED_AT,
            &chrono::Utc::now().to_rfc3339(),
        );
    }
}

pub fn license_info(app: &AppHandle) -> Option<LicensePayload> {
    let key = stored_license_key(app);
    if key.is_empty() {
        return None;
    }
    parse_key(&key, &LICENSE_PUBLIC_KEY).ok()
}

fn license_activated_at(app: &AppHandle) -> Option<chrono::DateTime<chrono::Utc>> {
    get_str(app, SETTINGS_LICENSE_ACTIVATED_AT)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn license_deadline(
    activated_at: chrono::DateTime<chrono::Utc>,
    payload_expires_at: &Option<String>,
) -> chrono::DateTime<chrono::Utc> {
    let mut deadline = activated_at + chrono::Duration::days(LICENSE_GRACE_DAYS as i64);
    if let Some(expires) = payload_expires_at {
        if let Ok(t) = chrono::DateTime::parse_from_rfc3339(expires) {
            let expires = t.with_timezone(&chrono::Utc);
            if expires < deadline {
                deadline = expires;
            }
        }
    }
    deadline
}

fn license_window(app: &AppHandle) -> Option<LicensePayload> {
    let license = license_info(app)?;
    let activated_at = match license_activated_at(app) {
        Some(t) => t,
        None => {
            let now = chrono::Utc::now();
            set_str(app, SETTINGS_LICENSE_ACTIVATED_AT, &now.to_rfc3339());
            now
        }
    };
    let deadline = license_deadline(activated_at, &license.expires_at);
    if chrono::Utc::now() > deadline {
        return None;
    }
    Some(license)
}

pub fn is_licensed(app: &AppHandle) -> bool {
    license_window(app).is_some()
}

pub fn trial_status(app: &AppHandle) -> LicenseStatus {
    if let Some(license) = license_window(app) {
        let activated_at = license_activated_at(app).unwrap_or_else(chrono::Utc::now);
        let deadline = license_deadline(activated_at, &license.expires_at);
        let days_left = ((deadline - chrono::Utc::now()).num_days()).max(0);
        return LicenseStatus {
            status: "licensed".to_string(),
            trial_days: LICENSE_GRACE_DAYS,
            trial_days_left: days_left,
            trial_ended: false,
            licensed_email: Some(license.email),
            license_expires_at: Some(deadline.to_rfc3339()),
        };
    }
    if !stored_license_key(app).is_empty() {
        return LicenseStatus {
            status: "expired".to_string(),
            trial_days: TRIAL_DAYS,
            trial_days_left: 0,
            trial_ended: true,
            licensed_email: None,
            license_expires_at: None,
        };
    }
    let started = get_str(app, SETTINGS_TRIAL_STARTED_AT)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));
    let elapsed_days = started
        .map(|t| (chrono::Utc::now() - t).num_days())
        .unwrap_or(0);
    let days_left = TRIAL_DAYS as i64 - elapsed_days;
    let trial_ended = days_left <= 0;
    LicenseStatus {
        status: if trial_ended {
            "expired".to_string()
        } else {
            "trial".to_string()
        },
        trial_days: TRIAL_DAYS,
        trial_days_left: days_left.max(0),
        trial_ended,
        licensed_email: None,
        license_expires_at: None,
    }
}

pub fn ensure_allowed(app: &AppHandle) -> Result<(), String> {
    if is_licensed(app) {
        return Ok(());
    }
    let status = trial_status(app);
    if status.trial_ended {
        Err("Trial expired - activate SnippetSpot to continue using it.".to_string())
    } else {
        Ok(())
    }
}

fn ping_registration(app: &AppHandle) {
    let Some(install_id) = get_str(app, SETTINGS_INSTALL_ID) else {
        return;
    };
    let version = app.package_info().version.to_string();
    let payload = serde_json::json!({
        "install_id": install_id,
        "version": version,
        "licensed": is_licensed(app),
    });
    let _ = ureq::post(REGISTER_URL)
        .timeout(std::time::Duration::from_secs(5))
        .send_json(payload);
}

pub fn start_license_worker(app: AppHandle) {
    std::thread::spawn(move || {
        ensure_initialized(&app);
        ping_registration(&app);
    });
}

#[tauri::command]
pub fn get_license_status(app: AppHandle) -> LicenseStatus {
    trial_status(&app)
}

#[tauri::command]
pub fn try_activate(app: AppHandle, key: String) -> Result<String, String> {
    let payload = parse_key(&key, &LICENSE_PUBLIC_KEY)?;
    crate::set_setting_value(&app, SETTINGS_LICENSE_KEY, serde_json::Value::String(key))?;
    set_str(
        &app,
        SETTINGS_LICENSE_ACTIVATED_AT,
        &chrono::Utc::now().to_rfc3339(),
    );
    Ok(format!(
        "Activated for {} — {} days of access granted",
        payload.email, LICENSE_GRACE_DAYS
    ))
}

#[tauri::command]
pub fn deactivate_license(app: AppHandle) -> Result<(), String> {
    crate::set_setting_value(
        &app,
        SETTINGS_LICENSE_KEY,
        serde_json::Value::String(String::new()),
    )?;
    set_str(&app, SETTINGS_LICENSE_ACTIVATED_AT, "");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_key() -> ed25519_dalek::SigningKey {
        ed25519_dalek::SigningKey::from_bytes(&[7u8; 32])
    }

    fn make_payload(email: &str, expires_at: Option<String>) -> LicensePayload {
        LicensePayload {
            email: email.to_string(),
            tier: "standard".to_string(),
            issued_at: chrono::Utc::now().to_rfc3339(),
            expires_at,
        }
    }

    fn future() -> String {
        (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339()
    }

    fn past() -> String {
        (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339()
    }

    fn hex_decode(s: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).expect("hex byte");
        }
        out
    }

    #[test]
    fn round_trip_valid_key() {
        let key = seed_key();
        let public = key.verifying_key().to_bytes();
        let payload = make_payload("tester@example.com", Some(future()));
        let encoded = encode_key(&key, &payload);
        let parsed = parse_key(&encoded, &public).expect("valid key should parse");
        assert_eq!(parsed.email, "tester@example.com");
        assert_eq!(parsed.tier, "standard");
        assert_eq!(parsed.expires_at, payload.expires_at);
    }

    #[test]
    fn perpetual_key_valid() {
        let key = seed_key();
        let public = key.verifying_key().to_bytes();
        let payload = make_payload("tester@example.com", None);
        let encoded = encode_key(&key, &payload);
        assert!(parse_key(&encoded, &public).is_ok());
    }

    #[test]
    fn expired_key_rejected() {
        let key = seed_key();
        let public = key.verifying_key().to_bytes();
        let payload = make_payload("tester@example.com", Some(past()));
        let encoded = encode_key(&key, &payload);
        let err = parse_key(&encoded, &public).expect_err("expired key should be rejected");
        assert!(err.contains("expired"));
    }

    #[test]
    fn tampered_key_rejected() {
        let key = seed_key();
        let public = key.verifying_key().to_bytes();
        let payload = make_payload("tester@example.com", Some(future()));
        let mut bytes = encode_key(&key, &payload).into_bytes();
        let mid = bytes.len() / 2;
        bytes[mid] = if bytes[mid] == b'A' { b'B' } else { b'A' };
        let encoded = String::from_utf8(bytes).expect("utf8");
        assert!(parse_key(&encoded, &public).is_err());
    }

    #[test]
    fn wrong_public_key_rejected() {
        let key = seed_key();
        let wrong_public = [0x11u8; 32];
        let payload = make_payload("tester@example.com", Some(future()));
        let encoded = encode_key(&key, &payload);
        assert!(parse_key(&encoded, &wrong_public).is_err());
    }

    #[test]
    fn embedded_key_matches_keygen() {
        let seed_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/license-keys/private.seed");
        if !seed_path.exists() {
            return;
        }
        let seed_hex = std::fs::read_to_string(seed_path).expect("read seed");
        let signing = ed25519_dalek::SigningKey::from_bytes(&hex_decode(seed_hex.trim()));
        let payload = make_payload("tester@example.com", Some(future()));
        let encoded = encode_key(&signing, &payload);
        let parsed = parse_key(&encoded, &LICENSE_PUBLIC_KEY)
            .expect("embedded public key should verify the dev keypair");
        assert_eq!(parsed.email, "tester@example.com");
    }

    #[test]
    fn license_deadline_no_payload_expiry() {
        let activated_at = chrono::Utc::now();
        let deadline = license_deadline(activated_at, &None);
        assert_eq!(deadline, activated_at + chrono::Duration::days(14));
    }

    #[test]
    fn license_deadline_payload_expiry_sooner() {
        let activated_at = chrono::Utc::now();
        let expires_at = Some((activated_at + chrono::Duration::days(5)).to_rfc3339());
        let deadline = license_deadline(activated_at, &expires_at);
        assert_eq!(
            deadline,
            chrono::DateTime::parse_from_rfc3339(expires_at.as_ref().unwrap())
                .unwrap()
                .with_timezone(&chrono::Utc)
        );
    }

    #[test]
    fn license_deadline_payload_expiry_later() {
        let activated_at = chrono::Utc::now();
        let expires_at = Some((activated_at + chrono::Duration::days(30)).to_rfc3339());
        let deadline = license_deadline(activated_at, &expires_at);
        assert_eq!(deadline, activated_at + chrono::Duration::days(14));
    }
}
