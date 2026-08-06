import { describe, expect, it } from "vitest";
import { expandVariables } from "./variables";

describe("expandVariables", () => {
  describe("date / time / datetime", () => {
    it("expands {{date}} to YYYY-MM-DD in local time", () => {
      expect(expandVariables("{{date}}", { date: new Date(2024, 0, 5) })).toBe(
        "2024-01-05"
      );
    });

    it("expands {{time}} to HH:mm in local time", () => {
      expect(expandVariables("{{time}}", { date: new Date(2024, 0, 5, 9, 7) })).toBe(
        "09:07"
      );
    });

    it("expands {{datetime}} to YYYY-MM-DD HH:mm", () => {
      expect(
        expandVariables("{{datetime}}", { date: new Date(2024, 0, 5, 9, 7) })
      ).toBe("2024-01-05 09:07");
    });

    it("zero-pads months, days, hours and minutes", () => {
      expect(
        expandVariables("{{date}}", { date: new Date(2024, 11, 31) })
      ).toBe("2024-12-31");
      expect(
        expandVariables("{{time}}", { date: new Date(2024, 0, 1, 23, 59) })
      ).toBe("23:59");
      expect(
        expandVariables("{{datetime}}", { date: new Date(2024, 5, 3, 4, 5) })
      ).toBe("2024-06-03 04:05");
    });

    it("uses the current time when no date is provided", () => {
      const before = new Date();
      const out = expandVariables("{{date}}");
      const after = new Date();
      const got = new Date(out + "T00:00:00");
      expect(got.getTime()).toBeGreaterThanOrEqual(
        new Date(before.getFullYear(), before.getMonth(), before.getDate()).getTime()
      );
      expect(got.getTime()).toBeLessThanOrEqual(
        new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1).getTime()
      );
    });
  });

  describe("clipboard", () => {
    it("replaces {{clipboard}} when clipboard is provided", () => {
      expect(
        expandVariables("Paste: {{clipboard}}", { clipboard: "hello" })
      ).toBe("Paste: hello");
    });

    it("replaces {{clipboard}} with an empty string when clipboard is empty", () => {
      expect(expandVariables("[{{clipboard}}]", { clipboard: "" })).toBe("[]");
    });

    it("leaves {{clipboard}} unchanged when clipboard is missing", () => {
      expect(expandVariables("Paste: {{clipboard}}")).toBe("Paste: {{clipboard}}");
      expect(
        expandVariables("Paste: {{clipboard}}", { date: new Date() })
      ).toBe("Paste: {{clipboard}}");
    });
  });

  describe("env", () => {
    it("expands {{env:NAME}} from the env map", () => {
      expect(
        expandVariables("{{env:USER}}", { env: { USER: "dhruv" } })
      ).toBe("dhruv");
    });

    it("expands to empty string when the map exists but the var is unset", () => {
      expect(expandVariables("[{{env:USER}}]", { env: {} })).toBe("[]");
      expect(
        expandVariables("[{{env:USER}}]", { env: { HOME: "/x" } })
      ).toBe("[]");
    });

    it("expands to empty string when the var is set to an empty string", () => {
      expect(
        expandVariables("[{{env:USER}}]", { env: { USER: "" } })
      ).toBe("[]");
    });

    it("leaves {{env:NAME}} unchanged when no env map is provided", () => {
      expect(expandVariables("{{env:USER}}")).toBe("{{env:USER}}");
      expect(expandVariables("{{env:USER}}", { clipboard: "x" })).toBe(
        "{{env:USER}}"
      );
    });

    it("uses the default when the var is unset", () => {
      expect(
        expandVariables("{{env:USER:default-user}}", { env: {} })
      ).toBe("default-user");
      expect(
        expandVariables("{{env:USER:default-user}}", {
          env: { HOME: "/x" },
        })
      ).toBe("default-user");
    });

    it("uses the default when no env map is provided", () => {
      expect(expandVariables("{{env:USER:default-user}}")).toBe("default-user");
    });

    it("prefers the real value over the default", () => {
      expect(
        expandVariables("{{env:USER:fallback}}", { env: { USER: "dhruv" } })
      ).toBe("dhruv");
    });

    it("supports defaults containing spaces", () => {
      expect(
        expandVariables("{{env:USER:default user}}", { env: {} })
      ).toBe("default user");
    });

    it("trims whitespace inside the placeholder", () => {
      expect(expandVariables("{{ env:USER }}", { env: { USER: "dhruv" } })).toBe(
        "dhruv"
      );
      expect(
        expandVariables("{{ env:USER:fallback }}", { env: {} })
      ).toBe("fallback");
    });
  });

  describe("unknown and edge cases", () => {
    it("leaves unknown placeholders unchanged", () => {
      expect(expandVariables("{{foo}}")).toBe("{{foo}}");
      expect(expandVariables("{{Env:USER}}")).toBe("{{Env:USER}}");
      expect(expandVariables("{{date_thing}}")).toBe("{{date_thing}}");
    });

    it("leaves the bare {{env}} placeholder unchanged", () => {
      expect(expandVariables("{{env}}")).toBe("{{env}}");
      expect(expandVariables("{{env}}", { env: { USER: "dhruv" } })).toBe(
        "{{env}}"
      );
    });

    it("replaces multiple placeholders in one string", () => {
      const ctx = {
        date: new Date(2024, 0, 5, 9, 7),
        clipboard: "clip",
        env: { USER: "dhruv", MISSING: undefined as unknown as string },
      };
      const out = expandVariables(
        "{{date}} | {{time}} | {{datetime}} | {{clipboard}} | {{env:USER}} | {{env:MISSING:x}}",
        ctx
      );
      expect(out).toBe(
        "2024-01-05 | 09:07 | 2024-01-05 09:07 | clip | dhruv | x"
      );
    });

    it("handles placeholders embedded in text", () => {
      expect(
        expandVariables("Created on {{date}} at {{time}}.", {
          date: new Date(2024, 6, 14, 8, 30),
        })
      ).toBe("Created on 2024-07-14 at 08:30.");
    });

    it("leaves text without placeholders untouched", () => {
      expect(expandVariables("plain text")).toBe("plain text");
      expect(expandVariables("")).toBe("");
    });
  });
});
