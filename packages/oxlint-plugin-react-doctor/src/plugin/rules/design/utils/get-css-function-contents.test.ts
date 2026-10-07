import { describe, expect, it } from "vite-plus/test";
import { getCssFunctionContents } from "./get-css-function-contents.js";

describe("getCssFunctionContents", () => {
  it("returns nested function contents", () => {
    expect(getCssFunctionContents("linear-gradient(rgb(1 2 3), #fff)")).toBe("rgb(1 2 3), #fff");
  });

  it("rejects unbalanced functions and trailing layers", () => {
    expect(getCssFunctionContents("linear-gradient(#000, #fff")).toBeNull();
    expect(getCssFunctionContents("linear-gradient(#000, #fff), url(texture.png)")).toBeNull();
  });
});
