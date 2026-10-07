import { describe, expect, it } from "vite-plus/test";
import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import { parseSourceText } from "./parse-source-file.js";
import { wrapWithSemanticContext } from "./wrap-with-semantic-context.js";
import type { Rule } from "./rule.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

describe("wrapWithSemanticContext", () => {
  it("preserves the bound getFilename fallback and adds the root-capture Program visitor", () => {
    let resolvedFilename: string | undefined;
    const callExpressionHandler = (): void => {};
    const rule: Rule = {
      id: "filename-fallback",
      severity: "error",
      create: (context) => {
        resolvedFilename = context.filename;
        return {
          CallExpression: callExpressionHandler,
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
    expect(visitors.Program).toBeDefined();
    expect(visitors.CallExpression).toBe(callExpressionHandler);
  });

  it("preserves shared empty visitors without adding a Program handler", () => {
    const rule: Rule = {
      id: "empty-visitors",
      severity: "error",
      create: () => EMPTY_RULE_VISITORS,
    };

    const visitors = wrapWithSemanticContext(rule).create({
      filename: "/tmp/example.js",
      report: () => {},
    });

    expect(visitors).toBe(EMPTY_RULE_VISITORS);
    expect(visitors.Program).toBeUndefined();
  });

  it("uses the host source AST without adding a Program handler", () => {
    const program = parseSourceText({
      filename: "/tmp/example.js",
      sourceText: "export const value = 1;",
    });
    if (program === null) throw new Error("Expected parsed fixture");

    let resolvedScopes: ScopeAnalysis | undefined;
    const callExpressionHandler = (): void => {};
    const rule: Rule = {
      id: "source-code-root",
      severity: "error",
      create: (context) => {
        resolvedScopes = context.scopes;
        return {
          CallExpression: callExpressionHandler,
        };
      },
    };

    const visitors = wrapWithSemanticContext(rule).create({
      filename: "/tmp/example.js",
      report: () => {},
      sourceCode: { ast: program },
    });

    expect(resolvedScopes?.rootScope.node).toBe(program);
    expect(visitors.Program).toBeUndefined();
    expect(visitors.CallExpression).toBe(callExpressionHandler);
  });

  it("does not retain fallback scopes after the Program root is captured", () => {
    let fallbackScopes: ScopeAnalysis | undefined;
    let liveScopes: ScopeAnalysis | undefined;
    let repeatedScopes: ScopeAnalysis | undefined;
    const rule: Rule = {
      id: "scope-cache",
      severity: "error",
      create: (context) => {
        fallbackScopes = context.scopes;
        return {
          Program: () => {
            liveScopes = context.scopes;
            repeatedScopes = context.scopes;
          },
        };
      },
    };
    const program = parseSourceText({
      filename: "/tmp/example.js",
      sourceText: "export const value = 1;",
    });
    if (program === null) throw new Error("Expected parsed fixture");

    const visitors = wrapWithSemanticContext(rule).create({
      filename: "/tmp/example.js",
      report: () => {},
    });
    visitors.Program?.(program);

    expect(liveScopes).not.toBe(fallbackScopes);
    expect(liveScopes?.rootScope.node).toBe(program);
    expect(repeatedScopes).toBe(liveScopes);
  });
});
