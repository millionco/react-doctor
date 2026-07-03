import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

type IsPropNameFn = (name: string, referenceNode?: EsTreeNode) => boolean;

const getStateSetterName = (useStateCall: EsTreeNodeOfType<"CallExpression">): string | null => {
  const declarator = useStateCall.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const setterElement = declarator.id.elements?.[1];
  if (!isNodeOfType(setterElement, "Identifier")) return null;
  return setterElement.name;
};

const isPropDerivedArgument = (
  argument: EsTreeNode | null | undefined,
  isPropName: IsPropNameFn,
): boolean => {
  if (!argument) return false;
  if (isNodeOfType(argument, "Identifier")) return isPropName(argument.name, argument);
  if (isNodeOfType(argument, "MemberExpression")) {
    const rootIdentifierName = getRootIdentifierName(argument);
    return rootIdentifierName !== null && isPropName(rootIdentifierName, argument);
  }
  return false;
};

const isNonHandlerHookCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent ?? null;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!(parent.arguments ?? []).some((argument) => argument === functionNode)) return false;
  const calleeName = getCalleeName(parent);
  return calleeName !== null && isReactHookName(calleeName) && calleeName !== "useCallback";
};

// A re-seed only counts when every function between the setter call and the
// component is handler-shaped: a plain nested function or a `useCallback`
// callback. Any other hook callback — `useEffect`, `useMemo`, or a custom
// effect wrapper like `useUpdateEffect` — is a genuine prop mirror, not a
// user-triggered draft reset.
const isHandlerShapedReseed = (setterCall: EsTreeNode, componentFunction: EsTreeNode): boolean => {
  let hasNestedFunction = false;
  let cursor: EsTreeNode | null = setterCall.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor)) {
      hasNestedFunction = true;
      if (isNonHandlerHookCallback(cursor)) return false;
    }
    cursor = cursor.parent ?? null;
  }
  return hasNestedFunction;
};

// True when no function boundary sits between `node` and the component —
// i.e. the call runs during render, not inside a nested handler/callback.
const isInRenderScope = (node: EsTreeNode, componentFunction: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor && cursor !== componentFunction) {
    if (isFunctionLike(cursor)) return false;
    cursor = cursor.parent ?? null;
  }
  return true;
};

// Two exemptions, one walk (they look for the same prop-derived setter call
// and differ only in where it sits):
//   - Draft buffer: the re-seed lives in a NESTED handler (e.g.
//     `edit = () => setTitle(props.title)` on entering rename mode) and
//     commits via a callback — the prop stays the source of truth, so
//     `useState(prop)` holds intentional decoupled user-edit text, not a
//     stale mirror. A re-seed in an effect or memo is a genuine mirror.
//   - Adjust-during-render: the "store information from previous renders"
//     pattern re-syncs during render (`if (prop !== prev) setPrev(prop)`), so
//     the value is never stale. React endorses this over a mirroring effect.
//     The render-phase call must pass a prop-derived argument: a render-phase
//     reset to an unrelated constant leaves the stale copy and keeps the report.
const isDraftReseedOrRenderAdjusted = (
  useStateCall: EsTreeNodeOfType<"CallExpression">,
  isPropName: IsPropNameFn,
): boolean => {
  const setterName = getStateSetterName(useStateCall);
  if (!setterName) return false;
  const componentFunction = findEnclosingFunction(useStateCall);
  if (!componentFunction) return false;

  let isExempt = false;
  walkAst(componentFunction, (child) => {
    if (isExempt) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName &&
      isPropDerivedArgument(child.arguments?.[0], isPropName) &&
      (isHandlerShapedReseed(child, componentFunction) || isInRenderScope(child, componentFunction))
    ) {
      isExempt = true;
      return false;
    }
  });
  return isExempt;
};

export const noDerivedUseState = defineRule({
  id: "no-derived-useState",
  title: "Prop derived into useState",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Compute the value inline so prop changes do not leave `useState` holding a stale copy.",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, "useState") || !node.arguments?.length) return;
        const initializer = node.arguments[0];

        if (
          isNodeOfType(initializer, "Identifier") &&
          propStackTracker.isPropName(initializer.name)
        ) {
          if (isInitialOnlyPropName(initializer.name)) return;
          if (isDraftReseedOrRenderAdjusted(node, propStackTracker.isPropName)) return;
          context.report({
            node,
            message: `Your users see a stale value when prop "${initializer.name}" changes because useState copies it once.`,
          });
          return;
        }

        if (isNodeOfType(initializer, "MemberExpression") && !initializer.computed) {
          const rootIdentifierName = getRootIdentifierName(initializer);
          if (rootIdentifierName && propStackTracker.isPropName(rootIdentifierName)) {
            // Last property name in `props.initialValue` style chains
            // — if that's an initial-only name, skip too.
            if (
              isNodeOfType(initializer.property, "Identifier") &&
              isInitialOnlyPropName(initializer.property.name)
            ) {
              return;
            }
            if (isDraftReseedOrRenderAdjusted(node, propStackTracker.isPropName)) return;
            context.report({
              node,
              message: `Your users see a stale value when prop "${rootIdentifierName}" changes because useState copies it once.`,
            });
          }
        }
      },
    };
  },
});
