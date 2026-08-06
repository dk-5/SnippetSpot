export const SNIPPET_TYPES = [
  "Plain",
  "Link",
  "Email",
  "Markdown",
  "Code",
  "Template",
  "Prompt",
] as const;

export type SnippetType = (typeof SNIPPET_TYPES)[number];

export interface Snippet {
  id: string;
  title: string;
  content: string;
  description: string | null;
  category: string;
  tags: string[];
  favorite: boolean;
  usage_count: number;
  last_used: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields a user provides when creating or updating a snippet. */
export interface SnippetInput {
  title: string;
  content: string;
  description: string | null;
  category: string;
  tags: string[];
  favorite: boolean;
}

export type PasteMode = "paste" | "type";

export interface Settings {
  hotkey: string;
  paste_mode: PasteMode;
}

/** A single fuzzy search hit returned by the snippet index. */
export interface SearchHit {
  snippet: Snippet;
  score: number;
}

export const DEFAULT_CATEGORIES = [
  "Links",
  "Emails",
  "AI Prompts",
  "Code",
  "Templates",
  "Personal",
  "Work",
];

export const DEFAULT_HOTKEY = "Alt+Space";

export type VaultKind = "credential" | "api_key";

export interface VaultItem {
  id: string;
  title: string;
  kind: VaultKind;
  username: string | null;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppItem {
  name: string;
  path: string;
}

export interface ClipboardEntry {
  id: string;
  content: string;
  pinned: boolean;
  created_at: string;
}

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  created_at: string;
}

export type ImportMergePolicy = "skip" | "overwrite" | "rename";

export const VAULT_KINDS: { value: VaultKind; label: string }[] = [
  { value: "credential", label: "Credential" },
  { value: "api_key", label: "API key" },
];
