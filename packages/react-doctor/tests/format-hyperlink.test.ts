import { describe, expect, it } from "vite-plus/test";
import { formatHyperlink } from "../src/cli/utils/format-hyperlink.js";

const ESCAPE = String.fromCharCode(27);

describe("formatHyperlink", () => {
  it("wraps the text in an OSC 8 hyperlink to the URI", () => {
    const result = formatHyperlink("src/App.tsx:12", "file:///repo/src/App.tsx");
    expect(result).toBe(
      `${ESCAPE}]8;;file:///repo/src/App.tsx${ESCAPE}\\src/App.tsx:12${ESCAPE}]8;;${ESCAPE}\\`,
    );
  });

  it("keeps the visible characters exactly equal to the text", () => {
    const result = formatHyperlink("location", "file:///x");
    // Stripping the OSC 8 escape sequences leaves only the original text, so
    // terminals that ignore the escapes show an unchanged location.
    const visible = result.replaceAll(
      new RegExp(`${ESCAPE}\\]8;;[^${ESCAPE}]*${ESCAPE}\\\\`, "g"),
      "",
    );
    expect(visible).toBe("location");
  });
});
