import uFuzzy from "@leeoniya/ufuzzy";
import type { SearchHit, Snippet } from "./types";

const CONTENT_CONTRIBUTION = 400;

const uf = new uFuzzy({ intraIns: 1 });

function buildHaystack(s: Snippet): string {
  const content =
    s.content.length > CONTENT_CONTRIBUTION
      ? s.content.slice(0, CONTENT_CONTRIBUTION)
      : s.content;
  return (
    s.title +
    " " +
    s.tags.join(" ") +
    " " +
    s.category +
    " " +
    (s.description ?? "") +
    " " +
    content
  ).toLowerCase();
}

function daysSinceLastUsed(lastUsed: string | null): number {
  if (!lastUsed) return 0;
  const ms = Date.now() - Date.parse(lastUsed);
  return Math.max(0, ms) / 86_400_000;
}

function recencyBoost(lastUsed: string | null): number {
  return 20 / (1 + Math.log(1 + daysSinceLastUsed(lastUsed)));
}

function usageBoost(usageCount: number): number {
  return Math.min(10, 3 * Math.log(1 + usageCount));
}

function fuzzyQuality(matchedChars: number, queryLen: number): number {
  if (queryLen <= 0) return 0;
  return 8 * Math.min(1, matchedChars / queryLen);
}

function compareSnippetsDesc(a: Snippet, b: Snippet): number {
  if (a.last_used === b.last_used) return 0;
  if (a.last_used === null) return 1;
  if (b.last_used === null) return -1;
  if (a.last_used > b.last_used) return -1;
  if (a.last_used < b.last_used) return 1;
  return 0;
}

function compareTitleAsc(a: Snippet, b: Snippet): number {
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  return 0;
}

export class SnippetIndex {
  private snippets: Snippet[];
  private haystacks: string[];
  private titles: string[];
  private tags: string[][];
  private categories: string[];

  constructor(snippets: Snippet[]) {
    this.snippets = snippets;
    this.haystacks = snippets.map(buildHaystack);
    this.titles = snippets.map((s) => s.title.toLowerCase());
    this.tags = snippets.map((s) => s.tags.map((t) => t.toLowerCase()));
    this.categories = snippets.map((s) => s.category.toLowerCase());
  }

  get all(): Snippet[] {
    return this.snippets;
  }

  search(query: string, limit = 20): SearchHit[] {
    const q = query.trim().toLowerCase();

    if (!q) {
      return this.browse(limit);
    }

    const [idxs, info] = uf.search(this.haystacks, q, 0, 1e6);
    if (!idxs || idxs.length === 0) {
      return [];
    }

    const matchedChars = new Map<number, number>();
    if (info) {
      for (let i = 0; i < info.idx.length; i++) {
        matchedChars.set(info.idx[i], info.chars[i]);
      }
    }

    const hits: SearchHit[] = new Array(idxs.length);
    for (let i = 0; i < idxs.length; i++) {
      const idx = idxs[i];
      hits[i] = {
        snippet: this.snippets[idx],
        score: this.score(idx, q, matchedChars.get(idx) ?? 0),
      };
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const recency = compareSnippetsDesc(a.snippet, b.snippet);
      if (recency !== 0) return recency;
      return compareTitleAsc(a.snippet, b.snippet);
    });

    return hits.slice(0, limit);
  }

  private browse(limit: number): SearchHit[] {
    const sorted = [...this.snippets].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const recency = compareSnippetsDesc(a, b);
      if (recency !== 0) return recency;
      return compareTitleAsc(a, b);
    });
    return sorted.slice(0, limit).map((snippet) => ({ snippet, score: 0 }));
  }

  private score(idx: number, q: string, matchedChars: number): number {
    let score = 0;

    const title = this.titles[idx];
    if (title === q) {
      score += 100;
    } else if (title.startsWith(q)) {
      score += 40;
    }

    if (this.snippets[idx].favorite) {
      score += 50;
    }

    for (const tag of this.tags[idx]) {
      if (tag.includes(q)) {
        score += 30;
        break;
      }
    }

    if (this.categories[idx].includes(q)) {
      score += 20;
    }

    score += recencyBoost(this.snippets[idx].last_used);
    score += usageBoost(this.snippets[idx].usage_count);
    score += fuzzyQuality(matchedChars, q.length);

    return score;
  }
}
