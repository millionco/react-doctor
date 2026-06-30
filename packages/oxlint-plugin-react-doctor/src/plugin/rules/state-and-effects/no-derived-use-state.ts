import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isSetterCalledDuringRender } from "./utils/is-setter-called-during-render.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

type IsPropNameFn = (name: string, referenceNode?: EsTreeNode) => boolean;

const getStateSetterName = (
  useStateCall: EsTreeNodeOfType<"CallExpression">
): string | null => {
  const declarator = useStateCall.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const setterElement = declarator.id.elements?.[1];
  if (!isNodeOfType(setterElement, "Identifier")) return null;
  return setterElement.name;
};

const getEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isPropDerivedArgument = (
  argument: EsTreeNode | null | undefined,
  isPropName: IsPropNameFn
): boolean => {
  if (!argument) return false;
  if (isNodeOfType(argument, "Identifier"))
    return isPropName(argument.name, argument);
  if (isNodeOfType(argument, "MemberExpression")) {
    const rootIdentifierName = getRootIdentifierName(argument);
    return (
      rootIdentifierName !== null && isPropName(rootIdentifierName, argument)
    );
  }
  return false;
};

// An editable draft buffer re-seeds itself from the prop inside an event
// handler (e.g. `edit = () => setTitle(props.title)` on entering rename
// mode) and commits via a callback — the prop stays the source of truth for
// display, so `useState(prop)` holds intentional decoupled user-edit text,
// not a stale mirror. The re-seed must live in a NESTED handler: a re-seed in
// the render body is the adjust-state-during-render pattern, and a re-seed in
// an effect is the genuine prop mirror — neither is a draft, so the effect
// subtree is skipped and render-body setter calls are ignored.
const isReseededDraftBuffer = (
  useStateCall: EsTreeNodeOfType<"CallExpression">,
  isPropName: IsPropNameFn
): boolean => {
  const setterName = getStateSetterName(useStateCall);
  if (!setterName) return false;
  const componentFunction = getEnclosingFunction(useStateCall);
  if (!componentFunction) return false;

  let isReseeded = false;
  walkAst(componentFunction, (child) => {
    if (isReseeded) return false;
    if (isHookCall(child, EFFECT_HOOK_NAMES)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName &&
      isPropDerivedArgument(child.arguments?.[0], isPropName) &&
      getEnclosingFunction(child) !== componentFunction
    ) {
      isReseeded = true;
      return false;
    }
  });
  return isReseeded;
};

// The "store information from previous renders" pattern seeds `useState`
// from a prop and re-syncs it during render (`if (prop !== prev)
// setPrev(prop)`), so the value is never stale — it tracks the prop every
// render. React endorses this over a mirroring effect, so it must not be
// reported as a stale copy.
const isAdjustedDuringRender = (
  useStateCall: EsTreeNodeOfType<"CallExpression">
): boolean => {
  const setterName = getStateSetterName(useStateCall);
  if (!setterName) return false;
  const componentFunction = getEnclosingFunction(useStateCall);
  if (!componentFunction) return false;
  return isSetterCalledDuringRender(componentFunction, setterName);
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
          if (isReseededDraftBuffer(node, propStackTracker.isPropName)) return;
          if (isAdjustedDuringRender(node)) return;
          context.report({
            node,
            message: `Your users see a stale value when prop "${initializer.name}" changes because useState copies it once.`,
          });
          return;
        }

        if (
          isNodeOfType(initializer, "MemberExpression") &&
          !initializer.computed
        ) {
          const rootIdentifierName = getRootIdentifierName(initializer);
          if (
            rootIdentifierName &&
            propStackTracker.isPropName(rootIdentifierName)
          ) {
            // Last property name in `props.initialValue` style chains
            // — if that's an initial-only name, skip too.
            if (
              isNodeOfType(initializer.property, "Identifier") &&
              isInitialOnlyPropName(initializer.property.name)
            ) {
              return;
            }
            if (isReseededDraftBuffer(node, propStackTracker.isPropName))
              return;
            if (isAdjustedDuringRender(node)) return;
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
