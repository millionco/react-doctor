import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { contextProviderValueFromUnmemoizedLocalLiteral } from "./context-provider-value-from-unmemoized-local-literal.js";

describe.each(["() =>", "function Inner()"])("callback replacement with %s", (callbackSyntax) => {
  it.each([
    ["unchanged callback", "return callback();", 1],
    ["direct replacement", "callback = () => null; return callback();", 0],
    ["conditional replacement", "if (condition) callback = () => null; return callback();", 0],
    ["unknown replacement", "callback = getReplacement(); return callback();", 0],
    [
      "replacement alias",
      "const replacement = () => null; callback = replacement; return callback();",
      0,
    ],
    ["array replacement", "[callback] = [() => null]; return callback();", 0],
    ["object replacement", "({ callback } = { callback: () => null }); return callback();", 0],
    ["loop replacement", "for (callback of [() => null]) {} return callback();", 0],
    [
      "destructured loop replacement",
      "for ([callback] of [[() => null]]) {} return callback();",
      0,
    ],
    [
      "nested synchronous replacement",
      "const replace = () => { callback = () => null; }; replace(); return callback();",
      0,
    ],
    [
      "write after invocation",
      "const result = callback(); callback = () => null; return result;",
      1,
    ],
    ["unreachable later write", "return callback(); callback = () => null;", 1],
    [
      "later loop write",
      "const result = callback(); for (const ignored of [0]) callback = () => null; return result;",
      1,
    ],
    [
      "discarded invocation before replacement",
      "callback(); callback = () => null; return callback();",
      0,
    ],
    ["member write", "callback.metadata = {}; return callback();", 1],
    ["destructured member write", "[callback.metadata] = [null]; return callback();", 1],
    ["computed pattern key", "({ [callback]: unused } = {}); return callback();", 1],
    ["read-only pattern default", "({ unused = callback } = {}); return callback();", 1],
    [
      "object pattern member write",
      "({ value: callback.metadata } = { value: null }); return callback();",
      1,
    ],
    [
      "object pattern source read",
      "({ value: unused } = { value: callback }); return callback();",
      1,
    ],
  ])("handles %s", (_, helperBody, diagnosticCount) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function helper(callback, unused = 0) { ${helperBody} }
       function App() {
         return helper(${callbackSyntax} {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it.each([
    "function helper(callback) { callback = () => null; return callback(); }",
    "function helper(callback, unused = (callback = () => null)) { return callback(); }",
  ])("ignores replaced callback in %s", (helperDeclaration) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       ${helperDeclaration}
       function App() {
         return helper(${callbackSyntax} {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
