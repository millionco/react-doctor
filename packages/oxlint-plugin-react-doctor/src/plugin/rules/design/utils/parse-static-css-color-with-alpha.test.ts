import { describe, expect, it } from "vite-plus/test";
import { parseStaticCssColorWithAlpha } from "./parse-static-css-color-with-alpha.js";

describe("parseStaticCssColorWithAlpha", () => {
  it("parses supported opaque and transparent colors", () => {
    expect(parseStaticCssColorWithAlpha("#336699")).toEqual({
      alpha: 1,
      blue: 153,
      green: 102,
      red: 51,
    });
    expect(parseStaticCssColorWithAlpha("transparent")?.alpha).toBe(0);
  });

  it("parses hexadecimal and functional alpha channels", () => {
    expect(parseStaticCssColorWithAlpha("#33669980")?.alpha).toBeCloseTo(128 / 255);
    expect(parseStaticCssColorWithAlpha("#3698")?.alpha).toBeCloseTo(8 / 15);
    expect(parseStaticCssColorWithAlpha("rgb(51 102 153 / 25%)")?.alpha).toBe(0.25);
    expect(parseStaticCssColorWithAlpha("hsla(210, 50%, 40%, 0.8)")?.alpha).toBe(0.8);
  });

  it("rejects unsupported or unresolved colors and alpha values", () => {
    expect(parseStaticCssColorWithAlpha("blue")).toBeNull();
    expect(parseStaticCssColorWithAlpha("var(--color)")).toBeNull();
    expect(parseStaticCssColorWithAlpha("rgb(51 102 153 / var(--alpha))")).toBeNull();
    expect(parseStaticCssColorWithAlpha("rgb(51 102 153 / 0.2junk)")).toBeNull();
    expect(parseStaticCssColorWithAlpha("rgba(51, 102, 153, 20%extra)")).toBeNull();
  });
});
