import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";

const DEBOUNCE_WRAPPER_HOOK_NAMES = new Set(["useMemo", "useCallback", "useRef"]);
const DEBOUNCE_FACTORY_NAMES = new Set(["debounce", "throttle"]);
const DEBOUNCE_RELEASE_METHOD_NAMES = new Set(["cancel", "flush"]);
const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);
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
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "trailing" &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === false,
  );
};

const collectBindingAliasNames = (searchRoot: EsTreeNode, bindingName: string): Set<string> => {
  const aliasNames = new Set([bindingName]);
  let didGrow = true;
  while (didGrow) {
    didGrow = false;
    walkAst(searchRoot, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "VariableDeclarator")) return;
      if (!isNodeOfType(child.id, "Identifier") || !child.init) return;
      if (aliasNames.has(child.id.name)) return;
      const initializer = stripParenExpression(child.init);
      if (isNodeOfType(initializer, "CallExpression")) {
        // `const searchRef = useRef(search)` — the ref box carries the
        // debounced binding, so `searchRef.current.cancel()` releases it.
        const callee = initializer.callee;
        if (
          isNodeOfType(callee, "Identifier") &&
          callee.name === "useRef" &&
          initializer.arguments?.some((argument) =>
            subtreeReferencesIdentifierName(argument as EsTreeNode, aliasNames),
          )
        ) {
          aliasNames.add(child.id.name);
          didGrow = true;
        }
        return;
      }
      if (subtreeReferencesIdentifierName(initializer, aliasNames)) {
        aliasNames.add(child.id.name);
        didGrow = true;
      }
    });
  }
  return aliasNames;
};

const hasReleaseForBinding = (searchRoot: EsTreeNode, aliasNames: ReadonlySet<string>): boolean => {
  let didRelease = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.property, "Identifier") &&
      DEBOUNCE_RELEASE_METHOD_NAMES.has(child.property.name) &&
      subtreeReferencesIdentifierName(child.object, aliasNames)
    ) {
      didRelease = true;
      return false;
    }
    // `const { cancel } = search; return () => cancel();` — destructuring a
    // release method off the binding is the same release, one syntax over.
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "ObjectPattern") &&
      child.init &&
      subtreeReferencesIdentifierName(stripParenExpression(child.init as EsTreeNode), aliasNames) &&
      (child.id.properties ?? []).some(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          isNodeOfType(property.key, "Identifier") &&
          DEBOUNCE_RELEASE_METHOD_NAMES.has(property.key.name),
      )
    ) {
      didRelease = true;
      return false;
    }
    // `useCancelOnUnmount(search)` — the binding escapes into a same-file
    // helper whose body releases its parameter.
    if (isNodeOfType(child, "CallExpression")) {
      const callee = stripParenExpression(child.callee as EsTreeNode);
      if (
        isNodeOfType(callee, "Identifier") &&
        (child.arguments ?? []).some(
          (argument) => isNodeOfType(argument, "Identifier") && aliasNames.has(argument.name),
        )
      ) {
        const binding = findVariableInitializer(callee, callee.name);
        if (binding?.initializer && isFunctionLike(binding.initializer)) {
          let helperReleases = false;
          walkAst(binding.initializer, (helperChild: EsTreeNode) => {
            if (helperReleases) return false;
            if (
              isNodeOfType(helperChild, "MemberExpression") &&
              !helperChild.computed &&
              isNodeOfType(helperChild.property, "Identifier") &&
              DEBOUNCE_RELEASE_METHOD_NAMES.has(helperChild.property.name)
            ) {
              helperReleases = true;
              return false;
            }
          });
          if (helperReleases) {
            didRelease = true;
            return false;
          }
        }
      }
    }
  });
  return didRelease;
};

const escapesViaReturn = (enclosingFunction: EsTreeNode, bindingName: string): boolean => {
  let didEscape = false;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (didEscape) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = stripParenExpression(child.argument);
    if (isNodeOfType(returned, "Identifier") && returned.name === bindingName) {
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
): boolean => {
  let didInvoke = false;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (didInvoke) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isHookCall(child, EFFECT_HOOK_NAMES)) return;
    const effectArgument = child.arguments?.[0];
    if (!effectArgument) return;
    const effectCallback = stripParenExpression(effectArgument);
    if (!isFunctionLike(effectCallback)) return;
    walkAst(effectCallback, (inner: EsTreeNode) => {
      if (didInvoke) return false;
      if (!isNodeOfType(inner, "CallExpression")) return;
      if (subtreeReferencesIdentifierName(inner.callee, bindingName)) {
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
      if (isHookCall(initializer, "useCallback") && isNodeOfType(initializer, "CallExpression")) {
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
        const memberUse = parent.parent;
        const isReadIntoExpression =
          !isNodeOfType(memberUse, "CallExpression") ||
          (memberUse.callee !== parent && !(memberUse.arguments ?? []).includes(parent as never));
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
        void isReadIntoExpression;
      }
      didFindWork = true;
      return false;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const callee = child.callee;
      if (isNodeOfType(callee, "Identifier") && callee.name === "fetch") {
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
      if (!isHookCall(node, DEBOUNCE_WRAPPER_HOOK_NAMES)) return;
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

      const aliasNames = collectBindingAliasNames(enclosingFunction, bindingName);
      if (hasReleaseForBinding(enclosingFunction, aliasNames)) return;
      if (escapesViaReturn(enclosingFunction, bindingName)) return;
      if (!isInvokedInsideEffectCallback(enclosingFunction, bindingName)) return;

      const wrappedCallback = resolveWrappedCallbackFunction(debounceCall, enclosingFunction);
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
