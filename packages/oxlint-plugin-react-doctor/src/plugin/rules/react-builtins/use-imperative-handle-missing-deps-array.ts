import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const HOOK_NAME = "useImperativeHandle";

const isReactImportSpecifierFor = (
  node: EsTreeNode,
  hookName: string
): boolean => {
  if (!isNodeOfType(node, "ImportSpecifier")) return false;
  const declaration = node.parent;
  if (!declaration || !isNodeOfType(declaration, "ImportDeclaration"))
    return false;
  if (declaration.source.value !== "react") return false;
  return getImportedName(node) === hookName;
};

// The callee must resolve to React's useImperativeHandle: a bare identifier
// whose binding is an import (or an aliased import), or a `<obj>.useImperativeHandle`
// member call. A locally-shadowed function of the same name (non-import
// binding) is skipped.
const isReactUseImperativeHandleCall = (
  node: EsTreeNodeOfType<"CallExpression">
): boolean => {
  const callee = node.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    return (
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === HOOK_NAME
    );
  }
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  if (
    binding?.initializer &&
    isReactImportSpecifierFor(binding.initializer, HOOK_NAME)
  ) {
    return true;
  }
  // No binding at all (bare `useImperativeHandle(...)` with the import elided)
  // is treated as the hook; a resolved NON-import binding is a local shadow.
  return callee.name === HOOK_NAME && !binding;
};

// Reactive values a handle can capture: props (the component's first parameter
// object and names destructured from it) and useState values. Refs, setters,
// and module-scope constants are stable and intentionally excluded.
const collectReactiveNames = (componentFunction: EsTreeNode): Set<string> => {
  const reactiveNames = new Set<string>();
  if (!isFunctionLike(componentFunction)) return reactiveNames;

  const firstParam = componentFunction.params?.[0];
  if (firstParam && isNodeOfType(firstParam, "Identifier")) {
    reactiveNames.add(firstParam.name);
  } else if (firstParam && isNodeOfType(firstParam, "ObjectPattern")) {
    collectPatternNames(firstParam, reactiveNames);
  }

  if (isNodeOfType(componentFunction.body, "BlockStatement")) {
    for (const statement of componentFunction.body.body ?? []) {
      if (!isNodeOfType(statement, "VariableDeclaration")) continue;
      for (const declarator of statement.declarations ?? []) {
        if (!isNodeOfType(declarator.init, "CallExpression")) continue;
        if (!isHookCall(declarator.init, "useState")) continue;
        if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
        const valueElement = declarator.id.elements?.[0];
        if (isNodeOfType(valueElement, "Identifier"))
          reactiveNames.add(valueElement.name);
      }
    }
  }
  return reactiveNames;
};

const functionReferencesAnyName = (
  functionNode: EsTreeNode,
  names: Set<string>
): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found || !node || typeof node !== "object") return;
    if (isNodeOfType(node, "Identifier") && names.has(node.name)) {
      const parent = node.parent;
      // `something.name` where name is a property key is not a reference to it.
      if (
        parent &&
        isNodeOfType(parent, "MemberExpression") &&
        parent.property === node &&
        !parent.computed
      ) {
        return;
      }
      found = true;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item)
            visit(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(functionNode);
  return found;
};

// Resolves the createHandle argument to an inspectable function body: an inline
// arrow / function expression, or a local named function the identifier binds
// to. Returns null when the callback can't be resolved to a local function.
const resolveCreateHandleFunction = (
  createHandle: EsTreeNode
): EsTreeNode | null => {
  if (isFunctionLike(createHandle)) return createHandle;
  if (!isNodeOfType(createHandle, "Identifier")) return null;
  const binding = findVariableInitializer(createHandle, createHandle.name);
  const initializer = binding?.initializer;
  if (initializer && isFunctionLike(initializer)) return initializer;
  return null;
};

export const useImperativeHandleMissingDepsArray = defineRule({
  id: "use-imperative-handle-missing-deps-array",
  title: "useImperativeHandle called without a dependency array",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "Pass a dependency array as the third argument to `useImperativeHandle` so React rebuilds the handle only when a captured value changes. Without it, React re-creates the handle and overwrites `ref.current` on every render, breaking parents that key effects or memoization on the handle's identity.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactUseImperativeHandleCall(node)) return;
      const args = node.arguments ?? [];
      // Two args exactly: ref + createHandle, no dependency array. An empty
      // `[]` third arg counts as present and must never be flagged.
      if (args.length !== 2) return;

      const createHandleFunction = resolveCreateHandleFunction(args[1]);
      if (!createHandleFunction) return;

      const componentFunction = nearestEnclosingFunction(node);
      if (!componentFunction) return;
      const displayName =
        componentOrHookDisplayNameForFunction(componentFunction);
      if (!displayName) return;

      // Only fire when the handle captures at least one reactive value. If it
      // reads only refs (the focus/scroll idiom), rebuilding it every render
      // is harmless and must not be flagged.
      const reactiveNames = collectReactiveNames(componentFunction);
      if (reactiveNames.size === 0) return;
      if (!functionReferencesAnyName(createHandleFunction, reactiveNames))
        return;

      context.report({
        node,
        message:
          "useImperativeHandle has no dependency array, so React rebuilds the handle and overwrites ref.current on every render; pass a dependency array of the reactive values the handle captures.",
      });
    },
  }),
});
