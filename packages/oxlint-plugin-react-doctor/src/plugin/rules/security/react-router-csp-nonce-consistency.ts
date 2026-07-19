import { defineRule } from "../../utils/define-rule.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const SERVER_RENDER_EXPORT_NAMES = new Set(["renderToPipeableStream", "renderToReadableStream"]);

const getJsxNonceExpression = (node: EsTreeNodeOfType<"JSXOpeningElement">): EsTreeNode | null => {
  const nonceAttribute = hasJsxProp(node.attributes ?? [], "nonce");
  if (!nonceAttribute || !isNodeOfType(nonceAttribute.value, "JSXExpressionContainer")) return null;
  return isNodeOfType(nonceAttribute.value.expression, "JSXEmptyExpression")
    ? null
    : nonceAttribute.value.expression;
};

export const reactRouterCspNonceConsistency = wrapReactRouterRule(
  defineRule({
    id: "react-router-csp-nonce-consistency",
    title: "CSP nonce is not shared across server rendering",
    tags: ["test-noise"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    category: "Security",
    recommendation:
      "Pass the same request-scoped nonce to ServerRouter and the React server-rendering stream options.",
    create: (context: RuleContext) => {
      let serverRouterNode: EsTreeNode | null = null;
      let serverRouterNonce: EsTreeNode | null = null;
      let streamCallNode: EsTreeNode | null = null;
      let streamNonce: EsTreeNode | null = null;
      return {
        JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
          if (!isNodeOfType(node.name, "JSXIdentifier")) return;
          if (
            getImportedNameFromReactRouter(context, node.name, node.name.name) !== "ServerRouter"
          ) {
            return;
          }
          serverRouterNode = node;
          serverRouterNonce = getJsxNonceExpression(node);
        },
        CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
          if (!isNodeOfType(node.callee, "Identifier")) return;
          if (context.scopes.symbolFor(node.callee)?.kind !== "import") return;
          const importedName = getImportedNameFromModule(
            node.callee,
            node.callee.name,
            "react-dom/server",
          );
          if (importedName === null || !SERVER_RENDER_EXPORT_NAMES.has(importedName)) return;
          streamCallNode = node;
          for (const argument of node.arguments ?? []) {
            if (!isNodeOfType(argument, "ObjectExpression")) continue;
            for (const property of argument.properties ?? []) {
              if (!isNodeOfType(property, "Property")) continue;
              if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== "nonce") {
                continue;
              }
              streamNonce = property.value;
            }
          }
        },
        "Program:exit"() {
          if (serverRouterNode === null || streamCallNode === null) return;
          if (serverRouterNonce === null && streamNonce === null) return;
          const sameNonce = areExpressionsStructurallyEqual(serverRouterNonce, streamNonce, {
            areIdentifiersEqual: (firstIdentifier, secondIdentifier) => {
              const firstSymbol = context.scopes.symbolFor(firstIdentifier);
              return (
                firstSymbol !== null && firstSymbol === context.scopes.symbolFor(secondIdentifier)
              );
            },
          });
          if (sameNonce) return;
          context.report({
            node: streamCallNode,
            message: "ServerRouter and the React stream do not receive the same CSP nonce.",
          });
        },
      };
    },
  }),
);
