import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EFFECT_PRIMITIVES: ReadonlyArray<string> = [
  "createEffect",
  "createRenderEffect",
  "createComputed",
];

const TIMER_METHODS = new Set(["setInterval", "setTimeout"]);
const SUBSCRIPTION_METHODS = new Set(["addEventListener", "subscribe", "observe"]);
const CLEANUP_PRIMITIVES: ReadonlyArray<string> = ["onCleanup"];

interface ResourceUsage {
  kind: "timer" | "subscription";
  name: string;
  node: EsTreeNode;
}

const findResourceUsages = (callback: EsTreeNode): ReadonlyArray<ResourceUsage> => {
  const usages: ResourceUsage[] = [];
  walkAst(callback, (node) => {
    if (isFunctionLike(node) && node !== callback) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (isNodeOfType(node.callee, "Identifier") && TIMER_METHODS.has(node.callee.name)) {
      usages.push({ kind: "timer", name: node.callee.name, node });
    }
    if (
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.property, "Identifier") &&
      SUBSCRIPTION_METHODS.has(node.callee.property.name)
    ) {
      usages.push({ kind: "subscription", name: node.callee.property.name, node });
    }
  });
  return usages;
};

const containsCleanupCall = (
  callback: EsTreeNode,
  cleanupLocalNames: ReadonlySet<string>,
): boolean => {
  let found = false;
  walkAst(callback, (node) => {
    if (found) return false;
    if (isFunctionLike(node) && node !== callback) return false;
    if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "Identifier")) {
      if (cleanupLocalNames.has(node.callee.name)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

export const solidRequireCleanup = defineRule<Rule>({
  id: "solid-require-cleanup",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Use `onCleanup` to release timers, listeners, and subscriptions created inside effects — without cleanup they leak on every re-run.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    const cleanupLocalNames = new Set<string>();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
        const source = node.source?.value;
        if (typeof source !== "string" || !/^solid-js/.test(source)) return;
        for (const specifier of node.specifiers) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          const importedIdentifier = specifier.imported;
          if (!isNodeOfType(importedIdentifier, "Identifier")) continue;
          if (CLEANUP_PRIMITIVES.includes(importedIdentifier.name)) {
            cleanupLocalNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedImport = importTracker.matchImport(EFFECT_PRIMITIVES, node.callee.name);
        if (!matchedImport) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0];
        if (!isFunctionLike(callback)) return;
        const usages = findResourceUsages(callback);
        if (usages.length === 0) return;
        if (containsCleanupCall(callback, cleanupLocalNames)) return;
        const firstUsage = usages[0];
        const releaseHint =
          firstUsage.kind === "timer"
            ? `clear${firstUsage.name === "setInterval" ? "Interval" : "Timeout"}(...)`
            : `the matching remove/unsubscribe call`;
        context.report({
          node,
          message: `This \`${matchedImport}\` uses \`${firstUsage.name}(...)\` but never calls \`onCleanup\` — the registration leaks on every re-run. Add \`onCleanup(() => ${releaseHint})\`.`,
        });
      },
    };
  },
});
