import type { ImportMergePolicy, Snippet, SnippetInput } from "./types";

function csvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function snippetsToCsv(snippets: Snippet[]): string {
  const header = [
    "title",
    "description",
    "category",
    "tags",
    "content",
    "favorite",
    "created_at",
    "updated_at",
  ];
  const rows = snippets.map((s) =>
    [
      s.title,
      s.description ?? "",
      s.category,
      s.tags.join(", "),
      s.content,
      s.favorite ? "true" : "false",
      s.created_at,
      s.updated_at,
    ]
      .map(csvField)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export function snippetsToMarkdown(snippets: Snippet[]): string {
  const blocks = snippets.map((s) => {
    const lines = [
      `## ${s.title}`,
      `Category: ${s.category} | Tags: ${s.tags.join(", ")}`,
    ];
    if (s.description && s.description.trim() !== "") {
      lines.push(s.description);
    }
    lines.push("", "```", s.content, "```", "", "---");
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

function normalizedTitle(title: string): string {
  return title.trim().toLowerCase();
}

function uniqueTitle(base: string, used: Set<string>): string {
  const trimmed = base.trim();
  let candidate = base;
  let n = 2;
  while (used.has(normalizedTitle(candidate))) {
    candidate = `${trimmed} (${n})`;
    n += 1;
  }
  return candidate;
}

export interface ImportPlan {
  create: SnippetInput[];
  update: { id: string; input: SnippetInput }[];
  skipped: number;
}

export function planImport(
  inputs: SnippetInput[],
  existing: Snippet[],
  policy: ImportMergePolicy
): ImportPlan {
  const byTitle = new Map<string, Snippet>();
  for (const s of existing) {
    const key = normalizedTitle(s.title);
    if (!byTitle.has(key)) byTitle.set(key, s);
  }
  const used = new Set(byTitle.keys());
  const create: SnippetInput[] = [];
  const update: { id: string; input: SnippetInput }[] = [];
  let skipped = 0;

  for (const input of inputs) {
    const key = normalizedTitle(input.title);
    const existingSnippet = byTitle.get(key);
    if (existingSnippet) {
      if (policy === "overwrite") {
        update.push({ id: existingSnippet.id, input });
      } else if (policy === "rename") {
        const title = uniqueTitle(input.title, used);
        used.add(normalizedTitle(title));
        create.push({ ...input, title });
      } else {
        skipped += 1;
      }
    } else if (used.has(key)) {
      if (policy === "rename") {
        const title = uniqueTitle(input.title, used);
        used.add(normalizedTitle(title));
        create.push({ ...input, title });
      } else {
        skipped += 1;
      }
    } else {
      used.add(key);
      create.push(input);
    }
  }

  return { create, update, skipped };
}
