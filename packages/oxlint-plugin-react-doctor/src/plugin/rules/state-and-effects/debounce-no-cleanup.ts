import { defineRule } from "../../utils/define-rule.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import {
  isProvenEffectHookCall,
  isProvenReactHookCall,
} from "../../utils/is-proven-effect-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";

const DEBOUNCE_WRAPPER_HOOK_NAMES = new Set(["useMemo", "useCallback", "useRef"]);
const DEBOUNCE_FACTORY_NAMES = new Set(["debounce", "throttle"]);
const DEBOUNCE_RELEASE_METHOD_NAMES = new Set(["cancel", "flush"]);
const BROWSER_GLOBAL_NAMES = new Set(["document", "window"]);
const PROMISE_CHAIN_METHOD_NAMES = new Set(["then", "catch", "finally"]);
const SAVE_LIKE_BINDING_NAME_PATTERN = /save|persist|submit|commit|sync/i;

type FunctionEsTreeNode = EsTreeNodeOfType<
  "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
>;

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
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) {
    if (!DEBOUNCE_FACTORY_NAMES.has(callee.name)) return false;
    return isLodashModuleSource(getImportSourceForName(callee, callee.name));
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    DEBOUNCE_FACTORY_NAMES.has(callee.property.name) &&
    isNodeOfType(callee.object, "Identifier")
  ) {
    const receiverSource = getImportSourceForName(callee.object, callee.object.name);
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

const hasTrailingFalseOption = (debounceCall: EsTreeNode): boolean => {
  if (!isNodeOfType(debounceCall, "CallExpression")) return false;
  let optionsArgument: EsTreeNode | null = (debounceCall.arguments?.[2] as EsTreeNode) ?? null;
  // `debounce(fn, 500, TRACK_OPTIONS)` — resolve the options binding.
  if (optionsArgument && isNodeOfType(optionsArgument, "Identifier")) {
    const binding = findVariableInitializer(optionsArgument, optionsArgument.name);
    if (binding?.initializer) optionsArgument = stripParenExpression(binding.initializer);
  }
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return (optionsArgument.properties ?? []).some(
    (property) =>
      isNodeOfType(property, "Property") &&
      ((isNodeOfType(property.key, "Identifier") && property.key.name === "trailing") ||
        (isNodeOfType(property.key, "Literal") && property.key.value === "trailing")) &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === false,
  );
};

const collectBindingAliases = (
  searchRoot: EsTreeNode,
  bindingName: string,
  bindingIdentifier: EsTreeNode,
): Map<string, EsTreeNode> => {
  const aliases = new Map([[bindingName, bindingIdentifier]]);
  let didGrow = true;
  while (didGrow) {
    didGrow = false;
    walkAst(searchRoot, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "VariableDeclarator")) return;
      if (!isNodeOfType(child.id, "Identifier") || !child.init) return;
      if (aliases.has(child.id.name)) return;
      const initializer = stripParenExpression(child.init);
      if (isNodeOfType(initializer, "CallExpression")) {
        // `const searchRef = useRef(search)` — the ref box carries the
        // debounced binding, so `searchRef.current.cancel()` releases it.
        const callee = initializer.callee;
        if (
          isNodeOfType(callee, "Identifier") &&
          callee.name === "useRef" &&
          initializer.arguments?.some((argument) =>
            subtreeReferencesIdentifierName(argument as EsTreeNode, new Set(aliases.keys())),
          )
        ) {
          aliases.set(child.id.name, child.id);
          didGrow = true;
        }
        return;
      }
      if (subtreeReferencesIdentifierName(initializer, new Set(aliases.keys()))) {
        aliases.set(child.id.name, child.id);
        didGrow = true;
      }
    });
  }
  return aliases;
};

const receiverReferencesAlias = (
  receiver: EsTreeNode,
  aliases: ReadonlyMap<string, EsTreeNode>,
): boolean => {
  let base = stripParenExpression(receiver);
  while (isNodeOfType(base, "MemberExpression")) {
    base = stripParenExpression(base.object as EsTreeNode);
  }
  if (!isNodeOfType(base, "Identifier")) return false;
  const expectedBinding = aliases.get(base.name);
  if (!expectedBinding) return false;
  return findVariableInitializer(base, base.name)?.bindingIdentifier === expectedBinding;
};

const isReleaseFunctionReference = (
  expression: EsTreeNode,
  aliases: ReadonlyMap<string, EsTreeNode>,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return (
      DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(unwrappedExpression) ?? "") &&
      receiverReferencesAlias(unwrappedExpression.object, aliases)
    );
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const bindingIdentifier = findVariableInitializer(
    unwrappedExpression,
    unwrappedExpression.name,
  )?.bindingIdentifier;
  const property = bindingIdentifier?.parent;
  if (!isNodeOfType(property, "Property")) return false;
  const propertyName = isNodeOfType(property.key, "Identifier")
    ? property.key.name
    : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
      ? property.key.value
      : null;
  if (!propertyName || !DEBOUNCE_RELEASE_METHOD_NAMES.has(propertyName)) return false;
  const pattern = property.parent;
  const declarator = pattern?.parent;
  return (
    isNodeOfType(pattern, "ObjectPattern") &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    Boolean(declarator.init && receiverReferencesAlias(declarator.init as EsTreeNode, aliases))
  );
};

const cleanupCallsRelease = (
  cleanupFunction: EsTreeNode,
  aliases: ReadonlyMap<string, EsTreeNode>,
): boolean => {
  let didRelease = false;
  walkAst(cleanupFunction, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (child !== cleanupFunction && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isReleaseFunctionReference(child.callee as EsTreeNode, aliases)
    ) {
      didRelease = true;
      return false;
    }
  });
  return didRelease;
};

const hasReleaseForBinding = (
  searchRoot: EsTreeNode,
  aliases: ReadonlyMap<string, EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean => {
  let didRelease = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (!isNodeOfType(child, "CallExpression") || !isProvenEffectHookCall(child, scopes)) return;
    const effectCallback = child.arguments?.[0]
      ? stripParenExpression(child.arguments[0] as EsTreeNode)
      : null;
    if (!effectCallback || !isFunctionLike(effectCallback)) return;
    if (
      !isNodeOfType(effectCallback.body, "BlockStatement") &&
      isReleaseFunctionReference(effectCallback.body, aliases)
    ) {
      didRelease = true;
      return false;
    }
    didRelease = collectReturnedCleanupFunctions(effectCallback).some((cleanupFunction) =>
      cleanupCallsRelease(cleanupFunction, aliases),
    );
  });
  if (didRelease) return true;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "useUnmount" &&
      (getImportSourceForName(callee, callee.name) === "react-use" ||
        !findVariableInitializer(callee, callee.name)) &&
      child.arguments?.some((argument) =>
        isReleaseFunctionReference(argument as EsTreeNode, aliases),
      )
    ) {
      didRelease = true;
      return false;
    }
    if (!isNodeOfType(callee, "Identifier")) return;
    const helper = findVariableInitializer(callee, callee.name)?.initializer;
    if (!helper || !isFunctionLike(helper)) return;
    const matchingParameterNames = (helper.params ?? []).flatMap((parameter, parameterIndex) => {
      const argument = child.arguments?.[parameterIndex];
      return argument &&
        isNodeOfType(parameter, "Identifier") &&
        receiverReferencesAlias(argument as EsTreeNode, aliases)
        ? [parameter.name]
        : [];
    });
    if (matchingParameterNames.length === 0) return;
    walkAst(helper, (helperChild: EsTreeNode) => {
      if (didRelease) return false;
      if (!isNodeOfType(helperChild, "CallExpression")) return;
      const helperCallee = stripParenExpression(helperChild.callee);
      if (!isNodeOfType(helperCallee, "MemberExpression")) return;
      if (!DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(helperCallee) ?? "")) return;
      const receiver = stripParenExpression(helperCallee.object as EsTreeNode);
      if (isNodeOfType(receiver, "Identifier") && matchingParameterNames.includes(receiver.name)) {
        didRelease = true;
        return false;
      }
    });
  });
  return didRelease;
};

const escapesViaReturn = (
  enclosingFunction: EsTreeNode,
  bindingName: string,
  bindingIdentifier: EsTreeNode,
): boolean => {
  let didEscape = false;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (didEscape) return false;
    if (child !== enclosingFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = stripParenExpression(child.argument);
    if (
      isNodeOfType(returned, "Identifier") &&
      returned.name === bindingName &&
      findVariableInitializer(returned, bindingName)?.bindingIdentifier === bindingIdentifier
    ) {
      didEscape = true;
      return false;
    }
    if (
      (isNodeOfType(returned, "ObjectExpression") || isNodeOfType(returned, "ArrayExpression")) &&
      subtreeReferencesIdentifierName(returned, bindingName)
    ) {
      didEscape = true;
      return false;
    }
  });
  return didEscape;
};

const isInvokedInsideEffectCallback = (
  enclosingFunction: EsTreeNode,
  bindingName: string,
  bindingIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let didInvoke = false;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (didInvoke) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isProvenEffectHookCall(child, scopes)) return;
    const effectArgument = child.arguments?.[0];
    if (!effectArgument) return;
    const effectCallback = stripParenExpression(effectArgument);
    if (!isFunctionLike(effectCallback)) return;
    walkAst(effectCallback, (inner: EsTreeNode) => {
      if (didInvoke) return false;
      if (!isNodeOfType(inner, "CallExpression")) return;
      const callee = stripParenExpression(inner.callee);
      const invokesBinding =
        (isNodeOfType(callee, "Identifier") &&
          callee.name === bindingName &&
          findVariableInitializer(callee, bindingName)?.bindingIdentifier === bindingIdentifier) ||
        (isNodeOfType(callee, "MemberExpression") &&
          receiverReferencesAlias(callee.object, new Map([[bindingName, bindingIdentifier]])));
      if (invokesBinding) {
        didInvoke = true;
        return false;
      }
    });
  });
  return didInvoke;
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
    !outermost.callee.computed &&
    isNodeOfType(outermost.callee.property, "Identifier") &&
    outermost.callee.property.name === "catch"
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
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        PROMISE_CHAIN_METHOD_NAMES.has(callee.property.name) &&
        callee.property.name !== "catch" &&
        !chainEndsInCatch(child)
      ) {
        didFindWork = true;
        return false;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.object, "Identifier") &&
        WEB_STORAGE_RECEIVER_NAMES.has(callee.object.name)
      ) {
        return;
      }
    }
  });
  return didFindWork;
};

const startsWithNullRefGuard = (wrappedFunction: FunctionEsTreeNode): boolean => {
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
      if (
        isNodeOfType(child, "MemberExpression") &&
        !child.computed &&
        isNodeOfType(child.property, "Identifier") &&
        child.property.name === "current"
      ) {
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
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isProvenReactHookCall(node, DEBOUNCE_WRAPPER_HOOK_NAMES, context.scopes)) return;
      const debounceCall = findDebounceCallInHookInitializer(node);
      if (!debounceCall) return;
      if (hasTrailingFalseOption(debounceCall)) return;

      const declarator = node.parent;
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        !isNodeOfType(declarator.id, "Identifier")
      ) {
        return;
      }
      const bindingName = declarator.id.name;
      if (SAVE_LIKE_BINDING_NAME_PATTERN.test(bindingName)) return;

      const enclosingFunction = findEnclosingFunction(node);
      if (!enclosingFunction) return;

      const aliases = collectBindingAliases(enclosingFunction, bindingName, declarator.id);
      if (hasReleaseForBinding(enclosingFunction, aliases, context.scopes)) return;
      if (escapesViaReturn(enclosingFunction, bindingName, declarator.id)) return;
      if (
        !isInvokedInsideEffectCallback(
          enclosingFunction,
          bindingName,
          declarator.id,
          context.scopes,
        )
      )
        return;

      const wrappedCallback = resolveWrappedCallbackFunction(
        debounceCall,
        enclosingFunction,
        context.scopes,
      );
      if (!wrappedCallback) return;
      if (!hasAsyncOrDomWork(wrappedCallback)) return;
      if (startsWithNullRefGuard(wrappedCallback)) return;

      context.report({
        node: debounceCall,
        message: `\`${bindingName}\` keeps a pending debounced/throttled call that fires after unmount because nothing cancels it; return \`() => ${bindingName}.cancel()\` from a useEffect so the trailing call is dropped on teardown.`,
      });
    },
  }),
});
