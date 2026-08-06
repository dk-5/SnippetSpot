import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PasteMode } from "./types";

function call<T>(cmd: string, message: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args).catch((err: unknown) => {
    throw new Error(`${message}: ${String(err)}`);
  });
}

export function showPopup(): Promise<void> {
  return call("show_popup", "Failed to show popup");
}

export function hidePopup(): Promise<void> {
  return call("hide_popup", "Failed to hide popup");
}

export function openManager(): Promise<void> {
  return call("open_manager", "Failed to open manager");
}

export function pasteSnippet(content: string): Promise<void> {
  return call("paste_snippet", "Failed to paste snippet", { content });
}

export function expandVariablesRust(text: string): Promise<string> {
  return call("expand_variables", "Failed to expand variables", { text });
}

export function getHotkey(): Promise<string> {
  return call("get_hotkey", "Failed to get hotkey");
}

export function setHotkey(hotkey: string): Promise<void> {
  return call("set_hotkey", "Failed to set hotkey", { hotkey });
}

export function getPasteMode(): Promise<PasteMode> {
  return call("get_paste_mode", "Failed to get paste mode");
}

export function setPasteMode(mode: PasteMode): Promise<void> {
  return call("set_paste_mode", "Failed to set paste mode", { mode });
}

export function getAutostart(): Promise<boolean> {
  return call("get_autostart", "Failed to get autostart setting");
}

export function setAutostart(enabled: boolean): Promise<void> {
  return call("set_autostart", "Failed to set autostart setting", { enabled });
}

export function readTextFile(path: string): Promise<string> {
  return call("read_text_file", "Failed to read text file", { path });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return call("write_text_file", "Failed to write text file", { path, contents });
}

export function quitApp(): Promise<void> {
  return call("quit_app", "Failed to quit app");
}

export async function onPopupShown(cb: () => void): Promise<() => void> {
  try {
    return await listen("popup-shown", cb);
  } catch (err: unknown) {
    throw new Error(`Failed to listen for popup-shown: ${String(err)}`);
  }
}
