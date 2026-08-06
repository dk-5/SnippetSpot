const VARIABLES: [string, string][] = [
  ["{{date}}", "YYYY-MM-DD"],
  ["{{time}}", "HH:mm"],
  ["{{datetime}}", "YYYY-MM-DD HH:mm"],
  ["{{clipboard}}", "current clipboard"],
  ["{{env:NAME}}", "environment variable"],
  ["{{env:NAME:default}}", "environment variable with default"],
];

export function VariableCheatsheet() {
  return (
    <div className="space-y-1">
      {VARIABLES.map(([code, desc]) => (
        <div key={code} className="flex items-center justify-between gap-2">
          <code className="font-mono text-xs text-[var(--ss-accent)]">{code}</code>
          <span className="text-right text-xs text-[var(--ss-text-faint)]">{desc}</span>
        </div>
      ))}
    </div>
  );
}
