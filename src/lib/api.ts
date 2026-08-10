import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppItem,
  BackupInfo,
  ClipboardEntry,
  LicenseStatus,
  PasteMode,
  VaultItem,
  VaultKind,
} from "./types";

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

export function appList(): Promise<AppItem[]> {
  return call("app_list", "Failed to list apps");
}

export function appLaunch(path: string): Promise<void> {
  return call("app_launch", "Failed to launch app", { path });
}

export function getShowOnStartup(): Promise<boolean> {
  return call("get_show_on_startup", "Failed to get show-on-startup setting");
}

export function setShowOnStartup(enabled: boolean): Promise<void> {
  return call("set_show_on_startup", "Failed to set show-on-startup setting", {
    enabled,
  });
}

export function getLicenseStatus(): Promise<LicenseStatus> {
  return call("get_license_status", "Failed to get license status");
}

export function activateLicense(key: string): Promise<string> {
  return call("try_activate", "Failed to activate license", { key });
}

export function deactivateLicense(): Promise<void> {
  return call("deactivate_license", "Failed to deactivate license");
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

export async function onAppsChanged(cb: () => void): Promise<() => void> {
  try {
    return await listen("apps-changed", cb);
  } catch (err: unknown) {
    throw new Error(`Failed to listen for apps-changed: ${String(err)}`);
  }
}

export interface VaultInput {
  title: string;
  kind: VaultKind;
  username: string | null;
  secret: string;
}

export function vaultList(): Promise<VaultItem[]> {
  return call("vault_list", "Failed to list vault items");
}

export function vaultCreate(input: VaultInput): Promise<VaultItem> {
  return call("vault_create", "Failed to create vault item", { input });
}

export function vaultUpdate(id: string, input: VaultInput): Promise<VaultItem> {
  return call("vault_update", "Failed to update vault item", { id, input });
}

export function vaultDelete(id: string): Promise<void> {
  return call("vault_delete", "Failed to delete vault item", { id });
}

export function vaultRevealSecret(id: string): Promise<string> {
  return call("vault_reveal_secret", "Failed to reveal secret", { id });
}

export function vaultCopySecret(id: string): Promise<void> {
  return call("vault_copy_secret", "Failed to copy secret", { id });
}

export function vaultPasteUsername(id: string): Promise<void> {
  return call("vault_paste_username", "Failed to paste username", { id });
}

export function vaultPasteSecret(id: string): Promise<void> {
  return call("vault_paste_secret", "Failed to paste secret", { id });
}

export function clipboardGetEnabled(): Promise<boolean> {
  return call("clipboard_get_enabled", "Failed to get clipboard history setting");
}

export function clipboardSetEnabled(enabled: boolean): Promise<void> {
  return call("clipboard_set_enabled", "Failed to set clipboard history setting", {
    enabled,
  });
}

export function clipboardGetCap(): Promise<number> {
  return call("clipboard_get_cap", "Failed to get clipboard history cap");
}

export function clipboardSetCap(cap: number): Promise<void> {
  return call("clipboard_set_cap", "Failed to set clipboard history cap", { cap });
}

export function clipboardList(): Promise<ClipboardEntry[]> {
  return call("clipboard_list", "Failed to list clipboard history");
}

export function clipboardDelete(id: string): Promise<void> {
  return call("clipboard_delete", "Failed to delete clipboard entry", { id });
}

export function clipboardClear(): Promise<void> {
  return call("clipboard_clear", "Failed to clear clipboard history");
}

export function clipboardTogglePin(id: string): Promise<void> {
  return call("clipboard_toggle_pin", "Failed to toggle clipboard pin", { id });
}

export function clipboardPaste(id: string): Promise<void> {
  return call("clipboard_paste", "Failed to paste clipboard entry", { id });
}

export async function onClipboardHistoryChanged(
  cb: () => void
): Promise<() => void> {
  try {
    return await listen("clipboard-history-changed", cb);
  } catch (err: unknown) {
    throw new Error(
      `Failed to listen for clipboard-history-changed: ${String(err)}`
    );
  }
}

export function backupNow(): Promise<BackupInfo> {
  return call("backup_now", "Failed to create backup");
}

export function backupList(): Promise<BackupInfo[]> {
  return call("backup_list", "Failed to list backups");
}

export function backupRestore(path: string): Promise<void> {
  return call("backup_restore", "Failed to restore backup", { path });
}

export function backupGetRetention(): Promise<number> {
  return call("backup_get_retention", "Failed to get backup retention");
}

export function backupSetRetention(n: number): Promise<void> {
  return call("backup_set_retention", "Failed to set backup retention", { n });
}
