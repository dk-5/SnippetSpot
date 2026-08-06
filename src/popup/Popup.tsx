import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Snippet } from "../lib/types";
import { SnippetIndex } from "../lib/search";
import {
  deleteSnippet,
  initDb,
  listSnippets,
  recordUsage,
} from "../lib/db";
import {
  hidePopup,
  onPopupShown,
  openManager,
  pasteSnippet,
} from "../lib/api";

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

export function Popup() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [index, setIndex] = useState<SnippetIndex | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef({ query, selected, index });
  stateRef.current = { query, selected, index };

  const results = useMemo(
    () => (index ? index.search(query, 12) : []),
    [index, query]
  );

  const refresh = useCallback(async () => {
    await initDb();
    const s = await listSnippets();
    setSnippets(s);
    setIndex(new SnippetIndex(s));
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
    let unlisten: (() => void) | null = null;
    onPopupShown(() => {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
      refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { query: q, selected: selIdx, index: idx } = stateRef.current;
      const list = idx ? idx.search(q, 12) : [];
      const sel = list[selIdx]?.snippet ?? null;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((prev) => Math.min(prev + 1, Math.max(list.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        if (sel) {
          e.preventDefault();
          handlePaste(sel);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        void hidePopup();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        localStorage.setItem("ss_edit_target", "new");
        void openManager();
        void hidePopup();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (sel) {
          localStorage.setItem("ss_edit_target", sel.id);
          void openManager();
          void hidePopup();
        }
      } else if (e.key === "Delete") {
        if (sel) {
          e.preventDefault();
          if (window.confirm(`Delete "${sel.title}"?`)) {
            setSelected(0);
            deleteSnippet(sel.id)
              .then(() => refresh())
              .catch(() => {});
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePaste]);

  useEffect(() => {
    setSelected((prev) => Math.min(prev, Math.max(results.length - 1, 0)));
  }, [results]);

  let body: ReactNode;
  if (snippets.length === 0) {
    body = (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ss-text-faint)]">
        No snippets yet — press Ctrl+N to add one
      </div>
    );
  } else if (results.length === 0) {
    body = (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ss-text-faint)]">
        No matches
      </div>
    );
  } else {
    body = results.map((hit, i) => (
      <button
        key={hit.snippet.id}
        type="button"
        onClick={() => handlePaste(hit.snippet)}
        onMouseEnter={() => setSelected(i)}
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
    ));
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
          }}
          placeholder="Search snippets…"
          spellCheck={false}
          className="w-full bg-transparent py-3 text-lg text-[var(--ss-text)] outline-none placeholder:text-[var(--ss-text-faint)]"
        />
        <span className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-[var(--ss-text-faint)]">
          Ctrl+F
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">{body}</div>
      <footer className="border-t border-white/5 px-4 py-2 text-center text-[11px] text-[var(--ss-text-faint)]">
        ↑↓ navigate · Enter paste · Esc close · Ctrl+N new · Ctrl+E edit · Del
        delete
      </footer>
    </div>
  );
}
