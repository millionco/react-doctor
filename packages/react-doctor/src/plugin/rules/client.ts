import { PASSIVE_EVENT_NAMES } from "../constants.js";
import { isMemberProperty } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const clientPassiveEventListeners: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isMemberProperty(node.callee, "addEventListener")) return;
      if ((node.arguments?.length ?? 0) < 2) return;

      const eventNameNode = node.arguments[0];
      if (eventNameNode.type !== "Literal" || !PASSIVE_EVENT_NAMES.has(eventNameNode.value)) return;

      const eventName = eventNameNode.value;
      const optionsArgument = node.arguments[2];

      if (!optionsArgument) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } — blocks scrolling performance. Only add { passive: true } if the handler does NOT call event.preventDefault() (passive listeners silently ignore preventDefault())`,
        });
        return;
      }

      if (optionsArgument.type !== "ObjectExpression") return;

      const hasPassiveTrue = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "passive" &&
          property.value?.type === "Literal" &&
          property.value.value === true,
      );

      if (!hasPassiveTrue) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } — blocks scrolling performance. Only add { passive: true } if the handler does NOT call event.preventDefault() (passive listeners silently ignore preventDefault())`,
        });
      }
    },
  }),
};

const VERSIONED_KEY_PATTERN = /(?:[._:-]v\d+|@\d+|\bv\d+\b)/i;
const STORAGE_OBJECTS = new Set(["localStorage", "sessionStorage"]);

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
  if (node.type !== "CallExpression") return false;
  if (node.callee?.type !== "MemberExpression") return false;
  if (node.callee.object?.type !== "Identifier") return false;
  if (node.callee.object.name !== "JSON") return false;
  if (node.callee.property?.type !== "Identifier") return false;
  return node.callee.property.name === "stringify";
};

export const clientLocalstorageNoVersion: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier") return;
      if (!STORAGE_OBJECTS.has(node.callee.object.name)) return;
      if (node.callee.property?.type !== "Identifier") return;
      if (node.callee.property.name !== "setItem") return;

      const keyArg = node.arguments?.[0];
      if (!keyArg) return;
      if (keyArg.type !== "Literal") return;
      if (typeof keyArg.value !== "string") return;
      if (VERSIONED_KEY_PATTERN.test(keyArg.value)) return;

      const valueArg = node.arguments?.[1];
      if (!valueArg) return;
      if (!isJsonStringifyCall(valueArg)) return;

      context.report({
        node: keyArg,
        message: `${node.callee.object.name}.setItem("${keyArg.value}", JSON.stringify(...)) — bake a version into the key (e.g. "${keyArg.value}:v1") so a future schema change can ignore old data instead of crashing on it`,
      });
    },
  }),
};
