use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

pub fn encrypt_secret(plaintext: &str) -> Result<Vec<u8>, String> {
    let bytes = plaintext.as_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().unwrap_or(u32::MAX),
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            0,
            &mut output,
        )
        .map_err(|e| e.to_string())?;
    }
    let data = if output.pbData.is_null() {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec()
    };
    unsafe {
        LocalFree(HLOCAL(output.pbData as *mut core::ffi::c_void));
    }
    Ok(data)
}

pub fn decrypt_secret(blob: &[u8]) -> Result<String, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: blob.len().try_into().unwrap_or(u32::MAX),
        pbData: blob.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|e| e.to_string())?;
    }
    let data = if output.pbData.is_null() {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec()
    };
    unsafe {
        LocalFree(HLOCAL(output.pbData as *mut core::ffi::c_void));
    }
    String::from_utf8(data).map_err(|e| e.to_string())
}

pub fn looks_like_secret(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("sk-")
        || lower.contains("ghp_")
        || lower.contains("gho_")
        || lower.contains("aiza")
        || lower.contains("xoxb-")
        || lower.contains("begin private key")
        || lower.contains("begin rsa private key")
        || lower.contains("password=")
        || lower.contains("api_key=")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_round_trip() {
        let secret = "correct horse battery staple";
        let blob = encrypt_secret(secret).unwrap();
        assert!(!blob.is_empty());
        assert_ne!(blob, secret.as_bytes());
        assert_eq!(decrypt_secret(&blob).unwrap(), secret);
    }

    #[test]
    fn encrypt_decrypt_round_trip_unicode() {
        let secret = "pässwörd-秘密-🔑";
        let blob = encrypt_secret(secret).unwrap();
        assert_eq!(decrypt_secret(&blob).unwrap(), secret);
    }

    #[test]
    fn decrypt_garbage_fails() {
        assert!(decrypt_secret(&[0u8, 1, 2, 3, 4]).is_err());
        assert!(decrypt_secret(&[]).is_err());
    }

    #[test]
    fn looks_like_secret_matches_patterns() {
        assert!(looks_like_secret("api key: sk-1234abcd"));
        assert!(looks_like_secret("SK-ABC"));
        assert!(looks_like_secret("ghp_abcdefghijklmnopqrstuv"));
        assert!(looks_like_secret("AIzaSyD-xyz"));
        assert!(looks_like_secret("gho_abcdefgh"));
        assert!(looks_like_secret("xoxb-123456-abcdef"));
        assert!(looks_like_secret("-----BEGIN PRIVATE KEY-----"));
        assert!(looks_like_secret("-----BEGIN RSA PRIVATE KEY-----"));
        assert!(looks_like_secret("password=hunter2"));
        assert!(looks_like_secret("api_key=abcdef"));
    }

    #[test]
    fn looks_like_secret_rejects_normal_text() {
        assert!(!looks_like_secret("hello world"));
        assert!(!looks_like_secret(
            "just a normal snippet with a url https://example.com"
        ));
    }
}
