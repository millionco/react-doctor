import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const PROMISE_CHAIN_METHOD_NAMES = new Set(["then", "catch", "finally"]);

const isPromiseChainCall = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  isNodeOfType(callee.property, "Identifier") &&
  PROMISE_CHAIN_METHOD_NAMES.has(callee.property.name) &&
  isNodeOfType(stripParenExpression(callee.object), "CallExpression");

export const getPromiseChainCallForCallback = (candidate: EsTreeNode): EsTreeNode | null => {
  let callbackContainer = candidate.parent;
  while (callbackContainer && TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(callbackContainer.type)) {
    callbackContainer = callbackContainer.parent;
  }
  if (!isNodeOfType(callbackContainer, "CallExpression")) return null;
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
): Set<EsTreeNode> => {
  const invokedFunctions = new Set<EsTreeNode>([effectCallback]);
  const localFunctionBindings = new Map<string, EsTreeNode>();
  const calledBindingNames = new Set<string>();
  const pendingFunctions: EsTreeNode[] = [effectCallback];

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
        if (isNodeOfType(child, "FunctionDeclaration") && isNodeOfType(child.id, "Identifier")) {
          localFunctionBindings.set(child.id.name, child);
        }
        return false;
      }

      if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
        const initializer = child.init ? stripParenExpression(child.init) : null;
        if (isFunctionLike(initializer)) {
          localFunctionBindings.set(child.id.name, initializer);
        }
        return;
      }

      if (!isNodeOfType(child, "CallExpression")) return;

      const callee = stripParenExpression(child.callee);

      if (isFunctionLike(callee)) {
        enqueue(callee);
        return;
      }

      if (isNodeOfType(callee, "Identifier")) {
        calledBindingNames.add(callee.name);
        return;
      }

      if (includePromiseCallbacks && isPromiseChainCall(callee)) {
        for (const callArgument of child.arguments ?? []) {
          enqueue(callArgument);
        }
      }
    });

    for (const calledName of calledBindingNames) {
      enqueue(localFunctionBindings.get(calledName));
    }
  }

  return invokedFunctions;
};

export const collectEffectInvokedFunctions = (effectCallback: EsTreeNode): Set<EsTreeNode> =>
  collectInvokedFunctions(effectCallback, true);

export const collectSynchronouslyEffectInvokedFunctions = (
  effectCallback: EsTreeNode,
): Set<EsTreeNode> => collectInvokedFunctions(effectCallback, false);
