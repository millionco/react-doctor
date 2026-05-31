import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getMethodCall,
  getStaticPropertyName,
  getZodNamedImport,
  getZodNamespaceMemberName,
} from "./utils/zod-ast.js";

const DEPRECATED_ZOD_ERROR_MEMBERS = new Set([
  "addIssue",
  "addIssues",
  "errors",
  "flatten",
  "formErrors",
  "format",
]);
const ZOD_ERROR_API_MESSAGE = "Zod 4 dropped this ZodError method, so it breaks when you upgrade.";

const isZodErrorReference = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "Identifier")) return getZodNamedImport(inner) === "ZodError";
  if (!isNodeOfType(inner, "MemberExpression")) return false;
  return getZodNamespaceMemberName(inner) === "ZodError";
};

const isDirectZodErrorValue = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "NewExpression")) return isZodErrorReference(inner.callee as EsTreeNode);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const methodCall = getMethodCall(inner);
  return methodCall?.methodName === "create" && isZodErrorReference(methodCall.receiver);
};

const isDeprecatedZodErrorMemberAccess = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const memberExpression = node;
  const propertyName = getStaticPropertyName(memberExpression);
  return (
    propertyName !== null &&
    DEPRECATED_ZOD_ERROR_MEMBERS.has(propertyName) &&
    isDirectZodErrorValue(memberExpression.object as EsTreeNode)
  );
};

const isZodErrorCreateCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const methodCall = getMethodCall(callExpression);
  return methodCall?.methodName === "create" && isZodErrorReference(methodCall.receiver);
};

const isReceiverOfDeprecatedZodErrorMember = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const parent = callExpression.parent;
  if (!parent || !isNodeOfType(parent, "MemberExpression")) return false;
  if (stripParenExpression(parent.object as EsTreeNode) !== callExpression) return false;
  return isDeprecatedZodErrorMemberAccess(parent);
};

export const zodV4NoDeprecatedErrorApis = defineRule<Rule>({
  id: "zod-v4-no-deprecated-error-apis",
  title: "Deprecated Zod error API",
  requires: ["zod:4"],
  tags: ["migration-hint"],
  severity: "warn",
  recommendation:
    "Use the Zod 4 helpers instead: `z.treeifyError()`, `z.flattenError()`, `z.prettifyError()`, or read `error.issues` directly.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (isZodErrorCreateCall(node) && isReceiverOfDeprecatedZodErrorMember(node)) return;
      if (!isZodErrorCreateCall(node) && !isDeprecatedZodErrorMemberAccess(node.callee)) {
        return;
      }
      context.report({
        node,
        message: ZOD_ERROR_API_MESSAGE,
      });
    },
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const parent = node.parent;
      if (
        parent &&
        isNodeOfType(parent, "CallExpression") &&
        stripParenExpression(parent.callee as EsTreeNode) === node
      ) {
        return;
      }
      if (!isDeprecatedZodErrorMemberAccess(node)) return;
      context.report({
        node,
        message: ZOD_ERROR_API_MESSAGE,
      });
    },
  }),
});
