import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSyncXhr } from "./no-sync-xhr.js";

describe("no-sync-xhr", () => {
  it("flags `xhr.open(method, url, false)`", () => {
    const result = runRule(
      noSyncXhr,
      `const xhr = new XMLHttpRequest(); xhr.open("GET", "/api", false);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("synchronous");
  });

  it("does not flag an async open (third arg true)", () => {
    const result = runRule(noSyncXhr, `xhr.open("GET", "/api", true);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an open with no async argument (defaults to async)", () => {
    const result = runRule(noSyncXhr, `xhr.open("GET", "/api");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-open method with a false argument", () => {
    const result = runRule(noSyncXhr, `widget.toggle("a", "b", false);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic async flag", () => {
    const result = runRule(noSyncXhr, `xhr.open("GET", url, isSync);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unrelated typed open method", () => {
    const result = runRule(
      noSyncXhr,
      `interface Archive { open(mode: string, path: string, createIfMissing: boolean): void; }
       const openArchive = (archive: Archive) => archive.open("read", "/documents.zip", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags typed XMLHttpRequest parameters and nullable unions", () => {
    const result = runRule(
      noSyncXhr,
      `const load = (first: XMLHttpRequest, second: XMLHttpRequest | null) => {
         first.open("GET", "/one", false);
         second?.open("GET", "/two", false);
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("follows direct and multi-hop XMLHttpRequest value aliases", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const firstAlias = request;
       const secondAlias = firstAlias;
       secondAlias.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows aliases of global and window XMLHttpRequest constructors", () => {
    const result = runRule(
      noSyncXhr,
      `const GlobalRequest = XMLHttpRequest;
       const WindowRequest = window.XMLHttpRequest;
       new GlobalRequest().open("GET", "/one", false);
       new WindowRequest().open("GET", "/two", false);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust shadowed XMLHttpRequest constructor or type names", () => {
    const result = runRule(
      noSyncXhr,
      `class XMLHttpRequest {
         open(mode: string, path: string, createIfMissing: boolean) {}
       }
       const request = new XMLHttpRequest();
       request.open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust unresolved or mutable aliases", () => {
    const result = runRule(
      noSyncXhr,
      `let request = new XMLHttpRequest();
       request = archive;
       request.open("read", "/archive", false);
       unknown.open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
