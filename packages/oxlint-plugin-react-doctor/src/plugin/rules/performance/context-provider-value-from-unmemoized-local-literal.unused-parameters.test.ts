import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { contextProviderValueFromUnmemoizedLocalLiteral } from "./context-provider-value-from-unmemoized-local-literal.js";

describe.each(["() =>", "function Inner()"])(
  "unused caught-helper parameters with %s",
  (callbackSyntax) => {
    it.each([
      ["unused", 0],
      ["first, second", 0],
      ["unused = 0", 0],
      ["unused = null", 0],
      ["unused = true", 0],
      ['unused = "value"', 0],
      ["unused = 1n", 0],
      ["unused = () => null", 0],
      ["unused = function () { return 0; }", 0],
      ["unused = async () => null", 0],
      ["unused = function* () { return 0; }", 0],
      ["first = 0, second = () => null", 0],
      ["unused: number = 0", 0],
      ["unused = /value/", 1],
      ["unused = -1", 1],
      ["unused = unknown", 1],
      ["unused = (capture.value = callback())", 1],
      ["unused = capture.render(callback)", 1],
      ["unused = () => callback()", 1],
      ["unused = function (value = callback()) { return 0; }", 1],
      ["{ unused } = {}", 1],
      ["[unused] = []", 1],
      ["...unused", 1],
      ["unused = 0, later = unused", 1],
      ["unused = 0, later = (unused = 1)", 1],
      ["unused, unused", 1],
      ["callback", 1],
    ])("handles %s", (extraParameters, diagnosticCount) => {
      for (const helperBody of [
        "const replace = async () => { try { await (() => { throw 0; })(); } catch { callback = () => null; } }; replace(); return callback();",
        "const fail = () => { throw 0; }; const replace = async () => { try { await fail(); } catch { callback = () => null; } }; replace(); return callback();",
        "const replace = async () => { try { await (() => { throw 0; })(); } finally { callback = () => null; } }; replace(); return callback();",
      ]) {
        const result = runRule(
          contextProviderValueFromUnmemoizedLocalLiteral,
          `import { createContext } from "react";
         const ThemeContext = createContext(null);
         const capture = { value: null, render: (callback) => capture.value = callback() };
         function helper(callback, ${extraParameters}) { ${helperBody} }
         function App() {
           return [helper(${callbackSyntax} {
             const value = {};
             return <ThemeContext.Provider value={value} />;
           }), capture.value];
         }`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(diagnosticCount);
      }
    });
  },
);
