import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// DOM / nullable-node members whose dereference crashes when `.current` is
// null (before mount / after unmount). Scoping to this set keeps the rule
// on the true-bug slice instead of every `.current.foo` business access.
const HAZARD_MEMBER_NAMES = new Set([
  "contains",
  "focus",
  "blur",
  "click",
  "select",
  "scrollIntoView",
  "getBoundingClientRect",
  "scrollHeight",
  "scrollWidth",
  "clientHeight",
  "clientWidth",
  "offsetHeight",
  "offsetWidth",
  "scrollTop",
  "scrollLeft",
  "style",
  "value",
  "files",
  "textContent",
  "innerHTML",
  "classList",
  "dataset",
  "querySelector",
  "querySelectorAll",
  "getContext",
  "play",
  "pause",
  "setSelectionRange",
]);

const isNullOrUndefinedLiteral = (
  node: EsTreeNode | null | undefined
): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal") && node.value === null) return true;
  return isNodeOfType(node, "Identifier") && node.name === "undefined";
};

// The ref binding is null-or-absent-initialized: `useRef(null)`,
// `useRef()`, `useRef<T>(null)`, or `createRef()`. A non-null initializer
// (`useRef(new Map())`, `useRef(0)`) is provably never null and is skipped.
const isNullOrAbsentRefBinding = (
  referenceNode: EsTreeNode,
  name: string
): boolean => {
  const binding = findVariableInitializer(referenceNode, name);
  const initializer = binding?.initializer;
  if (!initializer || !isNodeOfType(initializer, "CallExpression"))
    return false;
  const callee = initializer.callee;
  const calleeName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier")
    ? callee.property.name
    : null;
  if (calleeName === "createRef") return true;
  if (calleeName !== "useRef") return false;
  const firstArgument = initializer.arguments?.[0];
  return !firstArgument || isNullOrUndefinedLiteral(firstArgument);
};

const isCurrentMemberOf = (node: EsTreeNode, refName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === refName &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current";

// An optional member (`ref?.current`) is wrapped in a ChainExpression, so
// its immediate parent is the chain node, not the enclosing guard. Skip
// past chain wrappers to reach the operator that actually consumes it.
const getEffectiveParent = (
  target: EsTreeNode
): EsTreeNode | null | undefined => {
  let parent = target.parent;
  while (parent && isNodeOfType(parent, "ChainExpression"))
    parent = parent.parent;
  return parent;
};

// The target node is used as a truthiness / existence guard (not as a
// value dereference): `!t`, `t && ...`, `if (t)`, `t == null`,
// `t instanceof X`, `t?.member`.
const isGuardedUse = (target: EsTreeNode): boolean => {
  const parent = getEffectiveParent(target);
  if (!parent) return false;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!")
    return true;
  if (isNodeOfType(parent, "LogicalExpression")) return true;
  if (
    (isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "ConditionalExpression") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement")) &&
    parent.test === target
  ) {
    return true;
  }
  if (isNodeOfType(parent, "BinaryExpression")) {
    if (parent.operator === "instanceof") return true;
    if (["==", "!=", "===", "!=="].includes(parent.operator)) {
      const other = parent.left === target ? parent.right : parent.left;
      if (isNullOrUndefinedLiteral(other as EsTreeNode)) return true;
    }
  }
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === target &&
    parent.optional
  ) {
    return true;
  }
  return false;
};

const getGuardScanRoot = (node: EsTreeNode): EsTreeNode => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  let topmost: EsTreeNode = node;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    topmost = cursor;
    cursor = cursor.parent;
  }
  return topmost;
};

const scanRootGuardsTarget = (
  scanRoot: EsTreeNode,
  matchesTarget: (node: EsTreeNode) => boolean
): boolean => {
  let guarded = false;
  walkAst(scanRoot, (child: EsTreeNode) => {
    if (matchesTarget(child) && isGuardedUse(child)) guarded = true;
  });
  return guarded;
};

const isHazardousMemberOrCall = (accessObject: EsTreeNode): boolean => {
  const parent = accessObject.parent;
  if (!parent) return false;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.callee === accessObject &&
    !parent.optional
  ) {
    return true;
  }
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === accessObject
  ) {
    if (parent.optional) return false;
    if (parent.computed) return true;
    return (
      isNodeOfType(parent.property, "Identifier") &&
      HAZARD_MEMBER_NAMES.has(parent.property.name)
    );
  }
  return false;
};

export const noUnguardedRefCurrentMemberAccess = defineRule({
  id: "no-unguarded-ref-current-member-access",
  title: "Unguarded ref.current member access",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A `useRef(null)` / `createRef()` ref holds null before mount and after unmount, so an event/effect handler can dereference it while the node is detached and crash. Guard the access with optional chaining (`ref.current?.`) or an early `if (!ref.current) return`.",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (node.computed || !isNodeOfType(node.property, "Identifier")) return;
      if (
        node.property.name !== "current" ||
        !isNodeOfType(node.object, "Identifier")
      )
        return;
      const refName = node.object.name;
      if (!isHazardousMemberOrCall(node)) return;
      if (!isNullOrAbsentRefBinding(node.object, refName)) return;
      const scanRoot = getGuardScanRoot(node);
      if (
        scanRootGuardsTarget(scanRoot, (child) =>
          isCurrentMemberOf(child, refName)
        )
      )
        return;
      context.report({
        node,
        message:
          "This dereferences `ref.current` without a null guard; the ref is null before mount and after unmount, so a late event/effect handler crashes with a null read. Use `ref.current?.` or an early `if (!ref.current) return`.",
      });
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      const init = node.init;
      if (!init || !isNodeOfType(node.id, "Identifier")) return;
      if (!isNodeOfType(init, "MemberExpression") || init.optional) return;
      if (!isNodeOfType(init.object, "Identifier")) return;
      if (!isCurrentMemberOf(init, init.object.name)) return;
      const refName = init.object.name;
      if (!isNullOrAbsentRefBinding(init.object, refName)) return;

      const scanRoot = getGuardScanRoot(node);
      if (
        scanRootGuardsTarget(scanRoot, (child) =>
          isCurrentMemberOf(child, refName)
        )
      )
        return;

      const aliasName = node.id.name;
      if (
        scanRootGuardsTarget(
          scanRoot,
          (child) =>
            isNodeOfType(child, "Identifier") && child.name === aliasName
        )
      ) {
        return;
      }

      let hazardAccess: EsTreeNode | null = null;
      walkAst(scanRoot, (child: EsTreeNode) => {
        if (hazardAccess) return false;
        if (child === init) return;
        if (
          isNodeOfType(child, "Identifier") &&
          child.name === aliasName &&
          isHazardousMemberOrCall(child)
        ) {
          hazardAccess = child;
        }
      });
      if (hazardAccess) {
        context.report({
          node: hazardAccess,
          message:
            "This dereferences a value read from `ref.current` without a null guard; the ref is null before mount and after unmount, so a late handler crashes with a null read. Guard the ref before reading it (`ref.current?.` or an early return).",
        });
      }
    },
  }),
});
