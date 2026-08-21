import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isThreeRendererReference } from "./utils/is-three-renderer-reference.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const THREE_COMPILE_METHOD_NAMES: ReadonlySet<string> = new Set(["compile", "compileAsync"]);

const isInsideAdvancingSwitchStage = (node: EsTreeNode): boolean => {
  let switchCase: EsTreeNode | null = null;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "SwitchCase")) {
      switchCase = ancestor;
      break;
    }
    ancestor = ancestor.parent;
  }
  const switchStatement = switchCase?.parent;
  if (!switchStatement || !isNodeOfType(switchStatement, "SwitchStatement")) return false;
  if (!isNodeOfType(switchStatement.discriminant, "Identifier")) return false;
  const stageName = switchStatement.discriminant.name;
  const block = switchStatement.parent;
  if (!block || !isNodeOfType(block, "BlockStatement")) return false;
  const switchIndex = block.body.findIndex((statement) => statement === switchStatement);
  if (switchIndex === -1) return false;
  let advancesStage = false;
  for (const statement of block.body.slice(switchIndex + 1)) {
    walkAst(statement, (candidate) => {
      if (advancesStage) return false;
      if (
        isNodeOfType(candidate, "UpdateExpression") &&
        isNodeOfType(candidate.argument, "Identifier") &&
        candidate.argument.name === stageName
      ) {
        advancesStage = true;
        return false;
      }
      if (
        isNodeOfType(candidate, "AssignmentExpression") &&
        candidate.operator !== "=" &&
        isNodeOfType(candidate.left, "Identifier") &&
        candidate.left.name === stageName
      ) {
        advancesStage = true;
        return false;
      }
    });
    if (advancesStage) return true;
  }
  return false;
};

export const threeNoCompileInAnimationLoop = defineRule({
  id: "three-no-compile-in-animation-loop",
  title: "Three.js shader precompilation inside animation loop",
  category: "Performance",
  severity: "error",
  recommendation:
    "Precompile scene materials outside the animation loop before they are first displayed",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "MemberExpression") ||
            !THREE_COMPILE_METHOD_NAMES.has(getStaticPropertyName(candidate.callee) ?? "") ||
            !isThreeRendererReference(candidate.callee.object, context.scopes) ||
            isInsideAdvancingSwitchStage(candidate)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "Renderer shader precompilation runs inside the animation loop. Compile once before display instead of rechecking the scene every frame",
          });
        });
      },
    };
  },
});
