import { defineRule } from "../../utils/define-rule.js";
import {
  isImportedFromModule,
  getImportedNameFromModule,
} from "../../utils/find-import-source-for-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: jotai propagates derived-atom values with `Object.is`. There
// is no shallow compare and no custom equality on a plain
// `atom((get) => ...)`. A derivation that returns a fresh
// ObjectExpression / ArrayExpression literal — OR a method-chain that
// produces a fresh array / object on every read — fails Object.is on
// every notify and re-renders every consumer, even when the field
// values didn't change. Measured: a fresh-object derivation committed
// 44× more than the equivalent `useQuery` on no-op refetches.
// Fix: split into multiple primitive derived atoms (each `Object.is`-
// dedup-able), or wrap with `selectAtom(source, fn, shallow)` from
// `jotai/utils` if a single wrapper object is genuinely required.

type FunctionExpressionLike =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">;

const isAtomFromJotai = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  const localName = callExpression.callee.name;
  if (!isImportedFromModule(callExpression, localName, "jotai")) return false;
  return getImportedNameFromModule(callExpression, localName, "jotai") === "atom";
};

const isFunctionLike = (node: EsTreeNode | null | undefined): node is FunctionExpressionLike =>
  Boolean(
    node &&
    (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")),
  );

const getFirstParameterName = (fn: FunctionExpressionLike): string | null => {
  const parameters = fn.params ?? [];
  if (parameters.length !== 1) return null;
  const first = parameters[0];
  return isNodeOfType(first, "Identifier") ? first.name : null;
};

// Array-prototype methods that always allocate a fresh array. Includes
// the immutable variants from ES2023 (`toSorted`, `toReversed`,
// `toSpliced`, `with`) plus the classic Array.prototype mutators that
// return the modified-but-fresh-shape array (`.sort()`, `.reverse()`
// — note these mutate AND return the receiver; if the receiver is a
// fresh array from `.map()` upstream, the chain still allocates).
const FRESH_ARRAY_INSTANCE_METHODS = new Set([
  "filter",
  "map",
  "flatMap",
  "slice",
  "concat",
  "flat",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
  "sort",
  "reverse",
]);

// Static methods that allocate a fresh array / object from upstream.
const FRESH_STATIC_OBJECT_CALLS: Record<string, ReadonlySet<string>> = {
  Object: new Set(["keys", "values", "entries", "fromEntries", "assign", "create"]),
  Array: new Set(["from", "of"]),
};

interface FreshReturn {
  kind: "object" | "array";
  reportNode: EsTreeNode;
}

const freshFromObjectLiteral = (expression: EsTreeNode): FreshReturn | null => {
  if (isNodeOfType(expression, "ObjectExpression")) {
    return { kind: "object", reportNode: expression };
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    return { kind: "array", reportNode: expression };
  }
  return null;
};

// Only the OUTERMOST method in the chain decides whether the atom's
// value is a fresh structure. Walking inward past non-matching methods
// produces false positives: `get(users).filter(fn).reduce(sum, 0)`
// consumes the filtered array and returns a primitive that dedupes
// via Object.is correctly — even though `.filter()` appears inside
// the chain.
const freshFromMethodChain = (expression: EsTreeNode): FreshReturn | null => {
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const callee = expression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const methodName = callee.property.name;
  if (FRESH_ARRAY_INSTANCE_METHODS.has(methodName)) {
    return { kind: "array", reportNode: expression };
  }
  // Static-method form: `Object.entries(get(x))`, `Array.from(get(x))`.
  if (isNodeOfType(callee.object, "Identifier")) {
    const staticMethods = FRESH_STATIC_OBJECT_CALLS[callee.object.name];
    if (staticMethods?.has(methodName)) {
      return {
        kind:
          callee.object.name === "Array" ||
          methodName === "keys" ||
          methodName === "values" ||
          methodName === "entries"
            ? "array"
            : "object",
        reportNode: expression,
      };
    }
  }
  return null;
};

const classifyReturnedExpression = (
  expression: EsTreeNode | null | undefined,
): FreshReturn | null => {
  if (!expression) return null;
  const inner = stripParenExpression(expression);
  const literalReturn = freshFromObjectLiteral(inner);
  if (literalReturn) return literalReturn;
  return freshFromMethodChain(inner);
};

const collectTopLevelReturnExpressions = (
  block: EsTreeNodeOfType<"BlockStatement">,
): Array<EsTreeNode | null | undefined> => {
  const returns: Array<EsTreeNode | null | undefined> = [];
  walkAst(block, (child) => {
    if (
      isNodeOfType(child, "FunctionDeclaration") ||
      isNodeOfType(child, "FunctionExpression") ||
      isNodeOfType(child, "ArrowFunctionExpression")
    ) {
      // Don't descend into nested functions — their returns belong to
      // their own control-flow scope.
      return false;
    }
    if (isNodeOfType(child, "ReturnStatement")) returns.push(child.argument);
  });
  return returns;
};

const getFreshReturnForFunction = (fn: FunctionExpressionLike): FreshReturn | null => {
  const body = fn.body;
  if (!body) return null;
  // Concise arrow body: `(get) => ({ ... })` / `(get) => [...]` / `(get) => get(x).filter(...)`.
  if (!isNodeOfType(body, "BlockStatement")) {
    return classifyReturnedExpression(body);
  }
  // Block body: every reachable return must produce a fresh structure
  // for the diagnostic to hold across every notify. If ANY return
  // emits a primitive / `get(...)` member chain, the atom can still
  // dedupe on some paths and the recommendation no longer fits.
  const returnExpressions = collectTopLevelReturnExpressions(body);
  if (returnExpressions.length === 0) return null;
  let firstFresh: FreshReturn | null = null;
  for (const returnArgument of returnExpressions) {
    const classification = classifyReturnedExpression(returnArgument);
    if (!classification) return null;
    if (!firstFresh) firstFresh = classification;
  }
  return firstFresh;
};

const functionBodyReferencesGetParameter = (
  fn: FunctionExpressionLike,
  getParameterName: string,
): boolean => {
  const body = fn.body;
  if (!body) return false;
  let found = false;
  walkAst(body, (child) => {
    if (found) return false;
    // Don't descend into nested functions — their `get(...)` calls
    // belong to their own closure and don't prove the outer atom
    // reads from upstream.
    if (
      isNodeOfType(child, "FunctionDeclaration") ||
      isNodeOfType(child, "FunctionExpression") ||
      isNodeOfType(child, "ArrowFunctionExpression")
    ) {
      if (child !== fn) return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (child.callee.name === getParameterName) {
      found = true;
      return false;
    }
  });
  return found;
};

export const jotaiDerivedAtomReturnsFreshObject = defineRule<Rule>({
  id: "jotai-derived-atom-returns-fresh-object",
  title: "Derived atom returns fresh object",
  severity: "warn",
  recommendation:
    "Split it into one derived atom per field (each compares cleanly with Object.is), or wrap with `selectAtom(source, fn, shallow)` from jotai/utils if you really need one object.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isAtomFromJotai(node)) return;
      const args = node.arguments ?? [];
      if (args.length === 0) return;
      const reader = args[0];
      if (!isFunctionLike(reader)) return;
      // Write-only / read-write atoms have a second `set` parameter
      // and produce a different propagation shape. Out of v1 scope.
      const getParameterName = getFirstParameterName(reader);
      if (!getParameterName) return;

      const freshReturn = getFreshReturnForFunction(reader);
      if (!freshReturn) return;
      // A function body that never reads upstream via `get(...)` isn't
      // a derived atom — it's a constant atom the author wrote with
      // a function. The fresh-literal cost only matters when the
      // upstream is actually being propagated.
      if (!functionBodyReferencesGetParameter(reader, getParameterName)) return;

      const shape = freshReturn.kind === "object" ? "object" : "array";
      context.report({
        node: freshReturn.reportNode,
        message: `This derived atom returns a new ${shape} each time, so jotai's Object.is check fails & re-renders every consumer on every update. Split into one atom per field, or use \`selectAtom(source, fn, shallow)\`.`,
      });
    },
  }),
});
