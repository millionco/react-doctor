import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

interface ReadonlyBindingTargetCase {
  name: string;
  code: string;
  expected: boolean;
}

const cases: readonly ReadonlyBindingTargetCase[] = [
  { name: "destructured binding target", code: "({ value: selected } = source);", expected: true },
  { name: "computed pattern key read", code: "({ [selected]: value } = source);", expected: false },
  { name: "computed member index read", code: "record[selected] = value;", expected: false },
];

describe("mutation target proof for readonly binding references", () => {
  for (const targetCase of cases) {
    it(targetCase.name, () => {
      const parsed = parseFixture(targetCase.code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const classifications: boolean[] = [];
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "Identifier") && node.name === "selected") {
          classifications.push(isMemberMutationTarget(node));
        }
      });
      expect(classifications.length).toBeGreaterThan(0);
      expect(classifications.every((actual) => actual === targetCase.expected)).toBe(true);
    });
  }
});
