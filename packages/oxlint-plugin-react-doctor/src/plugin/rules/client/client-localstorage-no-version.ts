import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const VERSIONED_KEY_PATTERN = /(?:[._:-]v\d+|@\d+|\bv\d+\b)/i;

// camelCase version suffix (`userPrefsV2`): a lowercase letter immediately
// followed by a capital `V` and digits. Kept case-SENSITIVE on purpose — a
// case-insensitive `[a-z]v\d+` would over-match plain words that happen to end
// in `…v<digit>`, so the capital-V boundary is what marks an intentional
// camelCase version tag.
const CAMEL_CASE_VERSIONED_KEY_PATTERN = /[a-z]V\d+/;

const STORAGE_OBJECTS = new Set(["localStorage", "sessionStorage"]);

const isVersionedKey = (key: string): boolean =>
  VERSIONED_KEY_PATTERN.test(key) || CAMEL_CASE_VERSIONED_KEY_PATTERN.test(key);

// HACK: keys that store JSON-serialized objects in localStorage /
// sessionStorage live forever and often outlast the JavaScript that
// wrote them. When you change the stored shape (rename a field, switch
// encoding, etc.), old code in existing browsers reads the new format
// and either crashes or silently loses data. Versioning the key
// (`prefs:v1`, `cache@1`, etc.) means a schema change just reads from a
// new key, leaving the old one to either migrate cleanly or be ignored.
//
// Heuristic: flag only when the *value* is a `JSON.stringify(...)` call
// — those are the cases where schema versioning matters. Simple flags
// like `setItem("count", "5")` don't need versioning and would be noise.
const isJsonStringifyCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.object, "Identifier")) return false;
  if (node.callee.object.name !== "JSON") return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;
  return node.callee.property.name === "stringify";
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
      if (!isNodeOfType(node.callee.object, "Identifier")) return;
      if (!STORAGE_OBJECTS.has(node.callee.object.name)) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "setItem") return;

      const keyArg = node.arguments?.[0];
      if (!keyArg) return;
      if (!isNodeOfType(keyArg, "Literal")) return;
      if (typeof keyArg.value !== "string") return;
      if (isVersionedKey(keyArg.value)) return;

      const valueArg = node.arguments?.[1];
      if (!valueArg) return;
      if (!isJsonStringifyCall(valueArg)) return;

      context.report({
        node: keyArg,
        message: `${node.callee.object.name}.setItem("${keyArg.value}", JSON.stringify(...)) has no version, so changing the data shape later crashes your users' saved sessions. Add one to the key (e.g. "${keyArg.value}:v1").`,
      });
    },
  }),
});
