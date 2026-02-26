import { describe, expect, it } from "vitest";
import { colorizeByScore } from "../src/utils/colorize-by-score.js";

describe("colorizeByScore", () => {
  it("returns a string for high scores", () => {
    const result = colorizeByScore("Great", 90);
    expect(typeof result).toBe("string");
    expect(result).toContain("Great");
  });

  it("returns a string for medium scores", () => {
    const result = colorizeByScore("OK", 60);
    expect(typeof result).toBe("string");
    expect(result).toContain("OK");
  });

  it("returns a string for low scores", () => {
    const result = colorizeByScore("Critical", 30);
    expect(typeof result).toBe("string");
    expect(result).toContain("Critical");
  });

  it("does not throw at good threshold boundary (75)", () => {
    expect(() => colorizeByScore("text", 75)).not.toThrow();
    expect(() => colorizeByScore("text", 74)).not.toThrow();
    expect(colorizeByScore("text", 75)).toContain("text");
    expect(colorizeByScore("text", 74)).toContain("text");
  });

  it("does not throw at ok threshold boundary (50)", () => {
    expect(() => colorizeByScore("text", 50)).not.toThrow();
    expect(() => colorizeByScore("text", 49)).not.toThrow();
    expect(colorizeByScore("text", 50)).toContain("text");
    expect(colorizeByScore("text", 49)).toContain("text");
  });

  it("handles score of zero", () => {
    const result = colorizeByScore("zero", 0);
    expect(result).toContain("zero");
  });

  it("handles perfect score", () => {
    const result = colorizeByScore("perfect", 100);
    expect(result).toContain("perfect");
  });
});
