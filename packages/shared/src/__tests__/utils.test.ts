import { describe, it, expect } from "vitest";
import { cn, formatTime, truncate } from "../utils";

describe("cn", () => {
  it("merges simple class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("filters falsy values", () => {
    const hidden: string | false = false;
    expect(cn("a", hidden && "hidden", "b")).toBe("a b");
  });

  it("handles conditional objects", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long text with ellipsis", () => {
    expect(truncate("hello world this is long", 8)).toBe("hello wo…");
  });
});

describe("formatTime", () => {
  it("returns HH:MM for today", () => {
    const today = new Date();
    const result = formatTime(today);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns '昨天' for yesterday", () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(formatTime(yesterday)).toBe("昨天");
  });
});
