import { describe, expect, it } from "vitest";
import { planImport, snippetsToCsv, snippetsToMarkdown } from "./importExport";
import type { Snippet, SnippetInput } from "./types";

function makeSnippet(overrides: Partial<Snippet> & { title: string }): Snippet {
  return {
    id: `snip-${overrides.title}`,
    content: `${overrides.title} content`,
    description: null,
    category: "Links",
    tags: [],
    favorite: false,
    usage_count: 0,
    last_used: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeInput(overrides: Partial<SnippetInput> & { title: string }): SnippetInput {
  return {
    content: `${overrides.title} content`,
    description: null,
    category: "Personal",
    tags: [],
    favorite: false,
    ...overrides,
  };
}

describe("snippetsToCsv", () => {
  it("writes a header row and one row per snippet", () => {
    const csv = snippetsToCsv([
      makeSnippet({ title: "GitHub", category: "Code", tags: ["git", "dev"] }),
      makeSnippet({ title: "Email", description: "A note" }),
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "title,description,category,tags,content,favorite,created_at,updated_at"
    );
    expect(lines[1]).toContain("GitHub");
    expect(lines[1]).toContain("Code");
    expect(lines[1]).toContain("git, dev");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = snippetsToCsv([
      makeSnippet({ title: 'He said "hi", ok', content: "line1\nline2" }),
    ]);
    expect(csv).toContain('"He said ""hi"", ok"');
    expect(csv).toContain('"line1\nline2"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    const csv = snippetsToCsv([
      makeSnippet({ title: 'quote " inside' }),
    ]);
    expect(csv).toContain('"quote "" inside"');
  });

  it("renders the full content field verbatim", () => {
    const csv = snippetsToCsv([
      makeSnippet({ title: "Multi", content: "a,b\nc\"d" }),
    ]);
    expect(csv).toContain('"a,b\nc""d"');
  });
});

describe("snippetsToMarkdown", () => {
  it("formats a snippet with header, category, tags, description and code block", () => {
    const md = snippetsToMarkdown([
      makeSnippet({
        title: "GitHub",
        category: "Code",
        tags: ["git"],
        description: "Clone command",
        content: "git clone https://github.com/x",
      }),
    ]);
    expect(md).toBe(
      "## GitHub\n" +
        "Category: Code | Tags: git\n" +
        "Clone command\n" +
        "\n" +
        "```\n" +
        "git clone https://github.com/x\n" +
        "```\n" +
        "\n" +
        "---"
    );
  });

  it("omits the description line when there is none", () => {
    const md = snippetsToMarkdown([
      makeSnippet({ title: "Plain", category: "Personal" }),
    ]);
    expect(md.startsWith("## Plain\nCategory: Personal | Tags: \n\n```")).toBe(true);
  });

  it("separates multiple snippets with a blank line", () => {
    const md = snippetsToMarkdown([
      makeSnippet({ title: "One" }),
      makeSnippet({ title: "Two" }),
    ]);
    const blocks = md.split("\n\n---\n\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("## One");
    expect(blocks[1]).toContain("## Two");
  });
});

describe("planImport", () => {
  const existing = [
    makeSnippet({ title: "GitHub", id: "existing-1" }),
    makeSnippet({ title: "Email", id: "existing-2" }),
  ];

  it("skip policy drops matches and counts them as skipped", () => {
    const plan = planImport(
      [
        makeInput({ title: "GitHub" }),
        makeInput({ title: "  email  " }),
        makeInput({ title: "New" }),
      ],
      existing,
      "skip"
    );
    expect(plan.create.map((c) => c.title)).toEqual(["New"]);
    expect(plan.update).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("skip policy also drops duplicates within the import batch", () => {
    const plan = planImport(
      [
        makeInput({ title: "New" }),
        makeInput({ title: "New" }),
      ],
      existing,
      "skip"
    );
    expect(plan.create).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });

  it("overwrite policy marks existing snippets for update", () => {
    const plan = planImport(
      [
        makeInput({ title: "GitHub", content: "updated content" }),
        makeInput({ title: "New" }),
      ],
      existing,
      "overwrite"
    );
    expect(plan.update).toEqual([
      { id: "existing-1", input: makeInput({ title: "GitHub", content: "updated content" }) },
    ]);
    expect(plan.create.map((c) => c.title)).toEqual(["New"]);
    expect(plan.skipped).toBe(0);
  });

  it("overwrite policy matches titles case- and whitespace-insensitively", () => {
    const plan = planImport([makeInput({ title: "  github " })], existing, "overwrite");
    expect(plan.update[0].id).toBe("existing-1");
  });

  it("rename policy rewrites colliding titles with a numeric suffix", () => {
    const plan = planImport(
      [
        makeInput({ title: "GitHub" }),
        makeInput({ title: "GitHub" }),
        makeInput({ title: "New" }),
      ],
      existing,
      "rename"
    );
    expect(plan.update).toEqual([]);
    expect(plan.skipped).toBe(0);
    expect(plan.create.map((c) => c.title)).toEqual([
      "GitHub (2)",
      "GitHub (3)",
      "New",
    ]);
  });

  it("rename policy keeps non-colliding titles unchanged", () => {
    const plan = planImport([makeInput({ title: "Fresh" })], existing, "rename");
    expect(plan.create.map((c) => c.title)).toEqual(["Fresh"]);
  });
});
