import { describe, expect, it } from "vite-plus/test";
import { extractHtmlScriptSources } from "../src/utils/extract-html-script-sources.js";

describe("extractHtmlScriptSources", () => {
  it("extracts classic and module scripts into location-preserving sources", () => {
    const html = [
      "<!doctype html>",
      "<main>🙂</main>",
      '<script data-label="a > b">',
      "  debugger;",
      "</script>",
      '<script type="module">',
      '  import * as THREE from "three";',
      "</script>",
    ].join("\n");

    const extractedSources = extractHtmlScriptSources(html);

    expect(extractedSources.map((source) => source.extension)).toEqual([".js", ".mjs"]);
    for (const extractedSource of extractedSources) {
      expect(extractedSource.content.length).toBe(Buffer.byteLength(html));
      expect(extractedSource.content.toString("utf8").split("\n")).toHaveLength(8);
    }
    expect(extractedSources[0]?.content.toString("utf8")).toContain("  debugger;");
    expect(extractedSources[0]?.content.toString("utf8")).not.toContain("THREE");
    expect(extractedSources[1]?.content.toString("utf8")).toContain(
      '  import * as THREE from "three";',
    );
    expect(extractedSources[1]?.content.toString("utf8")).not.toContain("debugger");
  });

  it("keeps inline code at the original UTF-8 byte offset", () => {
    const html = '<main>🙂</main><script type="module">debugger;</script>';
    const [extractedSource] = extractHtmlScriptSources(html);

    expect(extractedSource?.content.indexOf("debugger")).toBe(
      Buffer.from(html).indexOf("debugger"),
    );
  });

  it("skips external, data, import-map, shader, and empty scripts", () => {
    const html = [
      '<script src="./main.js">debugger;</script>',
      '<script type="application/json">{"enabled": true}</script>',
      '<script type="importmap">{"imports": {}}</script>',
      '<script type="x-shader/x-fragment">void main() {}</script>',
      "<script>   </script>",
    ].join("\n");

    expect(extractHtmlScriptSources(html)).toEqual([]);
  });

  it("skips scripts inside HTML comments", () => {
    const html = [
      "<!-- <script>debugger;</script> -->",
      "<script>console.log('active');</script>",
    ].join("\n");

    const [extractedSource] = extractHtmlScriptSources(html);

    expect(extractedSource?.content.toString("utf8")).toContain("console.log('active')");
    expect(extractedSource?.content.toString("utf8")).not.toContain("debugger");
  });

  it("accepts standard JavaScript MIME types with parameters", () => {
    const html =
      '<script type="text/javascript; charset=utf-8">debugger;</script>' +
      '<script type="application/ecmascript">alert(1);</script>';

    expect(extractHtmlScriptSources(html).map((source) => source.extension)).toEqual([
      ".js",
      ".js",
    ]);
  });
});
