import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface ThreeRendererConstruction {
  bindingIdentifier: EsTreeNode;
  key: string;
  node: EsTreeNode;
}

const DOM_ATTACHMENT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "append",
  "appendChild",
  "insertBefore",
  "prepend",
  "replaceChildren",
]);

const isRendererDomElement = (
  node: EsTreeNode,
  rendererKey: string,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(node);
  return Boolean(
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyName(candidate) === "domElement" &&
    resolveExpressionKey(candidate.object, context) === rendererKey,
  );
};

const rendererHasEscapedDomElement = (
  construction: ThreeRendererConstruction,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(construction.bindingIdentifier);
  if (!symbol) return true;
  for (const reference of symbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const member = referenceRoot.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
      return true;
    }
    if (getStaticPropertyName(member) !== "domElement") continue;
    const parent = member.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === member) {
      continue;
    }
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.some((argument) => argument === member)
    ) {
      const callee = parent.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        DOM_ATTACHMENT_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
      ) {
        continue;
      }
      return true;
    }
    return true;
  }
  return false;
};

export const threeRequireRendererDomAttachment = defineRule({
  id: "three-require-renderer-dom-attachment",
  title: "Three.js renderer canvas is never attached to the DOM",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Pass an existing canvas to WebGLRenderer or attach renderer.domElement before presenting the scene",
  create: (context: RuleContext) => {
    const attachedRendererKeys = new Set<string>();
    const renderedRendererKeys = new Set<string>();
    const rendererConstructions: ThreeRendererConstruction[] = [];
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
        const symbol = context.scopes.symbolFor(declarator.id);
        const key = resolveExpressionKey(declarator.id, context);
        if (symbol?.kind === "const" && key) {
          rendererConstructions.push({ bindingIdentifier: declarator.id, key, node });
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (isNodeOfType(callee, "MemberExpression")) {
          const methodName = getStaticPropertyName(callee);
          if (
            methodName === "render" &&
            getThreeConstructorName(callee.object, context.scopes) === "WebGLRenderer"
          ) {
            const rendererKey = resolveExpressionKey(callee.object, context);
            if (rendererKey) renderedRendererKeys.add(rendererKey);
          }
          if (methodName && DOM_ATTACHMENT_METHOD_NAMES.has(methodName)) {
            for (const argument of node.arguments) {
              if (isNodeOfType(argument, "SpreadElement")) continue;
              for (const construction of rendererConstructions) {
                if (isRendererDomElement(argument, construction.key, context)) {
                  attachedRendererKeys.add(construction.key);
                }
              }
            }
          }
        }
      },
      "Program:exit"() {
        for (const construction of rendererConstructions) {
          if (
            !renderedRendererKeys.has(construction.key) ||
            attachedRendererKeys.has(construction.key) ||
            rendererHasEscapedDomElement(construction, context)
          ) {
            continue;
          }
          context.report({
            node: construction.node,
            message:
              "This WebGLRenderer renders frames but its generated domElement is never attached. Pass a mounted canvas to the constructor or append the renderer canvas to a DOM container",
          });
        }
      },
    };
  },
});
