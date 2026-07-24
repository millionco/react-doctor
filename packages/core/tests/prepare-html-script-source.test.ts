import { describe, expect, it } from "vite-plus/test";
import { prepareHtmlScriptSource } from "../src/utils/prepare-html-script-source.js";

describe("prepareHtmlScriptSource", () => {
  it("masks external script bodies without changing byte offsets or line breaks", () => {
    const source = [
      "<main>🙂</main>",
      '<SCRIPT defer SRC="./main.js" data-label="a > b">',
      "  debugger;",
      "</SCRIPT>",
      "<script>debugger;</script>",
    ].join("\n");
    const sourceBuffer = Buffer.from(source);
    const { executableScriptBodies, lintBuffer } = prepareHtmlScriptSource(sourceBuffer);

    expect(lintBuffer.length).toBe(sourceBuffer.length);
    expect(lintBuffer.toString("utf8").split("\n")).toHaveLength(
      sourceBuffer.toString("utf8").split("\n").length,
    );
    expect(lintBuffer.toString("utf8")).not.toContain("  debugger;\n</SCRIPT>");
    expect(lintBuffer.toString("utf8")).toContain("<script>debugger;</script>");
    expect(executableScriptBodies.map((scriptBody) => scriptBody.toString("utf8"))).toEqual([
      "debugger;",
    ]);
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
    const { executableScriptBodies, lintBuffer } = prepareHtmlScriptSource(sourceBuffer);

    expect(lintBuffer.equals(sourceBuffer)).toBe(true);
    expect(executableScriptBodies).toHaveLength(1);
    expect(executableScriptBodies[0]?.toString("utf8")).toContain("const example");
  });

  it("collects only executable JavaScript script bodies", () => {
    const source = [
      '<script type="application/json">import "three";</script>',
      '<script type="importmap">{"imports":{"three":"./three.js"}}</script>',
      '<script type="x-shader/x-fragment">import "three";</script>',
      '<script language="vbscript">import "three";</script>',
      '<!-- <script>import "three";</script> -->',
      '<script type="text/javascript; charset=utf-8">import "classic";</script>',
      '<script type="module">import "module";</script>',
    ].join("\n");

    const { executableScriptBodies } = prepareHtmlScriptSource(Buffer.from(source));

    expect(executableScriptBodies.map((scriptBody) => scriptBody.toString("utf8"))).toEqual([
      'import "classic";',
      'import "module";',
    ]);
  });

  it("masks leading frontmatter and scripts nested in templates", () => {
    const source = [
      "---",
      'title: <script type="module">import "frontmatter";</script>',
      "---",
      "<template>",
      '  <script type="module">import "template";</script>',
      "  <template>",
      '    <script type="module">import "nested-template";</script>',
      "  </template>",
      "</template>",
      '<script type="module">import "active";</script>',
    ].join("\r\n");
    const sourceBuffer = Buffer.from(source);

    const { executableScriptBodies, lintBuffer } = prepareHtmlScriptSource(sourceBuffer);

    expect(lintBuffer.length).toBe(sourceBuffer.length);
    expect(lintBuffer.toString("utf8").split("\r\n")).toHaveLength(source.split("\r\n").length);
    expect(lintBuffer.toString("utf8")).not.toContain('import "frontmatter"');
    expect(lintBuffer.toString("utf8")).not.toContain('import "template"');
    expect(lintBuffer.toString("utf8")).not.toContain('import "nested-template"');
    expect(executableScriptBodies.map((scriptBody) => scriptBody.toString("utf8"))).toEqual([
      'import "active";',
    ]);
  });
});
