import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { parseSourceText } from "./parse-source-file.js";
import { isAstNode } from "./is-ast-node.js";

describe("isKeyedDraftTypeReference", () => {
  it.each([
    { sourceText: "import Alias = Function.create;", expected: false },
    { sourceText: "type Alias = Function.create;", expected: true },
    {
      sourceText: "type Notes=({Function}:{Function:string})=>void;",
      expected: true,
    },
    {
      sourceText: "interface Notes { call({Function}:{Function:string}):void; }",
      expected: true,
    },
    {
      sourceText: "declare const notes: ({nested:{Function}}:{nested:{Function:string}})=>void;",
      expected: true,
    },
    {
      sourceText: 'Function("return 1")();',
      expected: false,
    },
    {
      sourceText: "const notes=Function as unknown;",
      expected: false,
    },
    {
      sourceText: "const notes={} as {Function:string};",
      expected: true,
    },
    {
      sourceText: "class Notes { constructor(public value=Function){} }",
      expected: false,
    },
    {
      sourceText: "class Notes { constructor(public Function:string){} }",
      expected: false,
    },
    {
      sourceText: "enum Notes { value=Function }",
      expected: false,
    },
    {
      sourceText: "namespace Notes { export const value=Function; }",
      expected: false,
    },
    {
      sourceText: 'import Function=require("code");',
      expected: false,
    },
    {
      sourceText: "declare function Function():void;",
      expected: false,
    },
    {
      sourceText: "const Function=read(); export=Function;",
      expected: false,
    },
    {
      sourceText: "const Function=read(); export type {Function};",
      expected: true,
    },
    {
      sourceText: "const Function=read(); export {type Function};",
      expected: true,
    },
    {
      sourceText: "const Function=read(); export {Function};",
      expected: false,
    },
    {
      sourceText: 'import type {Function} from "code";',
      expected: true,
    },
    {
      sourceText: 'import {type Function} from "code";',
      expected: true,
    },
  ])("classifies the final capability name in $sourceText", ({ sourceText, expected }) => {
    const program = parseSourceText({ filename: "reference.tsx", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    let identifier: EsTreeNode | undefined;
    const pending = [program];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (
        current.type === "Identifier" &&
        current.name === "Function" &&
        (!identifier || current.range[0] >= identifier.range[0])
      )
        identifier = current;
      for (const [key, child] of Object.entries(current)) {
        if (key === "parent") continue;
        if (Array.isArray(child)) pending.push(...child.filter(isAstNode));
        else if (isAstNode(child)) pending.push(child);
      }
    }
    if (!identifier) throw new Error("Expected a capability identifier");
    expect(isKeyedDraftTypeReference(identifier)).toBe(expected);
    expect(isKeyedDraftTypeReference(identifier)).toBe(expected);
  });
});
