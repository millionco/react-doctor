export const OWN_SEARCH_SLOT_MAX_VISITED_NODES = 20_000;
export const OWN_SEARCH_SLOT_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "globalThis",
  "window",
  "global",
  "self",
]);
export const OWN_SEARCH_SLOT_REGEX_PROPERTIES: ReadonlySet<string> = new Set([
  "source",
  "flags",
  "global",
  "sticky",
  "lastIndex",
]);
export const OWN_SEARCH_SLOT_VM_MODULE_NAMES: ReadonlySet<string> = new Set(["vm", "node:vm"]);
