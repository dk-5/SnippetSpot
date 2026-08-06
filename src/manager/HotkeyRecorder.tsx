import { useState } from "react";
import type { KeyboardEvent } from "react";

interface HotkeyRecorderProps {
  hotkey: string;
  onSave: (combo: string) => Promise<boolean>;
}

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  const k = e.key;
  let key = "";
  if (k === " ") key = "Space";
  else if (k.length === 1) key = k.toUpperCase();
  else if (/^F(?:[1-9]|1[0-2])$/.test(k)) key = k;
  if (!key) return "";
  return [...parts, key].join("+");
}

export function HotkeyRecorder({ hotkey, onSave }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const combo = comboFromEvent(e);
    if (combo) {
      setPending(combo);
      setRecording(false);
      e.currentTarget.blur();
    }
  };

  const handleSave = async () => {
    if (!pending) return;
    const ok = await onSave(pending);
    if (ok) setPending(null);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={recording ? "Press keys…" : pending ?? hotkey}
        onFocus={() => {
          setPending(null);
          setRecording(true);
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={handleKeyDown}
        className="w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={!pending}
        className="shrink-0 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-[var(--ss-text)] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}
