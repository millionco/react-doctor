import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { contextProviderValueFromUnmemoizedLocalLiteral } from "./context-provider-value-from-unmemoized-local-literal.js";

describe.each(["() =>", "function Inner()"])("callback replacement with %s", (callbackSyntax) => {
  it.each([
    ["unchanged callback", "return callback();", 1],
    [
      "awaited-assignment-RHS",
      "const replace=async()=>{callback=await Promise.resolve(()=>null);};replace();return callback();",
      1,
    ],
    [
      "awaited-destructure-RHS",
      "const replace=async()=>{[callback]=await Promise.resolve([()=>null]);};replace();return callback();",
      1,
    ],
    [
      "assignment-in-await-operand",
      "const replace=async()=>{await (callback=()=>null);};replace();return callback();",
      0,
    ],
    [
      "awaited for-of iterable",
      "const replace = async () => { for (callback of await Promise.resolve([() => null])) {} }; replace(); return callback();",
      1,
    ],
    [
      "skipped awaited pattern default",
      "const replace = async () => { [callback = await Promise.resolve(() => null)] = [() => null]; }; replace(); return callback();",
      0,
    ],
    [
      "later awaited sibling default",
      "const replace = async () => { let later; [callback, later = await Promise.resolve(0)] = [() => null]; }; replace(); return callback();",
      0,
    ],
    [
      "nested assignment in pre-await key",
      "const replace = async () => { const object = {}; object[callback = () => null] = await Promise.resolve(0); }; replace(); return callback();",
      0,
    ],
    [
      "synchronous call in pre-await key",
      "const mutate = () => { callback = () => null; }; const replace = async () => { const object = {}; object[mutate()] = await Promise.resolve(0); }; replace(); return callback();",
      0,
    ],

    [
      "async parameter default replacement",
      "const replace = async (unused = (callback = () => null)) => { await Promise.resolve(); }; replace(); return callback();",
      0,
    ],

    [
      "async-write-after-await",
      "const replace=async()=>{await Promise.resolve();callback=()=>null;};replace();return callback();",
      1,
    ],
    [
      "async-write-before-await",
      "const replace=async()=>{callback=()=>null;await Promise.resolve();};replace();return callback();",
      0,
    ],
    [
      "async-wrapper-after-await",
      "const replace=()=>{callback=()=>null;};const wrapper=async()=>{await Promise.resolve();replace();};wrapper();return callback();",
      1,
    ],
    [
      "async-wrapper-before-await",
      "const replace=()=>{callback=()=>null;};const wrapper=async()=>{replace();await Promise.resolve();};wrapper();return callback();",
      0,
    ],
    [
      "await-operand-write",
      "const replace=async()=>{await (callback=()=>null);};replace();return callback();",
      0,
    ],
    [
      "for-await-body-write",
      "const replace=async()=>{for await(const ignored of [0])callback=()=>null;};replace();return callback();",
      1,
    ],
    [
      "uncalled-generator",
      "const replace=function*(){callback=()=>null;};replace();return callback();",
      1,
    ],
    [
      "promise-then-write",
      "Promise.resolve().then(()=>{callback=()=>null;});return callback();",
      1,
    ],
    [
      "conditional-sync-write",
      "const replace=()=>{if(condition)callback=()=>null;};replace();return callback();",
      0,
    ],
    [
      "conditional async replacement before await",
      "const replace = async () => { if (condition) callback = () => null; await Promise.resolve(); }; replace(); return callback();",
      0,
    ],
    [
      "for-await binding replacement",
      "const replace = async () => { for await (callback of [() => null]) {} }; replace(); return callback();",
      1,
    ],

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
