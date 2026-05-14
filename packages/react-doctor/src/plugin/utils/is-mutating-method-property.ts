import { MUTATING_HTTP_METHODS } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// HACK: extracted so `findSideEffect` can re-use the EXACT same shape
// predicate when it goes hunting for the literal method to render in
// the diagnostic. Previously `findSideEffect` used a looser `key.name
// === "method"` predicate and could pick a non-Literal `method:` entry
// (when duplicate keys are present), producing
// `"fetch() with method undefined"` in the message.
export const isMutatingMethodProperty = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  isNodeOfType(property.key, "Identifier") &&
  property.key.name === "method" &&
  isNodeOfType(property.value, "Literal") &&
  typeof property.value.value === "string" &&
  MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase());
