import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isPostMountGlobalRead,
  isPostMountMemberRead,
} from "../../../utils/reads-post-mount-value.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ReadsPostMountOptions {
  // A bare `ref.current` read hands over the ELEMENT (e.g. as a config value
  // for creating an external instance), not a measured VALUE. Callers that
  // only exempt genuine DOM-derived values (the chain rule) skip it;
  // `ref.current.scrollWidth` still matches through its layout member.
  ignoreBareRefCurrent?: boolean;
}

const isBareRefCurrentRead = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current";

const matchesPostMountRead = (node: EsTreeNode, options: ReadsPostMountOptions): boolean => {
  if (isPostMountGlobalRead(node)) return true;
  if (!isPostMountMemberRead(node)) return false;
  return !(options.ignoreBareRefCurrent === true && isBareRefCurrentRead(node));
};

const objectPatternBindsName = (pattern: EsTreeNode, name: string): boolean => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return (pattern.properties ?? []).some((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    const bound = property.value;
    return Boolean(bound && isNodeOfType(bound, "Identifier") && bound.name === name);
  });
};

const findEffectLocalInitializer = (effectFn: EsTreeNode, name: string): EsTreeNode | null => {
  let initializer: EsTreeNode | null = null;
  walkAst(effectFn, (child: EsTreeNode): boolean | void => {
    if (initializer) return false;
    if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
    if (
      (isNodeOfType(child.id, "Identifier") && child.id.name === name) ||
      objectPatternBindsName(child.id as EsTreeNode, name)
    ) {
      initializer = child.init as EsTreeNode;
      return false;
    }
  });
  return initializer;
};

// The post-mount read is often hidden behind an effect-local variable —
// `const { width } = ref.current.getBoundingClientRect(); setWidth(width)` or
// `const anchors = Array.from(document.querySelectorAll(sel)); setAnchors(anchors)`.
// Trace identifiers in `root` back through effect-local declarators so the
// derived value is still recognized as a live DOM measurement.
export const readsPostMountValueThroughLocals = (
  root: EsTreeNode,
  effectFn: EsTreeNode,
  options: ReadsPostMountOptions = {},
  visitedLocalNames: Set<string> = new Set(),
): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (matchesPostMountRead(child, options)) {
      found = true;
      return false;
    }
    if (!isNodeOfType(child, "Identifier")) return;
    if (visitedLocalNames.has(child.name)) return;
    visitedLocalNames.add(child.name);
    const localInitializer = findEffectLocalInitializer(effectFn, child.name);
    if (
      localInitializer &&
      readsPostMountValueThroughLocals(localInitializer, effectFn, options, visitedLocalNames)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};
