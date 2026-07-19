import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { functionReturnsMatchingExpression } from "../../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { getApiReferenceModuleSource } from "./get-api-reference-module-source.js";
import { R3F_PUBLIC_MODULES } from "./r3f-public-modules.js";
import { R3F_WEBGPU_MODULES } from "./r3f-webgpu-modules.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";

const isWebGpuRendererExpression = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  const provenance = getApiReferenceProvenance(candidate.callee, context.scopes);
  return Boolean(
    provenance?.apiName === "WebGPURenderer" &&
    (provenance.moduleSource === "three" || provenance.moduleSource.startsWith("three/")),
  );
};

const canvasCreatesWebGpuRenderer = (canvas: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(canvas, "JSXElement")) return false;
  const glAttribute = getAuthoritativeJsxAttribute(canvas.openingElement.attributes, "gl");
  if (
    !glAttribute?.value ||
    !isNodeOfType(glAttribute.value, "JSXExpressionContainer") ||
    isNodeOfType(glAttribute.value.expression, "JSXEmptyExpression")
  ) {
    return false;
  }
  const glExpression = stripParenExpression(glAttribute.value.expression);
  if (isWebGpuRendererExpression(glExpression, context)) return true;
  const rendererFactory = resolveLocalReactCallback(glExpression, context.scopes);
  return Boolean(
    isFunctionLike(rendererFactory) &&
    functionReturnsMatchingExpression(
      rendererFactory,
      context.scopes,
      (returnedExpression) => isWebGpuRendererExpression(returnedExpression, context),
      context.cfg,
      "every",
    ),
  );
};

export const isR3fWebgpuCanvasElement = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "JSXElement")) return false;
  const moduleSource = getApiReferenceModuleSource(
    node.openingElement.name,
    "Canvas",
    context.scopes,
  );
  if (!moduleSource || !R3F_PUBLIC_MODULES.has(moduleSource)) return false;
  return R3F_WEBGPU_MODULES.has(moduleSource) || canvasCreatesWebGpuRenderer(node, context);
};

export const isInsideR3fWebgpuCanvas = (node: EsTreeNode, context: RuleContext): boolean => {
  let current = node.parent ?? null;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      const moduleSource = getApiReferenceModuleSource(
        current.openingElement.name,
        "Canvas",
        context.scopes,
      );
      if (moduleSource && R3F_PUBLIC_MODULES.has(moduleSource))
        return isR3fWebgpuCanvasElement(current, context);
    }
    current = current.parent ?? null;
  }
  return false;
};
