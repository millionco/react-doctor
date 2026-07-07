import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

const USE_EFFECT_ONLY = new Set(["useEffect"]);

// A setter fed by a `.current` read is the post-mount DOM-measurement
// pattern (header widths, element rects) — there is no pre-hydration value
// to render, so useSyncExternalStore is not an available alternative.
const argumentsReadRefCurrent = (callArguments: EsTreeNode[]): boolean =>
  callArguments.some((argument) => {
    let readsCurrent = false;
    walkAst(argument, (child) => {
      if (
        isNodeOfType(child, "MemberExpression") &&
        isNodeOfType(child.property, "Identifier") &&
        child.property.name === "current"
      ) {
        readsCurrent = true;
      }
    });
    return readsCurrent;
  });

const findPairedStateName = (setterCall: EsTreeNode, setterName: string): string | null => {
  let cursor: EsTreeNode | null | undefined = setterCall;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          if (!isHookCall(declarator.init, "useState")) continue;
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const elements = declarator.id.elements ?? [];
          const setterElement = elements[1];
          const stateElement = elements[0];
          if (
            isNodeOfType(setterElement, "Identifier") &&
            setterElement.name === setterName &&
            isNodeOfType(stateElement, "Identifier")
          ) {
            return stateElement.name;
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isInsideIdOrAriaAttribute = (identifier: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      return (
        isNodeOfType(cursor.name, "JSXIdentifier") &&
        (cursor.name.name === "id" || cursor.name.name.startsWith("aria-"))
      );
    }
    if (isNodeOfType(cursor, "JSXElement") || isNodeOfType(cursor, "JSXFragment")) return false;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// State that only feeds `id` / `aria-*` attributes (generated description
// ids for aria wiring) changes nothing users can see — no flicker.
const isStateUsedOnlyInIdOrAriaAttributes = (
  setterCall: EsTreeNode,
  setterName: string,
): boolean => {
  const stateName = findPairedStateName(setterCall, setterName);
  if (!stateName) return false;
  const programRoot = findProgramRoot(setterCall);
  if (!programRoot) return false;
  let referenceCount = 0;
  let nonAriaReferenceFound = false;
  walkAst(programRoot, (node) => {
    if (!isNodeOfType(node, "Identifier") || node.name !== stateName) return;
    const parent = node.parent;
    if (
      parent &&
      (isNodeOfType(parent, "ArrayPattern") ||
        (isNodeOfType(parent, "MemberExpression") && parent.property === node))
    ) {
      return;
    }
    referenceCount += 1;
    if (!isInsideIdOrAriaAttribute(node)) nonAriaReferenceFound = true;
  });
  return referenceCount > 0 && !nonAriaReferenceFound;
};

export const renderingHydrationNoFlicker = defineRule({
  id: "rendering-hydration-no-flicker",
  title: "useEffect setState flashes on mount",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` or add `suppressHydrationWarning` to the element",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      // useLayoutEffect runs synchronously BEFORE paint, so a mount-time
      // setState there never flashes — it's the canonical DOM-measurement
      // pattern (react.dev "you might not need an effect"). Only the
      // post-paint useEffect variant can flicker.
      if (!isHookCall(node, USE_EFFECT_ONLY) || (node.arguments?.length ?? 0) < 2) return;

      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || depsNode.elements?.length !== 0) return;

      const callback = getEffectCallback(node);
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      )
        return;

      const bodyStatements = isNodeOfType(callback.body, "BlockStatement")
        ? callback.body.body
        : [callback.body];
      if (!bodyStatements || bodyStatements.length !== 1) return;

      const soleStatement = bodyStatements[0];
      if (!isNodeOfType(soleStatement, "ExpressionStatement")) return;
      const expression = soleStatement.expression;
      if (
        isSetterCall(expression) &&
        isNodeOfType(expression, "CallExpression") &&
        isNodeOfType(expression.callee, "Identifier") &&
        isUseStateSetterInScope(expression, expression.callee.name)
      ) {
        if (argumentsReadRefCurrent(expression.arguments ?? [])) return;
        if (isStateUsedOnlyInIdOrAriaAttributes(expression, expression.callee.name)) return;
        context.report({
          node,
          message:
            "This flashes for your users because useEffect(setState, []) runs after the first paint, so use useSyncExternalStore, or add suppressHydrationWarning",
        });
      }
    },
  }),
});
