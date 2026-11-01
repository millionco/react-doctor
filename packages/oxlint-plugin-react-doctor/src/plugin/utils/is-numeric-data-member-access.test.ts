import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNumericDataMemberAccess } from "./is-numeric-data-member-access.js";
import { walkAst } from "./walk-ast.js";
import {
  NUMERIC_DATA_LARGE_READ_COUNT,
  NUMERIC_DATA_SMALL_READ_COUNT,
} from "../constants/thresholds.js";

const traversalWork = vi.hoisted(() => ({ programWalkCount: 0 }));

vi.mock("./walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("./walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
      if (node.type === "Program") traversalWork.programWalkCount += 1;
      originalModule.walkAst(node, visitor);
    },
  };
});

const prepare = (code: string) => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const members: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "MemberExpression") && node.computed) members.push(node);
  });
  expect(members.length).toBeGreaterThan(0);
  return { program: parsed.program, members, scopes: analyzeScopes(parsed.program) };
};

const source = "const getKey=()=>Number(input);const value=items[getKey()]-1;";

describe("numeric data stable facts lifetime", () => {
  it("indexes exported bindings once across distinct numeric helper functions", () => {
    const programWalkCounts = [NUMERIC_DATA_SMALL_READ_COUNT, NUMERIC_DATA_LARGE_READ_COUNT].map(
      (helperCount) => {
        const fixture = prepare(
          Array.from(
            { length: helperCount },
            (_, helperIndex) =>
              `const getKey${helperIndex}=()=>Number(input);const value${helperIndex}=items[getKey${helperIndex}()]-1;`,
          ).join("\n"),
        );
        traversalWork.programWalkCount = 0;
        expect(
          fixture.members.map((member) => isNumericDataMemberAccess(member, fixture.scopes)),
        ).toEqual(fixture.members.map(() => true));
        return traversalWork.programWalkCount;
      },
    );
    expect(programWalkCounts[0]).toBeGreaterThan(0);
    expect(programWalkCounts[1]).toBe(programWalkCounts[0]);
  });

  it.each([
    "const getKey=()=>Number(input);export {getKey};const value=items[getKey()]-1;",
    "const getKey=()=>Number(input);export default getKey;const value=items[getKey()]-1;",
  ])("declines exported numeric helpers: %s", (code) => {
    const fixture = prepare(code);
    expect(
      fixture.members.map((member) => isNumericDataMemberAccess(member, fixture.scopes)),
    ).toEqual(fixture.members.map(() => false));
  });

  it("reuses facts only within the exact analysis and Program", () => {
    const fixture = prepare(source);
    traversalWork.programWalkCount = 0;
    expect(
      fixture.members.map((member) => isNumericDataMemberAccess(member, fixture.scopes)),
    ).toEqual([true]);
    const coldWalks = traversalWork.programWalkCount;
    expect(coldWalks).toBeGreaterThan(0);
    traversalWork.programWalkCount = 0;
    expect(
      fixture.members.map((member) => isNumericDataMemberAccess(member, fixture.scopes)),
    ).toEqual([true]);
    expect(traversalWork.programWalkCount).toBe(0);
    const freshScopes = analyzeScopes(fixture.program);
    traversalWork.programWalkCount = 0;
    expect(fixture.members.map((member) => isNumericDataMemberAccess(member, freshScopes))).toEqual(
      [true],
    );
    expect(traversalWork.programWalkCount).toBe(coldWalks);
    const changed = prepare(`Number=identity;${source}`);
    expect(
      changed.members.map((member) => isNumericDataMemberAccess(member, changed.scopes)),
    ).toEqual([false]);
    const fresh = prepare(source);
    expect(fresh.members.map((member) => isNumericDataMemberAccess(member, fresh.scopes))).toEqual([
      true,
    ]);
  });

  it.each([
    "const getKey=()=>key;const before=items[getKey()]-1;const key=Number(input);const after=items[getKey()]-1;",
    "function getKey(){return other()} function other(){return getKey()} const value=items[getKey()]-1;",
  ])("keeps evaluation-position and visiting refusals uncached: %s", (code) => {
    const fixture = prepare(code);
    const expected = fixture.members.map(() => false);
    for (const members of [fixture.members, [...fixture.members].reverse(), fixture.members])
      expect(members.map((member) => isNumericDataMemberAccess(member, fixture.scopes))).toEqual(
        expected,
      );
  });
});
