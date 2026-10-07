import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAwaitedCallExpression } from "../../utils/is-awaited-call-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isWebGpuRendererExpression } from "./utils/is-inside-r3f-webgpu-canvas.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const callbackReturnsWebGpuRenderer = (callback: EsTreeNode, context: RuleContext): boolean =>
  functionReturnsMatchingExpression(
    callback,
    context.scopes,
    (expression) => isWebGpuRendererExpression(expression, context),
    context.cfg,
    "some",
  );

const hasDominatingAwaitedInitialization = (
  callback: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(callback) || !callback.async) return false;
  const returnStarts = isNodeOfType(callback.body, "BlockStatement")
    ? collectFunctionReturnStatements(callback).map((returnStatement) => returnStatement.range[0])
    : [callback.body.range[0]];
  let hasInitialization = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (
      hasInitialization ||
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      getStaticPropertyName(candidate.callee) !== "init" ||
      getThreeConstructorName(candidate.callee.object, context.scopes) !== "WebGPURenderer" ||
      !isAwaitedCallExpression(candidate) ||
      isNodeConditionallyExecuted(candidate, callback) ||
      returnStarts.some((returnStart) => returnStart < candidate.range[0])
    ) {
      return;
    }
    hasInitialization = true;
  });
  return hasInitialization;
};

export const r3fWebgpuRequireAsyncInit = defineRule({
  id: "r3f-webgpu-require-async-init",
  title: "R3F WebGPU factory skips asynchronous initialization",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Make the Canvas gl factory async and await renderer.init() before returning it",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        getApiReferenceModuleSource(node.name, "Canvas", context.scopes) !== "@react-three/fiber"
      ) {
        return;
      }
      const glAttribute = getAuthoritativeJsxAttribute(node.attributes, "gl");
      if (
        !glAttribute?.value ||
        !isNodeOfType(glAttribute.value, "JSXExpressionContainer") ||
        isNodeOfType(glAttribute.value.expression, "JSXEmptyExpression")
      ) {
        return;
      }
      const callback = resolveLocalReactCallback(glAttribute.value.expression, context.scopes);
      if (
        !callback ||
        !callbackReturnsWebGpuRenderer(callback, context) ||
        hasDominatingAwaitedInitialization(callback, context)
      ) {
        return;
      }
      context.report({
        node: glAttribute,
        message:
          "This Canvas factory returns WebGPURenderer without an unconditional awaited init() call, so R3F can receive an uninitialized backend",
      });
    },
  }),
});
