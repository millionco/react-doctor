import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { walkAst } from "../walk-ast.js";
import { isSupportedRuntimeScopeNode } from "./is-supported-runtime-scope-node.js";
import { NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH } from "./native-signal-delay/constants.js";

const unsupportedNodes = (source: string): string[] => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const unsupported: string[] = [];
  walkAst(parsed.program, (node) => {
    if (!isSupportedRuntimeScopeNode(node, scopes)) unsupported.push(node.type);
  });
  return unsupported;
};

describe("isSupportedRuntimeScopeNode", () => {
  it.each([
    "function helper() {} helper();",
    "export function helper() {} helper();",
    "export default function helper() {} helper();",
    "const run = () => { function helper() {} helper(); }; run();",
    "function run() { function helper() {} helper(); } run();",
    "const run = function () { function helper() {} helper(); }; run();",
    "class Runner { run() { function helper() {} helper(); } }",
    "{ const Object = function () {}; Object(); } Object.getPrototypeOf(value);",
    "{ const Object = () => {}; Object(); } Object.getPrototypeOf(value);",
    "const run = (Object) => Object.getPrototypeOf(value); run(localObject);",
    "const local = {}; local.value;",
    'import { Object } from "runtime"; Object.getPrototypeOf(value);',
    'import { type Other, Object } from "runtime"; Object.getPrototypeOf(value);',
    'import Runtime = require("runtime"); Runtime();',
    "namespace Runtime { export const value = 1; } Runtime.value;",
    "interface Shape {} type Alias = Shape; const value: Alias = {};",
    "interface Parent {} interface Child extends Parent {}",
    "interface Shape {} export type { Shape };",
    "interface Shape {} export { type Shape };",
    "declare const ambient: unknown; interface Shape {} type Alias = Shape;",
    'import type { Shape } from "types"; const value: Shape = {};',
    "declare function ambient(): void;",
    'import { View } from "runtime"; const node = <View />;',
    "enum Mode { Ready } Mode.Ready;",
    "const enum Mode { Ready }",
    "declare namespace Types { enum Mode { Ready } }",
    "{ var local = 1; } local;",
    "function run() { if (branch) { var local = 1; } local; }",
    "namespace Runtime { export const run = () => { var local = 1; return local; }; }",
  ])("allows supported runtime bindings and harmless erased syntax: %s", (source) => {
    expect(unsupportedNodes(source)).toEqual([]);
  });

  it.each([
    "{ function hidden() {} } hidden();",
    "if (branch) { function hidden() {} } hidden();",
    "if (branch) {} else { function hidden() {} } hidden();",
    "while (branch) { function hidden() {} } hidden();",
    "for (;;) { function hidden() {} break; } hidden();",
    "switch (branch) { case 1: function hidden() {} } hidden();",
    "try {} catch (error) { function hidden() {} } hidden();",
    "class Container { static { function hidden() {} } } hidden();",
    "namespace Container { function hidden() {} } hidden();",
    "const run = () => { { function hidden() {} } hidden(); };",
    "{ function aliasName() {} } const NativeObject = aliasName; NativeObject();",
  ])("refuses unsupported lexical function positions: %s", (source) => {
    expect(unsupportedNodes(source)).toContain("FunctionDeclaration");
  });

  it.each([
    ["{ enum Function { Local } } new Function(source);", "TSEnumDeclaration"],
    [
      "{ namespace Function { export const local = 1; } } new Function(source);",
      "TSModuleDeclaration",
    ],
    ["namespace Container { enum Function { Local } } new Function(source);", "TSEnumDeclaration"],
    [
      "namespace Container { import Function = Utilities.create; } new Function(source);",
      "TSImportEqualsDeclaration",
    ],
    [
      "namespace Container { var Function = Utilities.create; } new Function(source);",
      "VariableDeclaration",
    ],
    ["class Holder { static { var Function; } } new Function(source);", "StaticBlock"],
  ])("refuses over-hoisted runtime TypeScript declarations: %s", (source, nodeType) => {
    expect(unsupportedNodes(source)).toContain(nodeType);
  });

  it.each([
    "type Object = {}; Object.getPrototypeOf(value);",
    "interface Object {} Object.getPrototypeOf(value);",
    "type eval = {}; eval(source);",
    "declare const Object: any; Object.getPrototypeOf(value);",
    "declare let Object: any; Object.getPrototypeOf(value);",
    "declare class Object {} Object.getPrototypeOf(value);",
    "declare namespace Object {} Object.getPrototypeOf(value);",
    'import type Object from "types"; Object.getPrototypeOf(value);',
    'import type * as Object from "types"; Object.getPrototypeOf(value);',
    'import type { Object } from "types"; Object.getPrototypeOf(value);',
    'import { type Object } from "types"; Object.getPrototypeOf(value);',
    'import { type Object, other } from "types"; Object.getPrototypeOf(value);',
    'import type Object = require("types"); Object.getPrototypeOf(value);',
    "declare namespace Ambient { export const value: unknown; } Ambient.value;",
    "const enum Mode { Ready } Mode.Ready;",
  ])("refuses value references resolved to erased declarations: %s", (source) => {
    expect(unsupportedNodes(source)).toContain("Identifier");
  });

  it.each([
    'import { type View, other } from "types"; const node = <View />;',
    'import type * as Views from "types"; const node = <Views.Root />;',
    "type View = {}; const node = <View />;",
  ])("refuses erased bindings used as runtime JSX values: %s", (source) => {
    expect(unsupportedNodes(source)).toContain("JSXIdentifier");
  });

  it("refuses missing declaration ancestry", () => {
    const parsed = parseFixture("const local = 1; local;");
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let didCheckReference = false;
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "Identifier") || !scopes.referenceFor(node)) return;
      const symbol = scopes.symbolFor(node);
      if (!symbol) return;
      symbol.declarationNode.parent = null;
      expect(isSupportedRuntimeScopeNode(node, scopes)).toBe(false);
      didCheckReference = true;
    });
    expect(didCheckReference).toBe(true);
  });

  it("refuses scope analyses without a proved Program root", () => {
    const parsed = parseFixture("{ function hidden() {} }");
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a Program fixture");
    attachParentReferences(parsed.program);
    const block = parsed.program.body[0];
    expect(isNodeOfType(block, "BlockStatement")).toBe(true);
    const scopes = analyzeScopes(block);
    expect(isSupportedRuntimeScopeNode(block, scopes)).toBe(false);
  });

  it("refuses excessive runtime declaration ancestry", () => {
    const nesting = NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH;
    expect(
      unsupportedNodes(`${"{".repeat(nesting)} const local = 1; local; ${"}".repeat(nesting)}`),
    ).toContain("Identifier");
  });
});
