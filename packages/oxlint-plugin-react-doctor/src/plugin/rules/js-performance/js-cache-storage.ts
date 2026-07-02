import { STORAGE_OBJECTS } from "../../constants/dom.js";
import { DUPLICATE_STORAGE_READ_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const ARRAY_ITERATION_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "filter",
  "reduce",
  "some",
  "every",
]);

// An inline callback passed to an array-iteration member call runs once per
// element of a single invocation of the ENCLOSING function, so its storage
// reads multiply the enclosing function's reads rather than starting a new
// independent tally.
const isInlineIterationCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (parent.arguments?.[0] !== functionNode) return false;
  const callee = parent.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    ARRAY_ITERATION_CALLBACK_METHOD_NAMES.has(callee.property.name)
  );
};

export const jsCacheStorage = defineRule({
  id: "js-cache-storage",
  title: "Repeated localStorage reads",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Read `localStorage`/`sessionStorage` once and reuse the value. Every read has to parse the data again, which is slow",
  create: (context: RuleContext) => {
    // Each function gets its own read tally so reads of the same key in
    // unrelated functions aren't summed into a phantom duplicate. The base
    // map covers module-scope reads outside any function.
    const storageReadCountStack: Array<Map<string, number>> = [new Map()];
    const enterFunctionScope = (node: EsTreeNode): void => {
      if (isInlineIterationCallback(node)) return;
      storageReadCountStack.push(new Map());
    };
    const exitFunctionScope = (node: EsTreeNode): void => {
      if (isInlineIterationCallback(node)) return;
      if (storageReadCountStack.length > 1) storageReadCountStack.pop();
    };

    return {
      FunctionDeclaration: enterFunctionScope,
      "FunctionDeclaration:exit": exitFunctionScope,
      FunctionExpression: enterFunctionScope,
      "FunctionExpression:exit": exitFunctionScope,
      ArrowFunctionExpression: enterFunctionScope,
      "ArrowFunctionExpression:exit": exitFunctionScope,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isMemberProperty(node.callee, "getItem")) return;
        if (
          !isNodeOfType(node.callee.object, "Identifier") ||
          !STORAGE_OBJECTS.has(node.callee.object.name)
        )
          return;
        if (!isNodeOfType(node.arguments?.[0], "Literal")) return;

        const storageReadCounts = storageReadCountStack[storageReadCountStack.length - 1];
        const storageKey = String(node.arguments[0].value);
        const readCount = (storageReadCounts.get(storageKey) ?? 0) + 1;
        storageReadCounts.set(storageKey, readCount);

        if (readCount === DUPLICATE_STORAGE_READ_THRESHOLD) {
          const storageName = node.callee.object.name;
          context.report({
            node,
            message: `This is slow because ${storageName}.getItem("${storageKey}") runs several times & re-parses the data each call, so read it once & reuse the value`,
          });
        }
      },
    };
  },
});
