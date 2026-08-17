import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const TANSTACK_FORM_MODULES = ["@tanstack/react-form"];

const isStaticMethodCall = (expression: EsTreeNode, methodName: string): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isNodeOfType(expression.callee, "MemberExpression") &&
  !expression.callee.computed &&
  isNodeOfType(expression.callee.property, "Identifier") &&
  expression.callee.property.name === methodName;

interface SubmitHandlerScan {
  callsHandleSubmit: boolean;
  callsPreventDefault: boolean;
}

const scanInlineSubmitHandler = (handlerFunction: EsTreeNode): SubmitHandlerScan => {
  const scan: SubmitHandlerScan = { callsHandleSubmit: false, callsPreventDefault: false };
  walkAst(handlerFunction, (node) => {
    if (isStaticMethodCall(node, "handleSubmit")) scan.callsHandleSubmit = true;
    if (isStaticMethodCall(node, "preventDefault")) scan.callsPreventDefault = true;
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
    "Wrap the submit handler: onSubmit={(event) => { event.preventDefault(); form.handleSubmit(); }} — TanStack Form's handleSubmit never cancels the native submit itself.",
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
      // `onSubmit={form.handleSubmit}` hands React the bare method — the
      // event is treated as submit meta, the default is never prevented,
      // and the browser performs a full-page form submission.
      const isBareHandleSubmitReference =
        isNodeOfType(handler, "MemberExpression") &&
        !handler.computed &&
        isNodeOfType(handler.property, "Identifier") &&
        handler.property.name === "handleSubmit";
      let firesUnpreventedSubmit = isBareHandleSubmitReference;
      if (
        !firesUnpreventedSubmit &&
        (isNodeOfType(handler, "ArrowFunctionExpression") ||
          isNodeOfType(handler, "FunctionExpression"))
      ) {
        const scan = scanInlineSubmitHandler(handler);
        firesUnpreventedSubmit = scan.callsHandleSubmit && !scan.callsPreventDefault;
      }
      if (!firesUnpreventedSubmit) return;
      if (!hasImportFromModules(node, TANSTACK_FORM_MODULES)) return;
      context.report({
        node: onSubmitAttribute,
        message:
          "This submit handler calls the form's handleSubmit without event.preventDefault(), so the browser still performs a native full-page form submission and the app reloads mid-submit. Call event.preventDefault() before handleSubmit().",
      });
    },
  }),
});
