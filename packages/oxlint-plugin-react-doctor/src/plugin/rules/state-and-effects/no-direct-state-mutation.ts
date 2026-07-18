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
const PLAIN_DATA_JSON_STATIC_METHODS = new Set(["parse"]);
const PLAIN_DATA_OBJECT_STATIC_METHODS = new Set([
  "assign",
  "entries",
  "fromEntries",
  "keys",
  "values",
]);

// Copying array transforms return a NEW plain array when the receiver is an
// array — and even on a non-array receiver they never witness an opaque
// instance being handed to the setter, so they must not count as opaque
// evidence (`setItems(items.filter(...))` is the canonical plain-state feed).
const ARRAY_COPY_METHOD_NAMES = new Set([
  "map",
  "filter",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
]);

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
  if (isNodeOfType(callee.object, "Identifier")) {
    if (callee.object.name === "Array") {
      return PLAIN_DATA_ARRAY_STATIC_METHODS.has(callee.property.name);
    }
    if (callee.object.name === "JSON") {
      return PLAIN_DATA_JSON_STATIC_METHODS.has(callee.property.name);
    }
    if (callee.object.name === "Object") {
      return PLAIN_DATA_OBJECT_STATIC_METHODS.has(callee.property.name);
    }
  }
  // `Array(5).fill(0)`-style chains: a method called on plain data yields
  // plain data, not an opaque instance.
  return producesPlainStateValue(callee.object);
};

// `new Array(9)` / `new Object()` produce the same plain data as their call
// forms (`Array(9)`, `Object()`) — the `new` spelling must not read as an
// opaque third-party instance.
const PLAIN_DATA_CONSTRUCTOR_NAMES = new Set(["Array", "Object"]);

const isPlainDataNewExpression = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "NewExpression") &&
  isNodeOfType(expression.callee, "Identifier") &&
  PLAIN_DATA_CONSTRUCTOR_NAMES.has(expression.callee.name);

const producesPlainStateValue = (expression: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "ObjectExpression") || isNodeOfType(unwrapped, "ArrayExpression")) {
    return true;
  }
  if (isPlainDataNewExpression(unwrapped)) return true;
  if (isNullOrUndefinedExpression(unwrapped)) return true;
  if (isNodeOfType(unwrapped, "MemberExpression") && getRootIdentifierName(unwrapped) === "props") {
    return true;
  }
  return isPlainDataProducerCall(unwrapped);
};

// True when a `useState(...)` initializer marks the binding as React-owned
// plain data, so an in-place write is the classic lost-update bug:
//   - object / array literals, incl. TS wrappers (`[] as Item[]`, `{} satisfies X`)
//   - `null` / `undefined` / no argument — the value arrives later through the
//     setter, and mutating it in place still never redraws (the wangeditor
//     `const [editor] = useState(null)` + `editor.field = fn` bug)
//   - plain-data producers: `Array(...)`, `Array.from(...)`, `Array.of(...)`,
//     `structuredClone(...)` and method chains on them
//   - reads off the `props` bag (`useState(props.initialItems)`) — props are
//     render data by convention
//   - lazy initializers whose top-level return produces any of the above — a
//     return nested inside another function belongs to that inner scope
// Everything else (`new TrackQueue()`, `createEditor(el)`, another binding)
// is treated as an opaque instance whose fields and methods are its
// imperative API, not render state. That exemption also skips plain data
// flowing in from helper calls (`useState(getDefaultFilters())`) — a
// deliberate, known false-negative trade-off until receiver typing can
// separate the two.
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

// A null/undefined/absent initializer only says "the value arrives later
// through the setter" — WHAT arrives decides whether in-place writes are the
// lost-update bug. When every observed setter call feeds the state an opaque
// instance (`setGainNode(audioContext.createGain())`, `setEditor(new E())`),
// the binding holds a third-party object whose fields are its imperative
// API, so it must not be classified as plain React data. Only constructor
// calls and member-method factories count as opaque evidence: a BARE helper
// call (`setEditor(createEditor(el))`) stays unclassified so the documented
// wangeditor-class lost-update detection keeps firing, and member calls that
// produce plain data (`JSON.parse(raw)`, `items.filter(...)`) stay
// unclassified so mutations on the resulting plain value are still reported.
const producesOpaqueInstanceValue = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "NewExpression")) return !isPlainDataNewExpression(expression);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = expression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (isPlainDataProducerCall(expression)) return false;
  if (
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    ARRAY_COPY_METHOD_NAMES.has(callee.property.name)
  ) {
    return false;
  }
  return true;
};

interface SetterValueObservations {
  plainFedSetterNames: ReadonlySet<string>;
  opaqueFedSetterNames: ReadonlySet<string>;
  callbackRefSetterNames: ReadonlySet<string>;
}

const collectSetterValueObservations = (
  componentBody: EsTreeNode,
  setterNames: ReadonlySet<string>,
): SetterValueObservations => {
  const plainFedSetterNames = new Set<string>();
  const opaqueFedSetterNames = new Set<string>();
  const callbackRefSetterNames = new Set<string>();
  // Shadow-respecting walk: a nested function whose param or local re-binds
  // the setter name calls its OWN function, so its argument shapes are not
  // evidence about the state binding.
  walkComponentRespectingShadows(
    componentBody,
    new Set(),
    (node: EsTreeNode, currentlyShadowed: ReadonlySet<string>): void => {
      if (isNodeOfType(node, "JSXAttribute")) {
        const attributeName = node.name;
        if (
          isNodeOfType(attributeName, "JSXIdentifier") &&
          attributeName.name === "ref" &&
          node.value &&
          isNodeOfType(node.value, "JSXExpressionContainer")
        ) {
          const expression = stripParenExpression(node.value.expression);
          if (isNodeOfType(expression, "Identifier") && setterNames.has(expression.name)) {
            callbackRefSetterNames.add(expression.name);
          }
        }
        return;
      }
      if (!isNodeOfType(node, "CallExpression")) return;
      if (!isNodeOfType(node.callee, "Identifier")) return;
      const setterName = node.callee.name;
      if (!setterNames.has(setterName) || currentlyShadowed.has(setterName)) return;
      const argument = node.arguments?.[0];
      if (!argument) return;
      const unwrapped = stripParenExpression(argument as EsTreeNode);
      if (isNullOrUndefinedExpression(unwrapped)) return;
      if (producesPlainStateValue(unwrapped)) {
        plainFedSetterNames.add(setterName);
        return;
      }
      if (producesOpaqueInstanceValue(unwrapped)) {
        opaqueFedSetterNames.add(setterName);
      }
    },
    true,
  );
  return { plainFedSetterNames, opaqueFedSetterNames, callbackRefSetterNames };
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

// `const books = []` inside a `for`/`if` block (or a `for (const book of
// ...)` binding) shadows the state name for everything nested in that
// block, exactly like a function-body declaration does.
const collectBlockScopedBindings = (node: EsTreeNode): Set<string> | null => {
  if (isNodeOfType(node, "BlockStatement")) {
    const blockBindings = new Set<string>();
    for (const statement of node.body ?? []) {
      if (!isNodeOfType(statement, "VariableDeclaration")) continue;
      for (const declarator of statement.declarations ?? []) {
        collectPatternNames(declarator.id, blockBindings);
      }
    }
    return blockBindings;
  }
  if (isNodeOfType(node, "ForStatement") && isNodeOfType(node.init, "VariableDeclaration")) {
    const blockBindings = new Set<string>();
    for (const declarator of node.init.declarations ?? []) {
      collectPatternNames(declarator.id, blockBindings);
    }
    return blockBindings;
  }
  if (
    (isNodeOfType(node, "ForOfStatement") || isNodeOfType(node, "ForInStatement")) &&
    isNodeOfType(node.left, "VariableDeclaration")
  ) {
    const blockBindings = new Set<string>();
    for (const declarator of node.left.declarations ?? []) {
      collectPatternNames(declarator.id, blockBindings);
    }
    return blockBindings;
  }
  return null;
};

// HACK: walks the component AST while tracking which state names are
// SHADOWED in the current scope by a nested function's params or
// var/let/const declarations. Without this, a handler that locally
// re-binds the state name (e.g. `const items = raw.split(",")` then
// `items.push(x)`) gets falsely flagged. We don't do real scope
// analysis (would need eslint-utils' ScopeManager) — just lexical
// param + per-block binding collection, which covers the >99% of
// real-world shadowing cases without false positives.
const walkComponentRespectingShadows = (
  node: EsTreeNode,
  shadowedStateNames: ReadonlySet<string>,
  visit: (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => void,
  isComponentBodyRoot = false,
): void => {
  if (!node || typeof node !== "object") return;

  let nextShadowedStateNames = shadowedStateNames;
  // The component body's own declarations ARE the state bindings, not
  // shadows of them — only nested blocks/functions can shadow.
  const localBindings = isComponentBodyRoot
    ? null
    : isFunctionLike(node)
      ? collectFunctionLocalBindings(node)
      : collectBlockScopedBindings(node);
  if (localBindings && localBindings.size > 0) {
    const merged = new Set(shadowedStateNames);
    for (const localName of localBindings) merged.add(localName);
    nextShadowedStateNames = merged;
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
      const bindings = collectUseStateBindings(componentBody, context.scopes);
      if (bindings.length === 0) return;

      const stateValueToSetter = new Map<string, string>(
        bindings.map((binding) => [binding.valueName, binding.setterName] as const),
      );

      // A `x.y = ...` assignment or a `x.push(...)` mutating-method call
      // is only React-owned-state mutation when the state plausibly holds
      // React-managed data — see `initializerMarksPlainState` for the exact
      // boundary between plain data and opaque third-party instances.
      const setterValueObservations = collectSetterValueObservations(
        componentBody,
        new Set(bindings.map((binding) => binding.setterName)),
      );
      const plainObjectStateValueNames = new Set<string>();
      for (const binding of bindings) {
        if (setterValueObservations.callbackRefSetterNames.has(binding.setterName)) continue;
        if (!isNodeOfType(binding.declarator.init, "CallExpression")) continue;
        const initializerArgument = binding.declarator.init.arguments?.[0];
        if (!initializerMarksPlainState(initializerArgument)) continue;
        const isNullishInitializer =
          !initializerArgument ||
          isNullOrUndefinedExpression(stripParenExpression(initializerArgument));
        if (
          isNullishInitializer &&
          setterValueObservations.opaqueFedSetterNames.has(binding.setterName) &&
          !setterValueObservations.plainFedSetterNames.has(binding.setterName)
        ) {
          continue;
        }
        plainObjectStateValueNames.add(binding.valueName);
      }

      const visitMutationCandidate = (
        child: EsTreeNode,
        currentlyShadowed: ReadonlySet<string>,
      ): void => {
        if (isNodeOfType(child, "AssignmentExpression")) {
          if (!isNodeOfType(child.left, "MemberExpression")) return;
          const rootName = getRootIdentifierName(child.left);
          if (!rootName || !stateValueToSetter.has(rootName)) return;
          if (!plainObjectStateValueNames.has(rootName)) return;
          if (currentlyShadowed.has(rootName)) return;
          context.report({
            node: child,
            message: `React can't tell you changed "${rootName}" in place, so this update can be skipped or lost.`,
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
            message: `React can't tell .${methodName}() changed "${rootName}" in place, so this update can be skipped or lost.`,
          });
        }
      };

      walkComponentRespectingShadows(componentBody, new Set(), visitMutationCandidate, true);
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
