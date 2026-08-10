import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { emit } from "@tauri-apps/api/event";
import type { AppItem, ClipboardEntry, LicenseStatus, SearchHit, Snippet, VaultItem } from "../lib/types";
import { SnippetIndex } from "../lib/search";
import {
  deleteSnippet,
  initDb,
  listSnippets,
  recordUsage,
} from "../lib/db";
import {
  activateLicense,
  appLaunch,
  appList,
  clipboardClear,
  clipboardDelete,
  clipboardList,
  clipboardPaste,
  clipboardTogglePin,
  getLicenseStatus,
  hidePopup,
  onAppsChanged,
  onClipboardHistoryChanged,
  onPopupShown,
  openManager,
  pasteSnippet,
  vaultCopySecret,
  vaultList,
  vaultPasteSecret,
  vaultPasteUsername,
} from "../lib/api";
import { filterApps } from "../lib/appFilter";

function highlightText(query: string, text: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let start = lower.indexOf(q);
  while (start !== -1) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={parts.length}>{text.slice(start, start + q.length)}</mark>
    );
    cursor = start + q.length;
    start = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
}

function filterVaultItems(items: VaultItem[], query: string): VaultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.filter(
    (v) =>
      v.title.toLowerCase().includes(q) ||
      (v.username ?? "").toLowerCase().includes(q)
  );
}

type VaultAction = "username" | "secret" | "copy";

function vaultMenuOptions(item: VaultItem): { action: VaultAction; label: string }[] {
  const opts: { action: VaultAction; label: string }[] = [];
  if (item.username) opts.push({ action: "username", label: "Username" });
  if (item.has_secret) opts.push({ action: "secret", label: "Password / Secret" });
  if (item.has_secret) opts.push({ action: "copy", label: "Copy secret" });
  return opts;
}

function runVaultAction(
  item: VaultItem,
  action: VaultAction,
  onError?: (err: unknown) => void
): void {
  const fail = (err: unknown) => {
    if (onError) onError(err);
  };
  if (action === "username") {
    vaultPasteUsername(item.id).catch(fail);
  } else if (action === "secret") {
    vaultPasteSecret(item.id).catch(fail);
  } else if (action === "copy") {
    vaultCopySecret(item.id).catch(fail);
  }
}

function filterHistory(
  entries: ClipboardEntry[],
  query: string
): ClipboardEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.content.toLowerCase().includes(q));
}

type PopupRow =
  | { kind: "snippet"; hit: SearchHit }
  | { kind: "app"; app: AppItem }
  | { kind: "vault"; item: VaultItem };

export function Popup() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [index, setIndex] = useState<SnippetIndex | null>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [historyEntries, setHistoryEntries] = useState<ClipboardEntry[]>([]);
  const [historyMode, setHistoryMode] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [vaultMenu, setVaultMenu] = useState<VaultItem | null>(null);
  const [menuSel, setMenuSel] = useState(0);
  const [diag, setDiag] = useState("");
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [activateError, setActivateError] = useState("");
  const [activating, setActivating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ query, selected, index, apps, vaultItems, historyEntries, historyMode, vaultMenu, menuSel });
  stateRef.current = { query, selected, index, apps, vaultItems, historyEntries, historyMode, vaultMenu, menuSel };

  const results = useMemo(
    () => (index ? index.search(query, 12) : []),
    [index, query]
  );

  const vaultResults = useMemo(
    () => filterVaultItems(vaultItems, query),
    [vaultItems, query]
  );

  const appResults = useMemo(
    () => filterApps(apps, query),
    [apps, query]
  );

  const historyResults = useMemo(
    () => filterHistory(historyEntries, query),
    [historyEntries, query]
  );

  const rows = useMemo<PopupRow[]>(() => {
    const out: PopupRow[] = [];
    for (const hit of results) out.push({ kind: "snippet", hit });
    for (const item of vaultResults) out.push({ kind: "vault", item });
    for (const app of appResults) out.push({ kind: "app", app });
    return out;
  }, [results, appResults, vaultResults]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>("[data-selected='true']");
    row?.scrollIntoView({ block: "nearest" });
  }, [selected, menuSel, historyMode, vaultMenu, results, vaultResults, appResults, historyResults]);

  const refresh = useCallback(async () => {
    await initDb();
    const s = await listSnippets();
    setSnippets(s);
    setIndex(new SnippetIndex(s));
  }, []);

  const refreshClipboard = useCallback(() => {
    clipboardList()
      .then(setHistoryEntries)
      .catch(() => {});
  }, []);

  const handlePaste = useCallback(
    (snippet: Snippet) => {
      pasteSnippet(snippet.content)
        .then(() => recordUsage(snippet.id))
        .then(() => refresh())
        .catch(() => {});
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
    getLicenseStatus()
      .then(setLicense)
      .catch(() => {});
    vaultList()
      .then(setVaultItems)
      .catch(() => {});
    appList()
      .then(setApps)
      .catch(() => {});
    const appRefreshTimer = window.setTimeout(() => {
      appList()
        .then(setApps)
        .catch(() => {});
    }, 4000);
    refreshClipboard();
    let unlistenPopup: (() => void) | null = null;
    let unlistenClipboard: (() => void) | null = null;
    let unlistenApps: (() => void) | null = null;
    onPopupShown(() => {
      setQuery("");
      setSelected(0);
      setHistoryMode(false);
      setVaultMenu(null);
      inputRef.current?.focus();
      getLicenseStatus()
        .then(setLicense)
        .catch(() => {});
      refresh();
      vaultList()
        .then(setVaultItems)
        .catch(() => {});
      appList()
        .then(setApps)
        .catch(() => {});
    }).then((fn) => {
      unlistenPopup = fn;
    });
    onClipboardHistoryChanged(() => refreshClipboard()).then((fn) => {
      unlistenClipboard = fn;
    });
    onAppsChanged(() => {
      appList()
        .then(setApps)
        .catch(() => {});
    }).then((fn) => {
      unlistenApps = fn;
    });
    const readyTimer = window.setTimeout(() => {
      emit("popup-ready").catch(() => {});
    }, 120);
    return () => {
      window.clearTimeout(readyTimer);
      window.clearTimeout(appRefreshTimer);
      unlistenPopup?.();
      unlistenClipboard?.();
      unlistenApps?.();
    };
  }, [refresh, refreshClipboard]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (historyMode) return;
    setSelected((prev) => Math.min(prev, Math.max(rows.length - 1, 0)));
  }, [rows, historyMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const {
        query: q,
        selected: selIdx,
        index: idx,
        apps: appState,
        vaultItems: vaults,
        historyEntries: entries,
        historyMode: histMode,
        vaultMenu: vm,
        menuSel: menuSelIdx,
      } = stateRef.current;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        localStorage.setItem("ss_edit_target", "new");
        void openManager();
        void hidePopup();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const snipHits = idx ? idx.search(q, 12) : [];
        const sel = snipHits[selIdx]?.snippet ?? null;
        if (sel) {
          localStorage.setItem("ss_edit_target", sel.id);
          void openManager();
          void hidePopup();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        if (histMode) {
          setHistoryMode(false);
        } else {
          setHistoryMode(true);
          refreshClipboard();
        }
        setQuery("");
        setSelected(0);
        return;
      }

      if (histMode) {
        const list = filterHistory(entries, q);
        const cur = list[selIdx] ?? null;
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMode(false);
          setQuery("");
          setSelected(0);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelected((prev) => Math.min(prev + 1, Math.max(list.length - 1, 0)));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelected((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
          if (cur) {
            e.preventDefault();
            clipboardPaste(cur.id).catch(() => {});
          }
        } else if (e.key === "Delete") {
          if (cur) {
            e.preventDefault();
            setSelected(0);
            clipboardDelete(cur.id)
              .then(refreshClipboard)
              .catch(() => {});
          }
        } else if (e.key.toLowerCase() === "p") {
          if (cur) {
            e.preventDefault();
            clipboardTogglePin(cur.id)
              .then(refreshClipboard)
              .catch(() => {});
          }
        }
        return;
      }

      const snipHits = idx ? idx.search(q, 12) : [];
      const appHits = filterApps(appState, q);
      const vaultList = filterVaultItems(vaults, q);
      const total = snipHits.length + appHits.length + vaultList.length;
      const selectedRow: PopupRow | null =
        selIdx < snipHits.length
          ? { kind: "snippet", hit: snipHits[selIdx] }
          : selIdx < snipHits.length + vaultList.length
            ? { kind: "vault", item: vaultList[selIdx - snipHits.length] }
            : selIdx < total
              ? {
                  kind: "app",
                  app: appHits[selIdx - snipHits.length - vaultList.length],
                }
              : null;

      if (vm) {
        const opts = vaultMenuOptions(vm);
        if (e.key === "Escape") {
          e.preventDefault();
          setVaultMenu(null);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setMenuSel((prev) => Math.min(prev + 1, Math.max(opts.length - 1, 0)));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setMenuSel((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
          if (opts[menuSelIdx]) {
            e.preventDefault();
            runVaultAction(vm, opts[menuSelIdx].action, (err) =>
              setDiag(String(err))
            );
            setVaultMenu(null);
          }
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((prev) => Math.min(prev + 1, Math.max(total - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        if (selectedRow?.kind === "snippet") {
          e.preventDefault();
          handlePaste(selectedRow.hit.snippet);
        } else if (selectedRow?.kind === "app") {
          e.preventDefault();
          appLaunch(selectedRow.app.path).catch((err) => setDiag(String(err)));
          void hidePopup();
        } else if (selectedRow?.kind === "vault") {
          e.preventDefault();
          setVaultMenu(selectedRow.item);
          setMenuSel(0);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        void hidePopup();
      } else if (e.key === "Delete") {
        if (selectedRow?.kind === "snippet") {
          e.preventDefault();
          if (window.confirm(`Delete "${selectedRow.hit.snippet.title}"?`)) {
            setSelected(0);
            deleteSnippet(selectedRow.hit.snippet.id)
              .then(() => refresh())
              .catch(() => {});
          }
        }
      } else if (e.key.toLowerCase() === "u") {
        if (selectedRow?.kind === "vault") {
          e.preventDefault();
          vaultPasteUsername(selectedRow.item.id).catch(() => {});
          setVaultMenu(null);
        }
      } else if (e.key.toLowerCase() === "s") {
        if (selectedRow?.kind === "vault") {
          e.preventDefault();
          vaultPasteSecret(selectedRow.item.id).catch(() => {});
          setVaultMenu(null);
        }
      } else if (e.key.toLowerCase() === "c") {
        if (selectedRow?.kind === "vault") {
          e.preventDefault();
          vaultCopySecret(selectedRow.item.id).catch(() => {});
          setVaultMenu(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePaste, refresh, refreshClipboard]);

  let body: ReactNode;
  if (historyMode) {
    if (historyResults.length === 0) {
      body = (
        <div className="flex h-full items-center justify-center text-sm text-[var(--ss-text-faint)]">
          {historyEntries.length === 0 ? "No clipboard history yet" : "No matches"}
        </div>
      );
    } else {
      body = historyResults.map((entry, i) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => clipboardPaste(entry.id).catch(() => {})}
          onMouseEnter={() => setSelected(i)}
          data-selected={i === selected ? true : undefined}
          className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
            i === selected ? "bg-white/10" : "hover:bg-white/5"
          }`}
        >
          <span className="flex items-center gap-2">
            {entry.pinned && (
              <span className="rounded bg-[var(--ss-accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--ss-accent)]">
                Pinned
              </span>
            )}
            <span className="truncate text-[15px] font-medium text-[var(--ss-text)]">
              {highlightText(query, entry.content.replace(/\s+/g, " ").trim())}
            </span>
          </span>
        </button>
      ));
    }
  } else if (rows.length === 0) {
    body = (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ss-text-faint)]">
        {snippets.length === 0 && vaultItems.length === 0
          ? "No snippets yet — press Ctrl+N to add one"
          : "No matches"}
      </div>
    );
  } else {
    body = (
      <>
        {results.map((hit, i) => (
          <button
            key={hit.snippet.id}
            type="button"
            onClick={() => handlePaste(hit.snippet)}
            onMouseEnter={() => setSelected(i)}
            data-selected={i === selected ? true : undefined}
            className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
              i === selected ? "bg-white/10" : "hover:bg-white/5"
            }`}
          >
            <span className="flex items-center gap-2">
              {hit.snippet.favorite && (
                <span className="text-sm text-[var(--ss-accent)]">★</span>
              )}
              <span className="truncate text-[15px] font-medium text-[var(--ss-text)]">
                {highlightText(query, hit.snippet.title)}
              </span>
            </span>
            <span className="truncate text-[13px] text-[var(--ss-text-dim)]">
              {hit.snippet.content.replace(/\s+/g, " ").trim()}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded bg-[var(--ss-accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--ss-accent)]">
                {hit.snippet.category}
              </span>
              {hit.snippet.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-[var(--ss-text-faint)]"
                >
                  {tag}
                </span>
              ))}
            </span>
          </button>
        ))}
        {vaultResults.length > 0 && (
          <div className="mt-2">
            <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--ss-text-faint)]">
              Vault
            </div>
            {vaultResults.map((item, i) => {
              const rowIndex = results.length + i;
              const rowSelected = rowIndex === selected;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={-1}
                  onClick={() => setSelected(rowIndex)}
                  onMouseEnter={() => setSelected(rowIndex)}
                  data-selected={rowSelected ? true : undefined}
                  className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
                    rowSelected ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-[var(--ss-text)]">
                      {highlightText(query, item.title)}
                    </span>
                    {item.has_secret && (
                      <span className="shrink-0 text-xs text-[var(--ss-text-faint)]">
                        ••••
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[13px] text-[var(--ss-text-dim)]">
                    {item.username ?? ""}
                  </span>
                  {rowSelected && (
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          vaultPasteUsername(item.id).catch((err) =>
                            setDiag(String(err))
                          );
                        }}
                        className="rounded bg-[var(--ss-accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--ss-accent)]"
                      >
                        u Username
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          vaultPasteSecret(item.id).catch((err) =>
                            setDiag(String(err))
                          );
                        }}
                        className="rounded bg-[var(--ss-accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--ss-accent)]"
                      >
                        s Secret
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          vaultCopySecret(item.id).catch((err) =>
                            setDiag(String(err))
                          );
                        }}
                        className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-[var(--ss-text-dim)]"
                      >
                        c Copy
                      </button>
                    </span>
                  )}
                  {rowSelected && vaultMenu?.id === item.id && (() => {
                    const opts = vaultMenuOptions(item);
                    if (opts.length === 0) return null;
                    return (
                      <span className="ml-2 mt-1 flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
                        {opts.map((opt, i) => (
                          <button
                            key={opt.action}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              runVaultAction(item, opt.action, (err) =>
                                setDiag(String(err))
                              );
                              setVaultMenu(null);
                            }}
                            onMouseEnter={() => setMenuSel(i)}
                            data-selected={i === menuSel ? true : undefined}
                            className={`rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                              i === menuSel ? "bg-white/10" : "hover:bg-white/5"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </span>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
        {appResults.length > 0 && (
          <div className="mt-2">
            <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--ss-text-faint)]">
              Apps
            </div>
            {appResults.map((app, i) => {
              const rowIndex = results.length + vaultResults.length + i;
              const rowSelected = rowIndex === selected;
              return (
                <button
                  key={app.path}
                  type="button"
                  onClick={() => {
                    setSelected(rowIndex);
                    appLaunch(app.path).catch((err) => setDiag(String(err)));
                    void hidePopup();
                  }}
                    onMouseEnter={() => setSelected(rowIndex)}
                    data-selected={rowSelected ? true : undefined}
                    className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
                      rowSelected ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 text-sm text-[var(--ss-text-faint)]">
                      ▸
                    </span>
                    <span className="truncate text-[15px] font-medium text-[var(--ss-text)]">
                      {highlightText(query, app.name)}
                    </span>
                  </span>
                  <span className="truncate text-[13px] text-[var(--ss-text-dim)]">
                    {app.path}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  if (license?.trialEnded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[var(--ss-bg)] px-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="text-xl font-semibold text-[var(--ss-text)]">
          Trial expired
        </div>
        <p className="text-sm text-[var(--ss-text-dim)]">
          Your access to SnippetSpot has ended — activate a license key for{" "}
          {license.trialDays} more days.
        </p>
        <div className="mt-1 flex w-full flex-col gap-2">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste license key"
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-[var(--ss-text)] outline-none placeholder:text-[var(--ss-text-faint)] focus:border-[var(--ss-accent)]"
          />
          <button
            type="button"
            onClick={() => {
              setActivating(true);
              setActivateError("");
              activateLicense(keyInput.trim())
                .then(() => {
                  setKeyInput("");
                  getLicenseStatus().then(setLicense).catch(() => {});
                })
                .catch((err) => setActivateError(String(err)))
                .finally(() => setActivating(false));
            }}
            disabled={activating}
            className="w-full rounded-lg bg-[var(--ss-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {activating ? "Activating…" : "Activate"}
          </button>
          {activateError && (
            <p className="text-xs text-red-400">{activateError}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void openManager();
            void hidePopup();
          }}
          className="mt-1 rounded-lg bg-[var(--ss-accent)] px-4 py-1.5 text-sm font-medium text-white"
        >
          Manage
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--ss-bg)] shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-white/5 px-4">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
            setVaultMenu(null);
          }}
          placeholder={
            historyMode ? "Search clipboard history…" : "Search snippets…"
          }
          spellCheck={false}
          className="w-full bg-transparent py-3 text-lg text-[var(--ss-text)] outline-none placeholder:text-[var(--ss-text-faint)]"
        />
        <span className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-[var(--ss-text-faint)]">
          Ctrl+F
        </span>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2">{body}</div>
      <footer className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[11px] text-[var(--ss-text-faint)]">
        <span>
          {historyMode
            ? "Clipboard history — Enter paste · Del delete · P pin · Esc exit"
            : "↑↓ navigate · Enter paste/launch · Esc close · Ctrl+N new · Ctrl+E edit · Del delete · Ctrl+Shift+H history · vault: Enter menu"}
        </span>
        {historyMode && (
          <button
            type="button"
            onClick={() => {
              clipboardClear()
                .then(refreshClipboard)
                .catch(() => {});
            }}
            className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-[var(--ss-text-dim)] hover:bg-white/10"
          >
            Clear
          </button>
        )}
      </footer>
      {diag && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-1.5 text-[11px] text-red-300">
          {diag}
        </div>
      )}
    </div>
  );
}
