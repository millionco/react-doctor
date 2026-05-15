import { describe, expect, it } from "vite-plus/test";
import { wrapIndentedText } from "../src/cli/utils/wrap-indented-text.js";

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
});
