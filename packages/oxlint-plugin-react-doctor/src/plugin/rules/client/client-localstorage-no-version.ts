import { defineRule } from "../../utils/define-rule.js";
import { isGlobalMethodCall } from "../../utils/is-global-method-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const VERSIONED_KEY_PATTERN = /(?:[._:-]v\d+|@\d+|\bv\d+\b)/i;

// camelCase version suffix (`userPrefsV2`): a lowercase letter immediately
// followed by a capital `V` and digits. Kept case-SENSITIVE on purpose — a
// case-insensitive `[a-z]v\d+` would over-match plain words that happen to end
// in `…v<digit>`, so the capital-V boundary is what marks an intentional
// camelCase version tag.
const CAMEL_CASE_VERSIONED_KEY_PATTERN = /[a-z]V\d+/;

const isVersionedKey = (key: string): boolean =>
  VERSIONED_KEY_PATTERN.test(key) || CAMEL_CASE_VERSIONED_KEY_PATTERN.test(key);

// HACK: keys that store JSON-serialized objects in localStorage
// live forever and often outlast the JavaScript that
// wrote them. When you change the stored shape (rename a field, switch
// encoding, etc.), old code in existing browsers reads the new format
// and either crashes or silently loses data. Versioning the key
// (`prefs:v1`, `cache@1`, etc.) means a schema change just reads from a
// new key, leaving the old one to either migrate cleanly or be ignored.
//
// Heuristic: flag only when the *value* is a `JSON.stringify(...)` call
// — those are the cases where schema versioning matters. Simple flags
// like `setItem("count", "5")` don't need versioning and would be noise.
const isJsonStringifyCall = (node: EsTreeNode): boolean =>
  isGlobalMethodCall(node, "JSON", "stringify");

// The key is either an inline string literal or an identifier that resolves
// to a `const` string literal (`const CACHE_KEY = 'prefs'` then
// `setItem(CACHE_KEY, ...)`) — const guarantees the binding is never
// reassigned, so the literal is the key at every call site.
const resolveStringKey = (keyArg: EsTreeNode, context: RuleContext): string | null => {
  if (isNodeOfType(keyArg, "Literal")) {
    return typeof keyArg.value === "string" ? keyArg.value : null;
  }
  if (!isNodeOfType(keyArg, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(keyArg);
  if (!symbol || symbol.kind !== "const") return null;
  const initializer = symbol.initializer;
  if (!isNodeOfType(initializer, "Literal")) return null;
  return typeof initializer.value === "string" ? initializer.value : null;
};

export const clientLocalstorageNoVersion = defineRule({
  id: "client-localstorage-no-version",
  title: "Unversioned localStorage key",
  tags: ["test-noise"],
  severity: "warn",
  category: "Correctness",
  recommendation:
    'Put a version in the storage key (e.g. "myKey:v1"). If you change the data shape later, old saved data can be ignored instead of crashing the app.',
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      const receiver = stripParenExpression(node.callee.object);
      if (!isNodeOfType(receiver, "Identifier")) return;
      if (receiver.name !== "localStorage") return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "setItem") return;

      const keyArg = node.arguments?.[0];
      if (!keyArg) return;
      const keyValue = resolveStringKey(keyArg, context);
      if (keyValue === null) return;
      if (isVersionedKey(keyValue)) return;

      const valueArg = node.arguments?.[1];
      if (!valueArg) return;
      if (!isJsonStringifyCall(valueArg)) return;

      context.report({
        node: keyArg,
        message: `${receiver.name}.setItem("${keyValue}", JSON.stringify(...)) has no version, so changing the data shape later crashes your users' saved sessions. Add one to the key (e.g. "${keyValue}:v1").`,
      });
    },
  }),
});
