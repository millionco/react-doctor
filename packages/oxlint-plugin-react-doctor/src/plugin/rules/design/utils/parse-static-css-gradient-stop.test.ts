import { describe, expect, it } from "vite-plus/test";
import { parseStaticCssGradientStop } from "./parse-static-css-gradient-stop.js";

describe("parseStaticCssGradientStop", () => {
  it("parses supported colors and optional stop positions", () => {
    expect(parseStaticCssGradientStop("rgb(37 99 235 / 80%) 0 24px")).toEqual({
      color: { alpha: 0.8, blue: 235, green: 99, red: 37 },
      positions: ["0", "24px"],
    });
    expect(parseStaticCssGradientStop("#2563ebcc 50%")?.positions).toEqual(["50%"]);
  });

  it("rejects unresolved colors and unsupported positions", () => {
    expect(parseStaticCssGradientStop("var(--halo) 50%")).toBeNull();
    expect(parseStaticCssGradientStop("#2563ebcc calc(50% - 1px)")).toBeNull();
  });
});
