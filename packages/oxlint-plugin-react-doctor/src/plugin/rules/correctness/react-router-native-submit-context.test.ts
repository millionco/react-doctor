import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isClosedNativeSubmitNavigation } from "./utils/is-closed-native-submit-navigation.js";

describe("closed native submit source context", () => {
  for (const firstPlain of [true, false]) {
    it(`retains text boundaries with ${firstPlain ? "plain source" : "missing source"} first`, () => {
      const source =
        "import{useNavigate}from'react-router-dom';export const Screen=()=>{const navigate=useNavigate();const SAVE_RECORD=()=>navigate('/next');const onSubmit=(event:{preventDefault():void})=>{event.preventDefault();SAVE_RECORD()};return <form onSubmit={onSubmit}/>};";
      const parsed = parseFixture(source);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const cfg = analyzeControlFlow(parsed.program);
      const calls: EsTreeNodeOfType<"CallExpression">[] = [];
      const declarations: EsTreeNodeOfType<"VariableDeclarator">[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "navigate"
        )
          calls.push(node);
        if (
          isNodeOfType(node, "VariableDeclarator") &&
          isNodeOfType(node.id, "Identifier") &&
          node.id.name === "navigate"
        )
          declarations.push(node);
      });
      const call = calls[0];
      const declaration = declarations[0];
      if (!call || !declaration) throw new Error("Expected navigation call and declaration");
      const contexts: ReadonlyArray<RuleContext> = [
        {
          scopes,
          cfg,
          sourceCode: { ast: parsed.program, getText: () => source },
          report: () => {},
        },
        {
          scopes,
          cfg,
          sourceCode: { ast: parsed.program, getText: () => "/** @jsx custom */\n" + source },
          report: () => {},
        },
        { scopes, cfg, report: () => {} },
      ];
      const plain = contexts[0];
      const pragma = contexts[1];
      const missing = contexts[2];
      if (!plain || !pragma || !missing) throw new Error("Expected source contexts");
      const sequence = firstPlain
        ? [plain, pragma, missing, plain, pragma, missing]
        : [missing, pragma, plain, missing, plain, pragma];
      expect(
        sequence.map((context) => isClosedNativeSubmitNavigation(call, declaration, context)),
      ).toEqual(
        firstPlain
          ? [true, false, false, true, false, false]
          : [false, false, true, false, true, false],
      );
      let currentSource = source;
      let receiverCalls = 0;
      const sourceCode = {
        ast: parsed.program,
        getText() {
          expect(this).toBe(sourceCode);
          receiverCalls += 1;
          return currentSource;
        },
      };
      const mutableContext = { scopes, cfg, sourceCode, report: () => {} };
      const expected = firstPlain ? [true, false, true, false] : [false, true, false, true];
      expect(
        expected.map((isPlain) => {
          currentSource = isPlain ? source : "/** @jsx custom */\n" + source;
          return isClosedNativeSubmitNavigation(call, declaration, mutableContext);
        }),
      ).toEqual(expected);
      expect(receiverCalls).toBe(expected.length);
    });
  }
});
