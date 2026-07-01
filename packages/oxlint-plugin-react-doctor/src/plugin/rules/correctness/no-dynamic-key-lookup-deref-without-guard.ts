import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This dereferences a computed lookup whose key comes from an `as`/`keyof` cast, so the key can miss at runtime even though the cast tells TypeScript it can't; the missing key yields `undefined` and the deref throws. Guard with a presence check (`key in map`, `if (map[key])`) or optional chaining at the bracket, or route through a default.";

const NUMERIC_INDEX_NAMES = new Set(["i", "idx", "index", "j", "k", "n"]);

// The lookup key is untrusted only when it is introduced by an
// `as`/`keyof` assertion — either inline in the bracket or via an
// in-scope binding whose initializer is such a cast. A cast lies about
// the key's totality, which is exactly the runtime-crash origin.
const keyIntroducedByCast = (keyNode: EsTreeNode): boolean => {
  const key = stripGroupingParens(keyNode);
  if (isNodeOfType(key, "TSAsExpression")) return true;
  if (isNodeOfType(key, "Identifier")) {
    if (NUMERIC_INDEX_NAMES.has(key.name)) return false;
    const binding = findVariableInitializer(key, key.name);
    if (!binding || !binding.initializer) return false;
    return isNodeOfType(
      stripGroupingParens(binding.initializer),
      "TSAsExpression"
    );
  }
  return false;
};

const isNumericKey = (keyNode: EsTreeNode): boolean => {
  const key = stripGroupingParens(keyNode);
  if (isNodeOfType(key, "Literal") && typeof key.value === "number")
    return true;
  if (isNodeOfType(key, "Identifier")) return NUMERIC_INDEX_NAMES.has(key.name);
  if (isNodeOfType(key, "TSAsExpression")) {
    const target = key.typeAnnotation as EsTreeNode | undefined;
    if (target && isNodeOfType(target, "TSNumberKeyword")) return true;
    return isNumericKey(key.expression as EsTreeNode);
  }
  return false;
};

// A computed lookup `base[key]` whose result is immediately consumed.
const asComputedLookup = (
  node: EsTreeNode | null | undefined
): EsTreeNodeOfType<"MemberExpression"> | null => {
  if (!node) return null;
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "MemberExpression") && stripped.computed)
    return stripped;
  return null;
};

const referencesKeyName = (
  node: EsTreeNode | null | undefined,
  keyName: string
): boolean => {
  if (!node) return false;
  let found = false;
  const walk = (current: EsTreeNode): void => {
    if (found) return;
    if (isNodeOfType(current, "Identifier") && current.name === keyName) {
      found = true;
      return;
    }
    const record = current as unknown as Record<string, unknown>;
    for (const propertyKey of Object.keys(record)) {
      if (propertyKey === "parent") continue;
      const child = record[propertyKey];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item)
            walk(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        walk(child as EsTreeNode);
      }
    }
  };
  walk(node);
  return found;
};

// A preceding/enclosing presence check on the key (`if (map[key])`,
// `key in map`, `map[key] && ...`) makes the lookup provably present.
const isLookupGuarded = (
  derefNode: EsTreeNode,
  keyName: string | null
): boolean => {
  if (!keyName) return false;
  let child: EsTreeNode = derefNode;
  let ancestor: EsTreeNode | null = derefNode.parent ?? null;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      referencesKeyName(ancestor.test as EsTreeNode, keyName)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      (ancestor.consequent === child || ancestor.alternate === child) &&
      referencesKeyName(ancestor.test as EsTreeNode, keyName)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.right === child &&
      referencesKeyName(ancestor.left as EsTreeNode, keyName)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const statements = ancestor.body ?? [];
      const childIndex = statements.indexOf(child as never);
      for (let index = 0; index < childIndex; index += 1) {
        const statement = statements[index] as EsTreeNode;
        if (
          isNodeOfType(statement, "IfStatement") &&
          referencesKeyName(statement.test as EsTreeNode, keyName)
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const getKeyName = (keyNode: EsTreeNode): string | null => {
  const key = stripGroupingParens(keyNode);
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "TSAsExpression")) {
    const inner = stripGroupingParens(key.expression as EsTreeNode);
    if (isNodeOfType(inner, "Identifier")) return inner.name;
  }
  return null;
};

// Flags a member access, call, or destructure chained directly onto a
// computed lookup `base[key]` where `key` is introduced by an
// `as`/`keyof` cast (an untrusted keyspace) and there is no dominating
// presence guard and no optional chaining at the deref boundary. Casts
// lie about totality, so a missing key returns `undefined` and the
// immediate deref throws.
export const noDynamicKeyLookupDerefWithoutGuard = defineRule({
  id: "no-dynamic-key-lookup-deref-without-guard",
  title: "Cast-keyed lookup dereferenced without a guard",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "A computed lookup whose key comes from an `as`/`keyof` cast can miss at runtime; dereferencing that result throws `Cannot read properties of undefined`. Guard with `key in map` / `if (map[key])`, optional-chain the bracket, or route through a default helper.",
  create: (context: RuleContext) => {
    const reportForLookup = (
      derefNode: EsTreeNode,
      lookup: EsTreeNodeOfType<"MemberExpression">
    ): void => {
      // `base?.[key]` guards the base being nullish, not a missing key,
      // but a following non-optional deref still throws — so it stays
      // in scope. We only exclude an optional chain at the deref
      // boundary, handled by each caller.
      const keyNode = lookup.property as EsTreeNode;
      if (isNumericKey(keyNode)) return;
      if (!keyIntroducedByCast(keyNode)) return;
      if (isLookupGuarded(derefNode, getKeyName(keyNode))) return;
      context.report({ node: derefNode, message: MESSAGE });
    };

    return {
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        // The deref boundary is optional-chained — null-safe.
        if (node.optional) return;
        const lookup = asComputedLookup(node.object as EsTreeNode);
        if (!lookup || lookup === node) return;
        reportForLookup(node, lookup);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // `dict[key]()` — calling the looked-up element directly.
        const lookup = asComputedLookup(node.callee as EsTreeNode);
        if (!lookup) return;
        reportForLookup(node, lookup);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        // `const { field } = record[key]` — destructuring off the lookup.
        if (!node.init) return;
        if (
          !isNodeOfType(node.id, "ObjectPattern") &&
          !isNodeOfType(node.id, "ArrayPattern")
        )
          return;
        const lookup = asComputedLookup(node.init as EsTreeNode);
        if (!lookup) return;
        reportForLookup(node, lookup);
      },
    };
  },
});
