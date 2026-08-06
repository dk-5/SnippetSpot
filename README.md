# SnippetSpot

A Spotlight-style launcher for your personal text snippets. Press **Alt+Space**, type
a few characters, hit **Enter**, and the snippet is pasted into whatever app you were
working in — as if you'd typed it yourself.

Everything runs **100% locally**. No cloud, no accounts, no telemetry.

---

## Features

- **Global hotkey** — `Alt+Space` (configurable) opens the launcher anywhere, in under
  ~100 ms via a low-level Windows keyboard hook.
- **Fuzzy search** — type fragments like `li`, `git`, `mail`, `res` to find "LinkedIn",
  "GitHub", "Email", "Resume Link".
- **Smart ranking** — favorites, recently-used snippets, exact title matches, tag and
  category matches all boost results. Empty query = browse favorites first.
- **Paste into any app** — simulates `Ctrl+V` (clipboard preserved) or types the text
  directly. Multiline and Unicode supported.
- **Snippet types** — plain text, links, emails, markdown, code, templates, prompts.
- **Full CRUD** — create, edit, delete, duplicate, favorite, and **import/export JSON**
  backups from the manager window.
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

### Manager window

Opened from the tray (right-click → **Open Manager**) or via `Ctrl+N`/`Ctrl+E` in the
launcher. Use it to create, edit, duplicate, favorite and delete snippets, organize by
category and tags, and import/export JSON backups.

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

- **SQLite database:** `%APPDATA%\com.snippetspot.app\snippetspot.db`
- **Settings (hotkey, paste mode):** `%APPDATA%\com.snippetspot.app\settings.json`
- Backups via **Export JSON** in the manager.

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
  popup/Popup.tsx      launcher window (search + paste + shortcuts)
  manager/Manager.tsx  CRUD + settings + import/export
  lib/
    search.ts          uFuzzy index + ranking        (pure, tested)
    variables.ts       variable expansion            (pure, tested)
    db.ts              SQLite CRUD (tauri-plugin-sql)
    api.ts             typed Tauri command wrappers
src-tauri/src/
  lib.rs               window effects, tray, plugins, commands
  hotkey.rs            WH_KEYBOARD_LL global hook
  paste.rs             clipboard save → Ctrl+V → restore / type mode
  variables.rs         Rust-side variable expansion (paste-time)
  migrate.rs           SQLite migrations
```

The frontend and Rust implement the **same** variable-expansion rules, but the Rust
side is authoritative at paste time (it can read the live clipboard).

## Testing

```bash
npx vitest run     # TS unit tests (ranking, variables)
cargo test         # Rust unit tests (variables, hotkey parsing)
```

## Troubleshooting

- **Hotkey doesn't work / conflicts:** change it in the manager (Settings → Global
  hotkey). Other apps can also grab `Alt+Space`; if so pick `Ctrl+Shift+X` etc.
- **Alt+Space opens the window menu instead:** this happens only if another app has
  already reserved it; set a different hotkey.
- **Paste doesn't go to the right window:** the launcher hides itself before pasting;
  if a UAC prompt or another window steals focus in between, paste goes there instead.
