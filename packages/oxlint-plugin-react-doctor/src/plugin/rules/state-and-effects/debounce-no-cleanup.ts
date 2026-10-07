import { defineRule } from "../../utils/define-rule.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { collectBindingAliases } from "../../utils/collect-binding-aliases.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import {
  isProvenEffectHookCall,
  isProvenReactHookCall,
} from "../../utils/is-proven-effect-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";

const DEBOUNCE_WRAPPER_HOOK_NAMES = new Set(["useMemo", "useCallback", "useRef"]);
const USE_REF_HOOK_NAMES = new Set(["useRef"]);
const DEBOUNCE_FACTORY_NAMES = new Set(["debounce", "throttle"]);
const DEBOUNCE_RELEASE_METHOD_NAMES = new Set(["cancel", "flush"]);
const BROWSER_GLOBAL_NAMES = new Set(["document", "window"]);
const PROMISE_CHAIN_METHOD_NAMES = new Set(["then", "catch", "finally"]);

type FunctionEsTreeNode = EsTreeNodeOfType<
  "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
>;

interface DebounceFunctionUsageIndex {
  escapedSymbolIds: Set<number>;
  invokedSymbolIds: Set<number>;
  releasedSymbolIds: Set<number>;
}

const isLodashModuleSource = (source: string | null): boolean =>
  source !== null &&
  (source === "lodash" ||
    source === "lodash-es" ||
    source === "lodash.debounce" ||
    source === "lodash.throttle" ||
    source.startsWith("lodash/") ||
    source.startsWith("lodash-es/"));

const isLodashDebounceCall = (callExpression: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (!DEBOUNCE_FACTORY_NAMES.has(callee.name)) return false;
    const binding = findVariableInitializer(callee, callee.name);
    if (
      !binding?.initializer ||
      (!isNodeOfType(binding.initializer, "ImportSpecifier") &&
        !isNodeOfType(binding.initializer, "ImportDefaultSpecifier"))
    ) {
      return false;
    }
    return isLodashModuleSource(getImportSourceForName(callee, callee.name));
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    DEBOUNCE_FACTORY_NAMES.has(getStaticPropertyName(callee) ?? "")
  ) {
    const receiver = stripParenExpression(callee.object);
    if (!isNodeOfType(receiver, "Identifier")) return false;
    const binding = findVariableInitializer(receiver, receiver.name);
    if (
      !binding?.initializer ||
      (!isNodeOfType(binding.initializer, "ImportNamespaceSpecifier") &&
        !isNodeOfType(binding.initializer, "ImportDefaultSpecifier"))
    ) {
      return false;
    }
    const receiverSource = getImportSourceForName(receiver, receiver.name);
    return isLodashModuleSource(receiverSource);
  }
  return false;
};

const findDebounceCallInHookInitializer = (hookCall: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(hookCall, "CallExpression")) return null;
  const firstArgument = hookCall.arguments?.[0];
  if (!firstArgument) return null;
  const strippedArgument = stripParenExpression(firstArgument);
  if (isLodashDebounceCall(strippedArgument)) return strippedArgument;
  if (
    !isNodeOfType(strippedArgument, "ArrowFunctionExpression") &&
    !isNodeOfType(strippedArgument, "FunctionExpression")
  ) {
    return null;
  }
  if (!isNodeOfType(strippedArgument.body, "BlockStatement")) {
    const returned = stripParenExpression(strippedArgument.body);
    return isLodashDebounceCall(returned) ? returned : null;
  }
  for (const statement of strippedArgument.body.body ?? []) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      const returned = stripParenExpression(statement.argument);
      if (isLodashDebounceCall(returned)) return returned;
    }
  }
  return null;
};

const hasTrailingFalseOption = (
  debounceCall: EsTreeNode,
  scopes: ScopeAnalysis,
  optionsReadAnchor: EsTreeNode,
): boolean => {
  if (!isNodeOfType(debounceCall, "CallExpression")) return false;
  const optionsArgument = debounceCall.arguments?.[2] as EsTreeNode | undefined;
  if (!optionsArgument) return false;
  const optionsObject = resolveStableOptionsObject(
    optionsArgument,
    ["trailing"],
    scopes,
    optionsReadAnchor,
  );
  if (!optionsObject) return false;
  return optionsObject.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "trailing" &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === false,
  );
};

const baseReferenceIdentifier = (expression: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let base = stripParenExpression(expression);
  while (isNodeOfType(base, "MemberExpression")) {
    base = stripParenExpression(base.object as EsTreeNode);
  }
  return isNodeOfType(base, "Identifier") ? base : null;
};

const symbolIdForReferenceExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): number | null => {
  const identifier = baseReferenceIdentifier(expression);
  return identifier ? (scopes.symbolFor(identifier)?.id ?? null) : null;
};

const releaseTargetSymbolId = (expression: EsTreeNode, scopes: ScopeAnalysis): number | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    if (!DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(unwrappedExpression) ?? "")) {
      return null;
    }
    return symbolIdForReferenceExpression(unwrappedExpression.object, scopes);
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const bindingIdentifier = findVariableInitializer(
    unwrappedExpression,
    unwrappedExpression.name,
  )?.bindingIdentifier;
  const property = bindingIdentifier?.parent;
  if (!isNodeOfType(property, "Property")) return null;
  const propertyName = isNodeOfType(property.key, "Identifier")
    ? property.key.name
    : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
      ? property.key.value
      : null;
  if (!propertyName || !DEBOUNCE_RELEASE_METHOD_NAMES.has(propertyName)) return null;
  const pattern = property.parent;
  const declarator = pattern?.parent;
  if (
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !declarator.init
  ) {
    return null;
  }
  return symbolIdForReferenceExpression(declarator.init as EsTreeNode, scopes);
};

const addCleanupReleaseSymbols = (
  cleanupFunction: EsTreeNode,
  releasedSymbolIds: Set<number>,
  scopes: ScopeAnalysis,
): void => {
  walkAst(cleanupFunction, (child: EsTreeNode) => {
    if (child !== cleanupFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const symbolId = releaseTargetSymbolId(child.callee as EsTreeNode, scopes);
    if (symbolId !== null) releasedSymbolIds.add(symbolId);
  });
};

const buildFunctionUsageIndex = (
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): DebounceFunctionUsageIndex => {
  const escapedSymbolIds = new Set<number>();
  const invokedSymbolIds = new Set<number>();
  const releasedSymbolIds = new Set<number>();

  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (isProvenEffectHookCall(child, scopes)) {
      const effectArgument = child.arguments?.[0];
      const effectCallback = effectArgument ? stripParenExpression(effectArgument) : null;
      if (effectCallback && isFunctionLike(effectCallback)) {
        walkSynchronousCallbackFlow(effectCallback, (effectChild: EsTreeNode) => {
          if (!isNodeOfType(effectChild, "CallExpression")) return;
          const symbolId = symbolIdForReferenceExpression(effectChild.callee as EsTreeNode, scopes);
          if (symbolId !== null) invokedSymbolIds.add(symbolId);
        });
        if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
          const symbolId = releaseTargetSymbolId(effectCallback.body, scopes);
          if (symbolId !== null) releasedSymbolIds.add(symbolId);
        } else {
          for (const returnStatement of collectFunctionReturnStatements(effectCallback)) {
            if (!returnStatement.argument) continue;
            const symbolId = releaseTargetSymbolId(returnStatement.argument, scopes);
            if (symbolId !== null) releasedSymbolIds.add(symbolId);
          }
        }
        for (const cleanupFunction of collectReturnedCleanupFunctions(effectCallback)) {
          addCleanupReleaseSymbols(cleanupFunction, releasedSymbolIds, scopes);
        }
      }
    }
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "useUnmount" &&
      (getImportSourceForName(callee, callee.name) === "react-use" ||
        !findVariableInitializer(callee, callee.name))
    ) {
      for (const argument of child.arguments ?? []) {
        const symbolId = releaseTargetSymbolId(argument as EsTreeNode, scopes);
        if (symbolId !== null) releasedSymbolIds.add(symbolId);
      }
    }
    if (!isNodeOfType(callee, "Identifier")) return;
    if (!isReactHookName(callee.name)) return;
    const helper = findVariableInitializer(callee, callee.name)?.initializer;
    if (!helper || !isFunctionLike(helper)) return;
    const releasingParameterNames = new Set<string>();
    walkAst(helper, (helperChild: EsTreeNode) => {
      if (
        !isNodeOfType(helperChild, "CallExpression") ||
        !isProvenEffectHookCall(helperChild, scopes)
      )
        return;
      const effectCallback = getEffectCallback(helperChild);
      if (!effectCallback) return;
      for (const cleanupFunction of collectReturnedCleanupFunctions(effectCallback)) {
        walkAst(cleanupFunction, (cleanupChild: EsTreeNode) => {
          if (!isNodeOfType(cleanupChild, "CallExpression")) return;
          const cleanupCallee = stripParenExpression(cleanupChild.callee);
          if (
            !isNodeOfType(cleanupCallee, "MemberExpression") ||
            !DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(cleanupCallee) ?? "")
          ) {
            return;
          }
          const receiver = baseReferenceIdentifier(cleanupCallee.object as EsTreeNode);
          if (receiver) releasingParameterNames.add(receiver.name);
        });
      }
    });
    for (const [parameterIndex, parameter] of (helper.params ?? []).entries()) {
      if (!isNodeOfType(parameter, "Identifier") || !releasingParameterNames.has(parameter.name)) {
        continue;
      }
      const argument = child.arguments?.[parameterIndex];
      const symbolId = argument
        ? symbolIdForReferenceExpression(argument as EsTreeNode, scopes)
        : null;
      if (symbolId !== null) releasedSymbolIds.add(symbolId);
    }
  });

  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (child !== enclosingFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = stripParenExpression(child.argument);
    if (
      !isNodeOfType(returned, "Identifier") &&
      !isNodeOfType(returned, "ObjectExpression") &&
      !isNodeOfType(returned, "ArrayExpression")
    ) {
      return;
    }
    walkAst(returned, (returnChild: EsTreeNode) => {
      if (!isNodeOfType(returnChild, "Identifier")) return;
      const symbolId = scopes.symbolFor(returnChild)?.id;
      if (symbolId !== undefined) escapedSymbolIds.add(symbolId);
    });
  });

  return { escapedSymbolIds, invokedSymbolIds, releasedSymbolIds };
};

const resolveWrappedCallbackFunction = (
  debounceCall: EsTreeNode,
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): FunctionEsTreeNode | null => {
  if (!isNodeOfType(debounceCall, "CallExpression")) return null;
  const wrappedArgument = debounceCall.arguments?.[0];
  if (!wrappedArgument) return null;
  const strippedArgument = stripParenExpression(wrappedArgument);
  if (isFunctionLike(strippedArgument)) return strippedArgument;
  if (!isNodeOfType(strippedArgument, "Identifier")) return null;
  const wrappedName = strippedArgument.name;
  let resolvedFunction: FunctionEsTreeNode | null = null;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (resolvedFunction) return false;
    if (isNodeOfType(child, "FunctionDeclaration") && child.id?.name === wrappedName) {
      resolvedFunction = child;
      return false;
    }
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === wrappedName &&
      child.init
    ) {
      const initializer = stripParenExpression(child.init);
      if (isFunctionLike(initializer)) {
        resolvedFunction = initializer;
        return false;
      }
      if (
        isNodeOfType(initializer, "CallExpression") &&
        isProvenReactHookCall(initializer, new Set(["useCallback"]), scopes)
      ) {
        const callbackArgument = initializer.arguments?.[0];
        const strippedCallback = callbackArgument ? stripParenExpression(callbackArgument) : null;
        if (strippedCallback && isFunctionLike(strippedCallback)) {
          resolvedFunction = strippedCallback;
          return false;
        }
      }
    }
  });
  return resolvedFunction;
};

const WEB_STORAGE_RECEIVER_NAMES = new Set(["localStorage", "sessionStorage"]);

const chainEndsInCatch = (callNode: EsTreeNode): boolean => {
  let outermost: EsTreeNode = callNode;
  while (true) {
    const parent = outermost.parent;
    if (
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === outermost &&
      parent.parent &&
      isNodeOfType(parent.parent, "CallExpression") &&
      parent.parent.callee === parent
    ) {
      outermost = parent.parent;
      continue;
    }
    break;
  }
  return (
    isNodeOfType(outermost, "CallExpression") &&
    isNodeOfType(outermost.callee, "MemberExpression") &&
    getStaticPropertyName(outermost.callee) === "catch"
  );
};

const hasAsyncOrDomWork = (wrappedFunction: FunctionEsTreeNode): boolean => {
  if (wrappedFunction.async) return true;
  // A callback param shadowing a browser global (`(document) => ...` for a
  // domain noun) is a different binding entirely.
  const shadowedNames = new Set<string>();
  for (const param of wrappedFunction.params ?? []) {
    collectPatternNames(param as EsTreeNode, shadowedNames);
  }
  let didFindWork = false;
  walkAst(wrappedFunction, (child: EsTreeNode) => {
    if (didFindWork) return false;
    if (isNodeOfType(child, "AwaitExpression")) {
      didFindWork = true;
      return false;
    }
    const parent = child.parent;
    if (
      isNodeOfType(child, "Identifier") &&
      BROWSER_GLOBAL_NAMES.has(child.name) &&
      !shadowedNames.has(child.name) &&
      !findVariableInitializer(child, child.name) &&
      !(
        isNodeOfType(parent, "MemberExpression") &&
        !parent.computed &&
        parent.property === child
      ) &&
      !(isNodeOfType(parent, "Property") && !parent.computed && parent.key === child)
    ) {
      // Reading a metric off the global (`window.innerWidth`) into state is
      // benign after unmount; writing debounced persistence
      // (`localStorage.setItem(...)`) is the POINT of the trailing call.
      // Only calls THROUGH the global (`document.title = ...` assignments,
      // `window.scrollTo(...)`) remain DOM work.
      if (isNodeOfType(parent, "MemberExpression") && parent.object === child) {
        const isStorageReceiver =
          isNodeOfType(parent.property, "Identifier") &&
          WEB_STORAGE_RECEIVER_NAMES.has(parent.property.name);
        if (isStorageReceiver) return;
        // metric/member READ: the member is not itself called
        let cursor: EsTreeNode = parent;
        while (
          cursor.parent &&
          isNodeOfType(cursor.parent, "MemberExpression") &&
          cursor.parent.object === cursor
        ) {
          cursor = cursor.parent;
        }
        const isCalled =
          cursor.parent &&
          isNodeOfType(cursor.parent, "CallExpression") &&
          cursor.parent.callee === cursor;
        const isAssigned =
          cursor.parent &&
          isNodeOfType(cursor.parent, "AssignmentExpression") &&
          cursor.parent.left === cursor;
        if (!isCalled && !isAssigned) return;
      }
      didFindWork = true;
      return false;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const callee = child.callee;
      if (
        isNodeOfType(callee, "Identifier") &&
        callee.name === "fetch" &&
        !findVariableInitializer(callee, callee.name)
      ) {
        didFindWork = true;
        return false;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        PROMISE_CHAIN_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
        getStaticPropertyName(callee) !== "catch" &&
        !chainEndsInCatch(child)
      ) {
        didFindWork = true;
        return false;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier") &&
        WEB_STORAGE_RECEIVER_NAMES.has(callee.object.name)
      ) {
        return;
      }
    }
  });
  return didFindWork;
};

const isNullishRefInitializer = (expression: EsTreeNode | undefined): boolean => {
  if (!expression) return true;
  const initializer = stripParenExpression(expression);
  return (
    (isNodeOfType(initializer, "Literal") && initializer.value === null) ||
    (isNodeOfType(initializer, "Identifier") && initializer.name === "undefined") ||
    (isNodeOfType(initializer, "UnaryExpression") && initializer.operator === "void")
  );
};

const isUnmountClearedRefCurrentRead = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    getStaticPropertyName(memberExpression) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(memberExpression.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol) return true;
  if (!symbol.initializer) return false;
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "CallExpression") &&
    isProvenReactHookCall(initializer, USE_REF_HOOK_NAMES, scopes) &&
    isNullishRefInitializer(initializer.arguments?.[0] as EsTreeNode | undefined)
  );
};

const startsWithNullRefGuard = (
  wrappedFunction: FunctionEsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(wrappedFunction.body, "BlockStatement")) return false;
  // TS narrowing hoists the read: `const el = ref.current; if (!el) return;`
  // (or an optional-chained measurement) — collect leading bindings seeded
  // from a `.current` read, then find the early-return guard among the
  // leading statements.
  const currentSeededNames = new Set<string>();
  const readsCurrentOrSeeded = (root: EsTreeNode): boolean => {
    let found = false;
    walkAst(root, (child: EsTreeNode) => {
      if (found) return false;
      if (isUnmountClearedRefCurrentRead(child, scopes)) {
        found = true;
        return false;
      }
      if (isNodeOfType(child, "Identifier") && currentSeededNames.has(child.name)) {
        found = true;
        return false;
      }
    });
    return found;
  };
  for (const statement of wrappedFunction.body.body ?? []) {
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      (statement.declarations ?? []).every(
        (declarator) => declarator.init && readsCurrentOrSeeded(declarator.init as EsTreeNode),
      )
    ) {
      for (const declarator of statement.declarations ?? []) {
        if (isNodeOfType(declarator.id, "Identifier")) currentSeededNames.add(declarator.id.name);
      }
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      const consequent = statement.consequent;
      const isEarlyReturn =
        isNodeOfType(consequent, "ReturnStatement") ||
        (isNodeOfType(consequent, "BlockStatement") &&
          isNodeOfType(consequent.body?.[0], "ReturnStatement"));
      return isEarlyReturn && readsCurrentOrSeeded(statement.test as EsTreeNode);
    }
    return false;
  }
  return false;
};

export const debounceNoCleanup = defineRule({
  id: "debounce-no-cleanup",
  title: "Memoized debounce never cancelled on unmount",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "A debounced/throttled callback holds a pending timer that still fires after unmount, so add `useEffect(() => () => debounced.cancel(), [debounced])` to cancel the trailing invocation when the component tears down.",
  create: (context: RuleContext) => {
    const functionUsageIndexes = new WeakMap<EsTreeNode, DebounceFunctionUsageIndex>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isProvenReactHookCall(node, DEBOUNCE_WRAPPER_HOOK_NAMES, context.scopes)) return;
        const debounceCall = findDebounceCallInHookInitializer(node);
        if (!debounceCall) return;
        if (hasTrailingFalseOption(debounceCall, context.scopes, node)) return;

        const initializerRoot = findTransparentExpressionRoot(node);
        const declarator = initializerRoot.parent;
        if (
          !isNodeOfType(declarator, "VariableDeclarator") ||
          declarator.init !== initializerRoot ||
          !isNodeOfType(declarator.id, "Identifier")
        ) {
          return;
        }
        const bindingName = declarator.id.name;
        const enclosingFunction = findEnclosingFunction(node);
        if (!enclosingFunction) return;
        let functionUsageIndex = functionUsageIndexes.get(enclosingFunction);
        if (!functionUsageIndex) {
          functionUsageIndex = buildFunctionUsageIndex(enclosingFunction, context.scopes);
          functionUsageIndexes.set(enclosingFunction, functionUsageIndex);
        }

        const aliases = collectBindingAliases(declarator.id, context.scopes, {
          includeReactRefContainers: true,
        });
        const aliasSymbolIds = new Set(
          aliases.flatMap((alias) => {
            const symbolId = context.scopes.symbolFor(alias)?.id;
            return symbolId === undefined ? [] : [symbolId];
          }),
        );
        if (
          [...aliasSymbolIds].some((symbolId) => functionUsageIndex.releasedSymbolIds.has(symbolId))
        ) {
          return;
        }
        if (
          [...aliasSymbolIds].some((symbolId) => functionUsageIndex.escapedSymbolIds.has(symbolId))
        ) {
          return;
        }
        if (
          ![...aliasSymbolIds].some((symbolId) => functionUsageIndex.invokedSymbolIds.has(symbolId))
        ) {
          return;
        }

        const wrappedCallback = resolveWrappedCallbackFunction(
          debounceCall,
          enclosingFunction,
          context.scopes,
        );
        if (!wrappedCallback) return;
        if (!hasAsyncOrDomWork(wrappedCallback)) return;
        if (startsWithNullRefGuard(wrappedCallback, context.scopes)) return;

        context.report({
          node: debounceCall,
          message: `\`${bindingName}\` keeps a pending debounced/throttled call that fires after unmount because nothing cancels it; return \`() => ${bindingName}.cancel()\` from a useEffect so the trailing call is dropped on teardown.`,
        });
      },
    };
  },
});
