import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isSynchronousIteratorCall } from "./is-synchronous-iterator-callback.js";
import { isFunctionLike } from "./is-function-like.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const PROMISE_CHAIN_METHOD_NAMES = new Set(["then", "catch", "finally"]);

const isPromiseChainCall = (callee: EsTreeNode): boolean =>
  callee.type === "MemberExpression" &&
  callee.property.type === "Identifier" &&
  PROMISE_CHAIN_METHOD_NAMES.has(callee.property.name) &&
  stripParenExpression(callee.object).type === "CallExpression";

export const getPromiseChainCallForCallback = (candidate: EsTreeNode): EsTreeNode | null => {
  let callbackContainer = candidate.parent;
  while (callbackContainer && TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(callbackContainer.type)) {
    callbackContainer = callbackContainer.parent;
  }
  if (callbackContainer?.type !== "CallExpression") return null;
  if (
    !callbackContainer.arguments?.some((argument) => stripParenExpression(argument) === candidate)
  ) {
    return null;
  }
  return isPromiseChainCall(stripParenExpression(callbackContainer.callee))
    ? callbackContainer
    : null;
};

// Nested functions the effect body executes as part of running the effect —
// IIFEs, locally-declared functions invoked by a bare call on the synchronous
// path (transitively), and promise-chain callbacks rooted at calls made on
// that path — as opposed to handlers merely registered for a later external
// event (addEventListener / setInterval) or the returned cleanup function.
const collectInvokedFunctions = (
  effectCallback: EsTreeNode,
  includePromiseCallbacks: boolean,
  scopes?: ScopeAnalysis,
): Set<EsTreeNode> => {
  const invokedFunctions = new Set<EsTreeNode>([effectCallback]);
  const localFunctionBindings = new Map<string, EsTreeNode>();
  const calledBindingNames = new Set<string>();
  const reassignedBindingNames = new Set<string>();
  const pendingFunctions: EsTreeNode[] = [effectCallback];
  const getBindingKey = (identifier: EsTreeNode): string | null => {
    if (identifier.type !== "Identifier") return null;
    const symbol = scopes?.symbolFor(identifier);
    return symbol ? `symbol:${String(symbol.id)}` : `name:${identifier.name}`;
  };

  const enqueue = (candidate: EsTreeNode | null | undefined): void => {
    const strippedCandidate = candidate ? stripParenExpression(candidate) : candidate;
    if (!isFunctionLike(strippedCandidate) || invokedFunctions.has(strippedCandidate)) return;
    invokedFunctions.add(strippedCandidate);
    pendingFunctions.push(strippedCandidate);
  };

  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;

    walkAst(currentFunction, (child) => {
      if (child !== currentFunction && isFunctionLike(child)) {
        if (child.type === "FunctionDeclaration" && child.id?.type === "Identifier") {
          const bindingKey = getBindingKey(child.id);
          if (bindingKey) localFunctionBindings.set(bindingKey, child);
        }
        return false;
      }

      if (child.type === "VariableDeclarator" && child.id.type === "Identifier") {
        const initializer = child.init ? stripParenExpression(child.init) : null;
        if (isFunctionLike(initializer)) {
          const bindingKey = getBindingKey(child.id);
          if (bindingKey) localFunctionBindings.set(bindingKey, initializer);
        }
        return;
      }

      if (child.type === "AssignmentExpression") {
        const assignedTarget = stripParenExpression(child.left);
        if (assignedTarget.type === "Identifier") {
          const bindingKey = getBindingKey(assignedTarget);
          if (bindingKey) reassignedBindingNames.add(bindingKey);
        }
        return;
      }

      if (child.type !== "CallExpression") return;

      const callee = stripParenExpression(child.callee);

      if (isFunctionLike(callee)) {
        enqueue(callee);
        return;
      }

      if (callee.type === "Identifier") {
        const bindingKey = getBindingKey(callee);
        if (bindingKey) calledBindingNames.add(bindingKey);
        return;
      }

      if (includePromiseCallbacks && isPromiseChainCall(callee)) {
        for (const callArgument of child.arguments ?? []) {
          enqueue(callArgument);
        }
      }
    });

    for (const calledName of calledBindingNames) {
      if (reassignedBindingNames.has(calledName)) continue;
      enqueue(localFunctionBindings.get(calledName));
    }
  }

  return invokedFunctions;
};

export const collectEffectInvokedFunctions = (
  effectCallback: EsTreeNode,
  scopes?: ScopeAnalysis,
): Set<EsTreeNode> => collectInvokedFunctions(effectCallback, true, scopes);

export const collectSynchronouslyEffectInvokedFunctions = (
  effectCallback: EsTreeNode,
  scopes?: ScopeAnalysis,
): Set<EsTreeNode> => collectInvokedFunctions(effectCallback, false, scopes);

export const collectSynchronouslyInvokedLocalFunctions = (
  executionRoot: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<EsTreeNode> => {
  const invokedFunctions = new Set<EsTreeNode>();
  const pendingExecutionRoots: EsTreeNode[] = [executionRoot];
  const visitedExecutionRoots = new Set<EsTreeNode>();
  const enqueue = (candidate: EsTreeNode | null): void => {
    if (!candidate || !isFunctionLike(candidate) || candidate.generator) return;
    if (invokedFunctions.has(candidate)) return;
    invokedFunctions.add(candidate);
    pendingExecutionRoots.push(candidate);
  };
  if (isFunctionLike(executionRoot) && !executionRoot.generator) {
    invokedFunctions.add(executionRoot);
  }
  while (pendingExecutionRoots.length > 0) {
    const currentRoot = pendingExecutionRoots.pop();
    if (!currentRoot || visitedExecutionRoots.has(currentRoot)) continue;
    visitedExecutionRoots.add(currentRoot);
    walkAst(currentRoot, (node) => {
      if (node !== currentRoot && isFunctionLike(node)) return false;
      if (node.type !== "CallExpression") return;
      enqueue(resolveExactLocalFunction(node.callee, scopes));
      for (const argument of node.arguments) {
        if (
          argument.type === "SpreadElement" ||
          !isSynchronousIteratorCall(node, argument, scopes)
        ) {
          continue;
        }
        enqueue(resolveExactLocalFunction(argument, scopes));
      }
    });
  }
  return invokedFunctions;
};
