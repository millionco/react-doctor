import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// DOM/layout reads + globals that are NOT knowable at render time. A value
// measured from the live DOM (a ref's `.current`, an element measurement) or
// read off a browser global (`window`, `localStorage`, …) cannot be produced
// during the render pass: the element is not mounted yet, and the global is
// absent / inconsistent under SSR. Any state seeded from one of these is
// legitimately deferred to a mount effect — it is NOT a "you might not need an
// effect" smell, so the derived/adjust/init rules must not fire on it.
export const POST_MOUNT_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "current",
  "scrollWidth",
  "clientWidth",
  "offsetWidth",
  "scrollHeight",
  "clientHeight",
  "offsetHeight",
  "scrollTop",
  "scrollLeft",
  "offsetTop",
  "offsetLeft",
  "innerWidth",
  "innerHeight",
  "getBoundingClientRect",
  "getComputedStyle",
  "getElementById",
  "querySelector",
  "querySelectorAll",
  "getElementsByClassName",
  "getElementsByTagName",
  "matchMedia",
]);

export const POST_MOUNT_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "navigator",
]);

// The post-mount read is often not the setter argument itself — the effect
// reads `localStorage` / `matchMedia` / a `ref.current` / a DOM measurement
// into a local variable (or a helper / wrapper function) and then hands that
// derived value onward (e.g. `const saved = read(KEY); setStore(saved)`,
// `updateThumb()` measuring `viewportRef.current`, `setMode(scheme())` reading
// `document`). Scanning only direct arguments misses all of those, so we scan
// the whole subtree: if it touches any post-mount source anywhere, the values
// it produces are not render-time-knowable.
export const readsPostMountValue = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      POST_MOUNT_MEMBER_NAMES.has(child.property.name)
    ) {
      found = true;
      return false;
    }
    if (isNodeOfType(child, "Identifier") && POST_MOUNT_GLOBAL_NAMES.has(child.name)) {
      found = true;
      return false;
    }
  });
  return found;
};
