import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import {
  NEXT_NOT_FOUND_PROOF_GUARD_COUNT,
  NEXT_NOT_FOUND_PROOF_READS_PER_ALIAS_COUNT,
} from "../../../../test-utils/next-not-found-proof/constants.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import * as astWalk from "../../../utils/walk-ast.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "../no-array-find-result-member-access-without-guard.js";

const aliasStatements = Array.from(
  { length: NEXT_NOT_FOUND_PROOF_GUARD_COUNT },
  (_entry, aliasIndex) => `
    const found${aliasIndex} = rows.find((row) => row.id === "item-${aliasIndex}");
    ${Array.from(
      { length: NEXT_NOT_FOUND_PROOF_READS_PER_ALIAS_COUNT },
      () => `consume(found${aliasIndex}.label);`,
    ).join("\n")}
  `,
).join("\n");

const expectedAliasReadCount =
  NEXT_NOT_FOUND_PROOF_GUARD_COUNT * NEXT_NOT_FOUND_PROOF_READS_PER_ALIAS_COUNT;

const cases = [
  {
    name: "caches owners without dynamic code across many aliases and reads",
    source: `function render(rows) { ${aliasStatements} }`,
    expectedDiagnosticCount: expectedAliasReadCount,
    expectedOwnerWalkCount: 1,
  },
  {
    name: "also caches rejected owners with a genuine global eval reference",
    source: `function render(rows) { void eval; ${aliasStatements} }`,
    expectedDiagnosticCount: 0,
    expectedOwnerWalkCount: 1,
  },
  {
    name: "does not mistake an eval property for a global reference",
    source: `function render(rows) { void rows.eval; ${aliasStatements} }`,
    expectedDiagnosticCount: expectedAliasReadCount,
    expectedOwnerWalkCount: 1,
  },
  {
    name: "keeps accepted and rejected owner proofs independent in one analysis",
    source: `function renderFirst(rows) { void eval; ${aliasStatements} }
             function renderSecond(rows) { void rows.eval; ${aliasStatements} }`,
    expectedDiagnosticCount: expectedAliasReadCount,
    expectedOwnerWalkCount: 2,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("find-result alias owner proof work bounds", () => {
  it.each(cases)("$name", ({ source, expectedDiagnosticCount, expectedOwnerWalkCount }) => {
    const ownerWalks = vi.spyOn(astWalk, "walkAst");
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
    expect(
      ownerWalks.mock.calls.filter(
        ([node]) =>
          isNodeOfType(node, "FunctionDeclaration") &&
          node.id &&
          isNodeOfType(node.id, "Identifier") &&
          node.id.name.startsWith("render"),
      ),
    ).toHaveLength(expectedOwnerWalkCount);
  });
});
