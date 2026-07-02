import { collectPatternNames } from "./collect-pattern-names.js";
import type { ComponentPropStackTrackerCallbacks } from "./component-prop-stack-tracker-callbacks.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isComponentFunction } from "./is-component-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import type { RuleVisitors } from "./rule-visitors.js";

export interface ComponentPropStackTracker {
  isPropName: (name: string, referenceNode?: EsTreeNode) => boolean;
  getCurrentPropNames: () => Set<string>;
  visitors: RuleVisitors;
}

const extractDestructuredPropNames = (params: EsTreeNode[]): Set<string> => {
  const propNames = new Set<string>();
  for (const param of params) {
    collectPatternNames(param, propNames);
  }
  return propNames;
};

const getInlineFunctionNode = (
  node: EsTreeNode | null | undefined,
):
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | null => {
  if (!node) return null;
  if (isFunctionLike(node)) return node;
  if (!isNodeOfType(node, "CallExpression")) return null;

  for (const argument of node.arguments ?? []) {
    const inlineFunctionNode = getInlineFunctionNode(argument);
    if (inlineFunctionNode) return inlineFunctionNode;
  }

  return null;
};

const getNearestComponentFunction = (
  node: EsTreeNode,
):
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// HACK: barrier-frame predicate - a non-component arrow / function-expression
// VariableDeclarator pushes an empty stack frame so closed-over names from
// an outer component don't leak into the helper's prop check.
const isFunctionLikeVariableDeclarator = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "VariableDeclarator")) return false;
  return (
    isNodeOfType(node.init, "ArrowFunctionExpression") ||
    isNodeOfType(node.init, "FunctionExpression")
  );
};

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
  const exportDefaultDeclarationsWithFrames = new WeakSet<EsTreeNode>();
  const functionDeclarationsWithFrames = new WeakSet<EsTreeNode>();
  const variableDeclaratorsWithFrames = new WeakSet<EsTreeNode>();

  const isPropName = (name: string, referenceNode?: EsTreeNode): boolean => {
    for (let frameIndex = propParamStack.length - 1; frameIndex >= 0; frameIndex--) {
      const frame = propParamStack[frameIndex];
      if (frame.size === 0) break;
      if (frame.has(name)) return true;
    }
    if (referenceNode) {
      const componentFunctionNode = getNearestComponentFunction(referenceNode);
      if (!componentFunctionNode || !isComponentFunction(componentFunctionNode)) return false;
      return extractDestructuredPropNames(componentFunctionNode.params ?? []).has(name);
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

  const pushFunctionPropFrame = (
    functionNode:
      | EsTreeNodeOfType<"ArrowFunctionExpression">
      | EsTreeNodeOfType<"FunctionDeclaration">
      | EsTreeNodeOfType<"FunctionExpression">,
  ): void => {
    propParamStack.push(extractDestructuredPropNames(functionNode.params ?? []));
    callbacks?.onComponentEnter?.(functionNode.body);
  };

  const visitors: RuleVisitors = {
    ExportDefaultDeclaration(node: EsTreeNode) {
      if (!isNodeOfType(node, "ExportDefaultDeclaration")) return;
      const inlineFunctionNode = getInlineFunctionNode(node.declaration);
      if (!inlineFunctionNode) return;
      if (isNodeOfType(inlineFunctionNode, "FunctionDeclaration")) return;
      pushFunctionPropFrame(inlineFunctionNode);
      exportDefaultDeclarationsWithFrames.add(node);
    },
    "ExportDefaultDeclaration:exit"(node: EsTreeNode) {
      if (!isNodeOfType(node, "ExportDefaultDeclaration")) return;
      if (!exportDefaultDeclarationsWithFrames.has(node)) return;
      propParamStack.pop();
    },
    FunctionDeclaration(node: EsTreeNode) {
      if (!isNodeOfType(node, "FunctionDeclaration")) return;
      if (!node.id || node.id.name === "default") {
        propParamStack.push(extractDestructuredPropNames(node.params ?? []));
        callbacks?.onComponentEnter?.(node.body);
        functionDeclarationsWithFrames.add(node);
        return;
      }
      if (!isUppercaseName(node.id.name)) {
        propParamStack.push(new Set());
        functionDeclarationsWithFrames.add(node);
        return;
      }
      propParamStack.push(extractDestructuredPropNames(node.params ?? []));
      callbacks?.onComponentEnter?.(node.body);
      functionDeclarationsWithFrames.add(node);
    },
    "FunctionDeclaration:exit"(node: EsTreeNode) {
      if (!isNodeOfType(node, "FunctionDeclaration")) return;
      if (!functionDeclarationsWithFrames.has(node)) return;
      propParamStack.pop();
    },
    VariableDeclarator(node: EsTreeNode) {
      if (!isNodeOfType(node, "VariableDeclarator")) return;
      if (isNodeOfType(node.id, "Identifier") && isUppercaseName(node.id.name)) {
        const inlineFunctionNode = getInlineFunctionNode(node.init);
        if (!inlineFunctionNode) return;
        pushFunctionPropFrame(inlineFunctionNode);
        variableDeclaratorsWithFrames.add(node);
        return;
      }
      if (isFunctionLikeVariableDeclarator(node)) {
        propParamStack.push(new Set());
        variableDeclaratorsWithFrames.add(node);
      }
    },
    "VariableDeclarator:exit"(node: EsTreeNode) {
      if (!isNodeOfType(node, "VariableDeclarator")) return;
      if (!variableDeclaratorsWithFrames.has(node)) return;
      propParamStack.pop();
    },
  };

  return { isPropName, getCurrentPropNames, visitors };
};
