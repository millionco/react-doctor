import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDocumentWrite } from "./no-document-write.js";

describe("no-document-write", () => {
  it("flags `document.write(...)`", () => {
    const result = runRule(noDocumentWrite, `document.write("<p>hi</p>");`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("document.write()");
  });

  it("flags `document.writeln(...)`", () => {
    const result = runRule(noDocumentWrite, `document.writeln("x");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `document.createElement(...)`", () => {
    const result = runRule(noDocumentWrite, `const el = document.createElement("div");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `.write` on another object (e.g. a stream)", () => {
    const result = runRule(noDocumentWrite, `stream.write("chunk");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed `document[expr]()` access", () => {
    const result = runRule(noDocumentWrite, `document[method]("x");`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
