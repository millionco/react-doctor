import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findEnclosingFunction } from "./utils/find-enclosing-function.js";

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
  const optionsArgument = debounceCall.arguments?.[2];
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
      if (isNodeOfType(initializer, "CallExpression")) return;
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
    if (!isNodeOfType(child, "MemberExpression") || child.computed) return;
    if (!isNodeOfType(child.property, "Identifier")) return;
    if (!DEBOUNCE_RELEASE_METHOD_NAMES.has(child.property.name)) return;
    if (subtreeReferencesIdentifierName(child.object, aliasNames)) {
      didRelease = true;
      return false;
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

const hasAsyncOrDomWork = (wrappedFunction: FunctionEsTreeNode): boolean => {
  if (wrappedFunction.async) return true;
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
      !(
        isNodeOfType(parent, "MemberExpression") &&
        !parent.computed &&
        parent.property === child
      ) &&
      !(isNodeOfType(parent, "Property") && !parent.computed && parent.key === child)
    ) {
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
        PROMISE_CHAIN_METHOD_NAMES.has(callee.property.name)
      ) {
        didFindWork = true;
        return false;
      }
    }
  });
  return didFindWork;
};

const startsWithNullRefGuard = (wrappedFunction: FunctionEsTreeNode): boolean => {
  if (!isNodeOfType(wrappedFunction.body, "BlockStatement")) return false;
  const firstStatement = wrappedFunction.body.body?.[0];
  if (!isNodeOfType(firstStatement, "IfStatement")) return false;
  const consequent = firstStatement.consequent;
  const isEarlyReturn =
    isNodeOfType(consequent, "ReturnStatement") ||
    (isNodeOfType(consequent, "BlockStatement") &&
      isNodeOfType(consequent.body?.[0], "ReturnStatement"));
  if (!isEarlyReturn) return false;
  let didTestRefCurrent = false;
  walkAst(firstStatement.test, (child: EsTreeNode) => {
    if (didTestRefCurrent) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === "current"
    ) {
      didTestRefCurrent = true;
      return false;
    }
  });
  return didTestRefCurrent;
};

export const debounceNoCleanup = defineRule({
  id: "debounce-no-cleanup",
  title: "Memoized debounce never cancelled on unmount",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "A debounced/throttled callback holds a pending timer that still fires after unmount, so add `useEffect(() => () => debounced.cancel(), [])` to cancel the trailing invocation when the component tears down.",
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
