import { describe, expect, it } from "vite-plus/test";
import { splitCssTopLevel } from "./split-css-top-level.js";

describe("splitCssTopLevel", () => {
  it("ignores separators inside nested functions", () => {
    expect(splitCssTopLevel("to right, rgb(1, 2, 3), #fff", ",")).toEqual([
      "to right",
      "rgb(1, 2, 3)",
      "#fff",
    ]);
  });

  it("rejects unbalanced parentheses", () => {
    expect(splitCssTopLevel("rgb(1, 2, 3), #fff)", ",")).toBeNull();
    expect(splitCssTopLevel("rgb(1, 2, 3, #fff", ",")).toBeNull();
  });
});
