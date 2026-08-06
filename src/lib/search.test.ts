import { describe, expect, it } from "vitest";
import { SnippetIndex } from "./search";
import type { Snippet } from "./types";

let nextId = 0;

function makeSnippet(
  overrides: Partial<Snippet> & { title: string }
): Snippet {
  return {
    id: `snip-${++nextId}`,
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

describe("SnippetIndex", () => {
  describe("spec example rankings", () => {
    const index = new SnippetIndex([
      makeSnippet({ title: "LinkedIn", tags: ["networking"], category: "Links" }),
      makeSnippet({ title: "GitHub", tags: ["code"], category: "Links" }),
      makeSnippet({ title: "Email", tags: ["work"], category: "Emails" }),
      makeSnippet({ title: "Resume Link", tags: ["job"], category: "Links" }),
      makeSnippet({ title: "Project Notes", category: "Personal" }),
      makeSnippet({ title: "Todo List", category: "Personal" }),
      makeSnippet({ title: "Meeting Agenda", category: "Work" }),
      makeSnippet({ title: "Welcome Message", category: "Emails" }),
    ]);

    it('ranks "li" -> LinkedIn first', () => {
      const hits = index.search("li");
      expect(hits[0].snippet.title).toBe("LinkedIn");
    });

    it('ranks "git" -> GitHub first', () => {
      const hits = index.search("git");
      expect(hits[0].snippet.title).toBe("GitHub");
    });

    it('ranks "mail" -> Email first', () => {
      const hits = index.search("mail");
      expect(hits[0].snippet.title).toBe("Email");
    });

    it('ranks "res" -> Resume Link first', () => {
      const hits = index.search("res");
      expect(hits[0].snippet.title).toBe("Resume Link");
    });
  });

  it("gives a favorite lower-ranked title a boost over a non-favorite", () => {
    const index = new SnippetIndex([
      makeSnippet({ title: "Apple", favorite: false }),
      makeSnippet({ title: "Snap", favorite: true }),
    ]);
    const hits = index.search("ap");
    expect(hits[0].snippet.title).toBe("Snap");
  });

  it("prefers a more recently used snippet over an older one", () => {
    const now = Date.now();
    const index = new SnippetIndex([
      makeSnippet({
        title: "Zebra",
        last_used: new Date(now - 200 * 86_400_000).toISOString(),
      }),
      makeSnippet({
        title: "Zephyr",
        last_used: new Date(now - 2 * 86_400_000).toISOString(),
      }),
    ]);
    const hits = index.search("ze");
    expect(hits[0].snippet.title).toBe("Zephyr");
  });

  describe("browse mode (empty / whitespace query)", () => {
    it("sorts favorites first, then last_used descending with nulls last", () => {
      const now = Date.now();
      const used3d = makeSnippet({
        title: "Used3d",
        favorite: true,
        last_used: new Date(now - 3 * 86_400_000).toISOString(),
      });
      const neverUsed = makeSnippet({ title: "NeverUsed", favorite: true });
      const used1d = makeSnippet({
        title: "Used1d",
        favorite: false,
        last_used: new Date(now - 86_400_000).toISOString(),
      });
      const index = new SnippetIndex([used1d, neverUsed, used3d]);

      expect(index.search("").map((h) => h.snippet.title)).toEqual([
        "Used3d",
        "NeverUsed",
        "Used1d",
      ]);
      expect(index.search("   ").map((h) => h.snippet.title)).toEqual([
        "Used3d",
        "NeverUsed",
        "Used1d",
      ]);
    });

    it("applies the limit in browse mode", () => {
      const index = new SnippetIndex(
        Array.from({ length: 10 }, (_, i) =>
          makeSnippet({ title: `Item ${i}` })
        )
      );
      expect(index.search("", 3)).toHaveLength(3);
    });
  });

  describe("tie-breaking", () => {
    it("ties break by title ascending when last_used is equal", () => {
      const index = new SnippetIndex([
        makeSnippet({ title: "Ca", category: "zzz", tags: [] }),
        makeSnippet({ title: "Ba", category: "zzz", tags: [] }),
      ]);
      const hits = index.search("a");
      expect(hits.map((h) => h.snippet.title)).toEqual(["Ba", "Ca"]);
    });

    it("prefers the more recently used snippet when relevance is otherwise equal", () => {
      const now = Date.now();
      const index = new SnippetIndex([
        makeSnippet({
          title: "Email",
          last_used: new Date(now - 30 * 86_400_000).toISOString(),
        }),
        makeSnippet({
          title: "Email",
          last_used: new Date(now - 86_400_000).toISOString(),
        }),
      ]);
      const hits = index.search("mail");
      expect(hits.length).toBe(2);
      expect(hits[0].snippet.last_used).toBe(
        new Date(now - 86_400_000).toISOString()
      );
    });
  });

  it("returns search hits with a numeric score", () => {
    const index = new SnippetIndex([
      makeSnippet({ title: "LinkedIn" }),
      makeSnippet({ title: "GitHub" }),
    ]);
    const hits = index.search("git");
    expect(hits[0]).toMatchObject({ snippet: { title: "GitHub" } });
    expect(typeof hits[0].score).toBe("number");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("matches by tag content", () => {
    const index = new SnippetIndex([
      makeSnippet({ title: "Dashboard", tags: ["reporting"] }),
      makeSnippet({ title: "Cheat Sheet", tags: [] }),
    ]);
    const hits = index.search("report");
    expect(hits.map((h) => h.snippet.title)).toEqual(["Dashboard"]);
  });

  it("applies the default limit of 20 and respects a custom limit", () => {
    const index = new SnippetIndex(
      Array.from({ length: 30 }, (_, i) =>
        makeSnippet({ title: `Item ${i}` })
      )
    );
    expect(index.search("item")).toHaveLength(20);
    expect(index.search("item", 5)).toHaveLength(5);
  });

  it("returns the full snippet list via the all getter", () => {
    const snippets = [
      makeSnippet({ title: "One" }),
      makeSnippet({ title: "Two" }),
    ];
    const index = new SnippetIndex(snippets);
    expect(index.all).toHaveLength(2);
    expect(index.all).toEqual(snippets);
  });

  it("returns no hits for an empty index or a non-matching query", () => {
    const empty = new SnippetIndex([]);
    expect(empty.search("anything")).toEqual([]);

    const index = new SnippetIndex([makeSnippet({ title: "LinkedIn" })]);
    expect(index.search("xyzzy")).toEqual([]);
  });

  it("truncates the content contribution to bound memory", () => {
    const snippet = makeSnippet({
      title: "Long Doc",
      content:
        "needle-at-start" + "x".repeat(600) + " needle-at-end",
    });
    const index = new SnippetIndex([snippet]);
    expect(index.search("needle-at-start")).toHaveLength(1);
    expect(index.search("needle-at-end")).toHaveLength(0);
  });

  it("perf sanity: builds an index over 10,000 snippets and searches quickly", () => {
    const words = [
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
      "golf",
      "hotel",
      "india",
      "juliet",
    ];
    const now = Date.now();
    const snippets: Snippet[] = [];
    for (let i = 0; i < 10_000; i++) {
      snippets.push(
        makeSnippet({
          title: `${words[i % 10]} ${words[(i * 7) % 10]} note ${i}`,
          category: words[(i * 3) % 10],
          tags: [words[(i * 5) % 10]],
          content: "lorem ipsum dolor sit amet " + "x".repeat(120),
          usage_count: i % 20,
          last_used:
            i % 3 === 0
              ? null
              : new Date(now - (i % 100) * 86_400_000).toISOString(),
        })
      );
    }

    const buildStart = performance.now();
    const index = new SnippetIndex(snippets);
    const buildMs = performance.now() - buildStart;

    const searchStart = performance.now();
    const hits = index.search("bravo hotel");
    const searchMs = performance.now() - searchStart;

    expect(hits.length).toBeGreaterThan(0);
    expect(searchMs).toBeLessThan(500);
    expect(buildMs).toBeLessThan(500);
  });
});
