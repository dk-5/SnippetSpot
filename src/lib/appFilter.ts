import type { AppItem } from "./types";

export function appFileStem(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? "";
  return fileName.replace(/\.[^.]*$/, "");
}

export function filterApps(
  apps: AppItem[],
  query: string,
  limit = 8
): AppItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const nameMatches: AppItem[] = [];
  const stemMatches: AppItem[] = [];
  for (const app of apps) {
    if (app.name.toLowerCase().includes(q)) {
      nameMatches.push(app);
    } else if (appFileStem(app.path).toLowerCase().includes(q)) {
      stemMatches.push(app);
    }
  }
  return nameMatches.concat(stemMatches).slice(0, limit);
}
