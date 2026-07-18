import { LOADING_STATE_PATTERN } from "../../constants/react.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

// Walks up to find the function-like that owns this VariableDeclarator
// (component body / hook body). `useTransition` is only an alternative
// to `useState(false)` when the loading flag guards a SYNC state
// transition. If the SETTER for this state is called from an async
// context (an `async` function body, or one that itself contains an
// `await`), the flag tracks async work and the rule's recommendation
// doesn't apply.
const enclosingFunctionBody = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      return (cursor as { body: EsTreeNode | null }).body ?? null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasOwnAwait = (functionBody: EsTreeNode | null): boolean => {
  if (!functionBody) return false;
  let found = false;
  walkAst(functionBody, (child: EsTreeNode) => {
    if (found) return;
    if (child !== functionBody && isFunctionLike(child)) {
      // Don't descend into nested functions — their awaits belong to
      // THEIR async context, not this one.
      return false;
    }
    if (isNodeOfType(child, "AwaitExpression")) found = true;
  });
  return found;
};

const callsIdentifier = (root: EsTreeNode | null, identifierName: string): boolean => {
  if (!root) return false;
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === identifierName
    ) {
      found = true;
    }
  });
  return found;
};

const PROMISE_CHAIN_METHOD_NAMES: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

// Identifiers that, when present alongside a loading useState, strongly
// signal async data fetching (not a transition). The rule's
// recommendation to use `useTransition` only applies to UI-state-only
// flips; an Apollo / TanStack / SWR / fetch hook caller is doing real
// I/O that React can't optimize away.
const ASYNC_DATA_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "useApolloClient",
  "useMutation",
  "useQuery",
  "useLazyQuery",
  "useSubscription",
  "useSWR",
  "useSWRMutation",
  "useSWRInfinite",
  "fetch",
  "axios",
]);

// Resource-load lifecycle JSX events (image/media/iframe/webview). A
// loading flag cleared from `onLoad` / `onError` tracks a genuinely
// asynchronous external load that `useTransition` cannot model.
const RESOURCE_LOAD_EVENT_ATTRIBUTE_PATTERN =
  /^on(?:Load|Error|Abort|Progress|CanPlay|Stalled|Suspend|Waiting|Ended)/;

const JSX_EVENT_HANDLER_ATTRIBUTE_PATTERN = /^on[A-Z]/;

const REDUX_DISPATCH_HOOK_PATTERN = /^use\w*Dispatch$/;

const FILE_READER_READ_METHOD_NAMES: ReadonlySet<string> = new Set([
  "readAsArrayBuffer",
  "readAsBinaryString",
  "readAsDataURL",
  "readAsText",
]);

const isGlobalFileReaderConstruction = (
  expression: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "NewExpression") ||
    !isNodeOfType(unwrappedExpression.callee, "Identifier")
  ) {
    return false;
  }
  return (
    unwrappedExpression.callee.name === "FileReader" &&
    context.scopes.isGlobalReference(unwrappedExpression.callee)
  );
};

const getFileReaderOriginStartBefore = (
  readerSymbol: SymbolDescriptor,
  readCall: EsTreeNode,
  context: RuleContext,
): number | null => {
  const readFunction = findEnclosingFunction(readCall);
  let latestValue: EsTreeNode | null = null;
  let latestStart: number | null = null;
  if (
    readerSymbol.initializer &&
    findEnclosingFunction(readerSymbol.declarationNode) === readFunction &&
    readerSymbol.declarationNode.range[0] < readCall.range[0]
  ) {
    latestValue = readerSymbol.initializer;
    latestStart = readerSymbol.declarationNode.range[0];
  }
  for (const reference of readerSymbol.references) {
    if (
      reference.flag === "read" ||
      reference.identifier.range[0] >= readCall.range[0] ||
      (latestStart !== null && reference.identifier.range[0] <= latestStart) ||
      findEnclosingFunction(reference.identifier) !== readFunction
    ) {
      continue;
    }
    const assignment = reference.identifier.parent;
    if (
      !assignment ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== reference.identifier
    ) {
      continue;
    }
    latestValue = assignment.right;
    latestStart = reference.identifier.range[0];
  }
  return isGlobalFileReaderConstruction(latestValue, context) ? latestStart : null;
};

const resolveLoadingCompletionFunction = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const directFunction = resolveExactLocalFunction(expression, context.scopes);
  if (directFunction) return directFunction;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
  if (
    !initializer ||
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useCallback", context.scopes)
  ) {
    return null;
  }
  const callback = initializer.arguments?.[0];
  return callback && isFunctionLike(callback) ? callback : null;
};

const isSetterBooleanCall = (
  node: EsTreeNode,
  setterSymbol: SymbolDescriptor,
  value: boolean,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  const argument = node.arguments?.[0];
  const unwrappedArgument = argument ? stripParenExpression(argument) : null;
  return Boolean(
    isNodeOfType(callee, "Identifier") &&
    context.scopes.symbolFor(callee) === setterSymbol &&
    unwrappedArgument &&
    isNodeOfType(unwrappedArgument, "Literal") &&
    unwrappedArgument.value === value,
  );
};

const functionClearsLoadingState = (
  functionNode: EsTreeNode,
  setterSymbol: SymbolDescriptor,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode>,
): boolean => {
  if (visitedFunctions.has(functionNode) || !isFunctionLike(functionNode)) return false;
  visitedFunctions.add(functionNode);
  let didClearLoadingState = false;
  walkAst(functionNode.body, (child) => {
    if (didClearLoadingState) return false;
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (isSetterBooleanCall(child, setterSymbol, false, context)) {
      didClearLoadingState = true;
      return false;
    }
    const helperFunction = resolveLoadingCompletionFunction(child.callee, context);
    if (
      helperFunction &&
      functionClearsLoadingState(helperFunction, setterSymbol, context, visitedFunctions)
    ) {
      didClearLoadingState = true;
      return false;
    }
  });
  return didClearLoadingState;
};

const getLatestFileReaderCallbackBefore = (
  readCall: EsTreeNode,
  readerSymbol: SymbolDescriptor,
  propertyName: "onerror" | "onload",
  originStart: number,
  context: RuleContext,
): EsTreeNode | null => {
  const readFunction = findEnclosingFunction(readCall);
  if (!readFunction || !isFunctionLike(readFunction)) return null;
  let callback: EsTreeNode | null = null;
  let callbackStart = originStart;
  walkAst(readFunction.body, (child) => {
    if (child !== readFunction.body && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "AssignmentExpression") ||
      child.operator !== "=" ||
      child.range[0] >= readCall.range[0] ||
      child.range[0] <= callbackStart ||
      !isNodeOfType(child.left, "MemberExpression") ||
      getStaticPropertyName(child.left) !== propertyName
    ) {
      return;
    }
    const receiver = stripParenExpression(child.left.object);
    if (
      !isNodeOfType(receiver, "Identifier") ||
      context.scopes.symbolFor(receiver) !== readerSymbol
    ) {
      return;
    }
    callback = child.right;
    callbackStart = child.range[0];
  });
  return callback;
};

const setterStartsLoadingBefore = (
  readCall: EsTreeNode,
  setterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const readFunction = findEnclosingFunction(readCall);
  if (!readFunction || !isFunctionLike(readFunction)) return false;
  let didStartLoading = false;
  walkAst(readFunction.body, (child) => {
    if (didStartLoading) return false;
    if (child !== readFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression") || child.range[0] >= readCall.range[0]) {
      return;
    }
    if (isSetterBooleanCall(child, setterSymbol, true, context)) {
      didStartLoading = true;
      return false;
    }
  });
  return didStartLoading;
};

const setterTracksFileReader = (
  functionBody: EsTreeNode,
  setterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let didFindFileReaderLifecycle = false;
  walkAst(functionBody, (child) => {
    if (didFindFileReaderLifecycle) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isNodeOfType(child.callee, "MemberExpression") ||
      !FILE_READER_READ_METHOD_NAMES.has(getStaticPropertyName(child.callee) ?? "")
    ) {
      return;
    }
    const receiver = stripParenExpression(child.callee.object);
    if (!isNodeOfType(receiver, "Identifier")) return;
    const readerSymbol = context.scopes.symbolFor(receiver);
    if (!readerSymbol) return;
    const originStart = getFileReaderOriginStartBefore(readerSymbol, child, context);
    if (originStart === null || !setterStartsLoadingBefore(child, setterSymbol, context)) {
      return;
    }
    const loadCallback = getLatestFileReaderCallbackBefore(
      child,
      readerSymbol,
      "onload",
      originStart,
      context,
    );
    const errorCallback = getLatestFileReaderCallbackBefore(
      child,
      readerSymbol,
      "onerror",
      originStart,
      context,
    );
    const loadFunction = loadCallback
      ? resolveLoadingCompletionFunction(loadCallback, context)
      : null;
    const errorFunction = errorCallback
      ? resolveLoadingCompletionFunction(errorCallback, context)
      : null;
    if (
      loadFunction &&
      errorFunction &&
      functionClearsLoadingState(loadFunction, setterSymbol, context, new Set()) &&
      functionClearsLoadingState(errorFunction, setterSymbol, context, new Set())
    ) {
      didFindFileReaderLifecycle = true;
      return false;
    }
  });
  return didFindFileReaderLifecycle;
};

// One pass over the component body computes every async-work signal the
// caller ORs together, short-circuiting on the first hit:
//   - `setterName` called inside an async-context function ("async" or an
//     own-scope `await`) — a sync helper toggling the flag doesn't count.
//   - `setterName` called inside a Promise-chain callback
//     (`loadData().then(() => setIsLoading(false))`).
//   - a call to a known async-data hook / global anywhere in the body.
const hasAsyncLoadingWork = (fnBody: EsTreeNode, setterName: string | null): boolean => {
  let found = false;
  walkAst(fnBody, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const callee = child.callee;
      if (isNodeOfType(callee, "Identifier") && ASYNC_DATA_CALLEE_NAMES.has(callee.name)) {
        found = true;
        return false;
      }
      if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
        if (ASYNC_DATA_CALLEE_NAMES.has(callee.property.name)) {
          found = true;
          return false;
        }
        if (setterName !== null && PROMISE_CHAIN_METHOD_NAMES.has(callee.property.name)) {
          for (const argument of child.arguments ?? []) {
            if (!isFunctionLike(argument)) continue;
            if (callsIdentifier(argument.body, setterName)) {
              found = true;
              return false;
            }
          }
        }
      }
      return;
    }
    if (setterName !== null && isFunctionLike(child)) {
      const functionBody = (child as { body: EsTreeNode | null }).body;
      const isAsyncContext =
        Boolean((child as { async?: boolean }).async) || hasOwnAwait(functionBody);
      if (isAsyncContext && callsIdentifier(functionBody, setterName)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

const isHookDependencyArray = (arrayNode: EsTreeNode): boolean => {
  const call = arrayNode.parent;
  return Boolean(
    call &&
    isNodeOfType(call, "CallExpression") &&
    isNodeOfType(call.callee, "Identifier") &&
    /^use[A-Z]/.test(call.callee.name),
  );
};

// The rule can only reason about the flag when every use of the setter is
// visible in this component. When the setter itself escapes — returned
// from a custom hook, passed as a prop or callback argument — the toggling
// happens somewhere the rule can't see (usually around async work), so
// recommending `useTransition` here is speculation.
const setterEscapes = (
  fnBody: EsTreeNode,
  setterName: string,
  declaratorNode: EsTreeNode,
): boolean => {
  let escapes = false;
  walkAst(fnBody, (child: EsTreeNode) => {
    if (escapes) return false;
    if (!isNodeOfType(child, "Identifier") || child.name !== setterName) return;
    let cursor: EsTreeNode | null | undefined = child.parent;
    while (cursor && cursor !== fnBody) {
      if (cursor === declaratorNode) return;
      cursor = cursor.parent ?? null;
    }
    const parent = child.parent;
    if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === child) return;
    if (parent && isNodeOfType(parent, "ArrayExpression") && isHookDependencyArray(parent)) return;
    escapes = true;
    return false;
  });
  return escapes;
};

const enclosingJsxAttributeName = (node: EsTreeNode, boundary: EsTreeNode): string | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== boundary) {
    if (isNodeOfType(cursor, "JSXAttribute") && isNodeOfType(cursor.name, "JSXIdentifier")) {
      return cursor.name.name;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const collectSetterCalls = (fnBody: EsTreeNode, setterName: string): EsTreeNode[] => {
  const calls: EsTreeNode[] = [];
  walkAst(fnBody, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName
    ) {
      calls.push(child);
    }
  });
  return calls;
};

// `onClick={() => setIsLoading(true)}` where the flip IS the whole
// handler: the flag is a manually driven UI toggle (demo pages, controlled
// child props). There's no accompanying update to wrap in a transition,
// so `useTransition` has nothing to offer.
const isBareInlineJsxHandlerCall = (call: EsTreeNode, boundary: EsTreeNode): boolean => {
  const arrow = call.parent;
  if (!arrow || !isNodeOfType(arrow, "ArrowFunctionExpression") || arrow.body !== call) {
    return false;
  }
  const container = arrow.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attributeName = enclosingJsxAttributeName(call, boundary);
  return attributeName !== null && JSX_EVENT_HANDLER_ATTRIBUTE_PATTERN.test(attributeName);
};

// Names of functions in the component body that do async work themselves
// (declared `async` or awaiting), plus redux-style dispatchers obtained
// from `useDispatch()` / `useAppDispatch()`. A sync helper that toggles
// the flag and then calls one of these is wrapping async work.
const collectAsyncSignalNames = (fnBody: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(fnBody, (child: EsTreeNode) => {
    if (isNodeOfType(child, "FunctionDeclaration")) {
      if (Boolean(child.async) && child.id && isNodeOfType(child.id, "Identifier")) {
        names.add(child.id.name);
      }
      return;
    }
    if (!isNodeOfType(child, "VariableDeclarator") || !isNodeOfType(child.id, "Identifier")) {
      return;
    }
    const init = child.init;
    if (!init) return;
    if (isFunctionLike(init) && Boolean((init as { async?: boolean }).async)) {
      names.add(child.id.name);
      return;
    }
    if (
      isNodeOfType(init, "CallExpression") &&
      isNodeOfType(init.callee, "Identifier") &&
      REDUX_DISPATCH_HOOK_PATTERN.test(init.callee.name)
    ) {
      names.add(child.id.name);
    }
  });
  return names;
};

const callsAnyIdentifier = (root: EsTreeNode | null, names: ReadonlySet<string>): boolean => {
  if (!root || names.size === 0) return false;
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      names.has(child.callee.name)
    ) {
      found = true;
    }
  });
  return found;
};

const setterCalledAlongsideAsyncSignal = (fnBody: EsTreeNode, setterName: string): boolean => {
  const asyncSignalNames = collectAsyncSignalNames(fnBody);
  if (asyncSignalNames.size === 0) return false;
  let found = false;
  walkAst(fnBody, (child: EsTreeNode) => {
    if (found) return false;
    if (!isFunctionLike(child)) return;
    const functionBody = (child as { body: EsTreeNode | null }).body;
    if (
      callsIdentifier(functionBody, setterName) &&
      callsAnyIdentifier(functionBody, asyncSignalNames)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// Flags toggled from `addEventListener` handlers track loading driven by
// an external event source (webview navigation, media elements, sockets)
// — asynchronous by nature, not a transition candidate.
const setterCalledInEventListenerHandler = (fnBody: EsTreeNode, setterName: string): boolean => {
  const handlerNames = new Set<string>();
  let foundInline = false;
  walkAst(fnBody, (child: EsTreeNode) => {
    if (foundInline) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isNodeOfType(child.callee, "MemberExpression") ||
      !isNodeOfType(child.callee.property, "Identifier") ||
      child.callee.property.name !== "addEventListener"
    ) {
      return;
    }
    const handler = child.arguments?.[1];
    if (!handler) return;
    if (isFunctionLike(handler)) {
      if (callsIdentifier(handler.body, setterName)) foundInline = true;
      return;
    }
    if (isNodeOfType(handler, "Identifier")) handlerNames.add(handler.name);
  });
  if (foundInline) return true;
  if (handlerNames.size === 0) return false;
  let foundNamed = false;
  walkAst(fnBody, (child: EsTreeNode) => {
    if (foundNamed) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      handlerNames.has(child.id.name) &&
      child.init &&
      isFunctionLike(child.init) &&
      callsIdentifier(child.init.body, setterName)
    ) {
      foundNamed = true;
      return false;
    }
    if (
      isNodeOfType(child, "FunctionDeclaration") &&
      child.id &&
      isNodeOfType(child.id, "Identifier") &&
      handlerNames.has(child.id.name) &&
      callsIdentifier(child.body, setterName)
    ) {
      foundNamed = true;
      return false;
    }
  });
  return foundNamed;
};

export const renderingUsetransitionLoading = defineRule({
  id: "rendering-usetransition-loading",
  title: "Loading useState forces extra render",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Replace with `const [isPending, startTransition] = useTransition()`, which skips the extra render for the loading flag",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "ArrayPattern") || !node.id.elements?.length) return;
      if (!node.init || !isHookCall(node.init, "useState")) return;
      if (!isNodeOfType(node.init, "CallExpression")) return;
      if (!node.init.arguments?.length) return;

      const initializer = node.init.arguments[0];
      if (!isNodeOfType(initializer, "Literal") || initializer.value !== false) return;

      const firstBinding = node.id.elements[0];
      const stateVariableName = isNodeOfType(firstBinding, "Identifier") ? firstBinding.name : null;
      if (!stateVariableName || !LOADING_STATE_PATTERN.test(stateVariableName)) return;

      const secondBinding = node.id.elements[1];
      const setterName = isNodeOfType(secondBinding, "Identifier") ? secondBinding.name : null;

      // Async-work loading states aren't transition candidates — there's
      // a real I/O suspension that React can't elide. Detect either the
      // SETTER being called inside an async-context function (so the
      // flag is wrapping that async work) OR a call to a known
      // async-data hook / global in the component body.
      const fnBody = enclosingFunctionBody(node as EsTreeNode);
      if (fnBody && hasAsyncLoadingWork(fnBody, setterName)) return;

      if (fnBody && setterName) {
        const setterSymbol = isNodeOfType(secondBinding, "Identifier")
          ? context.scopes.symbolFor(secondBinding)
          : null;
        if (setterSymbol && setterTracksFileReader(fnBody, setterSymbol, context)) return;
        if (setterEscapes(fnBody, setterName, node as EsTreeNode)) return;
        if (setterCalledAlongsideAsyncSignal(fnBody, setterName)) return;
        if (setterCalledInEventListenerHandler(fnBody, setterName)) return;

        const setterCalls = collectSetterCalls(fnBody, setterName);
        if (setterCalls.length > 0) {
          const hasResourceLoadEventCall = setterCalls.some((call) => {
            const attributeName = enclosingJsxAttributeName(call, fnBody);
            return (
              attributeName !== null && RESOURCE_LOAD_EVENT_ATTRIBUTE_PATTERN.test(attributeName)
            );
          });
          if (hasResourceLoadEventCall) return;

          const allBareInlineJsxHandlerCalls = setterCalls.every((call) =>
            isBareInlineJsxHandlerCall(call, fnBody),
          );
          if (allBareInlineJsxHandlerCalls) return;
        }
      }

      context.report({
        node: node.init,
        message: `This adds an extra render because useState for "${stateVariableName}" re-renders just for the loading flag, so if it's a state change & not a data fetch, use useTransition instead`,
      });
    },
  }),
});
