import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// Bundled / minified output is not actionable source; the `test-noise`
// tag already skips test/spec/story/script files.
const NON_SOURCE_FILENAME_MARKERS = ["/dist/", "/build/", ".min.", ".umd."];

const REGEX_RESULT_METHOD_NAMES = new Set(["exec", "match"]);
const TOUCH_LIST_PROPERTY_NAMES = new Set(["touches", "targetTouches"]);
const TOUCH_END_EVENT_NAMES = new Set(["touchend", "touchcancel"]);
const TOUCH_END_HANDLER_PROP_PATTERN = /^ontouch(?:end|cancel)$/i;

const MESSAGE =
  "This dereferences an array index result that can be undefined at runtime (empty list, no regex match, or a short split), which throws `Cannot read properties of undefined`. Guard with a length/emptiness check or optional chaining before the access.";

const isNumericLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "number";

// Operators that always coerce both operands to a number, so the result is a
// provably-numeric array index (`i - 1`, `n * cols`, `x % len`) — never an
// object/Record string key. `+` is excluded because it is also string
// concatenation (`obj[prefix + suffix]`), which is an object-key access.
const NUMERIC_INDEX_OPERATORS: ReadonlySet<string> = new Set(["-", "*", "/", "%"]);

// A computed index that is provably numeric: an arithmetic expression whose
// top operator coerces to number. This is the only AST-only signal (no type
// checker) that separates a real array index from a dynamic object-key read
// (`acc[category]`, `styles[breakpoint]`), which is a different concern.
const isArithmeticNumericIndex = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "BinaryExpression") && NUMERIC_INDEX_OPERATORS.has(node.operator);

// A call whose method is `.exec(...)` / `.match(...)` — the result is
// `null` on no match and each capture group can be undefined.
const isRegexResultCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  REGEX_RESULT_METHOD_NAMES.has(node.callee.property.name);

const isSplitCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "split";

// `evt.touches` / `evt.targetTouches` — an empty TouchList inside
// touchend/touchcancel handlers.
const isTouchListAccess = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  TOUCH_LIST_PROPERTY_NAMES.has(node.property.name);

const findNearestFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// True when the nearest enclosing function is wired to a
// `touchend`/`touchcancel` listener — the only touch phase where the
// TouchList is empty and `touches[0]` throws.
const isInsideTouchEndHandler = (node: EsTreeNode): boolean => {
  const handler = findNearestFunction(node);
  if (!handler) return false;
  const parent = handler.parent;
  if (!parent) return false;

  if (
    isNodeOfType(parent, "CallExpression") &&
    isNodeOfType(parent.callee, "MemberExpression") &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    parent.callee.property.name === "addEventListener" &&
    parent.arguments[1] === handler
  ) {
    const eventNameArgument = parent.arguments[0];
    return (
      Boolean(eventNameArgument) &&
      isNodeOfType(eventNameArgument as EsTreeNode, "Literal") &&
      typeof (eventNameArgument as EsTreeNodeOfType<"Literal">).value === "string" &&
      TOUCH_END_EVENT_NAMES.has(String((eventNameArgument as EsTreeNodeOfType<"Literal">).value))
    );
  }

  if (
    isNodeOfType(parent, "JSXExpressionContainer") &&
    isNodeOfType(parent.parent, "JSXAttribute")
  ) {
    const attributeName = parent.parent.name;
    return (
      isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier") &&
      TOUCH_END_HANDLER_PROP_PATTERN.test((attributeName as EsTreeNodeOfType<"JSXIdentifier">).name)
    );
  }

  if (isNodeOfType(parent, "Property") && isNodeOfType(parent.key, "Identifier")) {
    return TOUCH_END_HANDLER_PROP_PATTERN.test(parent.key.name);
  }

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    isNodeOfType(parent.left, "MemberExpression") &&
    isNodeOfType(parent.left.property, "Identifier")
  ) {
    return TOUCH_END_HANDLER_PROP_PATTERN.test(parent.left.property.name);
  }

  return false;
};

const isFunctionParameter = (bindingIdentifier: EsTreeNode): boolean => {
  let cursor: EsTreeNode = bindingIdentifier;
  let parent = cursor.parent;
  while (parent) {
    if (isNodeOfType(parent, "VariableDeclarator") || isNodeOfType(parent, "ImportSpecifier")) {
      return false;
    }
    if (
      isFunctionLike(parent) &&
      Array.isArray(parent.params) &&
      parent.params.some((param) => (param as EsTreeNode) === cursor)
    ) {
      return true;
    }
    cursor = parent;
    parent = parent.parent ?? null;
  }
  return false;
};

// A base identifier that resolves to a function parameter is a
// variable-length runtime source (the caller controls its length).
const baseIsRuntimeSourceParameter = (base: EsTreeNode): boolean => {
  if (!isNodeOfType(base, "Identifier")) return false;
  const binding = findVariableInitializer(base, base.name);
  if (!binding || binding.initializer !== null) return false;
  return isFunctionParameter(binding.bindingIdentifier);
};

// Any length/`Array.isArray`/optional-chain reference to `baseName`
// inside the enclosing function counts as a dominating guard.
const enclosingFunctionGuardsBase = (node: EsTreeNode, baseName: string): boolean => {
  const enclosingFunction = findNearestFunction(node);
  if (!enclosingFunction) return false;
  let guarded = false;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (guarded) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === baseName
    ) {
      if (child.optional) {
        guarded = true;
        return false;
      }
      if (isNodeOfType(child.property, "Identifier") && child.property.name === "length") {
        guarded = true;
        return false;
      }
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.object, "Identifier") &&
      child.callee.object.name === "Array" &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "isArray"
    ) {
      const argument = child.arguments[0];
      if (
        argument &&
        isNodeOfType(argument as EsTreeNode, "Identifier") &&
        (argument as EsTreeNodeOfType<"Identifier">).name === baseName
      ) {
        guarded = true;
        return false;
      }
    }
  });
  return guarded;
};

// Flags an immediate deref (`.foo`, `.foo()`, further `[k]`) on the
// result of an empty-prone numeric bracket read with no dominating
// guard: (a) regex `.exec/.match` results, (b) `touches[0]` in
// touchend/touchcancel handlers, (c) `.split(delim)[k]` for k>=1, and
// (d) a provably-numeric arithmetic index into a runtime-sized parameter
// array (underflow/overflow crash) — dynamic object-key reads are excluded.
export const noArrayIndexDerefWithoutBoundsOrEmptyGuard = defineRule({
  id: "no-array-index-deref-without-bounds-or-empty-guard",
  title: "Array index result dereferenced without a guard",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "An array index read is typed `T` but is `T | undefined` at runtime, so dereferencing it on an empty list, a non-matching regex, or a short split throws. Add a length/emptiness check or optional chaining before the access.",
  create: (context: RuleContext): RuleVisitors => {
    const filename = context.filename ?? "";
    if (NON_SOURCE_FILENAME_MARKERS.some((marker) => filename.includes(marker))) return {};

    return {
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        // The deref boundary itself is optional-chained — already null-safe.
        if (node.optional) return;

        const indexRead = stripParenExpression(node.object as EsTreeNode);
        if (!isNodeOfType(indexRead, "MemberExpression") || !indexRead.computed) return;
        // `base?.[i]` guards the base being nullish already.
        if (indexRead.optional) return;

        const base = stripParenExpression(indexRead.object as EsTreeNode);
        const index = indexRead.property as EsTreeNode;

        // (a) regex exec/match result indexed then dereferenced.
        if (isRegexResultCall(base)) {
          context.report({ node, message: MESSAGE });
          return;
        }

        // (c) `.split(delim)[k]` for k >= 1 (index 0 is always present).
        if (
          isSplitCall(base) &&
          isNumericLiteral(index) &&
          Number((index as EsTreeNodeOfType<"Literal">).value) >= 1
        ) {
          context.report({ node, message: MESSAGE });
          return;
        }

        // (b) `touches[0]` / `targetTouches[0]` inside touchend/touchcancel.
        if (isTouchListAccess(base) && isInsideTouchEndHandler(node)) {
          context.report({ node, message: MESSAGE });
          return;
        }

        // (d) arithmetic (provably-numeric) index into a runtime-sized
        // parameter array with no dominating length/existence guard. Restricted
        // to arithmetic indices because a bare-identifier or member index
        // (`obj[key]`, `acc[category]`) is indistinguishable from a dynamic
        // object-key read without a type checker, and empirically those are
        // overwhelmingly Record accesses, not array indexing.
        if (isArithmeticNumericIndex(index) && baseIsRuntimeSourceParameter(base)) {
          const baseName = (base as EsTreeNodeOfType<"Identifier">).name;
          if (!enclosingFunctionGuardsBase(node, baseName)) {
            context.report({ node, message: MESSAGE });
          }
        }
      },
    };
  },
});
