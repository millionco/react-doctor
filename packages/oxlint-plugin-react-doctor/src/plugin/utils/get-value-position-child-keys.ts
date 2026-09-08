import { TYPE_POSITION_CHILD_KEYS } from "../constants/ts-type-position-keys.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { RUNTIME_VISITOR_KEYS } from "./runtime-visitor-keys.js";

const valuePositionChildKeysByType = new Map<string, ReadonlyArray<string>>();

const filterValuePositionChildKeys = (keys: ReadonlyArray<string>): ReadonlyArray<string> =>
  keys.filter((key) => key !== "parent" && !TYPE_POSITION_CHILD_KEYS.has(key));

// Child keys of `node` that hold runtime values (skips `parent` and TS
// type-position children). Known node types share one filtered array per
// type; unknown shapes fall back to the node's own keys.
export const getValuePositionChildKeys = (node: EsTreeNode): ReadonlyArray<string> => {
  const cachedKeys = valuePositionChildKeysByType.get(node.type);
  if (cachedKeys) return cachedKeys;
  const visitorKeys = RUNTIME_VISITOR_KEYS[node.type];
  if (!visitorKeys) return filterValuePositionChildKeys(Object.keys(node));
  const filteredKeys = filterValuePositionChildKeys(visitorKeys);
  valuePositionChildKeysByType.set(node.type, filteredKeys);
  return filteredKeys;
};
