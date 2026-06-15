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
});
