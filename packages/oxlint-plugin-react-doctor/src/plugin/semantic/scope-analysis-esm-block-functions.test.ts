import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";
import { walkAst } from "../utils/walk-ast.js";
import { analyzeScopes } from "./scope-analysis.js";

const analyze = (source: string) => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  return { ...analyzeScopes(parsed.program), program: parsed.program };
};

const namedNodes = (program: EsTreeNode, name: string) => {
  const identifiers: EsTreeNode[] = [];
  walkAst(program, (node) => {
    if (isNodeOfType(node, "Identifier") && node.name === name) identifiers.push(node);
  });
  return identifiers;
};

describe("explicit ESM block function bindings", () => {
  it.each([
    "import 'package';",
    "import {} from 'package';",
    "import value from 'package';",
    "import * as values from 'package';",
    "import {value} from 'package';",
    "import {type Shape, value} from 'package';",
    "export {};",
    "export const marker=1;",
    "export let marker=1;",
    "export var marker=1;",
    "export function marker(){}",
    "export class Marker{}",
    "export default 1;",
    "export default function(){}",
    "export default class{}",
    "export {value} from 'package';",
    "export * from 'package';",
  ])("uses the existing lexical block for %s", (marker) => {
    const analysis = analyze(`${marker} {helper(); function helper(){}} helper;`);
    const identifiers = namedNodes(analysis.program, "helper");
    const declaration = identifiers.find((node) => node.parent?.type === "FunctionDeclaration");
    if (!declaration?.parent) throw new Error("Missing declaration");
    const block = analysis.scopeFor(declaration.parent);
    const binding = block.symbolsByName.get("helper");
    expect(block.kind).toBe("block");
    expect(binding?.declarationNode).toBe(declaration.parent);
    expect(binding?.bindingIdentifier).toBe(declaration);
    expect(analysis.rootScope.symbolsByName.has("helper")).toBe(false);
    const references = identifiers.filter((node) => analysis.referenceFor(node));
    expect(analysis.symbolFor(references[0])).toBe(binding);
    expect(analysis.isGlobalReference(references[1])).toBe(true);
  });

  it.each([
    "",
    "'use strict';",
    "import('package');",
    "import type {Shape} from 'package';",
    "import {type Shape} from 'package';",
    "export type Shape={};",
    "export interface Shape{}",
    "export declare function marker():void;",
    "export declare const marker:number;",
    "export default interface Shape{}",
    "export const enum Marker{Value}",
    "export type {Shape} from 'package';",
    "export {type Shape} from 'package';",
    "import Marker=require('package');",
    "module.exports={};",
  ])("retains the previous hoisting model without a runtime ESM marker: %s", (marker) => {
    const analysis = analyze(`${marker} {function helper(){}} helper;`);
    const binding = analysis.rootScope.symbolsByName.get("helper");
    expect(binding?.kind).toBe("function");
    const reference = namedNodes(analysis.program, "helper").find((node) =>
      analysis.referenceFor(node),
    );
    if (!reference) throw new Error("Missing reference");
    expect(analysis.symbolFor(reference)).toBe(binding);
  });

  it("keeps a never-entered lexical block from hiding outside native timer references", () => {
    const analysis = analyze(
      "export {}; setInterval(refresh,1); if(false){function setInterval(){}} setInterval(refresh,1);",
    );
    const references = namedNodes(analysis.program, "setInterval").filter((node) =>
      analysis.referenceFor(node),
    );
    expect(references).toHaveLength(2);
    for (const reference of references) expect(analysis.isGlobalReference(reference)).toBe(true);
  });

  it("keeps outer, block, and post-block calls attached to their exact declaration", () => {
    const analysis = analyze(
      "export {}; function helper(){} helper(); {helper(); function helper(){}} helper();",
    );
    const outer = analysis.rootScope.symbolsByName.get("helper");
    const block = analysis.rootScope.children.find((scope) => scope.kind === "block");
    const inner = block?.symbolsByName.get("helper");
    const references = namedNodes(analysis.program, "helper").filter((node) =>
      analysis.referenceFor(node),
    );
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner).not.toBe(outer);
    expect(references.map((node) => analysis.symbolFor(node))).toEqual([outer, inner, outer]);
  });

  it("keeps same-name sibling block bindings distinct", () => {
    const analysis = analyze(
      "export {}; {function helper(){} helper();} {function helper(){} helper();}",
    );
    const blocks = analysis.rootScope.children.filter((scope) => scope.kind === "block");
    const references = namedNodes(analysis.program, "helper").filter((node) =>
      analysis.referenceFor(node),
    );
    expect(blocks).toHaveLength(2);
    expect(analysis.symbolFor(references[0])).toBe(blocks[0].symbolsByName.get("helper"));
    expect(analysis.symbolFor(references[1])).toBe(blocks[1].symbolsByName.get("helper"));
    expect(analysis.symbolFor(references[0])).not.toBe(analysis.symbolFor(references[1]));
  });

  it("preserves the inner self binding and outer lexical writes", () => {
    const analysis = analyze("export {}; {function helper(){helper();} helper=foreign; helper();}");
    const block = analysis.rootScope.children.find((scope) => scope.kind === "block");
    const outer = block?.symbolsByName.get("helper");
    if (!outer) throw new Error("Missing lexical binding");
    const inner = analysis.ownScopeFor(outer.declarationNode)?.symbolsByName.get("helper");
    const references = namedNodes(analysis.program, "helper").filter((node) =>
      analysis.referenceFor(node),
    );
    expect(inner).not.toBe(outer);
    expect(analysis.symbolFor(references[0])).toBe(inner);
    expect(analysis.symbolFor(references[1])).toBe(outer);
    expect(analysis.referenceFor(references[1])?.flag).toBe("write");
    expect(analysis.symbolFor(references[2])).toBe(outer);
  });

  it("preserves var and direct function-body hoisting in an ESM function", () => {
    const analysis = analyze(
      "export {}; function outer(){function direct(){} {var value=1; function helper(){}} helper; value; direct();}",
    );
    const owner = analysis.rootScope.children.find((scope) => scope.kind === "function");
    expect(owner?.symbolsByName.get("direct")?.kind).toBe("function");
    expect(owner?.symbolsByName.get("value")?.kind).toBe("var");
    expect(owner?.symbolsByName.has("helper")).toBe(false);
    const reference = namedNodes(analysis.program, "helper").find((node) =>
      analysis.referenceFor(node),
    );
    if (!reference) throw new Error("Missing outside reference");
    expect(analysis.isGlobalReference(reference)).toBe(true);
  });

  it.each([
    "try{}catch(error){{function helper(){}}}",
    "namespace Opaque{{function helper(){}}}",
    "class Container{static{{function helper(){}}}}",
    "class Container{method(){{function helper(){}}}}",
    "switch(1){case 1:{function helper(){}}}",
  ])("does not change opaque block contexts: %s", (body) => {
    const analysis = analyze(`export {}; ${body}`);
    const identifier = namedNodes(analysis.program, "helper").find(
      (node) => node.parent?.type === "FunctionDeclaration",
    );
    if (!identifier?.parent) throw new Error("Missing function declaration");
    const enclosing = analysis.scopeFor(identifier.parent);
    expect(enclosing.symbolsByName.get("helper")?.declarationNode).not.toBe(identifier.parent);
  });

  it("does not materialize runtime functions from ambient namespaces", () => {
    const analysis = analyze("export {}; declare namespace Opaque{function helper():void;}");
    expect(analysis.rootScope.symbolsByName.has("helper")).toBe(false);
    const namespace = analysis.rootScope.children.find((scope) => scope.kind === "ts-module");
    expect(namespace?.symbolsByName.has("helper")).toBe(false);
  });

  it.each(["if(true) function helper(){}", "switch(1){case 1:function helper(){}}"])(
    "retains the previous target for non-block declaration positions: %s",
    (body) => {
      const analysis = analyze(`export {}; ${body}`);
      expect(analysis.rootScope.symbolsByName.get("helper")?.kind).toBe("function");
    },
  );
});
