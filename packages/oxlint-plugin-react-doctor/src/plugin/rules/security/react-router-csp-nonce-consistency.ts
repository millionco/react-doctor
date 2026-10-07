import { defineRule } from "../../utils/define-rule.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierRootSymbol } from "../../utils/resolve-const-identifier-root-symbol.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const SERVER_RENDER_EXPORT_NAMES = new Set(["renderToPipeableStream", "renderToReadableStream"]);

interface ServerRouterNonce {
  nonce: EsTreeNode | null;
}

const getJsxNonceExpression = (node: EsTreeNodeOfType<"JSXOpeningElement">): EsTreeNode | null => {
  const nonceAttribute = hasJsxProp(node.attributes ?? [], "nonce");
  if (!nonceAttribute) return null;
  if (isNodeOfType(nonceAttribute.value, "Literal")) return nonceAttribute.value;
  if (!isNodeOfType(nonceAttribute.value, "JSXExpressionContainer")) return null;
  return isNodeOfType(nonceAttribute.value.expression, "JSXEmptyExpression")
    ? null
    : nonceAttribute.value.expression;
};

const getStreamNonceExpression = (node: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
  const options = node.arguments?.[1];
  if (!isNodeOfType(options, "ObjectExpression")) return null;
  for (const property of options.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property, { allowComputedString: true }) === "nonce") {
      return property.value;
    }
  }
  return null;
};

const findServerRouterNonce = (
  context: RuleContext,
  renderRoot: EsTreeNode | null | undefined,
): ServerRouterNonce | null => {
  if (!renderRoot) return null;
  const serverRouters: ServerRouterNonce[] = [];
  walkAst(renderRoot, (descendant) => {
    if (!isNodeOfType(descendant, "JSXOpeningElement")) return;
    if (!isNodeOfType(descendant.name, "JSXIdentifier")) return;
    if (
      getImportedNameFromReactRouter(context, descendant.name, descendant.name.name) !==
      "ServerRouter"
    ) {
      return;
    }
    serverRouters.push({ nonce: getJsxNonceExpression(descendant) });
  });
  return serverRouters.length === 1 ? serverRouters[0] : null;
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
    create: (context: RuleContext) => ({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (context.scopes.symbolFor(node.callee)?.kind !== "import") return;
        const importedName = getImportedNameFromModule(
          node.callee,
          node.callee.name,
          "react-dom/server",
        );
        if (importedName === null || !SERVER_RENDER_EXPORT_NAMES.has(importedName)) return;
        const serverRouter = findServerRouterNonce(context, node.arguments?.[0]);
        if (serverRouter === null) return;
        const streamNonce = getStreamNonceExpression(node);
        if (serverRouter.nonce === null && streamNonce === null) return;
        const sameNonce = areExpressionsStructurallyEqual(serverRouter.nonce, streamNonce, {
          areIdentifiersEqual: (firstIdentifier, secondIdentifier) => {
            const firstSymbol = resolveConstIdentifierRootSymbol(firstIdentifier, context.scopes);
            return (
              firstSymbol !== null &&
              firstSymbol === resolveConstIdentifierRootSymbol(secondIdentifier, context.scopes)
            );
          },
        });
        if (sameNonce) return;
        context.report({
          node,
          message: "ServerRouter and the React stream do not receive the same CSP nonce.",
        });
      },
    }),
  }),
);
