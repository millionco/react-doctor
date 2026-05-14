import type { ComponentPropStackTracker } from "./component-prop-stack-tracker.js";
import type { ComponentPropStackTrackerCallbacks } from "./component-prop-stack-tracker-callbacks.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { extractDestructuredPropNames } from "./extract-destructured-prop-names.js";
import { isComponentAssignment } from "./is-component-assignment.js";
import { isFunctionLikeVariableDeclarator } from "./is-function-like-variable-declarator.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import type { RuleVisitors } from "./rule-visitors.js";

// HACK: every rule that walks "what props does the enclosing component
// have?" needs the SAME prop-stack machinery - push the destructured
// param set on FunctionDeclaration / VariableDeclarator entry, push
// an empty barrier for non-component nested helpers (so closed-over
// names don't leak in), pop on exit. Four rules previously inlined
// near-identical copies of this - they now compose this tracker.
//
// `isPropName(name)` is the lookup form most rules want during a
// CallExpression visit (returns false at the first barrier).
//
// `getCurrentPropNames()` returns a snapshot - useful when the rule
// runs eagerly on component entry instead of deferring to a later
// CallExpression visit.
//
// `onComponentEnter(body)` is invoked AFTER the prop set is pushed,
// from inside the FunctionDeclaration / VariableDeclarator visitor -
// rules that compute everything once per component (e.g. mirror-prop
// detection) hook in here.
export const createComponentPropStackTracker = (
  callbacks?: ComponentPropStackTrackerCallbacks,
): ComponentPropStackTracker => {
  const propParamStack: Array<Set<string>> = [];

  const isPropName = (name: string): boolean => {
    for (let frameIndex = propParamStack.length - 1; frameIndex >= 0; frameIndex--) {
      const frame = propParamStack[frameIndex];
      if (frame.size === 0) return false;
      if (frame.has(name)) return true;
    }
    return false;
  };

  const getCurrentPropNames = (): Set<string> => {
    for (let frameIndex = propParamStack.length - 1; frameIndex >= 0; frameIndex--) {
      const frame = propParamStack[frameIndex];
      if (frame.size === 0) return new Set();
      return frame;
    }
    return new Set();
  };

  const visitors: RuleVisitors = {
    FunctionDeclaration(node: EsTreeNode) {
      if (!isNodeOfType(node, "FunctionDeclaration")) return;
      if (!node.id || !isUppercaseName(node.id.name)) {
        propParamStack.push(new Set());
        return;
      }
      propParamStack.push(extractDestructuredPropNames(node.params ?? []));
      callbacks?.onComponentEnter?.(node.body);
    },
    "FunctionDeclaration:exit"() {
      propParamStack.pop();
    },
    VariableDeclarator(node: EsTreeNode) {
      if (!isNodeOfType(node, "VariableDeclarator")) return;
      if (isComponentAssignment(node)) {
        const initializer = node.init;
        if (
          isNodeOfType(initializer, "ArrowFunctionExpression") ||
          isNodeOfType(initializer, "FunctionExpression")
        ) {
          propParamStack.push(extractDestructuredPropNames(initializer.params ?? []));
          callbacks?.onComponentEnter?.(initializer.body);
        } else {
          propParamStack.push(new Set());
        }
        return;
      }
      if (isFunctionLikeVariableDeclarator(node)) {
        propParamStack.push(new Set());
      }
    },
    "VariableDeclarator:exit"(node: EsTreeNode) {
      if (!isNodeOfType(node, "VariableDeclarator")) return;
      if (isComponentAssignment(node) || isFunctionLikeVariableDeclarator(node)) {
        propParamStack.pop();
      }
    },
  };

  return { isPropName, getCurrentPropNames, visitors };
};
