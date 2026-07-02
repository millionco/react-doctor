import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Built-in methods the language spec types as `T | undefined` / `T | null`
// on a miss: Array `find`/`findLast` (undefined), String `match` (null),
// Map/cache `get` (undefined). `pop`/`shift` are intentionally excluded —
// under a `.length` loop guard they are the idiomatic safe queue-drain —
// and `matchAll` returns an (empty) iterator, never null.
const NO_MATCH_MESSAGES: Readonly<Record<string, string>> = {
  find: "`.find(...)` returns `undefined` when nothing matches, so asserting `!` here crashes on the next access when the predicate misses; handle the missing case with optional chaining or a guard.",
  findLast:
    "`.findLast(...)` returns `undefined` when nothing matches, so asserting `!` here crashes on the next access when the predicate misses; handle the missing case with optional chaining or a guard.",
  match:
    "`.match(...)` returns `null` when the pattern does not match, so asserting `!` here crashes on the next index or access; check the result before reading it.",
  get: "`.get(...)` returns `undefined` when the key is absent, so asserting `!` here crashes on the next access when the key misses; check for the key or handle the missing value.",
};

// Normalize a `.get(...)` receiver to a comparable path key so the
// presence proof can match the exact same map: `sides` (Identifier),
// `this` (ThisExpression), or a non-computed member chain like
// `this.updateCallbacks`. Computed or deeper shapes are not comparable.
const receiverPathKey = (node: EsTreeNode): string | null => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "Identifier")) return target.name;
  if (isNodeOfType(target, "ThisExpression")) return "this";
  if (
    isNodeOfType(target, "MemberExpression") &&
    !target.computed &&
    isNodeOfType(target.property, "Identifier")
  ) {
    const objectKey = receiverPathKey(target.object as EsTreeNode);
    return objectKey ? `${objectKey}.${target.property.name}` : null;
  }
  return null;
};

// The outermost enclosing function (or Program at top level). A
// `map.get(key)!` inside a nested callback is still provably safe when the
// map is populated in the enclosing function (`for (...) sides.set(...)`),
// so the proof must look past the immediate scope up to the outermost one.
const findOutermostScope = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent;
  let outermostFunction: EsTreeNode | null = null;
  let program: EsTreeNode | null = null;
  while (ancestor) {
    if (isFunctionLike(ancestor)) outermostFunction = ancestor;
    if (isNodeOfType(ancestor, "Program")) {
      program = ancestor;
      break;
    }
    ancestor = ancestor.parent ?? null;
  }
  return outermostFunction ?? program;
};

// A `map.get(key)!` is likely safe when the same map is populated or
// checked (`map.set(...)` / `map.has(...)`) somewhere in the enclosing
// scope, so abstain there — a false negative is preferable to a false
// positive. Matches `this.updateCallbacks`-style member receivers too, not
// just bare identifiers.
const scopeProvesKeyPresence = (assertion: EsTreeNode, receiverKey: string): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let proven = false;
  walkAst(scope, (child) => {
    if (proven) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      (callee.property.name === "set" || callee.property.name === "has") &&
      receiverPathKey(callee.object as EsTreeNode) === receiverKey
    ) {
      proven = true;
      return false;
    }
  });
  return proven;
};

// The `get` branch only fires when the map's emptiness at construction is
// provable in scope: the receiver must be a local variable initialized with
// a bare `new Map()` / `new WeakMap()` (no entries argument). Parameters,
// call-initialized variables (`const sides = assignSides(...)`), `new
// Map(entries)` lookups, `this.*` fields, and unresolvable receivers all
// carry cross-function population invariants the rule cannot see, so they
// abstain.
const isBareMapConstruction = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const target = stripParenExpression(node);
  return (
    isNodeOfType(target, "NewExpression") &&
    isNodeOfType(target.callee, "Identifier") &&
    (target.callee.name === "Map" || target.callee.name === "WeakMap") &&
    target.arguments.length === 0
  );
};

const scopeDeclaresEmptyMap = (assertion: EsTreeNode, receiverName: string): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let didFindDeclaration = false;
  walkAst(scope, (child) => {
    if (didFindDeclaration) return false;
    if (!isNodeOfType(child, "VariableDeclarator")) return;
    if (!isNodeOfType(child.id, "Identifier") || child.id.name !== receiverName) return;
    if (isBareMapConstruction(child.init ? (child.init as EsTreeNode) : null)) {
      didFindDeclaration = true;
      return false;
    }
  });
  return didFindDeclaration;
};

// Normalize the regex a `.match(...)` receives so it can be compared with
// the receiver of a `.test(...)` call: same identifier, or a regex literal
// with the same source text.
const regexComparableKey = (node: EsTreeNode): string | null => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "Identifier")) return `id:${target.name}`;
  if (isNodeOfType(target, "Literal") && "regex" in target) return `regex:${target.raw}`;
  return null;
};

// `str.match(re)!` is likely on a proven-matching path when the enclosing
// scope also runs `re.test(...)` (validate-then-extract), so abstain there.
const scopeProvesMatchTested = (assertion: EsTreeNode, regexKey: string): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let proven = false;
  walkAst(scope, (child) => {
    if (proven) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "test" &&
      regexComparableKey(callee.object as EsTreeNode) === regexKey
    ) {
      proven = true;
      return false;
    }
  });
  return proven;
};

const isPredicateArgument = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(
    node &&
    (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")),
  );

export const noNonNullAssertionOnMaybeUndefinedResult = defineRule({
  id: "no-non-null-assertion-on-maybe-undefined-result",
  title: "Non-null assertion on a maybe-undefined result",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Drop the `!` on `.find`/`.match`/`.get` results and handle the miss (optional chaining, a guard, or a fallback). These built-ins return `undefined`/`null` when nothing matches, so the assertion just moves the crash one line later.",
  create: (context: RuleContext) => {
    const skipTestlikeFile = isTestlikeFilename(context.filename);
    return {
      TSNonNullExpression(node: EsTreeNodeOfType<"TSNonNullExpression">) {
        if (skipTestlikeFile) return;
        if (!isObjectOfMemberAccess(node as EsTreeNode)) return;
        const inner = stripParenExpression(node.expression as EsTreeNode);
        if (!isNodeOfType(inner, "CallExpression")) return;
        const callee = inner.callee;
        if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
        if (!isNodeOfType(callee.property, "Identifier")) return;
        const methodName = callee.property.name;
        const message = NO_MATCH_MESSAGES[methodName];
        if (!message) return;

        const args = inner.arguments ?? [];
        if (methodName === "find" || methodName === "findLast") {
          if (!isPredicateArgument(args[0] ? stripParenExpression(args[0]) : null)) return;
        }
        if (methodName === "match") {
          const pattern = args[0] ? stripParenExpression(args[0]) : null;
          const regexKey = pattern ? regexComparableKey(pattern) : null;
          if (regexKey && scopeProvesMatchTested(node as EsTreeNode, regexKey)) return;
        }
        if (methodName === "get") {
          const key = args[0] ? stripParenExpression(args[0]) : null;
          // A static literal key is often known-present; only dynamic keys
          // carry real miss risk.
          if (!key || isNodeOfType(key, "Literal")) return;
          const receiver = stripParenExpression(callee.object as EsTreeNode);
          if (!isNodeOfType(receiver, "Identifier")) return;
          if (!scopeDeclaresEmptyMap(node as EsTreeNode, receiver.name)) return;
          if (scopeProvesKeyPresence(node as EsTreeNode, receiver.name)) return;
        }

        context.report({ node, message });
      },
    };
  },
});
