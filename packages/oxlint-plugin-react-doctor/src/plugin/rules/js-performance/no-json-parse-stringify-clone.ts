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

// A `JSON.parse(JSON.stringify(x))` round-trip inside a `snapshot*`,
// `serialize*`, or `*ToJson`-named helper is serialization — the lossy
// JSON coercion (drop functions/undefined, Date → ISO string) is the
// point, so the `structuredClone` advice (preserve Date/Map/Set/cycles)
// would change behavior. `clone`-named helpers are intentionally NOT
// exempt: those are the deep clones the rule exists to redirect.
const SNAPSHOT_FUNCTION_NAME_PATTERN = /snapshot|serializ|tojson/i;

// `const normalizedDate = JSON.parse(JSON.stringify(date))` uses the
// round-trip to coerce values into their JSON form on purpose;
// `structuredClone` would preserve the original types and change behavior.
const NORMALIZATION_BINDING_NAME_PATTERN = /normali[sz]/i;

const isAssignedToNormalizationBinding = (node: EsTreeNode): boolean => {
  const holder = node.parent;
  return Boolean(
    holder &&
    isNodeOfType(holder, "VariableDeclarator") &&
    isNodeOfType(holder.id, "Identifier") &&
    NORMALIZATION_BINDING_NAME_PATTERN.test(holder.id.name),
  );
};

// `catch (err) { … JSON.parse(JSON.stringify(err)) … }` strips a thrown
// value to JSON-safe plain data (postMessage / logging): `structuredClone`
// throws on non-cloneable fields and preserves what the code intends to
// drop.
const isCatchParameterRoundTrip = (stringifyCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const argument = stringifyCall.arguments?.[0];
  if (!argument || !isNodeOfType(argument, "Identifier")) return false;
  let current: EsTreeNode | null | undefined = stringifyCall.parent;
  while (current) {
    if (
      isFunctionLike(current) &&
      (current.params ?? []).some(
        (parameter) => isNodeOfType(parameter, "Identifier") && parameter.name === argument.name,
      )
    ) {
      return false;
    }
    if (
      isNodeOfType(current, "CatchClause") &&
      isNodeOfType(current.param, "Identifier") &&
      current.param.name === argument.name
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

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
  // Hermes (the default React Native / Expo JS engine) has no global
  // `structuredClone`, so the recommended rewrite would crash at runtime.
  disabledWhen: ["react-native"],
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
      if (isAssignedToNormalizationBinding(node)) return;
      if (isCatchParameterRoundTrip(firstArgument)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
