import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const isUseCursorCall = (node: EsTreeNode | null | undefined, scopes: ScopeAnalysis): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "CallExpression") &&
    resolveInkApiName(node.callee, scopes) === "useCursor",
  );

export const inkUseStringWidthForCursor = defineRule({
  id: "ink-use-string-width-for-cursor",
  title: "String length used as terminal column width",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.cursor,
  recommendation:
    "Measure terminal columns with `string-width` before calling `setCursorPosition`.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "setCursorPosition") return;
      const cursorObject = stripParenExpression(node.callee.object);
      const isCursor =
        isUseCursorCall(cursorObject, context.scopes) ||
        (isNodeOfType(cursorObject, "Identifier") &&
          isUseCursorCall(context.scopes.symbolFor(cursorObject)?.initializer, context.scopes));
      if (!isCursor) return;
      const horizontalPosition = node.arguments[0];
      if (
        !isNodeOfType(horizontalPosition, "MemberExpression") ||
        getStaticPropertyName(horizontalPosition) !== "length"
      ) {
        return;
      }
      if (
        isNodeOfType(horizontalPosition.object, "Literal") &&
        typeof horizontalPosition.object.value === "string" &&
        /^[\x20-\x7e]*$/.test(horizontalPosition.object.value)
      ) {
        return;
      }
      context.report({
        node: horizontalPosition,
        message: "JavaScript string length is not a terminal column width for Unicode text.",
      });
    },
  }),
});
