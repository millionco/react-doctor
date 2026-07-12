import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readInitialStateBoolean } from "./read-initial-state-boolean.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";

const readResultBoolean = (componentBody: string): boolean | null => {
  const parsed = parseFixture(`
    import { useState } from "react";
    const Component = ({ unknownInitial }) => {
      ${componentBody}
      const result = state;
    };
  `);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  let resultExpression: EsTreeNode | null = null;
  walkAst(parsed.program, (node) => {
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === "result"
    ) {
      resultExpression = node.init;
    }
  });
  expect(resultExpression).not.toBeNull();
  if (!resultExpression) throw new Error("Expected result expression");
  return readInitialStateBoolean(resultExpression, scopes);
};

describe("readInitialStateBoolean", () => {
  it.each([
    ["an eager false literal", `const [state] = useState(false);`, false],
    ["an eager null literal", `const [state] = useState(null);`, false],
    ["a lazy false expression", `const [state] = useState(() => false);`, false],
    ["a lazy true expression", `const [state] = useState(() => true);`, true],
    ["a lazy block return", `const [state] = useState(() => { return false; });`, false],
    [
      "a lazy function-expression return",
      `const [state] = useState(function () { return true; });`,
      true,
    ],
    ["unary negation", `const [state] = useState(!true);`, false],
    [
      "an immutable boolean alias",
      `const initialState = !false; const [state] = useState(initialState);`,
      true,
    ],
    [
      "an immutable lazy initializer alias",
      `const initialState = () => false; const [state] = useState(initialState);`,
      false,
    ],
    [
      "a statically false nested logical initializer",
      `const [state] = useState(unknownInitial && false);`,
      false,
    ],
    [
      "a statically true nested logical initializer",
      `const [state] = useState(unknownInitial || true);`,
      true,
    ],
  ])("reads %s", (_name, componentBody, expected) => {
    expect(readResultBoolean(componentBody)).toBe(expected);
  });

  it.each([
    ["an unknown identifier", `const [state] = useState(unknownInitial);`],
    ["an unknown lazy result", `const [state] = useState(() => unknownInitial);`],
    [
      "a mutated alias",
      `let initialState = false; initialState = true; const [state] = useState(initialState);`,
    ],
    ["an async lazy initializer", `const [state] = useState(async () => false);`],
  ])("leaves %s unknown", (_name, componentBody) => {
    expect(readResultBoolean(componentBody)).toBeNull();
  });
});
