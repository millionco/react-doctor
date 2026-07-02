import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Global producers whose result is always plain React-owned data — never an
// opaque third-party instance: `Array(5)`, `structuredClone(defaults)`.
const PLAIN_DATA_PRODUCER_GLOBAL_NAMES = new Set(["Array", "structuredClone"]);
const PLAIN_DATA_ARRAY_STATIC_METHODS = new Set(["from", "of"]);

const isNullOrUndefinedExpression = (expression: EsTreeNode): boolean =>
  (isNodeOfType(expression, "Literal") && expression.value === null) ||
  (isNodeOfType(expression, "Identifier") && expression.name === "undefined");

const isPlainDataProducerCall = (expression: EsTreeNode): boolean => {
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = expression.callee;
  if (isNodeOfType(callee, "Identifier")) {
    return PLAIN_DATA_PRODUCER_GLOBAL_NAMES.has(callee.name);
  }
  if (!isNodeOfType(callee, "MemberExpression") || !isNodeOfType(callee.property, "Identifier")) {
    return false;
  }
  if (isNodeOfType(callee.object, "Identifier") && callee.object.name === "Array") {
    return PLAIN_DATA_ARRAY_STATIC_METHODS.has(callee.property.name);
  }
  // `Array(5).fill(0)`-style chains: a method called on plain data yields
  // plain data, not an opaque instance.
  return producesPlainStateValue(callee.object);
};

const producesPlainStateValue = (expression: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "ObjectExpression") || isNodeOfType(unwrapped, "ArrayExpression")) {
    return true;
  }
  if (isNullOrUndefinedExpression(unwrapped)) return true;
  return isPlainDataProducerCall(unwrapped);
};

// True when a `useState(...)` initializer marks the binding as React-owned
// plain data, so an in-place write is the classic lost-update bug:
//   - object / array literals, incl. TS wrappers (`[] as Item[]`, `{} satisfies X`)
//   - `null` / `undefined` / no argument — the value arrives later through the
//     setter, and mutating it in place still never redraws (the wangeditor
//     `const [editor] = useState(null)` + `editor.field = fn` bench bug)
//   - plain-data producers: `Array(...)`, `Array.from(...)`, `Array.of(...)`,
//     `structuredClone(...)` and method chains on them
//   - lazy initializers whose top-level return produces any of the above — a
//     return nested inside another function belongs to that inner scope
// Everything else (`new TrackQueue()`, `createEditor(el)`, another binding)
// is treated as an opaque instance whose fields and methods are its
// imperative API, not render state. That exemption also skips plain data
// flowing in from props or helper calls (`useState(props.initialItems)`,
// `useState(getDefaultFilters())`) — a deliberate, known false-negative
// trade-off until receiver typing can separate the two.
const initializerMarksPlainState = (initializerArgument: EsTreeNode | undefined): boolean => {
  if (!initializerArgument) return true;
  const unwrapped = stripParenExpression(initializerArgument);
  if (
    isNodeOfType(unwrapped, "ArrowFunctionExpression") ||
    isNodeOfType(unwrapped, "FunctionExpression")
  ) {
    const lazyBody = unwrapped.body;
    if (!isNodeOfType(lazyBody, "BlockStatement")) return producesPlainStateValue(lazyBody);
    return (lazyBody.body ?? []).some(
      (statement) =>
        isNodeOfType(statement, "ReturnStatement") &&
        statement.argument != null &&
        producesPlainStateValue(statement.argument),
    );
  }
  return producesPlainStateValue(unwrapped);
};

const collectFunctionLocalBindings = (functionNode: EsTreeNode): Set<string> => {
  const localBindings = new Set<string>();
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return localBindings;
  }
  for (const param of functionNode.params ?? []) {
    collectPatternNames(param, localBindings);
  }
  if (isNodeOfType(functionNode.body, "BlockStatement")) {
    for (const statement of functionNode.body.body ?? []) {
      if (!isNodeOfType(statement, "VariableDeclaration")) continue;
      for (const declarator of statement.declarations ?? []) {
        collectPatternNames(declarator.id, localBindings);
      }
    }
  }
  return localBindings;
};

// HACK: walks the component AST while tracking which state names are
// SHADOWED in the current scope by a nested function's params or
// var/let/const declarations. Without this, a handler that locally
// re-binds the state name (e.g. `const items = raw.split(",")` then
// `items.push(x)`) gets falsely flagged. We don't do real scope
// analysis (would need eslint-utils' ScopeManager) — just lexical
// param + top-level binding collection per function, which covers the
// >99% of real-world shadowing cases without false positives.
const walkComponentRespectingShadows = (
  node: EsTreeNode,
  shadowedStateNames: ReadonlySet<string>,
  visit: (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => void,
): void => {
  if (!node || typeof node !== "object") return;

  let nextShadowedStateNames = shadowedStateNames;
  if (isFunctionLike(node)) {
    const localBindings = collectFunctionLocalBindings(node);
    if (localBindings.size > 0) {
      const merged = new Set(shadowedStateNames);
      for (const localName of localBindings) merged.add(localName);
      nextShadowedStateNames = merged;
    }
  }

  visit(node, shadowedStateNames);

  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          walkComponentRespectingShadows(item as EsTreeNode, nextShadowedStateNames, visit);
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      walkComponentRespectingShadows(child as EsTreeNode, nextShadowedStateNames, visit);
    }
  }
};

export const noDirectStateMutation = defineRule({
  id: "no-direct-state-mutation",
  title: "State mutated in place",
  severity: "warn",
  recommendation:
    "Call the setter with a brand new value instead: `setItems([...items, newItem])`, `setItems(items.filter(x => x !== target))`, or `setItems(items.toSorted(...))`. React only redraws when the value is new, so changing it in place does nothing.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const stateValueToSetter = new Map<string, string>(
        bindings.map((binding) => [binding.valueName, binding.setterName] as const),
      );

      // A `x.y = ...` assignment or a `x.push(...)` mutating-method call
      // is only React-owned-state mutation when the state plausibly holds
      // React-managed data — see `initializerMarksPlainState` for the exact
      // boundary between plain data and opaque third-party instances.
      const plainObjectStateValueNames = new Set<string>();
      for (const binding of bindings) {
        if (!isNodeOfType(binding.declarator.init, "CallExpression")) continue;
        if (initializerMarksPlainState(binding.declarator.init.arguments?.[0])) {
          plainObjectStateValueNames.add(binding.valueName);
        }
      }

      walkComponentRespectingShadows(
        componentBody,
        new Set(),
        (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => {
          if (isNodeOfType(child, "AssignmentExpression")) {
            if (!isNodeOfType(child.left, "MemberExpression")) return;
            const rootName = getRootIdentifierName(child.left);
            if (!rootName || !stateValueToSetter.has(rootName)) return;
            if (!plainObjectStateValueNames.has(rootName)) return;
            if (currentlyShadowed.has(rootName)) return;
            context.report({
              node: child,
              message: `Your screen won't update because you change "${rootName}" in place.`,
            });
            return;
          }

          if (isNodeOfType(child, "CallExpression")) {
            const callee = child.callee;
            if (!isNodeOfType(callee, "MemberExpression")) return;
            if (!isNodeOfType(callee.property, "Identifier")) return;
            const methodName = callee.property.name;
            if (!MUTATING_ARRAY_METHODS.has(methodName)) return;
            const rootName = getRootIdentifierName(callee.object);
            if (!rootName || !stateValueToSetter.has(rootName)) return;
            if (!plainObjectStateValueNames.has(rootName)) return;
            if (currentlyShadowed.has(rootName)) return;
            context.report({
              node: child,
              message: `Your screen won't update because .${methodName}() changes "${rootName}" in place.`,
            });
          }
        },
      );
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
