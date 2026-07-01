import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DEBOUNCE_WRAPPER_HOOK_NAMES = new Set(["useMemo", "useCallback", "useRef"]);
const DEBOUNCE_FACTORY_NAMES = new Set(["debounce", "throttle"]);
const DEBOUNCE_RELEASE_METHOD_NAMES = new Set(["cancel", "flush"]);

const isLodashModuleSource = (source: string | null): boolean =>
  Boolean(
    source && (source === "lodash" || source.startsWith("lodash/") || source === "lodash-es"),
  );

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

const subtreeReferencesName = (node: EsTreeNode, bindingName: string): boolean => {
  let didReference = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didReference) return false;
    if (isNodeOfType(child, "Identifier") && child.name === bindingName) {
      didReference = true;
      return false;
    }
  });
  return didReference;
};

const findEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "FunctionDeclaration")
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasReleaseCallForBinding = (searchRoot: EsTreeNode, bindingName: string): boolean => {
  let didRelease = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (didRelease) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
    if (!isNodeOfType(callee.property, "Identifier")) return;
    if (!DEBOUNCE_RELEASE_METHOD_NAMES.has(callee.property.name)) return;
    if (subtreeReferencesName(callee.object, bindingName)) {
      didRelease = true;
      return false;
    }
  });
  return didRelease;
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

      const searchRoot = findEnclosingFunction(node);
      if (searchRoot && hasReleaseCallForBinding(searchRoot, bindingName)) return;

      context.report({
        node: debounceCall,
        message: `\`${bindingName}\` keeps a pending debounced/throttled call that fires after unmount because nothing cancels it; return \`() => ${bindingName}.cancel()\` from a useEffect so the trailing call is dropped on teardown.`,
      });
    },
  }),
});
