import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface UnsizedThreeRendererConstruction {
  bindingIdentifier: EsTreeNodeOfType<"Identifier">;
  key: string;
  node: EsTreeNodeOfType<"NewExpression">;
}

const THREE_RENDERER_SIZE_METHOD_NAMES: ReadonlySet<string> = new Set([
  "setDrawingBufferSize",
  "setSize",
]);
const CANVAS_DIMENSION_PROPERTY_NAMES: ReadonlySet<string> = new Set(["height", "width"]);

const isRendererDomElement = (
  expression: EsTreeNode,
  rendererKey: string,
  context: RuleContext,
): boolean =>
  Boolean(
    isNodeOfType(expression, "MemberExpression") &&
    getStaticPropertyName(expression) === "domElement" &&
    resolveExpressionKey(expression.object, context) === rendererKey,
  );

const rendererEscapesModule = (
  construction: UnsizedThreeRendererConstruction,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(construction.bindingIdentifier);
  if (!symbol) return true;
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    return !isNodeOfType(parent, "MemberExpression") || parent.object !== referenceRoot;
  });
};

export const threeRequireRendererSize = defineRule({
  id: "three-require-renderer-size",
  title: "Three.js renderer drawing buffer is never sized",
  category: "Correctness",
  severity: "warn",
  recommendation: "Set the WebGLRenderer drawing-buffer size before rendering a generated canvas",
  create: (context: RuleContext) => {
    const constructions: UnsizedThreeRendererConstruction[] = [];
    const renderedRendererKeys = new Set<string>();
    const sizedRendererKeys = new Set<string>();
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (getThreeConstructorName(node, context.scopes) !== "WebGLRenderer") return;
        const parameters = node.arguments[0];
        if (
          parameters &&
          (isNodeOfType(parameters, "SpreadElement") ||
            !isNodeOfType(parameters, "ObjectExpression") ||
            parameters.properties.some((property) => isNodeOfType(property, "SpreadElement")) ||
            getStaticObjectPropertyValue(parameters, "canvas"))
        ) {
          return;
        }
        const declarator = node.parent;
        if (
          !isNodeOfType(declarator, "VariableDeclarator") ||
          declarator.init !== node ||
          !isNodeOfType(declarator.id, "Identifier")
        ) {
          return;
        }
        const key = resolveExpressionKey(declarator.id, context);
        const symbol = context.scopes.symbolFor(declarator.id);
        if (key && symbol?.kind === "const") {
          constructions.push({ bindingIdentifier: declarator.id, key, node });
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const methodName = getStaticPropertyName(node.callee);
        const rendererKey = resolveExpressionKey(node.callee.object, context);
        if (!methodName || !rendererKey) return;
        if (
          methodName === "render" &&
          getThreeConstructorName(node.callee.object, context.scopes) === "WebGLRenderer"
        ) {
          renderedRendererKeys.add(rendererKey);
        }
        if (
          THREE_RENDERER_SIZE_METHOD_NAMES.has(methodName) &&
          getThreeConstructorName(node.callee.object, context.scopes) === "WebGLRenderer"
        ) {
          sizedRendererKeys.add(rendererKey);
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (node.operator !== "=" || !isNodeOfType(node.left, "MemberExpression")) return;
        const propertyName = getStaticPropertyName(node.left);
        if (!propertyName || !CANVAS_DIMENSION_PROPERTY_NAMES.has(propertyName)) return;
        for (const construction of constructions) {
          if (isRendererDomElement(node.left.object, construction.key, context)) {
            sizedRendererKeys.add(construction.key);
          }
        }
      },
      "Program:exit"() {
        for (const construction of constructions) {
          if (
            !renderedRendererKeys.has(construction.key) ||
            sizedRendererKeys.has(construction.key) ||
            rendererEscapesModule(construction, context)
          ) {
            continue;
          }
          context.report({
            node: construction.node,
            message:
              "This generated WebGLRenderer canvas is rendered without setSize, setDrawingBufferSize, or explicit canvas dimensions, so it keeps the default drawing-buffer size",
          });
        }
      },
    };
  },
});
