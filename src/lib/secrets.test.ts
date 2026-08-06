import { describe, expect, it } from "vitest";
import { maskSecret } from "./secrets";

describe("maskSecret", () => {
  it("returns an empty string for empty input", () => {
    expect(maskSecret("")).toBe("");
  });

  it("masks input of length 4 with four bullets", () => {
    expect(maskSecret("abcd")).toBe("••••");
  });

  it("masks shorter input with the same count of bullets", () => {
    expect(maskSecret("ab")).toBe("••");
    expect(maskSecret("a")).toBe("•");
  });

  it("keeps the last four characters visible for a normal secret", () => {
    expect(maskSecret("sk-abcdef123456")).toBe("•••••••••••3456");
    expect(maskSecret("secret")).toBe("••cret");
  });

  it("preserves length for long secrets", () => {
    const input = "x".repeat(64) + "1234";
    const out = maskSecret(input);
    expect(out).toHaveLength(input.length);
    expect(out.endsWith("1234")).toBe(true);
    expect(out.startsWith("•".repeat(64))).toBe(true);
  });
});
