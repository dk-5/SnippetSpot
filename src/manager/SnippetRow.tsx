import type { Snippet } from "../lib/types";

interface SnippetRowProps {
  snippet: Snippet;
  selected: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onDuplicate: () => void;
}

export function SnippetRow({
  snippet,
  selected,
  onSelect,
  onToggleFavorite,
  onDuplicate,
}: SnippetRowProps) {
  const rowCls = selected
    ? "cursor-pointer border-b border-white/5 bg-[var(--ss-accent-soft)] px-3 py-2"
    : "cursor-pointer border-b border-white/5 px-3 py-2 hover:bg-white/5";
  const titleCls = selected ? "text-[var(--ss-text)]" : "text-[var(--ss-text-dim)]";
  return (
    <div onClick={onSelect} className={rowCls}>
      <div className="flex items-center justify-between gap-2">
        <span className={"min-w-0 truncate text-sm font-semibold " + titleCls}>
          {snippet.title}
        </span>
        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--ss-text-dim)]">
          {snippet.category}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-[var(--ss-text-faint)]">{snippet.content}</p>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          title={snippet.favorite ? "Unfavorite" : "Favorite"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={
            snippet.favorite
              ? "text-sm leading-none text-[var(--ss-accent)] hover:opacity-80"
              : "text-sm leading-none text-[var(--ss-text-faint)] hover:text-[var(--ss-text-dim)]"
          }
        >
          {snippet.favorite ? "★" : "☆"}
        </button>
        <button
          type="button"
          title="Duplicate"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="text-sm leading-none text-[var(--ss-text-faint)] hover:text-[var(--ss-text-dim)]"
        >
          ⧉
        </button>
      </div>
    </div>
  );
}
