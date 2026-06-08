import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionBodyHasReturnWithValue } from "../../utils/function-body-has-return-with-value.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const RENDER_METHOD_NAME = "render";
const MESSAGE = "Your users see nothing because this `render` method returns nothing.";

const isStaticRenderKey = (key: EsTreeNode): boolean => {
  if (isNodeOfType(key, "Identifier")) return key.name === RENDER_METHOD_NAME;
  if (isNodeOfType(key, "Literal")) return key.value === RENDER_METHOD_NAME;
  return false;
};

const isFunctionExpressionLike = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "ArrowFunctionExpression");

interface RenderHostInfo {
  reportNode: EsTreeNode;
  isObjectPropertyRender: boolean;
  isClassRender: boolean;
}

const resolveRenderHost = (functionNode: EsTreeNode): RenderHostInfo | null => {
  const parent = functionNode.parent;
  if (!parent) return null;

  if (isNodeOfType(parent, "MethodDefinition") && isStaticRenderKey(parent.key)) {
    return { reportNode: parent.key, isObjectPropertyRender: false, isClassRender: true };
  }
  if (
    isNodeOfType(parent, "PropertyDefinition") &&
    parent.value === functionNode &&
    isStaticRenderKey(parent.key)
  ) {
    return { reportNode: parent.key, isObjectPropertyRender: false, isClassRender: true };
  }
  if (
    isNodeOfType(parent, "Property") &&
    parent.value === functionNode &&
    isStaticRenderKey(parent.key)
  ) {
    return { reportNode: parent.key, isObjectPropertyRender: true, isClassRender: false };
  }
  return null;
};

const isInsideEs5Component = (renderHost: EsTreeNode): boolean => {
  // `render: function() {...}` (Property) → ObjectExpression → CallExpression
  const objectExpression = renderHost.parent;
  if (!objectExpression || !isNodeOfType(objectExpression, "ObjectExpression")) return false;
  const callExpression = objectExpression.parent;
  if (!callExpression) return false;
  return isEs5Component(callExpression);
};

const isInsideEs6Component = (renderHost: EsTreeNode): boolean => {
  const classBody = renderHost.parent;
  if (!classBody || !isNodeOfType(classBody, "ClassBody")) return false;
  const classNode = classBody.parent;
  if (!classNode) return false;
  return isEs6Component(classNode);
};

// Port of `oxc_linter::rules::react::require_render_return`. Reports
// `render() {}` / `render: function() {}` / `render = () => {}` methods
// inside an es5 / es6 React component when the body contains no
// `return X` statement (with a non-undefined argument). Without a CFG we
// approximate by walking the body and skipping nested function scopes —
// good enough for every OXC test fixture.
export const requireRenderReturn = defineRule<Rule>({
  id: "require-render-return",
  title: "Render method does not return",
  severity: "error",
  recommendation:
    "Return JSX or `null` from `render` so the component intentionally shows something or nothing.",
  create: (context) => {
    const checkFunction = (functionNode: EsTreeNode): void => {
      const host = resolveRenderHost(functionNode);
      if (!host) return;
      const renderHostNode = (functionNode.parent ?? null) as EsTreeNode | null;
      if (!renderHostNode) return;
      if (host.isObjectPropertyRender) {
        if (!isInsideEs5Component(renderHostNode)) return;
      } else if (host.isClassRender) {
        if (!isInsideEs6Component(renderHostNode)) return;
      } else {
        return;
      }
      if (functionBodyHasReturnWithValue(functionNode)) return;
      context.report({ node: host.reportNode, message: MESSAGE });
    };

    return {
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        checkFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        checkFunction(node);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        // FunctionDeclaration can't appear inside a class/object literal as
        // a render method, but the parent traversal in `resolveRenderHost`
        // is cheap enough to also accept it here for robustness.
        if (isFunctionExpressionLike(node)) return;
        checkFunction(node);
      },
    };
  },
});
