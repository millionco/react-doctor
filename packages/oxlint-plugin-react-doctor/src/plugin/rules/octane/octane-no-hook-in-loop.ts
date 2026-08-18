import { LOOP_TYPES } from "../../constants/js.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isOctaneModule } from "../../utils/is-octane-module.js";
import { isOctanePackageSource } from "../../utils/is-octane-package-source.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const SLOT_KEYED_HOOK_NAME_PATTERN = /^use[A-Z]/;
const LOOP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  DoWhileStatement: "do…while",
  ForInStatement: "for…in",
  ForOfStatement: "for…of",
  ForStatement: "for",
  WhileStatement: "while",
};

const isImmediatelyCalledFunction = (functionNode: EsTreeNode): boolean => {
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const parent = functionRoot.parent;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === functionRoot) return true;
  if (!isNodeOfType(parent, "MemberExpression") || parent.object !== functionRoot) return false;
  const methodName = getStaticPropertyName(parent);
  const call = parent.parent;
  return Boolean(
    (methodName === "call" || methodName === "apply") &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === parent,
  );
};

const findEnclosingPlainLoopExecution = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let current = node.parent ?? null;
  while (current) {
    if (LOOP_TYPES.includes(current.type)) return current;
    if (
      isFunctionLike(current) &&
      !isImmediatelyCalledFunction(current) &&
      !executesDuringRender(current, scopes)
    ) {
      return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

const getSlotKeyedHookName = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const importedReference = resolveImportedApiReference(call.callee, scopes);
  if (
    importedReference &&
    isOctanePackageSource(importedReference.source) &&
    importedReference.importedName &&
    SLOT_KEYED_HOOK_NAME_PATTERN.test(importedReference.importedName) &&
    importedReference.importedName !== "useContext"
  ) {
    return importedReference.importedName;
  }

  const callee = stripParenExpression(call.callee);
  let hookName: string | null = null;
  if (isNodeOfType(callee, "Identifier")) hookName = callee.name;
  else if (isNodeOfType(callee, "MemberExpression") && !callee.optional) {
    hookName = getStaticPropertyName(callee);
  }
  return hookName && SLOT_KEYED_HOOK_NAME_PATTERN.test(hookName) && hookName !== "useContext"
    ? hookName
    : null;
};

export const octaneNoHookInLoop = defineRule({
  id: "octane-no-hook-in-loop",
  title: "Octane hook called inside a plain loop",
  severity: "error",
  recommendation:
    "Render repeated hook state with Octane's keyed `@for` directive or extract the loop body into a child component.",
  create: (context) => {
    let fileIsOctaneModule = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsOctaneModule = isOctaneModule(node, context.sourceCode?.getText?.() ?? "");
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!fileIsOctaneModule) return;
        const hookName = getSlotKeyedHookName(node, context.scopes);
        if (!hookName) return;
        const loop = findEnclosingPlainLoopExecution(node, context.scopes);
        if (!loop) return;
        const loopDisplayName = LOOP_DISPLAY_NAMES[loop.type] ?? "plain JavaScript";
        context.report({
          node,
          message: `\`${hookName}\` shares one compiler-assigned hook slot across every \`${loopDisplayName}\` iteration. Use a keyed \`@for\` directive or a child component so each item owns its hook state.`,
        });
      },
    };
  },
});
