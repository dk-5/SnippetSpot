import { useEffect, useState } from "react";

const inputCls =
  "w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";

interface SecretFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}

export function SecretField({
  value,
  onChange,
  placeholder,
  label,
}: SecretFieldProps) {
  const [text, setText] = useState(value);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setText(value);
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    onChange(next);
  };

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="space-y-1">
      {label && (
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--ss-text-dim)]">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2">
        <input
          type={revealed ? "text" : "password"}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={"flex-1 " + inputCls}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="shrink-0 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-[var(--ss-text)] hover:bg-white/10"
        >
          {revealed ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-[var(--ss-text)] hover:bg-white/10"
        >
          Copy
        </button>
      </div>
      {text === "" && (
        <span className="block text-xs text-[var(--ss-text-faint)]">
          (blank = keep current)
        </span>
      )}
    </div>
  );
}
