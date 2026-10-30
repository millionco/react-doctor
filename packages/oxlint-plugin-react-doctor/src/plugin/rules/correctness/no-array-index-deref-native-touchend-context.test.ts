import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNativeTouchendChangedTouchRead } from "./utils/is-native-touchend-changed-touch-read.js";

describe("native touchend source and profile cache boundaries", () => {
  for (const plainFirst of [true, false]) {
    it(`keeps source and profile guards fresh with plain source ${plainFirst ? "first" : "last"}`, () => {
      const code =
        "export const Screen=()=> <div onTouchEnd={event=>console.log(event.changedTouches[0].clientX)}/>;";
      const parsed = parseFixture(code);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const cfg = analyzeControlFlow(parsed.program);
      let coordinate: EsTreeNode | undefined;
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "MemberExpression") &&
          isNodeOfType(node.property, "Identifier") &&
          node.property.name === "clientX"
        )
          coordinate = node;
      });
      if (!coordinate) throw new Error("Expected selected coordinate");
      const selectedCoordinate = coordinate;
      const sequence = plainFirst
        ? ["plain", "pragma", "missing", "react18", "other-framework", "plain"]
        : ["other-framework", "react18", "missing", "pragma", "plain", "plain"];
      let currentSource = code;
      let receiverCalls = 0;
      const sourceCode = {
        ast: parsed.program,
        getText() {
          expect(this).toBe(sourceCode);
          receiverCalls++;
          return currentSource;
        },
      };
      const actual = sequence.map((name) => {
        currentSource = name === "pragma" ? "/** @jsx custom */\n" + code : code;
        return isNativeTouchendChangedTouchRead(selectedCoordinate, {
          scopes,
          cfg,
          settings: {
            "react-doctor": {
              framework: name === "other-framework" ? "vite" : "nextjs",
              capabilities: name === "react18" ? ["nextjs", "react:18"] : ["nextjs", "react:19"],
            },
          },
          ...(name === "missing" ? {} : { sourceCode }),
          report: () => {},
        });
      });
      expect(parsed.errors).toEqual([]);
      expect(actual).toEqual(sequence.map((name) => name === "plain"));
      expect(receiverCalls).toBe(
        sequence.filter((name) => name === "plain" || name === "pragma").length,
      );
    });
  }
});
