import { INLINE_STYLE_PROPERTY_THRESHOLD } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";

const MEMOIZED_REACT_CALLBACK_NAMES = new Set(["useMemo", "useState"]);

// Only properties whose values are compile-time constants can move to a CSS
// class — values computed from props/state (floating-ui coordinates, editor
// font sizes, conditional cursors) must stay inline, so they don't count
// toward the "move this to CSS" threshold.
const isStaticStyleValue = (value: EsTreeNode): boolean => {
  if (isNodeOfType(value, "Literal")) return true;
  if (isNodeOfType(value, "TemplateLiteral")) return value.expressions.length === 0;
  if (isNodeOfType(value, "UnaryExpression")) {
    return value.operator === "-" && isNodeOfType(value.argument, "Literal");
  }
  return false;
};

const isStaticStyleProperty = (property: EsTreeNode): boolean => {
  if (!isNodeOfType(property, "Property")) return false;
  if (property.computed) return false;
  return isStaticStyleValue(property.value);
};

const isReactClassRenderFunction = (functionNode: EsTreeNode): boolean => {
  const methodDefinition = functionNode.parent;
  if (
    !isNodeOfType(methodDefinition, "MethodDefinition") ||
    methodDefinition.value !== functionNode ||
    methodDefinition.kind !== "method" ||
    methodDefinition.static === true ||
    !isNodeOfType(methodDefinition.key, "Identifier") ||
    methodDefinition.key.name !== "render"
  ) {
    return false;
  }
  const classBody = methodDefinition.parent;
  return Boolean(
    classBody &&
    isNodeOfType(classBody, "ClassBody") &&
    classBody.parent &&
    isEs6Component(classBody.parent),
  );
};

const isInsideMemoizedReactCallback = (node: EsTreeNode, context: RuleContext): boolean => {
  let functionNode = findEnclosingFunction(node);
  while (functionNode) {
    const callExpression = functionNode.parent;
    if (
      isNodeOfType(callExpression, "CallExpression") &&
      callExpression.arguments?.[0] === functionNode &&
      isReactApiCall(callExpression, MEMOIZED_REACT_CALLBACK_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
      })
    ) {
      return true;
    }
    functionNode = findEnclosingFunction(functionNode);
  }
  return false;
};

const isInsideReactClassRenderPath = (node: EsTreeNode, context: RuleContext): boolean => {
  let functionNode = findEnclosingFunction(node);
  while (functionNode) {
    if (isReactClassRenderFunction(functionNode)) return true;
    if (!executesDuringRender(functionNode, context.scopes)) return false;
    functionNode = findEnclosingFunction(functionNode);
  }
  return false;
};

const isRebuiltDuringRender = (node: EsTreeNode, context: RuleContext): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction) return false;
  if (isInsideMemoizedReactCallback(node, context)) return false;
  return Boolean(
    findRenderPhaseComponentOrHook(node, context.scopes) ||
    isInsideReactClassRenderPath(node, context),
  );
};

export const noInlineExhaustiveStyle = defineRule({
  id: "no-inline-exhaustive-style",
  title: "Large inline style object rebuilds every render",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Move the styles to a CSS class, CSS module, Tailwind utilities, or a styled component. Big inline objects are hard to read and rebuild on every update.",
  create: (context: RuleContext): RuleVisitors => {
    if (isGeneratedImageRenderContext(context)) return {};

    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const expression = getInlineStyleExpression(node);
        if (!expression) return;
        if (!isRebuiltDuringRender(expression, context)) return;

        const propertyCount = expression.properties?.filter(isStaticStyleProperty).length ?? 0;

        if (propertyCount < INLINE_STYLE_PROPERTY_THRESHOLD) return;

        // Satori (next/og, @vercel/og) rasterizes this JSX to a static image,
        // so its exhaustive inline styles never rebuild on render — the rule's
        // premise doesn't hold. The walker marks the parent opening element.
        if (isGeneratedImageRenderContext(context, node.parent ?? undefined)) return;

        context.report({
          node: expression,
          message: `This inline style has ${propertyCount} properties, which is hard to read & rebuilds every render. Move it to a CSS class, CSS module, or styled component.`,
        });
      },
    };
  },
});
