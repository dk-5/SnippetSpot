# SnippetSpot

A fast, local-only search bar for your apps, snippets and vault credentials. Press
**Alt+Space**, type a few characters, hit **Enter**, and the result is pasted into
whatever app you were working in — as if you'd typed it yourself.

Everything runs **100% locally**. No cloud, no accounts, no telemetry.

---

## Features

- **Global hotkey** — `Alt+Space` (configurable) opens the search bar anywhere, in under
  ~100 ms via a low-level Windows keyboard hook.
- **Fuzzy search** — search snippets, apps, vault items and clipboard history from one
  box; type fragments like `li`, `git`, `mail`, `res` to find "LinkedIn",
  "GitHub", "Email", "Resume Link".
- **Smart ranking** — favorites, recently-used snippets, exact title matches, tag and
  category matches all boost results. Empty query = browse favorites first.
- **Paste into any app** — simulates `Ctrl+V` (clipboard preserved) or types the text
  directly. Multiline and Unicode supported.
- **Snippet types** — plain text, links, emails, markdown, code, templates, prompts.
- **Full CRUD** — create, edit, delete, duplicate, favorite, and **import/export**
  (JSON, CSV, Markdown) backups from the manager window.
- **Secure vault** — store credentials and API keys in the **Vault** tab: masked in the
  UI, encrypted at rest with Windows DPAPI (user scope). In the launcher, select a
  vault item and press `u` (username), `s` (secret), or `c` (copy). Secrets are never
  exported or imported.
- **Clipboard history** — press `Ctrl+Shift+H` in the launcher to browse recent
  clipboard entries: `Enter` paste, `Del` delete, `P` pin, `Esc` exit. Toggle capture
  and set the max entry count in Settings.
- **Automatic backups** — a timestamped backup of your data on every launch (keeps the
  newest 10), plus manual "Back up now" and Restore from Settings → Backups.
- **Smart import** — import with a merge policy (skip / overwrite / rename on title)
  and a summary of what was imported, updated, or skipped.
- **Variables** — `{{date}}`, `{{time}}`, `{{datetime}}`, `{{clipboard}}`,
  `{{env:NAME}}`, `{{env:NAME:default}}` are expanded at paste time.
- **System tray** — tray icon to reopen the launcher, open the manager, or quit.
- **Launch at startup** — optional, toggled from settings.
- **Performance** — in-memory fuzzy index (`uFuzzy`) handles **10,000+ snippets** with
  sub-50 ms search latency (index rebuild is a few ms).

## Tech stack

| Layer     | Choice                                                        |
| --------- | ------------------------------------------------------------- |
| Shell     | Tauri 2 (Rust)                                                |
| UI        | React 19 + TypeScript + Tailwind CSS v4 + Vite                |
| Storage   | SQLite (`tauri-plugin-sql`) — migrations in Rust              |
| Search    | `@leeoniya/ufuzzy` + custom ranker                            |
| Native    | `windows` crate (keyboard hook, SendInput, clipboard)         |

## Prerequisites (Windows)

- **Node.js 20+**
- **Rust** toolchain (MSVC): `winget install Rustlang.Rustup`
- **Visual Studio 2022 Build Tools** with the **"Desktop development with C++"** workload
  (MSVC compiler + Windows 11 SDK)
- **WebView2 Runtime** — preinstalled on Windows 11

Install everything with one command:

```powershell
.\scripts\setup.ps1
```

`setup.ps1` checks what's already installed and installs only the missing pieces
(you'll be asked to accept a UAC prompt for the VS Build Tools install).

## Quick start (development)

```bash
npm install
npm run tauri dev
```

## Building the production installer

```bash
npm run tauri build
```

Outputs:

- `src-tauri\target\release\snippetspot.exe` — standalone executable
- `src-tauri\target\release\bundle\nsis\SnippetSpot_0.1.0_x64-setup.exe` — NSIS installer

Or use the wrapper: `.\scripts\build.ps1` (defaults to release) and
`.\scripts\build.ps1 -Task test` for tests.

## Usage

### Launcher (popup)

| Key          | Action                          |
| ------------ | ------------------------------- |
| `Alt+Space`  | Open the launcher (configurable)|
| `↑` / `↓`    | Move selection                 |
| `Enter`      | Paste selected snippet         |
| `Esc`        | Close                          |
| `Ctrl+N`     | New snippet (opens manager)    |
| `Ctrl+E`     | Edit selected (opens manager)  |
| `Delete`     | Delete selected                |
| `Ctrl+F`     | Focus search field             |
| `u` / `s` / `c` | Vault item selected: paste username / secret / copy |
| `Ctrl+Shift+H`  | Toggle clipboard history (`Enter` paste, `Del` delete, `P` pin, `Esc` exit) |

### Manager window

Opened from the tray (right-click → **Open Manager**) or via `Ctrl+N`/`Ctrl+E` in the
launcher. Use it to create, edit, duplicate, favorite and delete snippets, organize by
category and tags, and import/export backups (JSON, CSV, or Markdown).

The manager has a **Snippets / Vault** tab strip. The **Vault** stores credentials and
API keys: secrets are masked in the UI and encrypted at rest with Windows DPAPI.
Settings cover clipboard history (enabled + max entries) and backups (retention, "Back
up now", Restore).

### Variables

Expanded when a snippet is pasted:

| Placeholder             | Result                          |
| ----------------------- | ------------------------------- |
| `{{date}}`              | `2026-08-06`                    |
| `{{time}}`              | `13:04`                         |
| `{{datetime}}`          | `2026-08-06 13:04`              |
| `{{clipboard}}`         | current clipboard text          |
| `{{env:NAME}}`          | value of environment variable   |
| `{{env:NAME:default}}`  | env var, or `default` if unset  |

## Data & storage

- **SQLite database:** `%APPDATA%\com.snippetspot.app\snippetspot.db` (snippets, vault
  items, clipboard history)
- **Settings:** `%APPDATA%\com.snippetspot.app\settings.json` (hotkey, paste mode,
  clipboard history, backup retention)
- **Backups:** `%APPDATA%\com.snippetspot.app\backups\` — automatic on every launch
  (keeps the newest 10), plus manual backup/restore in the manager.

Snippet content is stored in plaintext (lock-only design). Vault secrets are encrypted
at rest with Windows DPAPI (user scope) and are never exported or imported.

## How paste works

- **Paste mode** (default): your current clipboard text is saved, the snippet is written
  to the clipboard, `Ctrl+V` is sent to the previously focused app, then your clipboard
  is restored ~300 ms later. Text-only clipboard content is preserved (non-text
  clipboard formats can't be restored reliably — this is a Windows limitation).
- **Type mode**: text is "typed" using Unicode key events, so the clipboard is never
  touched (slower for long snippets).

## Architecture

```
src/
  popup/Popup.tsx      launcher window (search + paste + shortcuts + clipboard history)
  manager/Manager.tsx  Snippets/Vault tabs + settings + import/export
  lib/
    search.ts          uFuzzy index + ranking        (pure, tested)
    variables.ts       variable expansion            (pure, tested)
    secrets.ts         secret masking                (pure, tested)
    importExport.ts    CSV/Markdown export + merge policy (pure, tested)
    db.ts              SQLite CRUD (tauri-plugin-sql)
    api.ts             typed Tauri command wrappers + event listeners
src-tauri/src/
  lib.rs               window effects, tray, plugins, commands
  hotkey.rs            WH_KEYBOARD_LL global hook
  paste.rs             clipboard save → Ctrl+V → restore / type mode
  variables.rs         Rust-side variable expansion (paste-time)
  secrets.rs           Windows DPAPI encrypt/decrypt (user scope)
  vault.rs             secure vault CRUD (masked, never exported)
  clipboard.rs         background clipboard-history watcher
  backup.rs            automatic DB/settings backups + restore
  migrate.rs           SQLite migrations
```

The frontend and Rust implement the **same** variable-expansion rules, but the Rust
side is authoritative at paste time (it can read the live clipboard).

## Testing

```bash
npx vitest run     # TS unit tests (ranking, variables, secrets, import/export)
cargo test         # Rust unit tests (variables, hotkey parsing)
```

## Troubleshooting

- **Hotkey doesn't work / conflicts:** change it in the manager (Settings → Global
  hotkey). Other apps can also grab `Alt+Space`; if so pick `Ctrl+Shift+X` etc.
- **Alt+Space opens the window menu instead:** this happens only if another app has
  already reserved it; set a different hotkey.
- **Paste doesn't go to the right window:** the launcher hides itself before pasting;
  if a UAC prompt or another window steals focus in between, paste goes there instead.
