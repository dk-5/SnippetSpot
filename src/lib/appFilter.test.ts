import { describe, expect, it } from "vitest";
import type { AppItem } from "./types";
import { appFileStem, filterApps } from "./appFilter";

function makeApp(name: string, path: string): AppItem {
  return { name, path };
}

describe("filterApps", () => {
  const apps: AppItem[] = [
    makeApp(
      "Visual Studio Code",
      "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
    ),
    makeApp(
      "Notepad++",
      "C:\\Program Files\\Notepad++\\notepad++.exe"
    ),
    makeApp("Calculator", "C:\\Windows\\System32\\calc.exe"),
    makeApp(
      "GitHub Desktop",
      "C:\\Users\\me\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe"
    ),
  ];

  it("returns no results for an empty or whitespace query", () => {
    expect(filterApps(apps, "")).toEqual([]);
    expect(filterApps(apps, "   ")).toEqual([]);
  });

  it("matches on the app name case-insensitively", () => {
    const hits = filterApps(apps, "CODE");
    expect(hits.map((a) => a.name)).toEqual(["Visual Studio Code"]);
  });

  it("matches on the executable file stem case-insensitively", () => {
    expect(filterApps(apps, "Notepad").map((a) => a.name)).toEqual([
      "Notepad++",
    ]);
    expect(filterApps(apps, "CALC").map((a) => a.name)).toEqual([
      "Calculator",
    ]);
  });

  it("matches via the file stem even when the name differs from the exe", () => {
    const hits = filterApps(
      [makeApp("Code Editor", "C:\\Program Files\\Code.exe")],
      "code"
    );
    expect(hits).toHaveLength(1);
  });

  it("limits results to 8 by default", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeApp(`App ${i}`, `C:\\Apps\\app${i}.exe`)
    );
    expect(filterApps(many, "app")).toHaveLength(8);
  });

  it("matches unix-style paths", () => {
    const hits = filterApps(
      [makeApp("Terminal", "/usr/bin/terminal-app")],
      "terminal"
    );
    expect(hits).toHaveLength(1);
  });

  it("returns no matches when nothing matches", () => {
    expect(filterApps(apps, "zzzz")).toEqual([]);
  });

  it("prioritizes name matches over path-stem matches", () => {
    const hits = filterApps(
      [
        makeApp("Editor Pro", "C:\\Apps\\editor.exe"),
        makeApp("Notes", "C:\\Program Files\\EditorX\\editorx.exe"),
        makeApp("XAML Studio", "C:\\Apps\\xaml.exe"),
      ],
      "editor"
    );
    expect(hits.map((a) => a.name)).toEqual(["Editor Pro", "Notes"]);
  });

  it("does not let stem matches crowd out name matches", () => {
    const hits = filterApps(
      [
        makeApp("Codex", "C:\\Apps\\codex.exe"),
        makeApp("X-Terminal", "C:\\Apps\\xt.exe"),
        makeApp("Fax Client", "C:\\Apps\\faxclient.exe"),
        makeApp("Notepad", "C:\\Windows\\system32\\notepad.exe"),
      ],
      "x"
    );
    expect(hits.map((a) => a.name)).toEqual([
      "Codex",
      "X-Terminal",
      "Fax Client",
    ]);
  });
});

describe("appFileStem", () => {
  it("strips the extension from windows paths", () => {
    expect(appFileStem("C:\\Program Files\\Foo\\bar.exe")).toBe("bar");
  });

  it("strips the extension from unix paths", () => {
    expect(appFileStem("/usr/bin/baz")).toBe("baz");
  });

  it("returns the file name when there is no extension", () => {
    expect(appFileStem("/usr/bin/baz")).toBe("baz");
    expect(appFileStem("C:\\Users\\me\\Apps\\Foo")).toBe("Foo");
  });
});
