import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isAllLiteralArrayExpression } from "../../utils/is-all-literal-array-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  containsStatefulDescendant,
  PURE_SVG_PRIMITIVE_TAGS,
  STATELESS_HTML_LEAF_TAGS,
} from "../../utils/jsx-stateless-leaf.js";
import type { Rule } from "../../utils/rule.js";

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
const isPositionallyStableIterationReceiver = (receiver: EsTreeNode): boolean => {
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
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from" &&
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

// True when a key template literal mixes the index with a member of the
// iteration variable (`${item.id}-${index}`). The user is defensively
// composing identity + index — the composite key IS stable for that
// iteration, even though it mentions the index.
const templateHasIteratorMember = (
  templateLiteral: EsTreeNodeOfType<"TemplateLiteral">,
  iteratorName: string,
): boolean => {
  for (const expression of templateLiteral.expressions ?? []) {
    if (isNodeOfType(expression, "Identifier") && expression.name === iteratorName) return true;
    if (
      isNodeOfType(expression, "MemberExpression") &&
      isNodeOfType(expression.object, "Identifier") &&
      expression.object.name === iteratorName
    )
      return true;
  }
  return false;
};

// True for `Array.from(arr, (item, index) => …)`. The mapping callback
// is the SECOND argument, so the regular "callback is parent.arguments[0]"
// shape doesn't catch it.
const isArrayFromMapperCallback = (
  parentCall: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
): boolean => {
  if (parentCall.arguments[1] !== callback) return false;
  const callee = parentCall.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from"
  );
};

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

// Walk up from the JSX opening element to find the iteration callback's
// per-item parameter (`item` in `arr.map((item, i) => …)` — that's
// params[0]; for `reduce`/`reduceRight` it's params[1] because params[0]
// is the accumulator). Composite keys like `` `${item.id}-${index}` ``
// stay stable across reorders, so we don't want to flag them.
//
// Walk through inner ZERO-parameter helper callbacks — the keyed JSX
// may be inside a nested `() => <X/>` lazy/render-prop arrow that
// closes over the outer iterator's `item`. A 1-or-more-param inner
// callback is its own (possibly-unknown) iteration boundary, so we
// stop there.
const findIteratorItemName = (node: EsTreeNode): string | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression")
    ) {
      const parent = current.parent;
      const callbackItemName = readIteratorItemFromCallback(current, parent);
      if (callbackItemName !== undefined) return callbackItemName;
      // Only treat zero-param arrows as pass-through helpers; any
      // function with parameters could bind a per-item name we'd
      // shadow by walking past.
      if (current.params.length > 0) return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

// Returns the per-item name when `callback` is a recognised iterator
// callback (.map/.filter/.forEach/etc. → params[0]; .reduce/.reduceRight
// → params[1]; Array.from(_, cb) → params[0]). Returns undefined when
// `callback` isn't an iterator callback, and null when it IS one but
// the param shape (rest/destructure/missing) isn't a plain Identifier.
const readIteratorItemFromCallback = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
  parent: EsTreeNode | null | undefined,
): string | null | undefined => {
  if (!parent || !isNodeOfType(parent, "CallExpression")) return undefined;
  const callee = parent.callee;
  const isFirstArg = parent.arguments[0] === callback;
  if (
    isFirstArg &&
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    const methodName = callee.property.name;
    if (SECOND_INDEX_METHODS.has(methodName)) {
      const item = callback.params[0];
      return item && isNodeOfType(item, "Identifier") ? item.name : null;
    }
    if (THIRD_INDEX_METHODS.has(methodName)) {
      // params[0] is the accumulator, params[1] is the per-item value.
      const item = callback.params[1];
      return item && isNodeOfType(item, "Identifier") ? item.name : null;
    }
  }
  if (isArrayFromMapperCallback(parent, callback)) {
    const item = callback.params[0];
    return item && isNodeOfType(item, "Identifier") ? item.name : null;
  }
  return undefined;
};

// Find the iteration callback's index parameter binding (Identifier
// node) by walking up from a JSXOpeningElement / CallExpression until
// we find an enclosing array-iteration call.
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
      // Same zero-param pass-through rule as findIteratorItemName: a
      // helper arrow can't bind an index, so walk past it; anything
      // with params is its own iteration boundary.
      if (current.params.length > 0) return null;
    }
    current = current.parent ?? null;
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
      isIndexReference(expression.callee.object as EsTreeNode, paramName)
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

const isReactCloneElement = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "cloneElement") return false;
  return isNodeOfType(callee.object, "Identifier") && callee.object.name === "React";
};

const isPureSvgPrimitiveJsxName = (jsxOpeningName: EsTreeNode): boolean =>
  isNodeOfType(jsxOpeningName, "JSXIdentifier") && PURE_SVG_PRIMITIVE_TAGS.has(jsxOpeningName.name);

const isStatelessLeafJsxName = (jsxOpeningName: EsTreeNode): boolean =>
  isNodeOfType(jsxOpeningName, "JSXIdentifier") &&
  STATELESS_HTML_LEAF_TAGS.has(jsxOpeningName.name);

// Recognises `<React.Fragment>` / `<Fragment>` / shorthand `<>` —
// fragments carry no DOM identity and no internal state, so an index
// key has no reordering hazard. (React would warn loudly if a key
// mismatch corrupted hooks, but fragments themselves can't hold any.)
const isFragmentJsxName = (jsxOpeningName: EsTreeNode): boolean => {
  if (isNodeOfType(jsxOpeningName, "JSXIdentifier")) {
    return jsxOpeningName.name === "Fragment";
  }
  if (
    isNodeOfType(jsxOpeningName, "JSXMemberExpression") &&
    isNodeOfType(jsxOpeningName.object, "JSXIdentifier") &&
    isNodeOfType(jsxOpeningName.property, "JSXIdentifier") &&
    jsxOpeningName.object.name === "React" &&
    jsxOpeningName.property.name === "Fragment"
  ) {
    return true;
  }
  return false;
};

// Port of `oxc_linter::rules::react::no_array_index_key`.
export const noArrayIndexKey = defineRule<Rule>({
  id: "no-array-index-key",
  title: "Array index used as a key",
  severity: "warn",
  // Default off: duplicate of `no-array-index-as-key`, which is the
  // canonical rule (Bugs category, friendlier message). Both fire on the
  // same `key={index}` JSX, so keeping both double-reports. This oxc port
  // adds `React.cloneElement` coverage — opt in if you need that edge.
  defaultEnabled: false,
  recommendation:
    "Use a stable `key` from your data so reordered items keep the right state and DOM.",
  category: "Performance",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const keyAttribute = hasJsxPropIgnoreCase(node.attributes, "key");
      if (!keyAttribute) return;
      if (!keyAttribute.value || !isNodeOfType(keyAttribute.value, "JSXExpressionContainer")) {
        return;
      }
      const expression = keyAttribute.value.expression as EsTreeNode;
      if (expression.type === "JSXEmptyExpression") return;
      // Fragments don't hold state or DOM identity — even if the key
      // is the index, React's reconciler only uses it to match
      // children at the same position, and a fragment misidentification
      // has no observable consequence.
      if (isFragmentJsxName(node.name as EsTreeNode)) return;
      // SVG primitives (`<g>`, `<path>`, `<line>`, …) have no DOM
      // state to corrupt; reorders just re-diff attributes.
      if (isPureSvgPrimitiveJsxName(node.name as EsTreeNode)) return;
      const indexBinding = findIndexParameterBinding(node as EsTreeNode);
      if (!indexBinding) return;
      if (!expressionUsesIndex(expression, indexBinding.name)) return;
      // Composite key with iterator member identity: `${item.id}-${index}`
      // — the index is just a defensive uniqueness fallback, the real
      // identity is `item.id`. Skip.
      if (isNodeOfType(expression, "TemplateLiteral")) {
        const itemName = findIteratorItemName(node as EsTreeNode);
        if (itemName && templateHasIteratorMember(expression, itemName)) return;
        // Even when we can't resolve the iterator binding (nested
        // helper closures hide it from `findIteratorItemName`), a
        // template that interpolates something other than the bare
        // index — `${path}-${change.name}-${i}` — is composing
        // identity from an outer-scope value the user picked
        // explicitly. The hash collision risk that the rule guards
        // against (two siblings with the same key) requires the
        // OTHER interpolations to be stable per render, which the
        // user almost always arranges (route, route segment, parent
        // record id). False-positive cost dominates here — skip.
        const interpolations = expression.expressions ?? [];
        let interpolationsBeyondIndex = 0;
        for (const interpolation of interpolations) {
          if (isIndexReference(interpolation as EsTreeNode, indexBinding.name)) continue;
          interpolationsBeyondIndex += 1;
          if (interpolationsBeyondIndex >= 1) break;
        }
        if (interpolationsBeyondIndex >= 1) return;
      }
      // String-concatenation composite: `"prefix-" + i` is just a
      // namespaced bare index (no extra uniqueness signal) — keep
      // flagging. `outerVar + "-" + i` is composite — skip. The
      // template-literal branch above already covers the modern
      // shape; this catches the legacy concat form.
      if (isNodeOfType(expression, "BinaryExpression") && expression.operator === "+") {
        let interpolationsBeyondIndex = 0;
        const walkOperand = (operand: EsTreeNode): void => {
          if (isNodeOfType(operand, "BinaryExpression") && operand.operator === "+") {
            walkOperand(operand.left as EsTreeNode);
            walkOperand(operand.right as EsTreeNode);
            return;
          }
          if (isIndexReference(operand, indexBinding.name)) return;
          // String literal segments (`'prefix-'`) carry no identity —
          // skip so `'foo-' + i` still flags.
          if (
            isNodeOfType(operand, "Literal") &&
            typeof (operand as { value: unknown }).value === "string"
          ) {
            return;
          }
          interpolationsBeyondIndex += 1;
        };
        walkOperand(expression);
        if (interpolationsBeyondIndex >= 1) return;
      }
      // Stateless HTML leaf (`<div>`, `<li>`, `<span>`, etc.) whose
      // descendants are ALL pure-content (no `<input>`, `<button>`,
      // `<select>`, `<video>`, no custom PascalCase components, no
      // function-call expressions returning unknown JSX). Reordering
      // can't corrupt any DOM-managed state because there isn't any.
      if (isStatelessLeafJsxName(node.name as EsTreeNode)) {
        // node.parent should be the JSXElement; if not, fall through.
        const jsxElement = node.parent;
        if (jsxElement && isNodeOfType(jsxElement, "JSXElement")) {
          if (!containsStatefulDescendant(jsxElement as EsTreeNode)) return;
        }
      }
      context.report({ node: keyAttribute, message: MESSAGE });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactCloneElement(node)) return;
      if (node.arguments.length < 2 || node.arguments.length > 3) return;
      const propsArgument = node.arguments[1] as EsTreeNode;
      if (!isNodeOfType(propsArgument, "ObjectExpression")) return;
      const indexBinding = findIndexParameterBinding(node as EsTreeNode);
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
  }),
});
