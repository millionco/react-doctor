import { expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getClosedMemoArrayFromSource } from "./get-closed-memo-array-from-source.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

it("checks shared provider and symbol facts once per immutable analysis", () => {
  for (const fixture of [
    { exposure: "", parameterWrite: "", programReads: 1, parameterReads: 1 },
    {
      exposure: "const nativeArray = Array;",
      parameterWrite: "",
      programReads: 1,
      parameterReads: 1,
    },
    { exposure: "consume(useMemo);", parameterWrite: "", programReads: 0, parameterReads: 0 },
    { exposure: "", parameterWrite: 'label = "changed";', programReads: 0, parameterReads: 1 },
    { exposure: "", parameterWrite: "", programReads: 1, parameterReads: 1 },
  ]) {
    const declarations = Array.from(
      { length: 4 },
      (_, position) => `const letters${position} = useMemo(() => Array.from(label), [label]);`,
    ).join("\n");
    const rows = Array.from(
      { length: 4 },
      (_, position) =>
        `{letters${position}.map((letter, index) => <Glyph key={index} value={letter} />)}`,
    ).join("\n");
    const parsed = parseFixture(`import { useMemo } from "react";
${fixture.exposure}
const Caption = ({ label }: { label: string }) => {
  ${declarations}
  ${fixture.parameterWrite}
  return <>${rows}</>;
};`);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const iteratorCalls: EsTreeNode[] = [];
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "MemberExpression") &&
        getStaticPropertyName(node.callee) === "map"
      )
        iteratorCalls.push(node);
    });
    expect(iteratorCalls).toHaveLength(4);
    const memoSymbol = scopes.rootScope.symbolsByName.get("useMemo");
    const captionScope = scopes.rootScope.children.find((scope) =>
      scope.symbolsByName.has("label"),
    );
    const labelSymbol = captionScope?.symbolsByName.get("label");
    expect(memoSymbol).toBeDefined();
    expect(labelSymbol).toBeDefined();
    if (!memoSymbol || !labelSymbol) throw new Error("Missing fixture bindings");
    const memoReferences = memoSymbol.references;
    const parameterReferences = labelSymbol.references;
    let programReads = 0;
    let memoReferenceReads = 0;
    let parameterReferenceReads = 0;
    Object.defineProperty(scopes.rootScope, "node", {
      get: () => {
        programReads += 1;
        return parsed.program;
      },
    });
    Object.defineProperty(memoSymbol, "references", {
      get: () => {
        memoReferenceReads += 1;
        return memoReferences;
      },
    });
    Object.defineProperty(labelSymbol, "references", {
      get: () => {
        parameterReferenceReads += 1;
        return parameterReferences;
      },
    });
    for (const iteratorCall of iteratorCalls) {
      const source = getClosedMemoArrayFromSource(iteratorCall, scopes);
      expect(source === null).toBe(Boolean(fixture.exposure || fixture.parameterWrite));
      expect(getClosedMemoArrayFromSource(iteratorCall, scopes)).toBe(source);
    }
    expect(programReads).toBe(fixture.programReads);
    expect(memoReferenceReads).toBe(1);
    expect(parameterReferenceReads).toBe(fixture.parameterReads);
  }
});
