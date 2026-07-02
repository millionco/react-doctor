import { defineRule } from "../../utils/define-rule.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SET_STATE_PATTERN = /^set[A-Z]/;

// `setHasScrolled` → `hasScrolled`: the state name the setter mutates.
const setterToStateName = (setterName: string): string => {
  const withoutPrefix = setterName.slice(3);
  return withoutPrefix.charAt(0).toLowerCase() + withoutPrefix.slice(1);
};

const testReadsName = (test: EsTreeNode | null | undefined, name: string): boolean => {
  if (!test) return false;
  let didRead = false;
  walkAst(test, (child: EsTreeNode) => {
    if (didRead) return;
    if (isNodeOfType(child, "Identifier") && child.name === name) didRead = true;
  });
  return didRead;
};

// A set-once latch (`if (!hasScrolled) setHasScrolled(true)`) runs the setter
// at most once — after the first scroll the guard flips the state to a fixed
// CONSTANT and the guard is false forever, so there is no per-frame re-render
// storm. Two conditions must hold: the guard reads the SAME state the setter
// writes (or the ref that latches it,
// `if (!hasScrolledRef.current) { hasScrolledRef.current = true; setHasScrolled(true) }`),
// AND the setter writes a literal constant (`true`/`false`/a number). A guard
// on a different value (`if (offset > 100) setShowShadow(true)`) or a setter
// that writes a CHANGING value (`if (offset !== last) setLast(offset)`) can
// still fire every frame, so it stays reported. A both-branch TOGGLE
// (`if (showHeader) setShowHeader(false); else setShowHeader(true)`) never
// converges — some branch writes on every frame — so it also stays reported.
const isLiteralFlipValue = (callNode: EsTreeNode): boolean => {
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const firstArgument = callNode.arguments?.[0];
  return Boolean(firstArgument && isNodeOfType(firstArgument, "Literal"));
};

const branchCallsSetter = (branch: EsTreeNode | null | undefined, setterName: string): boolean => {
  if (!branch) return false;
  let didFindSetterCall = false;
  walkAst(branch, (child: EsTreeNode) => {
    if (didFindSetterCall) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName
    ) {
      didFindSetterCall = true;
    }
  });
  return didFindSetterCall;
};

const isGuardedSetOnceLatch = (
  callNode: EsTreeNode,
  setterName: string,
  boundary: EsTreeNode,
): boolean => {
  if (!isLiteralFlipValue(callNode)) return false;
  const stateName = setterToStateName(setterName);
  const latchRefName = `${stateName}Ref`;
  let containingBranch: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor && ancestor !== boundary) {
    if (
      (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) &&
      (testReadsName(ancestor.test, stateName) || testReadsName(ancestor.test, latchRefName))
    ) {
      const siblingBranch =
        containingBranch === ancestor.alternate ? ancestor.consequent : ancestor.alternate;
      return !branchCallsSetter(siblingBranch, setterName);
    }
    containingBranch = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const findSetStateInBody = (body: EsTreeNode): EsTreeNode | null => {
  let setStateCallNode: EsTreeNode | null = null;
  walkAst(body, (child: EsTreeNode) => {
    if (setStateCallNode) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      SET_STATE_PATTERN.test(child.callee.name) &&
      isUseStateSetterInScope(child, child.callee.name) &&
      !isGuardedSetOnceLatch(child, child.callee.name, body)
    ) {
      setStateCallNode = child;
    }
  });
  return setStateCallNode;
};

// HACK: setting React state inside an onScroll handler triggers a re-render
// at scroll-event frequency (60-120Hz). Use a Reanimated shared value
// (useSharedValue + useAnimatedScrollHandler) or a ref + raf throttle so
// the JS thread isn't pegged.
export const rnNoScrollState = defineRule({
  id: "rn-no-scroll-state",
  title: "setState in onScroll handler",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "`setState` on every scroll event redraws the screen dozens of times a second. Track the position with a Reanimated shared value (`useAnimatedScrollHandler`) or a ref.",
  create: (context: RuleContext) => {
    const stateSettersInHandlers = new Map<string, EsTreeNode>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const variableName = node.id.name;
        if (!/scroll/i.test(variableName)) return;

        const init = node.init;
        if (
          !isNodeOfType(init, "ArrowFunctionExpression") &&
          !isNodeOfType(init, "FunctionExpression")
        )
          return;

        const setStateCall = findSetStateInBody(init.body);
        if (setStateCall) {
          stateSettersInHandlers.set(variableName, setStateCall);
        }
      },

      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (node.name.name !== "onScroll") return;
        if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const expression = node.value.expression;

        if (isNodeOfType(expression, "Identifier")) {
          const tracked = stateSettersInHandlers.get(expression.name);
          if (tracked) {
            context.report({
              node: tracked,
              message:
                "Your users get janky scrolling when setState in this onScroll handler redraws the screen on every scroll event.",
            });
          }
          return;
        }

        if (
          !isNodeOfType(expression, "ArrowFunctionExpression") &&
          !isNodeOfType(expression, "FunctionExpression")
        ) {
          return;
        }

        const setStateCallNode = findSetStateInBody(expression.body);
        if (setStateCallNode) {
          context.report({
            node: setStateCallNode,
            message:
              "Your users get janky scrolling when setState in onScroll redraws the screen on every scroll event.",
          });
        }
      },
    };
  },
});
