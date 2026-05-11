import { describe, expect, it } from "vite-plus/test";
import { wrapIndentedText } from "../src/utils/wrap-indented-text.js";

const TEST_WRAP_WIDTH_CHARS = 36;

describe("wrapIndentedText", () => {
  it("wraps continuation lines with the same prefix", () => {
    const output = wrapIndentedText(
      "Return a cleanup function that releases the subscription timer before the component unmounts",
      "      ",
      TEST_WRAP_WIDTH_CHARS,
    );

    expect(output).toBe(
      [
        "      Return a cleanup function",
        "      that releases the",
        "      subscription timer before the",
        "      component unmounts",
      ].join("\n"),
    );
  });

  it("splits long words and indents only when prefix consumes width", () => {
    expect(wrapIndentedText("supercalifragilistic", "  ", 10)).toBe(
      ["  supercal", "  ifragili", "  stic"].join("\n"),
    );

    expect(wrapIndentedText("alpha\nbeta", "      ", 4)).toBe("      alpha\n      beta");
  });
});
