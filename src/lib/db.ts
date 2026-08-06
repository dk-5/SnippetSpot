import Database from "@tauri-apps/plugin-sql";
import type { Snippet, SnippetInput } from "./types";

type Row = Record<string, unknown>;

const DB_PATH = "sqlite:snippetspot.db";

let db: Database | null = null;

export async function initDb(): Promise<void> {
  if (db) return;
  const conn = await Database.load(DB_PATH);
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      tags TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  db = conn;
}

async function getDb(): Promise<Database> {
  if (!db) {
    await initDb();
  }
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

function parseTags(value: unknown): string[] {
  if (value == null) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function rowToSnippet(row: Row): Snippet {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    description: row.description == null ? null : String(row.description),
    category: String(row.category),
    tags: parseTags(row.tags),
    favorite: Number(row.favorite) === 1,
    usage_count: Number(row.usage_count),
    last_used: row.last_used == null ? null : String(row.last_used),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function selectById(id: string): Promise<Snippet> {
  const rows = await (await getDb()).select<Row[]>(
    "SELECT * FROM snippets WHERE id = $1",
    [id]
  );
  if (rows.length === 0) {
    throw new Error(`Snippet not found: ${id}`);
  }
  return rowToSnippet(rows[0]);
}

export async function listSnippets(): Promise<Snippet[]> {
  const rows = await (await getDb()).select<Row[]>(
    "SELECT * FROM snippets ORDER BY created_at ASC"
  );
  return rows.map(rowToSnippet);
}

export async function createSnippet(input: SnippetInput): Promise<Snippet> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await (
    await getDb()
  ).execute(
    "INSERT INTO snippets (id, title, content, description, category, tags, favorite, usage_count, last_used, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL, $8, $9)",
    [
      id,
      input.title,
      input.content,
      input.description,
      input.category,
      JSON.stringify(input.tags),
      input.favorite ? 1 : 0,
      now,
      now,
    ]
  );
  return {
    id,
    title: input.title,
    content: input.content,
    description: input.description,
    category: input.category,
    tags: input.tags,
    favorite: input.favorite,
    usage_count: 0,
    last_used: null,
    created_at: now,
    updated_at: now,
  };
}

export async function updateSnippet(
  id: string,
  input: SnippetInput
): Promise<Snippet> {
  const now = new Date().toISOString();
  await (
    await getDb()
  ).execute(
    "UPDATE snippets SET title = $2, content = $3, description = $4, category = $5, tags = $6, favorite = $7, updated_at = $8 WHERE id = $1",
    [
      id,
      input.title,
      input.content,
      input.description,
      input.category,
      JSON.stringify(input.tags),
      input.favorite ? 1 : 0,
      now,
    ]
  );
  return selectById(id);
}

export async function deleteSnippet(id: string): Promise<void> {
  await (await getDb()).execute("DELETE FROM snippets WHERE id = $1", [id]);
}

export async function duplicateSnippet(id: string): Promise<Snippet> {
  const original = await selectById(id);
  const now = new Date().toISOString();
  const newId = crypto.randomUUID();
  await (
    await getDb()
  ).execute(
    "INSERT INTO snippets (id, title, content, description, category, tags, favorite, usage_count, last_used, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [
      newId,
      `${original.title} (copy)`,
      original.content,
      original.description,
      original.category,
      JSON.stringify(original.tags),
      original.favorite ? 1 : 0,
      original.usage_count,
      original.last_used,
      now,
      now,
    ]
  );
  return selectById(newId);
}

export async function recordUsage(id: string): Promise<void> {
  await (
    await getDb()
  ).execute(
    "UPDATE snippets SET usage_count = usage_count + 1, last_used = $2 WHERE id = $1",
    [id, new Date().toISOString()]
  );
}

export async function importSnippets(inputs: SnippetInput[]): Promise<number> {
  const conn = await getDb();
  const now = new Date().toISOString();
  for (const input of inputs) {
    const id = crypto.randomUUID();
    await conn.execute(
      "INSERT INTO snippets (id, title, content, description, category, tags, favorite, usage_count, last_used, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL, $8, $9)",
      [
        id,
        input.title,
        input.content,
        input.description,
        input.category,
        JSON.stringify(input.tags),
        input.favorite ? 1 : 0,
        now,
        now,
      ]
    );
  }
  return inputs.length;
}
