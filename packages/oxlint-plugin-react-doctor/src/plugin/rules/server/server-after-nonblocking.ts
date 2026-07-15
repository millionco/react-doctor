import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: a (object, method) pair counts as "deferrable side effect" when
// it either (a) is a synchronous `console.log/info/warn` (still cheap,
// but the historical behavior of this rule and a real concern when many
// log lines pile up), or (b) is a known analytics/telemetry SDK method
// that genuinely costs a network round trip and IS worth wrapping in
// `after()` so it doesn't delay the user-visible response. Add provider
// names to the analytics object set as new SDKs come up.
const CONSOLE_DEFERRABLE_METHODS = new Set(["log", "info", "warn"]);

const ANALYTICS_DEFERRABLE_OBJECTS = new Set([
  "analytics",
  "posthog",
  "mixpanel",
  "segment",
  "amplitude",
  "datadog",
  "sentry",
]);

const ANALYTICS_DEFERRABLE_METHODS = new Set([
  "track",
  "identify",
  "page",
  "capture",
  "captureMessage",
  "captureException",
  "log",
]);

const isDeferrableSideEffectCall = (objectName: string, methodName: string): boolean => {
  if (objectName === "console") return CONSOLE_DEFERRABLE_METHODS.has(methodName);
  if (ANALYTICS_DEFERRABLE_OBJECTS.has(objectName)) {
    return ANALYTICS_DEFERRABLE_METHODS.has(methodName);
  }
  return false;
};

const isInsideAfterCallback = (
  node: EsTreeNode,
  afterImportNames: Set<string>,
): boolean => {
  if (afterImportNames.size === 0) return false;
  
  let cursor: EsTreeNode | null | undefined = node.parent;
  
  while (cursor) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression")
    ) {
      const parentNode = cursor.parent;
      if (isNodeOfType(parentNode, "CallExpression")) {
        const callee = stripParenExpression(parentNode.callee);
        if (isNodeOfType(callee, "Identifier")) {
          if (afterImportNames.has(callee.name)) {
            return true;
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  
  return false;
};

export const serverAfterNonblocking = defineRule({
  id: "server-after-nonblocking",
  title: "Blocking side effect before response",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "`import { after } from 'next/server'`, then wrap it: `after(() => analytics.track(...))`. The response sends right away.",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;
    let serverFunctionDepth = 0;
    const afterImportNames = new Set<string>();

    const enterIfServerFunction = (node: EsTreeNode): void => {
      if (hasUseServerDirective(node)) serverFunctionDepth++;
    };
    const leaveIfServerFunction = (node: EsTreeNode): void => {
      if (hasUseServerDirective(node)) serverFunctionDepth = Math.max(0, serverFunctionDepth - 1);
    };

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.source?.value !== "next/server") return;
        
        for (const specifier of node.specifiers ?? []) {
          if (
            isNodeOfType(specifier, "ImportSpecifier") &&
            isNodeOfType(specifier.imported, "Identifier") &&
            (specifier.imported.name === "after" || specifier.imported.name === "unstable_after")
          ) {
            const localName = isNodeOfType(specifier.local, "Identifier")
              ? specifier.local.name
              : specifier.imported.name;
            afterImportNames.add(localName);
          }
        }
      },
      FunctionDeclaration: enterIfServerFunction,
      "FunctionDeclaration:exit": leaveIfServerFunction,
      FunctionExpression: enterIfServerFunction,
      "FunctionExpression:exit": leaveIfServerFunction,
      ArrowFunctionExpression: enterIfServerFunction,
      "ArrowFunctionExpression:exit": leaveIfServerFunction,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!fileHasUseServerDirective && serverFunctionDepth === 0) return;
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(node.callee.property, "Identifier")) return;

        const receiver = stripParenExpression(node.callee.object);
        const objectName = isNodeOfType(receiver, "Identifier") ? receiver.name : null;
        if (!objectName) return;

        const methodName = node.callee.property.name;
        if (!isDeferrableSideEffectCall(objectName, methodName)) return;

        if (isInsideAfterCallback(node, afterImportNames)) return;

        context.report({
          node,
          message: `${objectName}.${methodName}() runs before the response, so your users wait longer for it.`,
        });
      },
    };
  },
});
