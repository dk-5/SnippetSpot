import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { vaultCreate, vaultDelete, vaultList, vaultUpdate } from "../lib/api";
import type { VaultItem, VaultKind } from "../lib/types";
import { VAULT_KINDS } from "../lib/types";
import { maskSecret } from "../lib/secrets";
import { SecretField } from "./SecretField";

const inputCls =
  "w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";
const selectCls =
  "rounded border border-white/10 bg-[#1a1a22] px-2.5 py-1.5 text-sm text-[var(--ss-text)] outline-none focus:border-[var(--ss-accent)]";

const MASK_MOCK = "••••••••••••";

interface VaultPanelProps {
  onError: (msg: string) => void;
}

interface VaultForm {
  title: string;
  kind: VaultKind;
  username: string;
  secret: string;
}

function emptyVaultForm(): VaultForm {
  return { title: "", kind: "credential", username: "", secret: "" };
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

export function VaultPanel({ onError }: VaultPanelProps) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<VaultForm>(emptyVaultForm);

  const reload = useCallback(async () => {
    try {
      setItems(await vaultList());
    } catch (err) {
      onError(String(err));
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startCreate = () => {
    setCreating(true);
    setSelected(null);
    setForm(emptyVaultForm());
  };

  const selectItem = (item: VaultItem) => {
    setCreating(false);
    setSelected(item);
    setForm({
      title: item.title,
      kind: item.kind,
      username: item.username ?? "",
      secret: "",
    });
  };

  const cancel = () => {
    setCreating(false);
    setSelected(null);
    setForm(emptyVaultForm());
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) {
      onError("Title is required");
      return;
    }
    const input = {
      title,
      kind: form.kind,
      username: form.username.trim() === "" ? null : form.username.trim(),
      secret: form.secret,
    };
    try {
      if (creating) {
        await vaultCreate(input);
      } else if (selected) {
        await vaultUpdate(selected.id, input);
      }
      await reload();
      cancel();
    } catch (err) {
      onError(String(err));
    }
  };

  const handleDelete = async (item: VaultItem) => {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await vaultDelete(item.id);
      if (selected?.id === item.id) cancel();
      await reload();
    } catch (err) {
      onError(String(err));
    }
  };

  const editing = creating || selected !== null;
  const selectedId = selected?.id ?? null;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Vault</h2>
        <button
          type="button"
          onClick={startCreate}
          className="rounded bg-[var(--ss-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          New
        </button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={inputCls}
              placeholder="Vault item title"
            />
          </Field>

          <Field label="Kind">
            <select
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({ ...f, kind: e.target.value as VaultKind }))
              }
              className={"w-full " + selectCls}
            >
              {VAULT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Username">
            <input
              value={form.username}
              onChange={(e) =>
                setForm((f) => ({ ...f, username: e.target.value }))
              }
              className={inputCls}
              placeholder="Optional username"
            />
          </Field>

          <SecretField
            value={form.secret}
            onChange={(v) => setForm((f) => ({ ...f, secret: v }))}
            label="Secret"
            placeholder={creating ? "Secret" : "New secret"}
          />

          {!creating && selected && (
            <p className="text-xs text-[var(--ss-text-faint)]">
              {selected.has_secret
                ? `Current secret: ${maskSecret(MASK_MOCK)}`
                : "No secret"}
            </p>
          )}

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
              onClick={cancel}
              className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[var(--ss-text-dim)] hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--ss-text-faint)]">
          No vault items yet. Click “New” to create one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className={
                selectedId === item.id
                  ? "cursor-pointer rounded border border-white/5 bg-[var(--ss-accent-soft)] px-3 py-2"
                  : "cursor-pointer rounded border border-white/5 px-3 py-2 hover:bg-white/5"
              }
            >
              <div
                onClick={() => selectItem(item)}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--ss-text)]">
                  {item.title}
                </span>
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--ss-text-dim)]">
                  {VAULT_KINDS.find((k) => k.value === item.kind)?.label ??
                    item.kind}
                </span>
              </div>
              <div
                onClick={() => selectItem(item)}
                className="mt-0.5 flex items-center justify-between gap-2"
              >
                <span className="truncate text-xs text-[var(--ss-text-faint)]">
                  {item.username ?? ""}
                </span>
                <span className="shrink-0 text-xs text-[var(--ss-text-faint)]">
                  {item.has_secret ? "••••" : ""}
                </span>
              </div>
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(item);
                  }}
                  className="rounded border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/25"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
