import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasGlobalNamespaceMutation } from "./has-global-namespace-mutation.js";
import { parseSourceText } from "./parse-source-file.js";

describe("global namespace mutation without a reference node", () => {
  it.each([
    ["const text = 'plain';", "String", false],
    ["const String = { prototype: {} }; String.prototype.split = replace;", "String", false],
    ["String.prototype.split = replace;", "String", true],
    ["const original = String; original.prototype.split = replace;", "String", true],
    ["Object.assign(String.prototype, { split: replace });", "String", true],
    ["Reflect.defineProperty(String.prototype, 'split', { value: replace });", "String", true],
    ["const container = { value: String }; consume(container);", "String", true],
    ["const container = [Object]; consume(container);", "Object", true],
    ["const container = { host: globalThis }; consume(container);", "String", true],
    ["const name = Promise.name;", "Promise", false],
    ["const name = queueMicrotask.length;", "queueMicrotask", false],
    ["const name = [Promise.resolve.name];", "Promise", true],
  ])("checks %s", (sourceText, namespace, expected) => {
    const program = parseSourceText({ filename: "namespace.tsx", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    expect(hasGlobalNamespaceMutation(namespace, scopes, undefined, true)).toBe(expected);
    expect(hasGlobalNamespaceMutation(namespace, scopes, undefined, true)).toBe(expected);
  });
});
