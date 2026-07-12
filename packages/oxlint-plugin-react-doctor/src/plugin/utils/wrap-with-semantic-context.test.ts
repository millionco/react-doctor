import { describe, expect, it } from "vite-plus/test";
import { wrapWithSemanticContext } from "./wrap-with-semantic-context.js";
import type { Rule } from "./rule.js";

describe("wrapWithSemanticContext", () => {
  it("preserves the bound getFilename fallback without adding semantic visitors", () => {
    let resolvedFilename: string | undefined;
    const rule: Rule = {
      id: "filename-fallback",
      severity: "error",
      create: (context) => {
        resolvedFilename = context.filename;
        return {
          CallExpression: () => {},
        };
      },
    };
    const hostContext = {
      expectedFilename: "/tmp/example.js",
      report: () => {},
      getFilename() {
        return this.expectedFilename;
      },
    };

    const visitors = wrapWithSemanticContext(rule).create(hostContext);

    expect(resolvedFilename).toBe(hostContext.expectedFilename);
    expect(visitors.Program).toBeUndefined();
  });
});
