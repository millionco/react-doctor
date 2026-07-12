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

  it("still flags when the `document` receiver is wrapped in `as any`", () => {
    const result = runRule(noDocumentWrite, `(document as any).write("x");`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a computed `document[expr]()` access", () => {
    const result = runRule(noDocumentWrite, `document[method]("x");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `document["write"]("x");`,
    'document[`writeln`]("x");',
    `document?.write("x");`,
    `document!.write("x");`,
    `(document as Document)["write"]("x");`,
    `(document satisfies Document).writeln("x");`,
  ])("flags static global document write form %#", (source) => {
    const result = runRule(noDocumentWrite, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const document = { write() {} }; document.write("x");`,
    `const document = { write() {} }; document["write"]("x");`,
    `const document = { writeln() {} }; document?.writeln("x");`,
  ])("does not flag shadowed document form %#", (source) => {
    const result = runRule(noDocumentWrite, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
