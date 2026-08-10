use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};

pub const MOD_ALT: u16 = 0x0001;
pub const MOD_CTRL: u16 = 0x0002;
pub const MOD_SHIFT: u16 = 0x0004;
pub const MOD_WIN: u16 = 0x0008;

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN,
        WM_SYSKEYDOWN,
    };

    const WM_KEYDOWN_CODE: usize = WM_KEYDOWN as usize;
    const WM_SYSKEYDOWN_CODE: usize = WM_SYSKEYDOWN as usize;

    static HOTKEY_STATE: AtomicU32 = AtomicU32::new(0);
    static HOOK_HANDLE: AtomicIsize = AtomicIsize::new(0);
    static TRIGGER_TX: OnceLock<Mutex<mpsc::Sender<()>>> = OnceLock::new();

    pub fn start_hotkey(app: tauri::AppHandle, hotkey: &str) -> Result<(), String> {
        if TRIGGER_TX.get().is_some() {
            return update_hotkey(hotkey);
        }

        let (tx, rx) = mpsc::channel::<()>();
        let _ = TRIGGER_TX.set(Mutex::new(tx));

        let app_listener = app.clone();
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                crate::do_show_popup(&app_listener);
            }
        });

        std::thread::spawn(move || {
            install_hook();
            let mut msg = MSG::default();
            unsafe {
                while GetMessageW(&mut msg, HWND::default(), 0, 0).0 > 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                let hook = HOOK_HANDLE.load(Ordering::Acquire);
                if hook != 0 {
                    let _ = UnhookWindowsHookEx(HHOOK(hook as *mut core::ffi::c_void));
                }
            }
        });

        update_hotkey(&hotkey)
    }

    pub fn update_hotkey(hotkey: &str) -> Result<(), String> {
        let (mods, vk) = parse_hotkey(hotkey)?;
        HOTKEY_STATE.store(((mods as u32) << 16) | (vk as u32), Ordering::Release);
        Ok(())
    }

    fn install_hook() {
        unsafe {
            let module = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), module, 0) {
                Ok(hook) => {
                    HOOK_HANDLE.store(hook.0 as isize, Ordering::Release);
                }
                Err(e) => {
                    eprintln!("[snippetspot] failed to install keyboard hook: {e}");
                }
            }
        }
    }

    unsafe extern "system" fn keyboard_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let kbd = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let state = HOTKEY_STATE.load(Ordering::Relaxed);
            let vk = state & 0xFFFF;
            if kbd.vkCode as u32 == vk {
                let message = wparam.0;
                if message == WM_KEYDOWN_CODE || message == WM_SYSKEYDOWN_CODE {
                    let desired_mods = (state >> 16) as u16;
                    let mut current = current_mods();
                    if (desired_mods & MOD_ALT) != 0
                        && message == WM_SYSKEYDOWN_CODE
                        && (current & MOD_ALT) == 0
                    {
                        current |= MOD_ALT;
                    }
                    if current == desired_mods {
                        if let Some(tx) = TRIGGER_TX.get() {
                            if let Ok(tx) = tx.lock() {
                                let _ = tx.send(());
                            }
                        }
                    }
                }
            }
        }
        let hook = HOOK_HANDLE.load(Ordering::Acquire);
        CallNextHookEx(HHOOK(hook as *mut core::ffi::c_void), code, wparam, lparam)
    }

    fn current_mods() -> u16 {
        let mut mods = 0;
        if key_down(VK_MENU) {
            mods |= MOD_ALT;
        }
        if key_down(VK_CONTROL) {
            mods |= MOD_CTRL;
        }
        if key_down(VK_SHIFT) {
            mods |= MOD_SHIFT;
        }
        if key_down(VK_LWIN) || key_down(VK_RWIN) {
            mods |= MOD_WIN;
        }
        mods
    }

    fn key_down(vk: VIRTUAL_KEY) -> bool {
        unsafe { ((GetAsyncKeyState(vk.0 as i32) as u16) & 0x8000) != 0 }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn start_hotkey(_app: tauri::AppHandle, _hotkey: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn update_hotkey(_hotkey: &str) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::*;

pub fn parse_hotkey(hotkey: &str) -> Result<(u16, u16), String> {
    let mut mods = 0u16;
    let mut key = None;
    for part in hotkey.split('+') {
        let part = part.trim();
        if part.is_empty() {
            return Err(format!("invalid hotkey: '{hotkey}'"));
        }
        match part.to_ascii_lowercase().as_str() {
            "alt" => mods |= MOD_ALT,
            "ctrl" | "control" => mods |= MOD_CTRL,
            "shift" => mods |= MOD_SHIFT,
            "win" | "windows" | "super" | "cmd" | "meta" => mods |= MOD_WIN,
            _ => {
                if key.is_some() {
                    return Err(format!("invalid hotkey: '{hotkey}'"));
                }
                key = Some(parse_key(part)?);
            }
        }
    }
    let key = key.ok_or_else(|| format!("invalid hotkey: '{hotkey}' (missing key)"))?;
    if mods == 0 {
        return Err(format!("invalid hotkey: '{hotkey}' (missing modifier)"));
    }
    Ok((mods, key))
}

fn parse_key(name: &str) -> Result<u16, String> {
    let lower = name.to_ascii_lowercase();
    let upper = name.to_ascii_uppercase();
    match lower.as_str() {
        "space" => return Ok(0x20),
        "enter" | "return" => return Ok(0x0D),
        "tab" => return Ok(0x09),
        "escape" | "esc" => return Ok(0x1B),
        "backspace" => return Ok(0x08),
        "delete" | "del" => return Ok(0x2E),
        "insert" | "ins" => return Ok(0x2D),
        "home" => return Ok(0x24),
        "end" => return Ok(0x23),
        "pageup" | "pgup" => return Ok(0x21),
        "pagedown" | "pgdn" => return Ok(0x22),
        "up" | "arrowup" => return Ok(0x26),
        "down" | "arrowdown" => return Ok(0x28),
        "left" | "arrowleft" => return Ok(0x25),
        "right" | "arrowright" => return Ok(0x27),
        _ => {}
    }
    if upper.len() == 1 {
        let c = upper.as_bytes()[0];
        if c.is_ascii_alphabetic() {
            return Ok(c as u16);
        }
        if c.is_ascii_digit() {
            return Ok(c as u16);
        }
    }
    if let Some(vk) = parse_function_key(&upper) {
        return Ok(vk);
    }
    Err(format!("unsupported key: '{name}'"))
}

fn parse_function_key(upper: &str) -> Option<u16> {
    let n: u16 = upper.strip_prefix('F')?.parse().ok()?;
    if (1..=24).contains(&n) {
        Some(0x70 + n - 1)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_alt_space() {
        assert_eq!(parse_hotkey("Alt+Space"), Ok((MOD_ALT, 0x20)));
        assert_eq!(parse_hotkey("alt+space"), Ok((MOD_ALT, 0x20)));
    }

    #[test]
    fn parses_multiple_modifiers() {
        assert_eq!(
            parse_hotkey("Ctrl+Shift+T"),
            Ok((MOD_CTRL | MOD_SHIFT, b'T' as u16))
        );
        assert_eq!(
            parse_hotkey("Win+Alt+1"),
            Ok((MOD_WIN | MOD_ALT, b'1' as u16))
        );
    }

    #[test]
    fn parses_named_and_function_keys() {
        assert_eq!(parse_hotkey("Ctrl+Enter"), Ok((MOD_CTRL, 0x0D)));
        assert_eq!(parse_hotkey("Ctrl+F5"), Ok((MOD_CTRL, 0x74)));
        assert_eq!(parse_hotkey("Ctrl+ArrowUp"), Ok((MOD_CTRL, 0x26)));
    }

    #[test]
    fn rejects_invalid_hotkeys() {
        assert!(parse_hotkey("Space").is_err());
        assert!(parse_hotkey("Alt+").is_err());
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey("Alt+Space+Enter").is_err());
        assert!(parse_hotkey("Alt+F25").is_err());
        assert!(parse_hotkey("Alt+UnknownKey").is_err());
    }
}
