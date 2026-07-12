import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// DOM/layout reads + globals that are NOT knowable at render time. A value
// measured from the live DOM (a ref's `.current`, an element measurement) or
// read off a browser global (`window`, `localStorage`, …) cannot be produced
// during the render pass: the element is not mounted yet, and the global is
// absent / inconsistent under SSR. Any state seeded from one of these is
// legitimately deferred to a mount effect — it is NOT a "you might not need an
// effect" smell, so the derived/adjust/init rules must not fire on it.
//
// Unambiguous DOM API method names: these never appear on plain data objects,
// so a bare name match is safe.
export const DOM_QUERY_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "getBoundingClientRect",
  "getComputedStyle",
  "getElementById",
  "querySelector",
  "querySelectorAll",
  "getElementsByClassName",
  "getElementsByTagName",
  "matchMedia",
]);

// Ambiguous property names: `.current` and the layout measures also occur on
// plain data objects (`pagination.current`, a swiper API's `offsetLeft`), so
// they only count as a post-mount read when the receiver is ref-like.
const LAYOUT_MEASUREMENT_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "current",
  "textContent",
  "innerText",
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
]);

const POST_MOUNT_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "navigator",
]);

const REF_FACTORY_CALLEE_NAMES: ReadonlySet<string> = new Set(["useRef", "createRef"]);

const hasRefLikeName = (name: string): boolean =>
  name === "ref" ||
  name.endsWith("Ref") ||
  name.endsWith("ref") ||
  name.endsWith("Node") ||
  name.endsWith("node") ||
  name.endsWith("Element") ||
  name.endsWith("element");

const isRefFactoryInitializer = (init: EsTreeNode | null | undefined): boolean => {
  if (!init || !isNodeOfType(init, "CallExpression")) return false;
  const callee = init.callee;
  if (isNodeOfType(callee, "Identifier")) return REF_FACTORY_CALLEE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return REF_FACTORY_CALLEE_NAMES.has(callee.property.name);
  }
  return false;
};

const resolvesToRefFactoryCall = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const root = findProgramRoot(identifier);
  if (!root) return false;
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === identifier.name &&
      isRefFactoryInitializer(child.init as EsTreeNode | null)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const unwrapExpression = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  if (isNodeOfType(node, "ChainExpression")) return unwrapExpression(node.expression as EsTreeNode);
  if (isNodeOfType(node, "TSNonNullExpression")) {
    return unwrapExpression(node.expression as EsTreeNode);
  }
  return node;
};

// `const el = contentRef.current` — a local alias of a ref's `.current`
// carries the mounted element, so layout reads through the alias
// (`el.scrollHeight`) are post-mount measurements too.
const resolvesToRefCurrentAlias = (
  identifier: EsTreeNodeOfType<"Identifier">,
  visitedAliasNames: ReadonlySet<string>,
): boolean => {
  if (visitedAliasNames.has(identifier.name)) return false;
  const root = findProgramRoot(identifier);
  if (!root) return false;
  const nextVisited = new Set([...visitedAliasNames, identifier.name]);
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === identifier.name
    ) {
      const init = unwrapExpression(child.init as EsTreeNode | null);
      if (
        init &&
        isNodeOfType(init, "MemberExpression") &&
        isNodeOfType(init.property, "Identifier") &&
        init.property.name === "current" &&
        isRefLikeReceiver(init.object as EsTreeNode, nextVisited)
      ) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

const isRefLikeReceiver = (
  receiver: EsTreeNode | null | undefined,
  visitedAliasNames: ReadonlySet<string> = new Set(),
): boolean => {
  if (!receiver) return false;
  if (isNodeOfType(receiver, "ChainExpression")) {
    return isRefLikeReceiver(receiver.expression as EsTreeNode, visitedAliasNames);
  }
  if (isNodeOfType(receiver, "TSNonNullExpression")) {
    return isRefLikeReceiver(receiver.expression as EsTreeNode, visitedAliasNames);
  }
  if (isNodeOfType(receiver, "Identifier")) {
    return (
      hasRefLikeName(receiver.name) ||
      resolvesToRefFactoryCall(receiver) ||
      resolvesToRefCurrentAlias(receiver, visitedAliasNames)
    );
  }
  if (isNodeOfType(receiver, "MemberExpression") && isNodeOfType(receiver.property, "Identifier")) {
    if (hasRefLikeName(receiver.property.name)) return true;
    if (receiver.property.name === "current")
      return isRefLikeReceiver(receiver.object as EsTreeNode, visitedAliasNames);
  }
  return false;
};

// A member read that can only be answered by the live DOM: an unambiguous DOM
// query API, or `.current` / a layout measure on a ref-like receiver
// (`viewportRef.current`, `ref.current.offsetWidth`). Plain-data lookalikes
// (`pagination.current`) do NOT match.
export const isPostMountMemberRead = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || !isNodeOfType(node.property, "Identifier")) {
    return false;
  }
  const memberName = node.property.name;
  if (DOM_QUERY_MEMBER_NAMES.has(memberName)) return true;
  if (!LAYOUT_MEASUREMENT_MEMBER_NAMES.has(memberName)) return false;
  return isRefLikeReceiver(node.object as EsTreeNode);
};

// A member read that yields a live measurement VALUE. Layout members measure
// as plain property reads (`ref.current.scrollHeight`), but DOM query members
// are METHODS — they only measure when invoked (`window.matchMedia("...")`).
// A bare method reference (`!!window.matchMedia`) is render-time-knowable, so
// it does not justify deferring state init to a mount effect.
export const isMeasurementMemberRead = (node: EsTreeNode): boolean => {
  if (!isPostMountMemberRead(node)) return false;
  if (!isNodeOfType(node, "MemberExpression") || !isNodeOfType(node.property, "Identifier")) {
    return false;
  }
  if (!DOM_QUERY_MEMBER_NAMES.has(node.property.name)) return true;
  const parent = node.parent;
  return Boolean(parent && isNodeOfType(parent, "CallExpression") && parent.callee === node);
};

const isPropertyNamePosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) {
    return parent.property === identifier && !parent.computed;
  }
  if (isNodeOfType(parent, "Property")) {
    return parent.key === identifier && !parent.computed;
  }
  return false;
};

// A read of a browser global itself — NOT a same-named property on a data
// object (`data.document`, `config.window`).
export const isPostMountGlobalRead = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Identifier") &&
  POST_MOUNT_GLOBAL_NAMES.has(node.name) &&
  !isPropertyNamePosition(node);

// The post-mount read is often not the setter argument itself — the effect
// reads a browser global / a `ref.current` / a DOM measurement into a local
// variable and hands the derived value onward. Callers therefore scan the
// subtree they care about (a setter call, an argument): if it touches any
// post-mount source, the values it produces are not render-time-knowable.
export const readsPostMountValue = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (isPostMountMemberRead(child) || isPostMountGlobalRead(child)) {
      found = true;
      return false;
    }
  });
  return found;
};
