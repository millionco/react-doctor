import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const SIGNAL_CREATORS: ReadonlyArray<string> = ["createSignal"];

const getRootObject = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (isNodeOfType(current, "MemberExpression")) {
    current = current.object as EsTreeNode;
  }
  return current;
};

const findEnclosingFunction = (node: EsTreeNode) => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
};

const isRenderPropCallback = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  return isNodeOfType(parent, "JSXExpressionContainer");
};

const formatMemberExpression = (node: EsTreeNodeOfType<"MemberExpression">): string => {
  const object = node.object as EsTreeNode;
  const property = node.property;
  const objectText = isNodeOfType(object, "MemberExpression")
    ? formatMemberExpression(object)
    : isNodeOfType(object, "Identifier")
      ? object.name
      : "…";
  const propertyText = isNodeOfType(property, "Identifier") ? property.name : "…";
  return `${objectText}.${propertyText}`;
};

export const solidNoSignalFromProp = defineRule<Rule>({
  id: "solid-no-signal-from-prop",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Don't initialize a signal from a prop value — the prop is read once and the signal never updates when the parent re-renders. Use a memo or derived computation instead.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedImport = importTracker.matchImport(SIGNAL_CREATORS, node.callee.name);
        if (!matchedImport) return;
        if (node.arguments.length < 1) return;

        const firstArgument = node.arguments[0];
        if (!isNodeOfType(firstArgument, "MemberExpression")) return;

        const rootObject = getRootObject(firstArgument);
        if (!isNodeOfType(rootObject, "Identifier")) return;

        const enclosingFunction = findEnclosingFunction(node);
        if (!enclosingFunction) return;
        if (isRenderPropCallback(enclosingFunction)) return;
        if (enclosingFunction.params.length < 1) return;

        const firstParameter = enclosingFunction.params[0];
        if (!isNodeOfType(firstParameter, "Identifier")) return;
        if (firstParameter.name !== rootObject.name) return;
        if (!containsJsxElement(enclosingFunction as EsTreeNode)) return;

        const propAccessText = formatMemberExpression(firstArgument);
        context.report({
          node,
          message: `Initializing a signal with \`${propAccessText}\` reads the prop once — the signal won't update when the parent re-renders. Use a memo or derived computation instead.`,
        });
      },
    };
  },
});
