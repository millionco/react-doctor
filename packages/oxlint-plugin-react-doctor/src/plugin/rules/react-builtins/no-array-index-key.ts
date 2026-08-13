import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAllLiteralArrayExpression } from "../../utils/is-all-literal-array-expression.js";
import { isGlobalMethodCall } from "../../utils/is-global-method-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { shouldUseCuratedPortBehavior } from "../../utils/should-use-curated-port-behavior.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE = "Your users can see & submit the wrong data when this list reorders.";

const SECOND_INDEX_METHODS: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "some",
]);

const THIRD_INDEX_METHODS: ReadonlySet<string> = new Set(["reduce", "reduceRight"]);

// Returns true when the receiver of the iteration call is provably
// "positional and stable" — its element order is determined by the
// iteration index itself, so an `index`-based key is correct by
// construction. Catches:
//   `Array.from({ length: N }).map((_, i) => ...)`
//   `Array(N).fill(...).map((_, i) => ...)`
//   `str.split(sep).map((_, i) => ...)`  (text-position iteration)
// In each of these the array's identity-vs-position is fixed by the
// source string/length — reordering can't happen, so using the index
// as the key is semantically right.
const isPositionallyStableIterationReceiver = (receiverNode: EsTreeNode): boolean => {
  const receiver = stripParenExpression(receiverNode);
  // `[lit, lit, lit].map(...)` — fixed-shape literal array, order is stable.
  if (isAllLiteralArrayExpression(receiver)) return true;
  // `[...Array(N)].map(...)` or `[...Array.from(...)].map(...)` — spread
  // of an array constructor; the result has a fixed positional shape.
  if (isNodeOfType(receiver, "ArrayExpression") && receiver.elements?.length === 1) {
    const only = receiver.elements[0];
    if (only && isNodeOfType(only, "SpreadElement")) {
      const arg = only.argument as EsTreeNode | null;
      if (arg && isPositionallyStableIterationReceiver(arg)) return true;
    }
  }
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  const callee = receiver.callee;
  // Array.from({ length: N })  /  Array.from({ length: N }, ...)
  if (
    isGlobalMethodCall(receiver, "Array", "from") &&
    receiver.arguments.length >= 1 &&
    isNodeOfType(receiver.arguments[0] as EsTreeNode, "ObjectExpression")
  ) {
    return true;
  }
  // Array(N) / new Array(N) — the result has a fixed length, can't reorder.
  if (isNodeOfType(callee, "Identifier") && callee.name === "Array") return true;
  // <expr>.split(...) — text-position iteration. Skip even if chained
  // (e.g. `text.split('\n')`).
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "split"
  ) {
    return true;
  }
  // Chained: `<expr>.fill(...).map(...)` — strip `.fill(...)` and
  // check the receiver. Pattern: `Array(N).fill(0)`.
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    (callee.property.name === "fill" || callee.property.name === "flat")
  ) {
    return isPositionallyStableIterationReceiver(callee.object as EsTreeNode);
  }
  return false;
};

// True for `Array.from(arr, (item, index) => …)`. The mapping callback
// is the SECOND argument, so the regular "callback is parent.arguments[0]"
// shape doesn't catch it.
const isArrayFromMapperCallback = (
  parentCall: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
): boolean =>
  parentCall.arguments[1] === callback && isGlobalMethodCall(parentCall, "Array", "from");

// `Array.from(source, mapper)` — the positional stability of the
// produced array depends on `source`. `{length: N}` is the placeholder
// shape (fixed-length blank slots, index IS stable); anything else
// inherits source's own stability.
const isArrayFromSourcePositionallyStable = (source: EsTreeNode): boolean => {
  if (isNodeOfType(source, "ObjectExpression")) {
    for (const property of source.properties ?? []) {
      if (!isNodeOfType(property, "Property")) continue;
      const key = property.key;
      const isLengthKey =
        (isNodeOfType(key, "Identifier") && key.name === "length") ||
        (isNodeOfType(key, "Literal") && key.value === "length");
      if (isLengthKey) return true;
    }
    return false;
  }
  return isPositionallyStableIterationReceiver(source);
};

// Find the iteration callback's index parameter binding (Identifier
// node) by walking up from the cloneElement CallExpression until we
// find an enclosing array-iteration call.
//
// Returns null if the iteration source is positionally stable (see
// `isPositionallyStableIterationReceiver` above) — `index` keys ARE
// correct in those cases.
const findIndexParameterBinding = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression")
    ) {
      const indexParam = readIteratorIndexFromCallback(current, current.parent);
      if (indexParam !== undefined) return indexParam;
      // A zero-param arrow is a pass-through helper that can't bind an
      // index, so walk past it; anything with params is its own
      // iteration boundary.
      if (current.params.length > 0) return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

const findUpstreamIndexParameterBinding = (
  node: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "CallExpression")) {
      const callee = ancestor.callee;
      if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
        const methodName = callee.property.name;
        let indexParameterPosition: number | null = null;
        if (SECOND_INDEX_METHODS.has(methodName)) indexParameterPosition = 1;
        else if (THIRD_INDEX_METHODS.has(methodName)) indexParameterPosition = 2;
        const callback = ancestor.arguments[0] as EsTreeNode | undefined;
        if (
          indexParameterPosition !== null &&
          callback &&
          (isNodeOfType(callback, "ArrowFunctionExpression") ||
            isNodeOfType(callback, "FunctionExpression"))
        ) {
          const indexParameter = callback.params[indexParameterPosition] as EsTreeNode | undefined;
          return indexParameter && isNodeOfType(indexParameter, "Identifier")
            ? indexParameter
            : null;
        }
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// Returns the index Identifier when `callback` is an iterator callback
// (and the source isn't positionally stable). Returns undefined when
// `callback` isn't an iterator at all; returns null when we recognise
// the iterator but the receiver/source is positionally stable, OR the
// index param isn't a plain Identifier — both cases mean the rule
// should NOT fire for this node, so the caller treats null as "stop".
const readIteratorIndexFromCallback = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
  parent: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"Identifier"> | null | undefined => {
  if (!parent || !isNodeOfType(parent, "CallExpression")) return undefined;
  const callee = parent.callee;
  const isFirstArg = parent.arguments[0] === callback;
  if (
    isFirstArg &&
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    const methodName = callee.property.name;
    let indexParamPosition: number | null = null;
    if (SECOND_INDEX_METHODS.has(methodName)) indexParamPosition = 1;
    else if (THIRD_INDEX_METHODS.has(methodName)) indexParamPosition = 2;
    if (indexParamPosition !== null) {
      const receiver = callee.object as EsTreeNode;
      if (isPositionallyStableIterationReceiver(receiver)) return null;
      const indexParam = callback.params[indexParamPosition] as EsTreeNode | undefined;
      return indexParam && isNodeOfType(indexParam, "Identifier") ? indexParam : null;
    }
  }
  if (isArrayFromMapperCallback(parent, callback)) {
    const source = parent.arguments[0] as EsTreeNode | undefined;
    if (source && isArrayFromSourcePositionallyStable(source)) return null;
    const indexParam = callback.params[1] as EsTreeNode | undefined;
    return indexParam && isNodeOfType(indexParam, "Identifier") ? indexParam : null;
  }
  return undefined;
};

const isIndexReference = (expression: EsTreeNode, paramName: string): boolean =>
  isNodeOfType(expression, "Identifier") && expression.name === paramName;

const expressionUsesIndex = (expression: EsTreeNode, paramName: string): boolean => {
  if (isIndexReference(expression, paramName)) return true;
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return expression.expressions.some((innerExpression) =>
      isIndexReference(innerExpression as EsTreeNode, paramName),
    );
  }
  if (isNodeOfType(expression, "BinaryExpression")) {
    const usesInLeft = isIndexReference(expression.left as EsTreeNode, paramName);
    const usesInRight = isIndexReference(expression.right as EsTreeNode, paramName);
    if (usesInLeft || usesInRight) return true;
    if (
      isNodeOfType(expression.left as EsTreeNode, "BinaryExpression") &&
      expressionUsesIndex(expression.left as EsTreeNode, paramName)
    )
      return true;
    if (
      isNodeOfType(expression.right as EsTreeNode, "BinaryExpression") &&
      expressionUsesIndex(expression.right as EsTreeNode, paramName)
    )
      return true;
    return false;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    // index.toString()
    if (
      isNodeOfType(expression.callee, "MemberExpression") &&
      isNodeOfType(expression.callee.property, "Identifier") &&
      expression.callee.property.name === "toString" &&
      isIndexReference(stripParenExpression(expression.callee.object), paramName)
    ) {
      return true;
    }
    // String(index)
    if (
      isNodeOfType(expression.callee, "Identifier") &&
      expression.callee.name === "String" &&
      expression.arguments.length > 0 &&
      isIndexReference(expression.arguments[0] as EsTreeNode, paramName)
    ) {
      return true;
    }
  }
  return false;
};

const isReactCloneElement = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean =>
  isGlobalMethodCall(callExpression, "React", "cloneElement");

// Port of `oxc_linter::rules::react::no_array_index_key`, scoped to the
// `React.cloneElement(child, { key: index })` shape only. The JSX
// `key={index}` attribute is owned by the canonical
// `no-array-index-as-key` rule (Bugs category, default-on, richer
// exemptions); keeping a second JSX path here double-reported every
// hit when both rules were enabled. This opt-in port exists purely for
// the cloneElement coverage the canonical rule doesn't have.
export const noArrayIndexKey = defineRule({
  id: "no-array-index-key",
  title: "Array index used as a key",
  severity: "warn",
  // Default off: complements `no-array-index-as-key` — opt in when you
  // need `React.cloneElement` key coverage.
  defaultEnabled: false,
  recommendation:
    "Use a stable `key` from your data so reordered items keep the right state and DOM.",
  category: "Performance",
  create: (context) => {
    const shouldUseCuratedBehavior = shouldUseCuratedPortBehavior(context.settings);
    const findRelevantIndexParameter = shouldUseCuratedBehavior
      ? findIndexParameterBinding
      : findUpstreamIndexParameterBinding;
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (shouldUseCuratedBehavior) return;
        const indexBinding = findRelevantIndexParameter(node as EsTreeNode);
        if (!indexBinding) return;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== "key") {
            continue;
          }
          const value = attribute.value;
          if (!value || !isNodeOfType(value, "JSXExpressionContainer")) continue;
          const expression = value.expression;
          if (!expression || expression.type === "JSXEmptyExpression") continue;
          if (expressionUsesIndex(expression as EsTreeNode, indexBinding.name)) {
            context.report({ node: attribute, message: MESSAGE });
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactCloneElement(node)) return;
        if (node.arguments.length < 2 || node.arguments.length > 3) return;
        const propsArgument = node.arguments[1] as EsTreeNode;
        if (!isNodeOfType(propsArgument, "ObjectExpression")) return;
        const indexBinding = findRelevantIndexParameter(node as EsTreeNode);
        if (!indexBinding) return;
        for (const property of propsArgument.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          if (property.computed) continue;
          const propKey = property.key as EsTreeNode;
          let propName: string | null = null;
          if (isNodeOfType(propKey, "Identifier")) propName = propKey.name;
          else if (isNodeOfType(propKey, "Literal") && typeof propKey.value === "string") {
            propName = propKey.value;
          }
          if (propName !== "key") continue;
          if (expressionUsesIndex(property.value as EsTreeNode, indexBinding.name)) {
            context.report({ node: property, message: MESSAGE });
          }
        }
      },
    };
  },
});
