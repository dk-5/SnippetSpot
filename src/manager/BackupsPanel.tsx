import { useCallback, useEffect, useState } from "react";
import {
  backupGetRetention,
  backupList,
  backupNow,
  backupRestore,
  backupSetRetention,
} from "../lib/api";
import type { BackupInfo } from "../lib/types";

const inputCls =
  "w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";

interface BackupsPanelProps {
  onError: (msg: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsPanel({ onError }: BackupsPanelProps) {
  const [retention, setRetention] = useState("7");
  const [backups, setBackups] = useState<BackupInfo[]>([]);

  const reload = useCallback(async () => {
    try {
      const [list, ret] = await Promise.all([backupList(), backupGetRetention()]);
      setBackups(list);
      setRetention(String(ret));
    } catch (err) {
      onError(String(err));
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSaveRetention = async () => {
    const n = Math.max(1, Number(retention) || 1);
    setRetention(String(n));
    try {
      await backupSetRetention(n);
    } catch (err) {
      onError(String(err));
    }
  };

  const handleBackupNow = async () => {
    try {
      await backupNow();
      await reload();
    } catch (err) {
      onError(String(err));
    }
  };

  const handleRestore = async (path: string) => {
    try {
      await backupRestore(path);
      window.alert(
        "Restore complete. Please restart SnippetSpot for the backup to take effect."
      );
    } catch (err) {
      onError(String(err));
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ss-text-dim)]">
        Backups
      </h3>

      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-[var(--ss-text-dim)]">
          Retention (days)
        </span>
        <div className="flex-1">
          <input
            type="number"
            min={1}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            className={inputCls}
          />
        </div>
        <button
          type="button"
          onClick={handleSaveRetention}
          className="shrink-0 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-[var(--ss-text)] hover:bg-white/10"
        >
          Save
        </button>
      </div>

      <button
        type="button"
        onClick={handleBackupNow}
        className="w-full rounded bg-[var(--ss-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        Back up now
      </button>

      {backups.length === 0 ? (
        <p className="text-sm text-[var(--ss-text-faint)]">No backups yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {backups.map((b) => (
            <li
              key={b.path}
              className="flex items-center justify-between gap-2 rounded border border-white/5 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-[var(--ss-text)]">{b.name}</p>
                <p className="truncate text-xs text-[var(--ss-text-faint)]">
                  {formatSize(b.size)} · {b.created_at}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRestore(b.path)}
                className="shrink-0 rounded border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-[var(--ss-text)] hover:bg-white/10"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
