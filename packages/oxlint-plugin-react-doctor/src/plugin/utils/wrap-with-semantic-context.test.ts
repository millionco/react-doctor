import { describe, expect, it } from "vite-plus/test";
import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import { parseSourceText } from "./parse-source-file.js";
import { wrapWithSemanticContext } from "./wrap-with-semantic-context.js";
import type { Rule } from "./rule.js";
import type { BaseRuleSourceCode } from "./rule-context.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

interface SourceForwardingHost {
  report: () => void;
  sourceCode: BaseRuleSourceCode | undefined;
}

describe("wrapWithSemanticContext", () => {
  it("forwards the host source object and preserves its getText receiver", () => {
    const sourceCode = {
      sourceText: "export const value = 1;",
      getText() {
        return this.sourceText;
      },
    };
    const rule: Rule = {
      id: "source-code-forwarding",
      severity: "error",
      create: (context) => {
        expect(context.sourceCode).toBe(sourceCode);
        expect(context.sourceCode?.getText?.()).toBe(sourceCode.sourceText);
        return EMPTY_RULE_VISITORS;
      },
    };

    wrapWithSemanticContext(rule).create({ report: () => {}, sourceCode });
  });

  it("leaves source code unavailable when the host does not provide it", () => {
    const rule: Rule = {
      id: "source-code-unavailable",
      severity: "error",
      create: (context) => {
        expect(context.sourceCode).toBeUndefined();
        return EMPTY_RULE_VISITORS;
      },
    };

    wrapWithSemanticContext(rule).create({ report: () => {} });
  });

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

describe("wrapWithSemanticContext source forwarding", () => {
  it("preserves the current host source object and bound text receiver", () => {
    let readCurrentSource: () => string | undefined = () => undefined;
    let readCurrentSourceCode: () => BaseRuleSourceCode | undefined = () => undefined;
    const rule: Rule = {
      id: "current-source-forwarding",
      severity: "error",
      create: (context) => {
        readCurrentSource = () => context.sourceCode?.getText?.();
        readCurrentSourceCode = () => context.sourceCode;
        return EMPTY_RULE_VISITORS;
      },
    };
    const originalSource = {
      text: "original source",
      getText() {
        return this.text;
      },
    };
    const hostContext: SourceForwardingHost = {
      report: () => {},
      sourceCode: originalSource,
    };
    wrapWithSemanticContext(rule).create(hostContext);
    expect(readCurrentSourceCode()).toBe(originalSource);
    expect(readCurrentSource()).toBe("original source");
    originalSource.text = "updated source";
    expect(readCurrentSource()).toBe("updated source");
    hostContext.sourceCode = {
      getText: () => "replacement source",
    };
    expect(readCurrentSource()).toBe("replacement source");
    hostContext.sourceCode = undefined;
    expect(readCurrentSource()).toBeUndefined();
  });
});
