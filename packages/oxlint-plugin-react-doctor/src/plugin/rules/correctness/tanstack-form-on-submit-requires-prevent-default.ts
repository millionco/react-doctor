import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const TANSTACK_FORM_MODULE = "@tanstack/react-form";
const TANSTACK_FORM_HOOK_NAMES: ReadonlySet<string> = new Set(["useForm"]);
const CONTROL_FLOW_NODE_TYPES: ReadonlySet<string> = new Set([
  "ConditionalExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LogicalExpression",
  "ReturnStatement",
  "SwitchStatement",
  "SwitchCase",
  "ThrowStatement",
  "TryStatement",
  "WhileStatement",
]);

const isTanstackFormHookCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const reference = resolveImportedApiReference(expression.callee, context.scopes);
  return Boolean(
    reference?.source === TANSTACK_FORM_MODULE &&
    reference.importedName &&
    TANSTACK_FORM_HOOK_NAMES.has(reference.importedName),
  );
};

const isTanstackFormInstance = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  if (isTanstackFormHookCall(expression, context)) return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.initializer &&
    isTanstackFormHookCall(symbol.initializer, context),
  );
};

const isTanstackHandleSubmitReference = (
  rawExpression: EsTreeNode,
  context: RuleContext,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  return (
    isNodeOfType(expression, "MemberExpression") &&
    getStaticPropertyName(expression) === "handleSubmit" &&
    isTanstackFormInstance(expression.object, context)
  );
};

interface SubmitHandlerScan {
  callsHandleSubmit: boolean;
  definitelyPreventsDefault: boolean;
}

const functionDefinitelyPreventsDefault = (
  handlerFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(handlerFunction)) return false;
  const eventParameter = handlerFunction.params?.[0];
  if (!eventParameter || !isNodeOfType(eventParameter, "Identifier")) return false;
  const eventSymbol = context.scopes.symbolFor(eventParameter);
  if (!eventSymbol) return false;
  let foundPrevention = false;
  let hasControlFlow = false;
  walkAst(handlerFunction.body, (node) => {
    if (node !== handlerFunction.body && isFunctionLike(node)) return false;
    if (CONTROL_FLOW_NODE_TYPES.has(node.type)) hasControlFlow = true;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "preventDefault"
    ) {
      const receiver = stripParenExpression(callee.object);
      if (
        isNodeOfType(receiver, "Identifier") &&
        context.scopes.referenceFor(receiver)?.resolvedSymbol?.id === eventSymbol.id
      ) {
        foundPrevention = true;
      }
    }
  });
  return foundPrevention && !hasControlFlow;
};

const scanSubmitHandler = (
  handlerFunction: EsTreeNode,
  context: RuleContext,
): SubmitHandlerScan => {
  const scan: SubmitHandlerScan = {
    callsHandleSubmit: false,
    definitelyPreventsDefault: functionDefinitelyPreventsDefault(handlerFunction, context),
  };
  if (!isFunctionLike(handlerFunction)) return scan;
  walkAst(handlerFunction.body, (node) => {
    if (node !== handlerFunction.body && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "CallExpression") &&
      isTanstackHandleSubmitReference(node.callee, context)
    ) {
      scan.callsHandleSubmit = true;
    }
  });
  return scan;
};

export const tanstackFormOnSubmitRequiresPreventDefault = defineRule({
  id: "tanstack-form-on-submit-requires-prevent-default",
  title: "Form submit reloads the page around handleSubmit",
  severity: "warn",
  category: "Correctness",
  requires: ["tanstack-form"],
  matchByOccurrence: true,
  recommendation:
    "Wrap the submit handler as onSubmit={(event) => { event.preventDefault(); form.handleSubmit(); }} because TanStack Form's handleSubmit never cancels the native submit itself.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "form") return;
      const onSubmitAttribute = findJsxAttribute(node.attributes, "onSubmit");
      if (
        !onSubmitAttribute?.value ||
        !isNodeOfType(onSubmitAttribute.value, "JSXExpressionContainer")
      ) {
        return;
      }
      const handler = stripParenExpression(onSubmitAttribute.value.expression);
      const isBareHandleSubmitReference = isTanstackHandleSubmitReference(handler, context);
      let firesUnpreventedSubmit = isBareHandleSubmitReference;
      if (!firesUnpreventedSubmit) {
        const handlerFunction = resolveExactLocalFunction(handler, context.scopes);
        if (handlerFunction) {
          const scan = scanSubmitHandler(handlerFunction, context);
          firesUnpreventedSubmit = scan.callsHandleSubmit && !scan.definitelyPreventsDefault;
        }
      }
      if (!firesUnpreventedSubmit) return;
      context.report({
        node: onSubmitAttribute,
        message:
          "This submit handler calls the form's handleSubmit without event.preventDefault(), so the browser still performs a native full-page form submission and the app reloads mid-submit. Call event.preventDefault() before handleSubmit().",
      });
    },
  }),
});
