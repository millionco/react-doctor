import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { isPrivateInitializationLatchWrite } from "./utils/is-private-initialization-latch-write.js";

describe("private latch selected write and owner cache boundaries", () => {
  for (const unsafeFirst of [true, false]) {
    it(`retains the opaque branch when visited ${unsafeFirst ? "first" : "last"}`, () => {
      const code =
        'import * as React from "react";export const useSetup=({revision})=>{const [firstLatch,setFirstLatch]=React.useState(true);const [secondLatch,setSecondLatch]=React.useState(true);React.useEffect(()=>{if(firstLatch){setFirstLatch(false);}},[revision]);React.useEffect(()=>{if(secondLatch){inspect();setSecondLatch(false);}},[revision]);};';
      const parsed = parseFixture(code);
      attachParentReferences(parsed.program);
      const writes: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name.startsWith("set")
        )
          writes.push(node);
      });
      const settings = {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
        },
      };
      for (const scopes of [analyzeScopes(parsed.program), analyzeScopes(parsed.program)]) {
        const context = {
          scopes,
          cfg: analyzeControlFlow(parsed.program),
          settings,
          sourceCode: { ast: parsed.program, getText: () => code },
          report: () => {},
        };
        const ordered = unsafeFirst ? [...writes].reverse() : writes;
        expect(ordered.map((write) => isPrivateInitializationLatchWrite(write, context))).toEqual(
          unsafeFirst ? [false, true] : [true, false],
        );
        expect(writes.map((write) => isPrivateInitializationLatchWrite(write, context))).toEqual([
          true,
          false,
        ]);
        expect(
          [...writes].reverse().map((write) => isPrivateInitializationLatchWrite(write, context)),
        ).toEqual([false, true]);
      }
      const actual = runRule(noAdjustStateOnPropChange, code, {
        filename: "/synthetic/private-latch-work/selected.tsx",
        settings,
        includeLocations: true,
      });
      expect(parsed.errors).toEqual([]);
      expect(actual.parseErrors).toEqual([]);
      expect(actual.diagnostics).toHaveLength(1);
    });
  }
});
