import { describe, expect, it } from "vite-plus/test";
import { maskExternalHtmlScriptBodies } from "../src/utils/mask-external-html-script-bodies.js";

describe("maskExternalHtmlScriptBodies", () => {
  it("masks external script bodies without changing byte offsets or line breaks", () => {
    const source = [
      "<main>🙂</main>",
      '<SCRIPT defer SRC="./main.js" data-label="a > b">',
      "  debugger;",
      "</SCRIPT>",
      "<script>debugger;</script>",
    ].join("\n");
    const sourceBuffer = Buffer.from(source);
    const maskedBuffer = maskExternalHtmlScriptBodies(sourceBuffer);

    expect(maskedBuffer.length).toBe(sourceBuffer.length);
    expect(maskedBuffer.toString("utf8").split("\n")).toHaveLength(
      sourceBuffer.toString("utf8").split("\n").length,
    );
    expect(maskedBuffer.toString("utf8")).not.toContain("  debugger;\n</SCRIPT>");
    expect(maskedBuffer.toString("utf8")).toContain("<script>debugger;</script>");
  });

  it("ignores src-like text in attribute values, comments, and inline script bodies", () => {
    const source = [
      '<main data-example="<script src=ignored>">content</main>',
      "<p>1 < 3</p>",
      "<!-- <script src=ignored>debugger;</script> -->",
      "<textarea><script src=ignored>debugger;</textarea>",
      '<script>const example = "<script src=ignored>debugger;</script>";</script>',
    ].join("\n");
    const sourceBuffer = Buffer.from(source);

    expect(maskExternalHtmlScriptBodies(sourceBuffer).equals(sourceBuffer)).toBe(true);
  });
});
