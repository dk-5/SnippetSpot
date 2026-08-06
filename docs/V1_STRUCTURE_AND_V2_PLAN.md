# SnippetSpot — v1 Structure & v2 Plan

## 1. v1 Overview

SnippetSpot is a Windows-only, Spotlight-style launcher for personal text snippets.
Press **Alt+Space**, type to fuzzy-search, press **Enter**, and the snippet is pasted
into the previously focused application. Everything runs locally (SQLite + JSON);
no cloud, no telemetry.

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
│   │   │                      #   SNIPPET_TYPES, DEFAULT_CATEGORIES, DEFAULT_HOTKEY
│   │   ├── search.ts          # SnippetIndex: uFuzzy filter + composite ranker
│   │   │                      #   (favorites/exact/tags/recency/usage); browse mode
│   │   ├── variables.ts       # Pure variable expansion: {{date}}/{{time}}/{{clipboard}}/{{env:}}
│   │   ├── db.ts              # SQLite CRUD via tauri-plugin-sql (init/list/create/update/
│   │   │                      #   delete/duplicate/recordUsage/import)
│   │   ├── api.ts             # Typed wrappers over Tauri invoke() + event listeners
│   │   ├── search.test.ts     # vitest: ranking + spec examples + 10k perf sanity
│   │   └── variables.test.ts  # vitest: all placeholder rules
│   │
│   ├── popup\                 # ── launcher window (transparent, acrylic, always-on-top) ──
│   │   └── Popup.tsx          # Search UI, highlighted results, keyboard nav, paste flow
│   │                          #   (↑↓ / Enter / Esc / Ctrl+N / Ctrl+E / Del / Ctrl+F)
│   │
│   └── manager\               # ── management window (normal window) ──
│       ├── Manager.tsx        # Layout: header, category sidebar, list, editor, settings
│       ├── SnippetRow.tsx     # List row: title/preview/badges/favorite star/duplicate
│       ├── HotkeyRecorder.tsx # Record-mode global hotkey capture + validation
│       └── VariableCheatsheet.tsx  # Static reference for paste variables
│
├── src-tauri\                 # ── Rust backend ───────────────────────────────────────
│   ├── Cargo.toml             # Rust deps + release profile (LTO, strip, opt-size)
│   ├── build.rs               # tauri-build (embedded assets/context)
│   ├── tauri.conf.json        # App config: productName, 2 windows, CSP, NSIS bundling
│   ├── capabilities\default.json  # Plugin permissions (sql/store/clipboard/autostart)
│   ├── icons\                 # App + tray icons
│   ├── src\
│   │   ├── main.rs            # Entry → snippetspot_lib::run()
│   │   ├── lib.rs             # Builder: plugins, window effects, tray, centering,
│   │   │                      #   hide-on-blur, all 16 Tauri commands
│   │   ├── migrate.rs         # SQLite migrations (snippets table + 4 indexes)
│   │   ├── hotkey.rs          # WH_KEYBOARD_LL global hook (dedicated thread + msg loop),
│   │   │                      #   parse_hotkey(), AtomicU32 combo state
│   │   ├── paste.rs           # paste mode (clipboard save → Ctrl+V → restore ~300ms)
│   │   │                      #   / type mode (KEYEVENTF_UNICODE)
│   │   └── variables.rs       # Rust-side variable expansion (authoritative at paste time)
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
| `src/lib/types.ts` | Single source of truth for `Snippet`, `SnippetInput`, `Settings`, `SearchHit`, category/type constants. Both windows and both sides (TS/Rust via JS) depend on these shapes. |
| `src/lib/search.ts` | Builds a lowercase haystack per snippet; `uFuzzy` filters; a deterministic composite score ranks favorites, exact/starts-with title matches, tag/category hits, recency and usage. Empty query = browse favorites-first. Tested for the spec examples (`li`→LinkedIn, etc.). |
| `src/lib/variables.ts` | Pure `expandVariables()` — mirrors the Rust rules exactly so previews match paste output. |
| `src/lib/db.ts` | Singleton `tauri-plugin-sql` connection to `sqlite:snippetspot.db`; maps SQL rows ↔ `Snippet` (JSON tags, 0/1 favorite, ISO dates); generates UUID v4 ids + timestamps. |
| `src/lib/api.ts` | Every `invoke()` name the frontend uses, typed, plus `onPopupShown` event subscription. The contract the Rust commands implement. |
| `src/popup/Popup.tsx` | The launcher: auto-focus search, `SnippetIndex`-driven results with `<mark>` highlighting, full keyboard handling, paste flow (`pasteSnippet` → `recordUsage` → rebuild index), Ctrl+N/E bridge to the manager via `localStorage.ss_edit_target`. |
| `src/manager/Manager.tsx` | CRUD + categories + import/export JSON + settings. Filters by category using `SnippetIndex` over the subset; editor validates and persists; settings panel wires hotkey/paste-mode/autostart. |
| `src-tauri/src/hotkey.rs` | Low-level `WH_KEYBOARD_LL` hook on its own thread (like PowerToys Run) so `Alt+Space` fires reliably and <100ms. `AtomicU32` holds the current (mods, vk); a channel triggers `show_popup`. |
| `src-tauri/src/paste.rs` | Paste mode: save clipboard → write snippet → `SendInput` Ctrl+V → restore after ~300ms (best-effort text preservation). Type mode: Unicode key events, clipboard untouched. |
| `src-tauri/src/variables.rs` | Same expansion rules as TS, run in Rust at paste time (can read the live clipboard / env vars). |
| `src-tauri/src/migrate.rs` | Versioned `Migration` structs registered on `sqlite:snippetspot.db`. |
| `src-tauri/src/lib.rs` | Wires everything: plugins (single-instance, store, sql, dialog, fs, autostart, clipboard-manager), Acrylic→Blur window effects, cursor-monitor centering, hide-on-focus-loss, tray menu, and 16 commands. |

### Runtime data (v1)

- **DB:** `%APPDATA%\com.snippetspot.app\snippetspot.db`
- **Settings:** `%APPDATA%\com.snippetspot.app\settings.json` (`hotkey`, `paste_mode`)
- **Backups:** via Manager → Export JSON.

---

## 4. v2 Plan

### 4.1 Goals

Keep the v1 foundation; add the deferred features plus high-value polish. v2 targets
**same architecture** (Tauri + SQLite + in-memory search) so most changes are additive.

### 4.2 Feature backlog (prioritized)

| Priority | Feature | Approach |
| --- | --- | --- |
| P0 | **AI semantic search** | Local embeddings (on-device, no cloud). Embed each snippet with a small model (e.g. `@huggingface/transformers` + MiniLM, WASM/WebGPU); store vectors in a new `embeddings` table (or JSON column); one-time background embedding job + incremental on CRUD. Hybrid ranker: fuzzy score + cosine similarity; natural-language queries ("my email", "github profile") route to the top by semantic match. Schema is already additive (`ALTER TABLE snippets ADD COLUMN embedding …` migration or separate table) — no breaking change. |
| P0 | **Clipboard history** | Continuous clipboard polling (e.g. every 500ms) in Rust; new `clipboard_entries` table; "history" mode in the popup (a second result mode toggled by a key, e.g. `Ctrl+Shift+H`); paste a history entry like a snippet; search history too. Optional: pin favorites / copy-not-paste actions. |
| P1 | **Variable expansion UI** | Live preview of `{{date}}`/`{{clipboard}}` in the manager editor; custom date/time formats (`{{date:YYYY-MM}}`); multiline-friendly placeholders; "insert variable" picker in the content textarea. |
| P1 | **Settings polish** | Paste-mode per snippet (override global); per-snippet "type" toggle; default category/type preferences; appearance (window width, theme accent, blur strength). |
| P1 | **Import/Export v2** | CSV + Markdown export; import merge policy (skip duplicates by title, overwrite, or rename); automatic timestamped backups on app start. |
| P1 | **Backup/restore** | Copy/restore the SQLite file from the manager; optional encrypted backup (AES-GCM, local key). |
| P2 | **macOS/Linux support** | Hotkey layer already isolated in `hotkey.rs` — abstract into a trait; swap `SendInput`/hook per platform (`global-hotkey` crate or platform APIs); conditional window effects (`NSVisualEffect` on macOS). Keep `#[cfg(target_os)]` seams. |
| P2 | **Search quality** | Multi-token queries (AND of terms), typo tolerance tuning, per-field weights, category+tag filters in the popup, persistent per-query "did you mean" from usage data. |
| P2 | **System integration** | Auto-update (`tauri-plugin-updater`), code signing, multi-monitor DPI handling, click-through shadow improvements, per-monitor remembering of last position. |
| P3 | **Snippet sharing** | Export a single snippet as a shareable `.json`/gist-style file; optional local-network sync (LAN-only, still no cloud). |
| P3 | **Power features** | Scriptable snippets (run command/script output as paste), nested/variable templates with prompts, snippet groups/folders, bulk tagging UI, keyboard-first manager navigation. |

### 4.3 Architecture changes for v2

1. **Search abstraction** — introduce a `SearchProvider` interface: `FuzzySearch`, and later `SemanticSearch` + `HybridSearch`. The popup stays unchanged behind the interface.
2. **Embedding pipeline** — Rust command `ensure_embeddings()` runs a background job (progress events → manager UI); model cached in `app_data_dir`; vectors stored per-snippet with a model-version column so re-embedding is automatic on model upgrade.
3. **Clipboard watcher** — new `src-tauri/src/clipboard.rs` thread; a toggle in settings + tray; dedupe consecutive identical entries; cap stored entries (e.g. 500).
4. **Settings model** — migrate `settings.json` toward typed, schema'd settings with migration-on-load (fall back to defaults) instead of ad-hoc keys; expose a typed settings API to both windows.
5. **Database migrations** — continue `migrate.rs` versioning (v2 adds `embeddings`/`clipboard_entries` tables + any indexes). No schema rewrites.

### 4.4 v2 release checklist

- [ ] Embedding model size/accuracy benchmark on 10k snippets (memory, latency, cold start)
- [ ] Hybrid ranking regression tests (existing vitest suite extended)
- [ ] Clipboard watcher + history UI tests
- [ ] macOS/Linux CI build (if P2 scope confirmed)
- [ ] Signed installer + updater channel
- [ ] Update README + this document

### 4.5 Out of scope for v2 (unless requested)

- Cloud sync / accounts
- Natural-language *generation* (only retrieval/search)
- Mobile versions
