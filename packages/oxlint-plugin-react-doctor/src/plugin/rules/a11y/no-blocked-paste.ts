import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { walkAst } from "../../utils/walk-ast.js";

const CONTROL_FLOW_NODE_TYPES: ReadonlySet<string> = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "ReturnStatement",
  "SwitchStatement",
  "SwitchCase",
  "ThrowStatement",
  "TryStatement",
  "WhileStatement",
]);

const findDefinitePastePrevention = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  const eventParameter = functionNode.params?.[0];
  if (!eventParameter || !isNodeOfType(eventParameter, "Identifier")) return null;

  let preventionCall: EsTreeNode | null = null;
  let hasControlFlow = false;
  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (preventionCall) return false;
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (CONTROL_FLOW_NODE_TYPES.has(child.type)) hasControlFlow = true;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "MemberExpression")) return;
    if (!isNodeOfType(child.callee.object, "Identifier")) return;
    if (child.callee.object.name !== eventParameter.name) return;
    if (!isNodeOfType(child.callee.property, "Identifier")) return;
    if (child.callee.property.name !== "preventDefault") return;
    preventionCall = child;
    return false;
  });
  return hasControlFlow ? null : preventionCall;
};

const AUTHENTICATION_AUTOCOMPLETE_TOKENS: ReadonlySet<string> = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "username",
]);

const isAuthenticationInput = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const typeAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "type");
  if (typeAttribute && getJsxPropStringValue(typeAttribute)?.toLowerCase() === "password")
    return true;
  const autocompleteAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "autoComplete");
  const autocompleteValue = autocompleteAttribute
    ? getJsxPropStringValue(autocompleteAttribute)
    : null;
  return Boolean(
    autocompleteValue
      ?.split(/\s+/)
      .some((token) => AUTHENTICATION_AUTOCOMPLETE_TOKENS.has(token.toLowerCase())),
  );
};

export const noBlockedPaste = defineRule({
  id: "no-blocked-paste",
  title: "Paste blocked in an authentication field",
  severity: "error",
  recommendation:
    "Allow paste so people can use password managers, verification codes, assistive tools, and copied text without retyping it.",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "onPaste") return;
      const openingElement = node.parent;
      if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return;
      const elementType = resolveJsxElementType(openingElement);
      if (elementType !== "input" || !isAuthenticationInput(openingElement)) return;
      if (hasJsxSpreadAttribute(openingElement.attributes)) return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;
      const handler = resolveExactLocalFunction(node.value.expression, context.scopes);
      if (!handler) return;
      const preventionCall = findDefinitePastePrevention(handler);
      if (!preventionCall) return;

      context.report({
        node: preventionCall,
        message:
          "This authentication field blocks paste, forcing users to transcribe credentials or verification codes. Remove preventDefault() from the paste handler.",
      });
    },
  }),
});
