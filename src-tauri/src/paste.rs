use std::time::Duration;

use arboard::Clipboard;
use tauri::AppHandle;

pub fn paste_text(app: &AppHandle, text: &str, mode: &str) {
    crate::do_hide_popup(app);
    std::thread::sleep(Duration::from_millis(60));

    match mode {
        "type" => type_text(text),
        _ => paste_via_clipboard(text),
    }
    crate::clipboard::mark_app_clipboard_write(app);
}

fn paste_via_clipboard(text: &str) {
    let saved = Clipboard::new()
        .and_then(|mut clip| clip.get_text().map(|t| t.to_string()))
        .unwrap_or_default();

    if let Err(e) = set_clipboard(text) {
        eprintln!("[snippetspot] failed to set clipboard: {e}");
        return;
    }

    std::thread::sleep(Duration::from_millis(40));
    send_ctrl_v();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        if let Err(e) = set_clipboard(&saved) {
            eprintln!("[snippetspot] failed to restore clipboard: {e}");
        }
    });
}

fn set_clipboard(text: &str) -> Result<(), String> {
    let mut clip = Clipboard::new().map_err(|e| e.to_string())?;
    clip.set_text(text).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VK_CONTROL,
        VIRTUAL_KEY, KEYBD_EVENT_FLAGS,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::SendInput;

    pub(super) fn send_ctrl_v() {
        let inputs = [
            key_input(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            key_input(VIRTUAL_KEY(0x56), KEYBD_EVENT_FLAGS(0)),
            key_input(VIRTUAL_KEY(0x56), KEYEVENTF_KEYUP),
            key_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    pub(super) fn type_text(text: &str) {
        let mut inputs = Vec::with_capacity(text.len() * 2);
        for unit in text.encode_utf16() {
            match unit {
                0x0D | 0x0A => {
                    inputs.push(key_input(VIRTUAL_KEY(0x0D), KEYBD_EVENT_FLAGS(0)));
                    inputs.push(key_input(VIRTUAL_KEY(0x0D), KEYEVENTF_KEYUP));
                }
                c => {
                    inputs.push(unicode_input(c, KEYBD_EVENT_FLAGS(0)));
                    inputs.push(unicode_input(c, KEYEVENTF_KEYUP));
                }
            }
        }
        if !inputs.is_empty() {
            unsafe {
                SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
            }
        }
    }

    fn key_input(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn unicode_input(unit: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub(super) fn send_ctrl_v() {}

    pub(super) fn type_text(_text: &str) {}
}

use imp::*;
