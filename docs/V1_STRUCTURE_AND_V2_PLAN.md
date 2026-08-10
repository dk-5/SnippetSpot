# SnippetSpot — v1 Structure & v2 Plan

## 1. v1 Overview

SnippetSpot is a Windows-only, local-first search bar for your apps, text snippets and
vault credentials. Press **Alt+Space**, type to fuzzy-search, press **Enter**, and the
result is pasted into the previously focused application. Everything runs locally
(SQLite + JSON); no cloud, no telemetry.

**Stack:** Tauri 2 (Rust) · React 19 + TypeScript · Tailwind CSS v4 · Vite ·
SQLite (`tauri-plugin-sql`) · `@leeoniya/ufuzzy` · `windows` crate.

---

## 2. v1 Project Structure

```
C:\snippetshot\
├── AGENTS.md                  # Working conventions for AI agents (sub-agents, testing, DB rules)
├── README.md                  # User-facing docs: features, install, build, usage, troubleshooting
├── package.json               # npm scripts (dev/build/tauri), frontend + plugin dependencies
├── package-lock.json
├── tsconfig.json              # TS strict config + path aliases (@lib/*, @/*)
├── tsconfig.node.json         # TS config for build tooling (vite.config.ts)
├── vite.config.ts             # Vite + React + Tailwind plugins, Tauri dev port 1420, vitest config
├── index.html                 # Single HTML entry (Vite SPA)
├── .gitignore                 # Ignores node_modules, dist, src-tauri/target, src-tauri/gen
│
├── src\                       # ── React frontend ──────────────────────────────────────
│   ├── main.tsx               # Entry: dispatches to <Popup/> or <Manager/> by window label
│   ├── index.css              # Tailwind v4 import + dark-theme CSS vars + global styles
│   ├── vite-env.d.ts
│   │
│   ├── lib\                   # ── shared, framework-agnostic logic ──
│   │   ├── types.ts           # Core types: Snippet, SnippetInput, Settings, SearchHit,
│   │   │                      #   VaultItem, ClipboardEntry, BackupInfo, merge policy,
│   │   │                      #   SNIPPET_TYPES, DEFAULT_CATEGORIES, DEFAULT_HOTKEY
│   │   ├── search.ts          # SnippetIndex: uFuzzy filter + composite ranker
│   │   │                      #   (favorites/exact/tags/recency/usage); browse mode
│   │   ├── variables.ts       # Pure variable expansion: {{date}}/{{time}}/{{clipboard}}/{{env:}}
│   │   ├── db.ts              # SQLite CRUD via tauri-plugin-sql (init/list/create/update/
│   │   │                      #   delete/duplicate/recordUsage/import)
│   │   ├── api.ts             # Typed wrappers over Tauri invoke() + event listeners
│   │   │                      #   (onPopupShown, onClipboardHistoryChanged)
│   │   ├── secrets.ts         # Pure maskSecret() (mask all but last 4 chars)
│   │   ├── importExport.ts    # Pure CSV/Markdown export + planImport() merge policies
│   │   ├── search.test.ts     # vitest: ranking + spec examples + 10k perf sanity
│   │   ├── variables.test.ts  # vitest: all placeholder rules
│   │   ├── secrets.test.ts    # vitest: masking rules
│   │   └── importExport.test.ts  # vitest: CSV/Markdown export + merge policies
│   │
│   ├── popup\                 # ── launcher window (transparent, acrylic, always-on-top) ──
│   │   └── Popup.tsx          # Search UI, highlighted results, keyboard nav, paste flow
│   │                          #   (↑↓ / Enter / Esc / Ctrl+N / Ctrl+E / Del / Ctrl+F);
│   │                          #   vault items in results (u / s / c) and clipboard
│   │                          #   history mode (Ctrl+Shift+H)
│   │
│   └── manager\               # ── management window (normal window) ──
│       ├── Manager.tsx        # Layout: header, Snippets/Vault tabs, list, editor,
│       │                      #   settings (clipboard history, backups, import merge policy)
│       ├── SnippetRow.tsx     # List row: title/preview/badges/favorite star/duplicate
│       ├── HotkeyRecorder.tsx # Record-mode global hotkey capture + validation
│       ├── VariableCheatsheet.tsx  # Static reference for paste variables
│       ├── SecretField.tsx    # Masked secret input (Show/Hide toggle, Copy)
│       ├── VaultPanel.tsx     # Vault list + create/edit form (title, kind, username, secret)
│       └── BackupsPanel.tsx   # Retention setting, back-up-now, backup list with Restore
│
├── src-tauri\                 # ── Rust backend ───────────────────────────────────────
│   ├── Cargo.toml             # Rust deps (windows crypto, rusqlite bundled) + release
│   │                          #   profile (LTO, strip, opt-size)
│   ├── build.rs               # tauri-build (embedded assets/context)
│   ├── tauri.conf.json        # App config: productName, 2 windows, CSP, NSIS bundling
│   ├── capabilities\default.json  # Plugin permissions (sql/store/clipboard/autostart)
│   ├── icons\                 # App + tray icons
│   ├── src\
│   │   ├── main.rs            # Entry → snippetspot_lib::run()
│   │   ├── lib.rs             # Builder: plugins, window effects, tray, centering,
│   │   │                      #   hide-on-blur, ~38 Tauri commands; starts clipboard
│   │   │                      #   watcher + startup backup in setup()
│   │   ├── migrate.rs         # SQLite migrations (v1 snippets; v3 vault_items +
│   │   │                      #   clipboard_entries tables + indexes)
│   │   ├── hotkey.rs          # WH_KEYBOARD_LL global hook (dedicated thread + msg loop),
│   │   │                      #   parse_hotkey(), AtomicU32 combo state
│   │   ├── paste.rs           # paste mode (clipboard save → Ctrl+V → restore ~300ms)
│   │   │                      #   / type mode (KEYEVENTF_UNICODE)
│   │   ├── variables.rs       # Rust-side variable expansion (authoritative at paste time)
│   │   ├── secrets.rs         # Windows DPAPI encrypt/decrypt (user scope) +
│   │   │                      #   looks_like_secret pattern detection
│   │   ├── vault.rs           # Vault CRUD (credentials + API keys); secrets only exit
│   │   │                      #   via explicit reveal/copy/paste commands
│   │   ├── clipboard.rs       # Background history watcher (poll arboard 500ms, dedupe,
│   │   │                      #   skip secrets/self-writes) → clipboard-history-changed
│   │   └── backup.rs          # Timestamped DB + settings backups (auto on start, keep 10)
│   └── gen\                   # Generated schemas (capabilities) — do not edit
│
├── scripts\
│   ├── setup.ps1              # One-time toolchain install (Rust + VS Build Tools + SDK)
│   └── build.ps1              # Task wrapper: dev / test / check / build
│
└── dist\                      # Vite build output (frontendDist, generated at build time)
```

---

## 3. v1 File Descriptions (at a glance)

| File | What it does |
| --- | --- |
| `src/lib/types.ts` | Single source of truth for `Snippet`, `SnippetInput`, `Settings`, `SearchHit`, `VaultItem`, `ClipboardEntry`, `BackupInfo`, `ImportMergePolicy`, category/type constants. Both windows and both sides (TS/Rust via JS) depend on these shapes. |
| `src/lib/search.ts` | Builds a lowercase haystack per snippet; `uFuzzy` filters; a deterministic composite score ranks favorites, exact/starts-with title matches, tag/category hits, recency and usage. Empty query = browse favorites-first. Tested for the spec examples (`li`→LinkedIn, etc.). |
| `src/lib/variables.ts` | Pure `expandVariables()` — mirrors the Rust rules exactly so previews match paste output. |
| `src/lib/db.ts` | Singleton `tauri-plugin-sql` connection to `sqlite:snippetspot.db`; maps SQL rows ↔ `Snippet` (JSON tags, 0/1 favorite, ISO dates); generates UUID v4 ids + timestamps. |
| `src/lib/api.ts` | Every `invoke()` name the frontend uses, typed, plus `onPopupShown` and `onClipboardHistoryChanged` event subscriptions. The contract the ~38 Rust commands implement. |
| `src/popup/Popup.tsx` | The launcher: auto-focus search, `SnippetIndex`-driven results with `<mark>` highlighting, full keyboard handling, paste flow (`pasteSnippet` → `recordUsage` → rebuild index), Ctrl+N/E bridge to the manager via `localStorage.ss_edit_target`. Vault items appear in results (title + username, masked badge, never the secret) with `u`/`s`/`c` actions; `Ctrl+Shift+H` toggles clipboard-history mode (live via the event). |
| `src/manager/Manager.tsx` | CRUD + categories + import/export + settings. Snippets/Vault tab strip; import has a merge-policy select (skip/overwrite/rename) with a summary alert (imported/updated/skipped); export dropdown offers JSON, CSV, Markdown; settings wire hotkey, paste mode, clipboard history, backups. |
| `src-tauri/src/hotkey.rs` | Low-level `WH_KEYBOARD_LL` hook on its own thread (like PowerToys Run) so `Alt+Space` fires reliably and <100ms. `AtomicU32` holds the current (mods, vk); a channel triggers `show_popup`. |
| `src-tauri/src/paste.rs` | Paste mode: save clipboard → write snippet → `SendInput` Ctrl+V → restore after ~300ms (best-effort text preservation). Type mode: Unicode key events, clipboard untouched. |
| `src-tauri/src/variables.rs` | Same expansion rules as TS, run in Rust at paste time (can read the live clipboard / env vars). |
| `src-tauri/src/migrate.rs` | Versioned `Migration` structs on `sqlite:snippetspot.db` — v1 `snippets`, v3 `vault_items` + `clipboard_entries` tables (+ indexes). v2 unchanged. |
| `src-tauri/src/lib.rs` | Wires everything: plugins (single-instance, store, sql, dialog, fs, autostart, clipboard-manager), Acrylic→Blur window effects, cursor-monitor centering, hide-on-focus-loss, tray menu, and ~38 commands. `setup()` starts the clipboard watcher and a startup backup; Settings adds `clipboard_history_enabled`, `clipboard_history_cap`, `backup_retention`; `paste.rs` marks app clipboard writes so history suppresses them. |
| `src-tauri/src/secrets.rs` | Windows DPAPI (`CryptProtectData`/`CryptUnprotectData`, user scope) `encrypt_secret`/`decrypt_secret`; `looks_like_secret` detects API-key/password patterns (sk-, ghp_, AIza, private-key headers). |
| `src-tauri/src/vault.rs` | CRUD for `vault_items` (credentials + API keys); secrets stay DPAPI-encrypted and only leave via explicit `reveal_secret`/`copy_secret`/`paste_*` commands. |
| `src-tauri/src/clipboard.rs` | Background watcher thread (poll `arboard` 500ms, dedupe consecutive, skip empty/oversized/likely-secrets, ~1s suppression of app self-writes); cap 500 entries, prune older than 7 days; emits `clipboard-history-changed`. |
| `src-tauri/src/backup.rs` | Timestamped backups of the SQLite DB + settings.json into `<app_config_dir>/backups/`; auto on start (skips within the same minute), keeps newest 10; restore copies over the live DB (restart required). |
| `src/lib/secrets.ts` | Pure `maskSecret()` — masks everything but the last 4 characters of a secret. |
| `src/lib/importExport.ts` | Pure `snippetsToCsv()`, `snippetsToMarkdown()`, and `planImport()` (merge policy: skip/overwrite/rename on normalized title). |
| `src/manager/SecretField.tsx` | Masked secret input with Show/Hide toggle and Copy ("(blank = keep current)"). |
| `src/manager/VaultPanel.tsx` | Vault list + create/edit form (title, kind credential/api_key, username, secret). |
| `src/manager/BackupsPanel.tsx` | Retention setting, "Back up now", backup list with Restore. |

### Runtime data

- **DB:** `%APPDATA%\com.snippetspot.app\snippetspot.db` (tables: `snippets`, `vault_items`, `clipboard_entries`)
- **Settings:** `%APPDATA%\com.snippetspot.app\settings.json` (`hotkey`, `paste_mode`, `clipboard_history_enabled`, `clipboard_history_cap`, `backup_retention`)
- **Backups:** `%APPDATA%\com.snippetspot.app\backups\` (automatic on app start, keeps newest 10)

---

## 4. v2 (shipped)

v2 shipped as SnippetSpot 0.1.0 (Windows-only) on the same foundation — Tauri 2 +
React 19 + TypeScript + Tailwind v4 + SQLite (`tauri-plugin-sql`). The three
high-priority backlog features were delivered with ~22 new Rust commands (~38 total).

### 4.1 Secure vault

- New `vault_items` table (UUID id, title, kind `credential|api_key`, username,
  `secret_enc` BLOB, timestamps) via migration v3.
- Secrets are encrypted with **Windows DPAPI (user scope)** before hitting the DB —
  never stored plaintext.
- Commands: `vault_list` / `create` / `update` / `delete` / `reveal_secret` /
  `copy_secret` / `paste_username` / `paste_secret`. Secrets are never returned to the
  frontend except via explicit reveal/copy/paste.
- Manager **Vault** tab: masked `SecretField` (Show/Hide + Copy, "(blank = keep
  current)") and `VaultPanel` list + create/edit form.
- Popup: vault items appear in search results (title + username, masked "••••" badge,
  never the secret). Select one and press **u** (username), **s** (secret), or **c**
  (copy).

### 4.2 Clipboard history

- `src-tauri/src/clipboard.rs`: background watcher thread polls `arboard` every 500ms,
  dedupes consecutive identical entries, skips empty / >5000-char / likely-secret
  content, and suppresses capture for ~1s after the app itself writes the clipboard.
- New `clipboard_entries` table (content, created_at, pinned). Cap 500 entries, prune
  older than 7 days. Emits `clipboard-history-changed` for live refresh.
- Commands: `clipboard_get_enabled` / `set_enabled` / `get_cap` / `set_cap` / `list` /
  `delete` / `clear` / `toggle_pin` / `paste`.
- Popup: `Ctrl+Shift+H` toggles history mode — Enter paste, Del delete, P pin, Esc exit,
  Clear button.

### 4.3 Import/export v2 + backups

- Export now offers **JSON, CSV, and Markdown** (`snippetsToCsv()` /
  `snippetsToMarkdown()`); export dropdown in the manager.
- Import has a **merge-policy select** — skip / overwrite / rename on normalized title
  (`planImport()`) — with a summary alert (imported / updated / skipped).
- `src-tauri/src/backup.rs`: timestamped backups of the SQLite DB + settings.json into
  `<app_config_dir>/backups/`; automatic at every app start (skips if one exists within
  the same minute), keeps the newest 10 by default. Restore copies a backup over the
  live DB (app restart required). Manager **Backups** panel: retention setting, "Back
  up now", backup list with Restore.

### 4.4 Security model

- Passwords and API keys are never stored in plaintext (DPAPI user-scope encryption),
  never shown in plaintext in the UI (masked; reveal is transient), never included in
  search indexes, and never included in JSON/CSV/Markdown exports. Vault items are never
  imported from files.
- DPAPI blobs are bound to the Windows user + machine — a backup moved to another
  machine cannot decrypt its secrets.
- Snippet content itself is **not** encrypted (lock-only design).

### 4.5 Test coverage

- `cargo test`: 23 passed · `vitest`: 57 passed (4 files) · `tsc` clean.

---

## 5. v2.1+ Backlog

Deferred ideas from the original v2 plan, still future work:

| Priority | Feature | Approach |
| --- | --- | --- |
| P0 | **AI semantic search** | Local embeddings (on-device, no cloud). Embed each snippet with a small model (e.g. `@huggingface/transformers` + MiniLM, WASM/WebGPU); store vectors in a new `embeddings` table (or JSON column); one-time background embedding job + incremental on CRUD. Hybrid ranker: fuzzy score + cosine similarity; natural-language queries ("my email", "github profile") route to the top by semantic match. Additive schema change — no breaking rewrite. |
| P1 | **Variable expansion UI** | Live preview of `{{date}}`/`{{clipboard}}` in the manager editor; custom date/time formats (`{{date:YYYY-MM}}`); multiline-friendly placeholders; "insert variable" picker in the content textarea. |
| P1 | **Settings/appearance polish** | Paste-mode per snippet (override global); per-snippet "type" toggle; default category/type preferences; appearance (window width, theme accent, blur strength). |
| P2 | **macOS/Linux support** | Hotkey layer already isolated in `hotkey.rs` — abstract into a trait; swap `SendInput`/hook per platform (`global-hotkey` crate or platform APIs); conditional window effects (`NSVisualEffect` on macOS). Keep `#[cfg(target_os)]` seams. |
| P2 | **Search quality** | Multi-token queries (AND of terms), typo tolerance tuning, per-field weights, category+tag filters in the popup, persistent per-query "did you mean" from usage data. |
| P2 | **System integration** | Auto-update (`tauri-plugin-updater`), code signing, multi-monitor DPI handling, click-through shadow improvements, per-monitor remembering of last position. |
| P3 | **Snippet sharing** | Export a single snippet as a shareable `.json`/gist-style file; optional local-network sync (LAN-only, still no cloud). |
| P3 | **Power features** | Scriptable snippets (run command/script output as paste), nested/variable templates with prompts, snippet groups/folders, bulk tagging UI, keyboard-first manager navigation. |

### 5.1 v2.1+ release checklist

- [x] Clipboard watcher + history UI tests (shipped in v2)
- [x] Update README + this document (shipped in v2)
- [ ] Embedding model size/accuracy benchmark on 10k snippets (memory, latency, cold start)
- [ ] Hybrid ranking regression tests (existing vitest suite extended)
- [ ] macOS/Linux CI build (if P2 scope confirmed)
- [ ] Signed installer + updater channel

### 5.2 Out of scope (unless requested)

- Cloud sync / accounts
- Natural-language *generation* (only retrieval/search)
- Mobile versions
