import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";

const MESSAGE =
  "`JSON.parse(JSON.stringify(x))` deep-clones by re-serializing: it is slow on large objects and silently drops `undefined`, functions, `Date`/`Map`/`Set`, and cyclic references. Use `structuredClone(x)`.";

// `JSON.<method>(...)` with a non-computed `JSON` member callee. Computed
// access (`JSON["parse"]`) is a v1 non-goal: it is vanishingly rare and
// keeping the matcher to plain member access avoids over-reaching.
const isJsonMethodCall = (
  node: EsTreeNode,
  method: string,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "JSON" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === method
  );
};

// A `JSON.parse(JSON.stringify(x))` round-trip inside a `snapshot*`
// helper is serialization-for-persistence (localStorage / sync-storage),
// not a general deep clone — the values are JSON-serializable by
// definition, so the `structuredClone` advice (preserve Date/Map/Set/
// cycles) is moot. `clone`-named helpers are intentionally NOT exempt:
// those are the deep clones the rule exists to redirect.
const SNAPSHOT_FUNCTION_NAME_PATTERN = /snapshot/i;

const getName = (candidate: EsTreeNode | null | undefined): string | null => {
  if (!candidate) return null;
  if (isNodeOfType(candidate, "Identifier")) return candidate.name;
  return null;
};

const isInsideSnapshotHelper = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      const directName = isNodeOfType(current, "ArrowFunctionExpression")
        ? null
        : getName(current.id);
      const parent = current.parent;
      let boundName: string | null = directName;
      if (!boundName && parent && isNodeOfType(parent, "VariableDeclarator")) {
        boundName = getName(parent.id);
      }
      if (
        !boundName &&
        parent &&
        (isNodeOfType(parent, "Property") || isNodeOfType(parent, "MethodDefinition")) &&
        isNodeOfType(parent.key, "Identifier")
      ) {
        boundName = parent.key.name;
      }
      // The NEAREST named function-like ancestor decides: a lowercase
      // `snapshot*` helper name marks serialization-for-persistence, while
      // an uppercase-first name is a React component — a plain deep clone
      // in a component handler is exactly what the rule redirects, no
      // matter which `Snapshot*`-named ancestor encloses it. Anonymous
      // wrappers (inline callbacks) are transparent.
      if (boundName) {
        return SNAPSHOT_FUNCTION_NAME_PATTERN.test(boundName) && !isReactComponentName(boundName);
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

export const noJsonParseStringifyClone = defineRule({
  id: "no-json-parse-stringify-clone",
  title: "JSON parse/stringify deep clone",
  severity: "warn",
  recommendation:
    "Replace `JSON.parse(JSON.stringify(value))` with `structuredClone(value)`. It is faster and preserves Dates, Maps, Sets, and cyclic references.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isJsonMethodCall(node, "parse")) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || !isJsonMethodCall(firstArgument, "stringify")) return;
      // A function or array replacer (`JSON.stringify(x, (k, v) => …)`,
      // `JSON.stringify(x, ["a", "b"])`) transforms/filters the output, which
      // `structuredClone` cannot reproduce — so this is not a plain clone.
      const replacer = firstArgument.arguments?.[1];
      if (isFunctionLike(replacer) || isNodeOfType(replacer, "ArrayExpression")) return;
      // Symmetric to the replacer: an inline function reviver
      // (`JSON.parse(…, (k, v) => …)`) transforms the parsed values, which
      // `structuredClone` cannot reproduce either.
      const reviver = node.arguments?.[1];
      if (isFunctionLike(reviver)) return;
      if (isInsideSnapshotHelper(node)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
