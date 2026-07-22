import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isCpuTypedArray } from "../../utils/is-cpu-typed-array.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isWebglContextReference } from "../../utils/is-webgl-context-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { WEBGL_READ_PIXELS_DESTINATION_ARGUMENT_INDEX } from "../webgl/constants.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const CANVAS_2D_CONTEXT_NAMES = new Set(["2d"]);

const isContextFromGetContext = (
  expression: EsTreeNode,
  contextNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isContextFromGetContext(symbol.initializer, contextNames, scopes, visitedSymbolIds);
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    !isNodeOfType(candidate.callee, "MemberExpression") ||
    getStaticPropertyName(candidate.callee) !== "getContext"
  ) {
    return false;
  }
  const contextName = candidate.arguments[0];
  if (!contextName || isNodeOfType(contextName, "SpreadElement")) return false;
  const staticContextName = stripParenExpression(contextName);
  return Boolean(
    isNodeOfType(staticContextName, "Literal") &&
    typeof staticContextName.value === "string" &&
    contextNames.has(staticContextName.value),
  );
};

const getReadbackKind = (
  node: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  context: RuleContext,
): "canvas" | "three" | "webgl" | null => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(node.callee);
  if (
    methodName === "readRenderTargetPixels" &&
    (isR3fCallbackStateProperty(node.callee.object, callback, "gl", context.scopes) ||
      isR3fCallbackStateProperty(node.callee.object, callback, "renderer", context.scopes))
  ) {
    return "three";
  }
  if (
    methodName === "getImageData" &&
    isContextFromGetContext(node.callee.object, CANVAS_2D_CONTEXT_NAMES, context.scopes)
  ) {
    return "canvas";
  }
  if (methodName === "readPixels" && isWebglContextReference(node.callee.object, context.scopes)) {
    const destination = node.arguments[WEBGL_READ_PIXELS_DESTINATION_ARGUMENT_INDEX];
    return destination &&
      !isNodeOfType(destination, "SpreadElement") &&
      isCpuTypedArray(destination, context.scopes)
      ? "webgl"
      : null;
  }
  return null;
};

export const r3fNoSyncReadbackInUseFrame = defineRule({
  id: "r3f-no-sync-readback-in-use-frame",
  title: "Synchronous readback inside useFrame",
  severity: "warn",
  recommendation:
    "Move readback to a discrete or serialized async path and reuse the latest completed result during frames",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!callback) return;
      walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
        if (!isNodeOfType(candidate, "CallExpression")) return;
        const readbackKind = getReadbackKind(candidate, callback, context);
        if (!readbackKind) return;
        if (isConditionallyExecuted) return;
        context.report({
          node: candidate,
          message:
            readbackKind === "canvas"
              ? "getImageData copies pixels to the CPU on every frame. Sample on demand or at a lower rate"
              : "Synchronous GPU readback can stall the frame until prior GPU work completes. Use an asynchronous or event-driven readback path",
        });
      });
    },
  }),
});
