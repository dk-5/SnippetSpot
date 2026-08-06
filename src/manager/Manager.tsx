import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { DEFAULT_CATEGORIES, DEFAULT_HOTKEY, SNIPPET_TYPES } from "../lib/types";
import type {
  ImportMergePolicy,
  PasteMode,
  Snippet,
  SnippetInput,
  SnippetType,
} from "../lib/types";
import { planImport, snippetsToCsv, snippetsToMarkdown } from "../lib/importExport";
import { SnippetIndex } from "../lib/search";
import {
  createSnippet,
  deleteSnippet,
  duplicateSnippet,
  importSnippets,
  initDb,
  listSnippets,
  updateSnippet,
} from "../lib/db";
import {
  clipboardGetCap,
  clipboardGetEnabled,
  clipboardSetCap,
  clipboardSetEnabled,
  getAutostart,
  getHotkey,
  getPasteMode,
  readTextFile,
  setAutostart as setAutostartApi,
  setHotkey as setHotkeyApi,
  setPasteMode as setPasteModeApi,
  writeTextFile,
} from "../lib/api";
import { expandVariables } from "../lib/variables";
import { HotkeyRecorder } from "./HotkeyRecorder";
import { VariableCheatsheet } from "./VariableCheatsheet";
import { SnippetRow } from "./SnippetRow";
import { VaultPanel } from "./VaultPanel";
import { BackupsPanel } from "./BackupsPanel";

type SortKey = "updated" | "used" | "favorite";

interface FormState {
  id: string | null;
  title: string;
  description: string;
  category: string;
  tags: string;
  type: SnippetType;
  content: string;
  favorite: boolean;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "used", label: "Most used" },
  { value: "favorite", label: "Favorites" },
];

const inputCls =
  "w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";
const selectCls =
  "rounded border border-white/10 bg-[#1a1a22] px-2.5 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";
const contentCls =
  "min-h-[180px] w-full resize-none rounded border border-white/10 bg-white/5 p-2.5 font-mono text-xs leading-relaxed text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";

function emptyForm(): FormState {
  return {
    id: null,
    title: "",
    description: "",
    category: "",
    tags: "",
    type: "Plain",
    content: "",
    favorite: false,
  };
}

function formFromSnippet(s: Snippet): FormState {
  return {
    id: s.id,
    title: s.title,
    description: s.description ?? "",
    category: s.category,
    tags: s.tags.join(", "),
    type: "Plain",
    content: s.content,
    favorite: s.favorite,
  };
}

function formsEqual(a: FormState, b: FormState): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.description === b.description &&
    a.category === b.category &&
    a.tags === b.tags &&
    a.type === b.type &&
    a.content === b.content &&
    a.favorite === b.favorite
  );
}

function tagsFromText(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter((t) => t !== ""))];
}

function sortSnippets(list: Snippet[], key: SortKey): Snippet[] {
  const copy = [...list];
  copy.sort((a, b) => {
    if (key === "used") {
      const diff = b.usage_count - a.usage_count;
      if (diff !== 0) return diff;
    } else if (key === "favorite") {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
  return copy;
}

function toInputArray(parsed: unknown): SnippetInput[] {
  let items: unknown;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed != null && typeof parsed === "object") {
    const maybe = (parsed as { snippets?: unknown }).snippets;
    items = Array.isArray(maybe) ? maybe : [];
  } else {
    items = [];
  }
  const out: SnippetInput[] = [];
  for (const item of items as unknown[]) {
    if (item == null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const content = typeof rec.content === "string" ? rec.content : "";
    if (!title || !content) continue;
    const rawTags = Array.isArray(rec.tags) ? rec.tags : [];
    const tags = [...new Set(rawTags.map((t) => String(t).trim()).filter((t) => t !== ""))];
    out.push({
      title,
      content,
      description: rec.description == null ? null : String(rec.description),
      category:
        rec.category == null || String(rec.category).trim() === ""
          ? "Personal"
          : String(rec.category).trim(),
      tags,
      favorite: rec.favorite === true || rec.favorite === 1,
    });
  }
  return out;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--ss-text-dim)]">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Manager() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [base, setBase] = useState<FormState>(emptyForm);
  const [preview, setPreview] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"snippets" | "vault">("snippets");
  const [currentHotkey, setCurrentHotkey] = useState(DEFAULT_HOTKEY);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [pasteMode, setPasteModeState] = useState<PasteMode>("paste");
  const [autostart, setAutostartState] = useState(false);
  const [clipboardEnabled, setClipboardEnabled] = useState(false);
  const [clipboardCap, setClipboardCap] = useState("500");
  const [mergePolicy, setMergePolicy] = useState<ImportMergePolicy>("skip");
  const [exportOpen, setExportOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const dirty = !formsEqual(form, base);

  const alertError = (msg: string) => {
    window.alert(msg);
  };

  const loadSnippet = (s: Snippet) => {
    const f = formFromSnippet(s);
    setForm(f);
    setBase(f);
    setSelectedId(s.id);
    setPreview(false);
  };

  const clearForm = () => {
    const f = emptyForm();
    setForm(f);
    setBase(f);
    setSelectedId(null);
    setPreview(false);
  };

  const selectSnippet = (s: Snippet) => {
    setSettingsOpen(false);
    setRightTab("snippets");
    loadSnippet(s);
  };

  const reloadData = async (): Promise<Snippet[]> => {
    const list = await listSnippets();
    setSnippets(list);
    return list;
  };

  const reloadAndReselect = async () => {
    const list = await reloadData();
    if (selectedId) {
      const s = list.find((x) => x.id === selectedId);
      if (s) loadSnippet(s);
    }
  };

  const handleNew = () => {
    clearForm();
    setSettingsOpen(false);
    setRightTab("snippets");
    setActiveCategory("All");
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      window.alert("Title and content are required");
      return;
    }
    try {
      const input: SnippetInput = {
        title: form.title.trim(),
        content: form.content,
        description: form.description.trim() === "" ? null : form.description.trim(),
        category: form.category.trim() === "" ? "Personal" : form.category.trim(),
        tags: tagsFromText(form.tags),
        favorite: form.favorite,
      };
      const saved = form.id ? await updateSnippet(form.id, input) : await createSnippet(input);
      await reloadData();
      loadSnippet(saved);
    } catch (err) {
      console.error("Failed to save snippet", err);
      window.alert(`Failed to save snippet: ${String(err)}`);
    }
  };

  const handleDuplicate = async () => {
    if (!form.id) return;
    try {
      const dup = await duplicateSnippet(form.id);
      await reloadData();
      loadSnippet(dup);
    } catch (err) {
      console.error("Failed to duplicate snippet", err);
    }
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!window.confirm("Delete this snippet? This cannot be undone.")) return;
    try {
      await deleteSnippet(form.id);
      await reloadData();
      clearForm();
    } catch (err) {
      console.error("Failed to delete snippet", err);
    }
  };

  const handleToggleFavorite = async (s: Snippet) => {
    try {
      await updateSnippet(s.id, {
        title: s.title,
        content: s.content,
        description: s.description,
        category: s.category,
        tags: s.tags,
        favorite: !s.favorite,
      });
      await reloadAndReselect();
    } catch (err) {
      console.error("Failed to toggle favorite", err);
    }
  };

  const handleRowDuplicate = async (id: string) => {
    try {
      await duplicateSnippet(id);
      await reloadAndReselect();
    } catch (err) {
      console.error("Failed to duplicate snippet", err);
    }
  };

  const handleImport = async () => {
    try {
      const p = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof p !== "string") return;
      const text = await readTextFile(p);
      const parsed: unknown = JSON.parse(text);
      const inputs = toInputArray(parsed);
      const plan = planImport(inputs, snippets, mergePolicy);
      let created = 0;
      if (plan.create.length > 0) {
        created = await importSnippets(plan.create);
      }
      for (const u of plan.update) {
        await updateSnippet(u.id, u.input);
      }
      await reloadData();
      window.alert(
        `Imported ${created}, updated ${plan.update.length}, skipped ${plan.skipped}`
      );
    } catch (err) {
      console.error("Import failed", err);
      window.alert(`Import failed: ${String(err)}`);
    }
  };

  const handleExport = async (format: "json" | "csv" | "markdown") => {
    try {
      const p = await save({
        filters:
          format === "json"
            ? [{ name: "JSON", extensions: ["json"] }]
            : format === "csv"
              ? [{ name: "CSV", extensions: ["csv"] }]
              : [{ name: "Markdown", extensions: ["md"] }],
        defaultPath:
          format === "json"
            ? "snippetspot-backup.json"
            : format === "csv"
              ? "snippetspot-snippets.csv"
              : "snippetspot-snippets.md",
      });
      if (!p) return;
      const content =
        format === "json"
          ? JSON.stringify(
              {
                app: "snippetspot",
                version: 1,
                exportedAt: new Date().toISOString(),
                snippets,
              },
              null,
              2
            )
          : format === "csv"
            ? snippetsToCsv(snippets)
            : snippetsToMarkdown(snippets);
      await writeTextFile(p, content);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  const handleSaveHotkey = async (combo: string): Promise<boolean> => {
    try {
      await setHotkeyApi(combo);
      setCurrentHotkey(combo);
      setHotkeyError(null);
      return true;
    } catch (err) {
      setHotkeyError(String(err));
      return false;
    }
  };

  const handlePasteMode = async (mode: PasteMode) => {
    setPasteModeState(mode);
    try {
      await setPasteModeApi(mode);
    } catch (err) {
      console.error("Failed to set paste mode", err);
    }
  };

  const handleAutostart = async (enabled: boolean) => {
    setAutostartState(enabled);
    try {
      await setAutostartApi(enabled);
    } catch (err) {
      console.error("Failed to set autostart", err);
    }
  };

  const handleClipboardEnabled = async (enabled: boolean) => {
    setClipboardEnabled(enabled);
    try {
      await clipboardSetEnabled(enabled);
    } catch (err) {
      console.error("Failed to set clipboard history setting", err);
    }
  };

  const handleClipboardCap = async (raw: string) => {
    const n = Math.max(1, Number(raw) || 1);
    setClipboardCap(String(n));
    try {
      await clipboardSetCap(n);
    } catch (err) {
      console.error("Failed to set clipboard history cap", err);
    }
  };

  const handleRefresh = async () => {
    try {
      await reloadData();
    } catch (err) {
      console.error("Failed to refresh snippets", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDb();
        const list = await reloadData();
        const [hk, pm, as, cl, cap] = await Promise.all([
          getHotkey().catch(() => DEFAULT_HOTKEY),
          getPasteMode().catch(() => "paste" as PasteMode),
          getAutostart().catch(() => false),
          clipboardGetEnabled().catch(() => false),
          clipboardGetCap().catch(() => 500),
        ]);
        if (cancelled) return;
        setCurrentHotkey(hk);
        setPasteModeState(pm);
        setAutostartState(as);
        setClipboardEnabled(cl);
        setClipboardCap(String(cap));
        const target = localStorage.getItem("ss_edit_target");
        localStorage.removeItem("ss_edit_target");
        if (target) {
          if (target === "new") {
            clearForm();
            requestAnimationFrame(() => titleRef.current?.focus());
          } else {
            const s = list.find((x) => x.id === target);
            if (s) selectSnippet(s);
          }
        }
      } catch (err) {
        console.error("Failed to initialize manager", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const favoritesCount = useMemo(
    () => snippets.filter((s) => s.favorite).length,
    [snippets]
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of snippets) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [snippets]);

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...DEFAULT_CATEGORIES, ...snippets.map((s) => s.category)]) {
      const t = c.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }, [snippets]);

  const sidebarItems = useMemo(
    () => [
      { key: "All", label: "All", count: snippets.length },
      { key: "Favorites", label: "★ Favorites", count: favoritesCount },
      ...categoryOptions.map((c) => ({ key: c, label: c, count: counts.get(c) ?? 0 })),
    ],
    [snippets.length, favoritesCount, categoryOptions, counts]
  );

  const displayed = useMemo(() => {
    let subset = snippets;
    if (activeCategory === "Favorites") {
      subset = subset.filter((s) => s.favorite);
    } else if (activeCategory !== "All") {
      subset = subset.filter((s) => s.category === activeCategory);
    }
    const q = query.trim();
    if (q) {
      const index = new SnippetIndex(subset);
      return index.search(q, 500).map((h) => h.snippet);
    }
    return sortSnippets(subset, sortKey);
  }, [snippets, activeCategory, query, sortKey]);

  return (
    <div className="flex h-screen flex-col bg-[var(--ss-bg-solid)] text-[var(--ss-text)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        <h1 className="mr-2 text-base font-semibold tracking-tight">SnippetSpot</h1>
        <button
          type="button"
          onClick={handleNew}
          className="rounded bg-[var(--ss-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          New
        </button>
        <select
          value={mergePolicy}
          onChange={(e) => setMergePolicy(e.target.value as ImportMergePolicy)}
          title="Import merge policy"
          className={
            "rounded border border-white/10 bg-[#1a1a22] px-2 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]"
          }
        >
          <option value="skip">Skip duplicates</option>
          <option value="overwrite">Overwrite</option>
          <option value="rename">Rename</option>
        </select>
        <button
          type="button"
          onClick={handleImport}
          className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[var(--ss-text)] hover:bg-white/10"
        >
          Import
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[var(--ss-text)] hover:bg-white/10"
          >
            Export ▾
          </button>
          {exportOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setExportOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1 min-w-[130px] rounded border border-white/10 bg-[#1a1a22] py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    void handleExport("json");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--ss-text)] hover:bg-white/5"
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    void handleExport("csv");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--ss-text)] hover:bg-white/5"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    void handleExport("markdown");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--ss-text)] hover:bg-white/5"
                >
                  Markdown
                </button>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          title="Settings"
          className={
            settingsOpen
              ? "rounded bg-[var(--ss-accent-soft)] px-3 py-1.5 text-sm text-[var(--ss-accent)]"
              : "rounded px-3 py-1.5 text-sm text-[var(--ss-text-dim)] hover:bg-white/5 hover:text-[var(--ss-text)]"
          }
        >
          ⚙
        </button>
        <span className="ml-auto text-sm text-[var(--ss-text-dim)]">
          {snippets.length} snippets
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[180px] shrink-0 overflow-y-auto border-r border-white/10 py-2">
          {sidebarItems.map((item) => {
            const active = activeCategory === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveCategory(item.key)}
                className={
                  active
                    ? "flex w-full items-center justify-between gap-2 bg-[var(--ss-accent-soft)] px-3 py-1.5 text-left text-sm text-[var(--ss-text)]"
                    : "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-[var(--ss-text-dim)] hover:bg-white/5 hover:text-[var(--ss-text)]"
                }
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-xs text-[var(--ss-text-faint)]">{item.count}</span>
              </button>
            );
          })}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search snippets…"
              className={"flex-1 " + inputCls}
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className={"w-[150px] shrink-0 " + selectCls}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {displayed.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--ss-text-faint)]">
                No snippets yet. Click “New” to create one.
              </p>
            ) : (
              displayed.map((s) => (
                <SnippetRow
                  key={s.id}
                  snippet={s}
                  selected={s.id === selectedId}
                  onSelect={() => selectSnippet(s)}
                  onToggleFavorite={() => handleToggleFavorite(s)}
                  onDuplicate={() => handleRowDuplicate(s.id)}
                />
              ))
            )}
          </div>
        </main>

        <section className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-white/10">
          <div className="flex shrink-0 border-b border-white/10">
            <button
              type="button"
              onClick={() => {
                setRightTab("snippets");
                setSettingsOpen(false);
              }}
              className={
                rightTab === "snippets" && !settingsOpen
                  ? "flex-1 border-b-2 border-[var(--ss-accent)] px-3 py-2 text-sm font-medium text-[var(--ss-text)]"
                  : "flex-1 border-b-2 border-transparent px-3 py-2 text-sm text-[var(--ss-text-dim)] hover:text-[var(--ss-text)]"
              }
            >
              Snippets
            </button>
            <button
              type="button"
              onClick={() => {
                setRightTab("vault");
                setSettingsOpen(false);
              }}
              className={
                rightTab === "vault" && !settingsOpen
                  ? "flex-1 border-b-2 border-[var(--ss-accent)] px-3 py-2 text-sm font-medium text-[var(--ss-text)]"
                  : "flex-1 border-b-2 border-transparent px-3 py-2 text-sm text-[var(--ss-text-dim)] hover:text-[var(--ss-text)]"
              }
            >
              Vault
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
          {settingsOpen ? (
            <div className="space-y-6 px-4 py-4">
              <h2 className="text-sm font-semibold">Settings</h2>

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ss-text-dim)]">
                  Global hotkey
                </h3>
                <HotkeyRecorder hotkey={currentHotkey} onSave={handleSaveHotkey} />
                {hotkeyError && <p className="mt-1.5 text-xs text-red-400">{hotkeyError}</p>}
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ss-text-dim)]">
                  Paste mode
                </h3>
                <select
                  value={pasteMode}
                  onChange={(e) => handlePasteMode(e.target.value as PasteMode)}
                  className={"w-full " + selectCls}
                >
                  <option value="paste">Paste (Ctrl+V) — preserves clipboard</option>
                  <option value="type">Type characters — no clipboard touch</option>
                </select>
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ss-text-dim)]">
                  Launch at startup
                </h3>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autostart}
                    onChange={(e) => handleAutostart(e.target.checked)}
                    className="h-4 w-4 accent-[var(--ss-accent)]"
                  />
                  Open SnippetSpot at login
                </label>
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ss-text-dim)]">
                  Clipboard history
                </h3>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={clipboardEnabled}
                    onChange={(e) => handleClipboardEnabled(e.target.checked)}
                    className="h-4 w-4 accent-[var(--ss-accent)]"
                  />
                  Track clipboard history
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <span className="shrink-0 text-xs text-[var(--ss-text-dim)]">
                    Max entries
                  </span>
                  <div className="flex-1">
                    <input
                      type="number"
                      min={1}
                      value={clipboardCap}
                      onChange={(e) => handleClipboardCap(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              <BackupsPanel onError={alertError} />

              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ss-text-dim)]">
                  Variables
                </h3>
                <VariableCheatsheet />
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[var(--ss-text)] hover:bg-white/10"
              >
                Refresh snippets
              </button>
            </div>
          ) : rightTab === "vault" ? (
            <VaultPanel onError={alertError} />
          ) : (
            <div className="flex flex-col gap-4 px-4 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {form.id ? "Edit snippet" : "New snippet"}
                </h2>
                {dirty && (
                  <span className="text-xs font-medium text-[var(--ss-accent)]">● unsaved</span>
                )}
              </div>

              <Field label="Title">
                <input
                  ref={titleRef}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputCls}
                  placeholder="Snippet title"
                />
              </Field>

              <Field label="Description">
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={inputCls}
                  placeholder="Optional description"
                />
              </Field>

              <Field label="Category">
                <input
                  value={form.category}
                  list="ss-categories"
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className={inputCls}
                  placeholder="Personal"
                />
                <datalist id="ss-categories">
                  {categoryOptions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>

              <Field label="Tags">
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  className={inputCls}
                  placeholder="tag1, tag2, tag3"
                />
              </Field>

              <Field label="Type">
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as SnippetType }))}
                  className={"w-full " + selectCls}
                >
                  {SNIPPET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--ss-text-dim)]">
                    Content
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreview((v) => !v)}
                    className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-[var(--ss-text-dim)] hover:bg-white/10"
                  >
                    {preview ? "Edit" : "Preview"}
                  </button>
                </div>
                {preview ? (
                  <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-white/5 p-2.5 font-mono text-xs leading-relaxed text-[var(--ss-text)]">
                    {expandVariables(form.content)}
                  </pre>
                ) : (
                  <textarea
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    className={contentCls}
                    placeholder="Snippet content"
                    spellCheck={false}
                  />
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.favorite}
                  onChange={(e) => setForm((f) => ({ ...f, favorite: e.target.checked }))}
                  className="h-4 w-4 accent-[var(--ss-accent)]"
                />
                Favorite
              </label>

              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 rounded bg-[var(--ss-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  disabled={!form.id}
                  title="Duplicate"
                  className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[var(--ss-text)] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!form.id}
                  className="rounded border border-red-500/30 bg-red-500/15 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={clearForm}
                  className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[var(--ss-text-dim)] hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}
