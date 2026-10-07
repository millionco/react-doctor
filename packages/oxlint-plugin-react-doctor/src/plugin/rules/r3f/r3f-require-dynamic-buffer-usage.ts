import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getNeedsUpdateReceiver } from "./utils/get-needs-update-receiver.js";
import { isDynamicBufferUsageExpression } from "./utils/is-dynamic-buffer-usage-expression.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

interface R3fBufferAttributeRefUsage {
  readonly isDynamic: boolean;
  readonly symbolId: number;
}

const collectBufferAttributeRefUsages = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): ReadonlyMap<number, boolean> => {
  const usages = new Map<number, boolean>();
  walkAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "JSXOpeningElement") || !isR3fHostIntrinsic(candidate)) return;
    const elementType = resolveJsxElementType(candidate);
    if (!elementType?.toLowerCase().endsWith("bufferattribute")) return;
    const refAttribute = getAuthoritativeJsxAttribute(candidate.attributes, "ref");
    if (
      !refAttribute?.value ||
      !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
      !isNodeOfType(refAttribute.value.expression, "Identifier")
    ) {
      return;
    }
    const refSymbol = resolveConstIdentifierAlias(refAttribute.value.expression, context.scopes);
    if (!refSymbol) return;
    const usageAttribute = getAuthoritativeJsxAttribute(candidate.attributes, "usage");
    const isDynamic = Boolean(
      usageAttribute?.value &&
      isNodeOfType(usageAttribute.value, "JSXExpressionContainer") &&
      !isNodeOfType(usageAttribute.value.expression, "JSXEmptyExpression") &&
      isDynamicBufferUsageExpression(usageAttribute.value.expression, context.scopes),
    );
    usages.set(refSymbol.id, isDynamic);
  });
  return usages;
};

const getManagedBufferRefUsage = (
  expression: EsTreeNode,
  usages: ReadonlyMap<number, boolean>,
  context: RuleContext,
): R3fBufferAttributeRefUsage | null => {
  const currentMember = stripParenExpression(expression);
  if (
    !isNodeOfType(currentMember, "MemberExpression") ||
    getStaticPropertyName(currentMember) !== "current"
  ) {
    return null;
  }
  const refExpression = stripParenExpression(currentMember.object);
  if (!isNodeOfType(refExpression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(refExpression, context.scopes);
  return symbol && usages.has(symbol.id)
    ? { isDynamic: usages.get(symbol.id) ?? false, symbolId: symbol.id }
    : null;
};

export const r3fRequireDynamicBufferUsage = defineRule({
  id: "r3f-require-dynamic-buffer-usage",
  title: "R3F per-frame buffer upload keeps static usage",
  category: "Performance",
  severity: "warn",
  recommendation: "Set usage={DynamicDrawUsage} on buffer attributes uploaded from useFrame",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    let bufferRefUsages: ReadonlyMap<number, boolean> = new Map();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        bufferRefUsages = collectBufferAttributeRefUsages(node, context);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (isConditionallyExecuted || !isNodeOfType(candidate, "AssignmentExpression")) return;
          const receiver = getNeedsUpdateReceiver(candidate);
          const usage = receiver
            ? getManagedBufferRefUsage(receiver, bufferRefUsages, context)
            : null;
          if (!usage || usage.isDynamic) return;
          context.report({
            node: candidate,
            message:
              "This R3F BufferAttribute uploads every frame without a dynamic or stream usage prop, so it retains Three.js's StaticDrawUsage strategy",
          });
        });
      },
    };
  },
});
