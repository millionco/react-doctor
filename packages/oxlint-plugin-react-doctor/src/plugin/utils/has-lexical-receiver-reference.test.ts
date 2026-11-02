import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasLexicalReceiverReference } from "./has-lexical-receiver-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

describe("hasLexicalReceiverReference", () => {
  it.each([
    { expression: "() => import.meta.url", expected: false },
    { expression: "() => () => import.meta.url", expected: false },
    { expression: "() => new.target", expected: true },
    { expression: "() => () => new.target", expected: true },
    { expression: "() => this.value", expected: true },
    { expression: "() => () => this.value", expected: true },
    { expression: "() => arguments[0]", expected: true },
    { expression: "() => () => arguments[0]", expected: true },
    { expression: "() => [import.meta.url, new.target]", expected: true },
    { expression: "() => [import.meta.url, this.value]", expected: true },
    { expression: "() => [import.meta.url, arguments[0]]", expected: true },
    { expression: "() => function () { return new.target; }", expected: false },
  ])("classifies $expression", ({ expression, expected }) => {
    const parsed = parseFixture(`function owner() { const callback = ${expression}; }`);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let callback: EsTreeNode | undefined;
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "VariableDeclarator") &&
        isNodeOfType(node.id, "Identifier") &&
        node.id.name === "callback" &&
        node.init
      ) {
        callback = node.init;
      }
    });
    if (!callback) throw new Error("Expected callback initializer");
    expect(hasLexicalReceiverReference(callback, scopes)).toBe(expected);
  });
});
