import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
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
  bindings: ReturnType<typeof collectUseStateBindings>,
  scopes: ScopeAnalysis,
): SetterValueObservations => {
  const plainFedSetterNames = new Set<string>();
  const opaqueFedSetterNames = new Set<string>();
  const callbackRefSetterNames = new Set<string>();
  for (const binding of bindings) {
    if (!isNodeOfType(binding.declarator.id, "ArrayPattern")) continue;
    const setterIdentifier = binding.declarator.id.elements?.[1];
    if (!isNodeOfType(setterIdentifier, "Identifier")) continue;
    const setterSymbol = scopes.symbolFor(setterIdentifier);
    if (!setterSymbol) continue;
    for (const reference of setterSymbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      if (isNodeOfType(parent, "JSXExpressionContainer")) {
        const attribute = parent.parent;
        if (
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name === "ref"
        ) {
          callbackRefSetterNames.add(binding.setterName);
        }
        continue;
      }
      if (!isNodeOfType(parent, "CallExpression") || parent.callee !== referenceRoot) continue;
      const argument = parent.arguments?.[0];
      if (!argument || isNodeOfType(argument, "SpreadElement")) continue;
      const unwrapped = stripParenExpression(argument);
      if (isNullOrUndefinedExpression(unwrapped)) continue;
      if (producesPlainStateValue(unwrapped)) {
        plainFedSetterNames.add(binding.setterName);
        continue;
      }
      if (producesOpaqueInstanceValue(unwrapped)) {
        opaqueFedSetterNames.add(binding.setterName);
      }
    }
  }
  return { plainFedSetterNames, opaqueFedSetterNames, callbackRefSetterNames };
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
      const scopes = context.scopes;
      const bindings = collectUseStateBindings(componentBody, scopes);
      if (bindings.length === 0) return;

      // A `x.y = ...` assignment or a `x.push(...)` mutating-method call
      // is only React-owned-state mutation when the state plausibly holds
      // React-managed data — see `initializerMarksPlainState` for the exact
      // boundary between plain data and opaque third-party instances.
      const setterValueObservations = collectSetterValueObservations(bindings, scopes);
      const plainStateValueNames = new Set<string>();
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
        plainStateValueNames.add(binding.valueName);
      }

      for (const binding of bindings) {
        if (!plainStateValueNames.has(binding.valueName)) continue;
        if (!isNodeOfType(binding.declarator.id, "ArrayPattern")) continue;
        const stateIdentifier = binding.declarator.id.elements?.[0];
        if (!isNodeOfType(stateIdentifier, "Identifier")) continue;
        const stateSymbol = scopes.symbolFor(stateIdentifier);
        if (!stateSymbol) continue;
        for (const reference of stateSymbol.references) {
          let expressionRoot = findTransparentExpressionRoot(reference.identifier);
          while (
            isNodeOfType(expressionRoot.parent, "MemberExpression") &&
            expressionRoot.parent.object === expressionRoot
          ) {
            expressionRoot = findTransparentExpressionRoot(expressionRoot.parent);
          }
          const parent = expressionRoot.parent;
          if (
            isNodeOfType(parent, "AssignmentExpression") &&
            parent.left === expressionRoot &&
            isNodeOfType(expressionRoot, "MemberExpression")
          ) {
            context.report({
              node: parent,
              message: `React can't tell you changed "${binding.valueName}" in place, so this update can be skipped or lost.`,
            });
            continue;
          }
          if (
            !isNodeOfType(parent, "CallExpression") ||
            parent.callee !== expressionRoot ||
            !isNodeOfType(expressionRoot, "MemberExpression") ||
            !isNodeOfType(expressionRoot.property, "Identifier")
          ) {
            continue;
          }
          const methodName = expressionRoot.property.name;
          if (!MUTATING_ARRAY_METHODS.has(methodName)) continue;
          context.report({
            node: parent,
            message: `React can't tell .${methodName}() changed "${binding.valueName}" in place, so this update can be skipped or lost.`,
          });
        }
      }
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
