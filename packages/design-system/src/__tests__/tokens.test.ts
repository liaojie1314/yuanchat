import { describe, it, expect } from "vitest";
import { lightScheme, darkScheme, fontScale, shapes } from "../tokens";

describe("M3 Color Tokens", () => {
  it("light scheme has required colors", () => {
    expect(lightScheme.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(lightScheme.onPrimary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(lightScheme.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(lightScheme.surface).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(lightScheme.error).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(lightScheme.outline).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("dark scheme has required colors", () => {
    expect(darkScheme.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(darkScheme.onPrimary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(darkScheme.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(darkScheme.surface).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(darkScheme.error).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(darkScheme.outline).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("light and dark schemes have different backgrounds", () => {
    expect(lightScheme.background).not.toBe(darkScheme.background);
    expect(lightScheme.onBackground).not.toBe(darkScheme.onBackground);
  });
});

describe("Typography", () => {
  it("font scales are defined", () => {
    expect(fontScale.small).toBeGreaterThan(0);
    expect(fontScale.normal).toBe(1);
    expect(fontScale.large).toBeGreaterThan(1);
  });
});

describe("Shapes", () => {
  it("border radius tokens are defined", () => {
    expect(shapes.none).toBe("0px");
    expect(shapes.full).toBe("9999px");
  });
});
