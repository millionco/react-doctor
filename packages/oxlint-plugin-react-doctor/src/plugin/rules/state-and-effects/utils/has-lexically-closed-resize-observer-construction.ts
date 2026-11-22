import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";

// The exact writer uses a bare browser constructor and does not take local
// routes to realm objects or mutate built-in observers, entries, rects or arrays.
const REALM_OR_PROVIDER_VALUE_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "DOMRect",
  "DOMRectReadOnly",
  "Document",
  "Element",
  "HTMLElement",
  "HTMLDivElement",
  "Function",
  "Object",
  "Reflect",
  "ResizeObserverEntry",
  "document",
  "eval",
  "global",
  "globalThis",
  "self",
  "window",
]);

const MEMBER_ESCAPE_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "ResizeObserver",
  "contentDocument",
  "contentWindow",
  "defaultView",
  "ownerDocument",
  "view",
]);

const isDirectConstructorUse = (identifier: EsTreeNode): boolean => {
  const reference = findTransparentExpressionRoot(identifier);
  return isNodeOfType(reference.parent, "NewExpression") && reference.parent.callee === reference;
};

const isNonExposingTypeofUse = (identifier: EsTreeNode): boolean => {
  const reference = findTransparentExpressionRoot(identifier);
  return (
    isNodeOfType(reference.parent, "UnaryExpression") &&
    reference.parent.operator === "typeof" &&
    reference.parent.argument === reference
  );
};

// This is lexical evidence only. The caller still proves the stock host's
// ResizeObserver provider and separately validates callback forwarding and
// targets. Observation lifetime is not part of measurement provenance.
export const hasLexicallyClosedResizeObserverConstruction = (
  construction: EsTreeNodeOfType<"NewExpression">,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const program = findProgramRoot(owner);
  if (
    !program ||
    !isAstDescendant(construction, owner) ||
    !isNodeOfType(construction.callee, "Identifier") ||
    construction.callee.name !== "ResizeObserver" ||
    !scopes.isGlobalReference(construction.callee) ||
    construction.arguments.length !== 1 ||
    isNodeOfType(construction.arguments[0], "SpreadElement")
  ) {
    return false;
  }

  let closed = true;
  walkAst(program, (node) => {
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (name !== null && MEMBER_ESCAPE_NAMES.has(name)) closed = false;
      if (name === "getBoundingClientRect") {
        const reference = findTransparentExpressionRoot(node);
        const call = reference.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== reference ||
          call.optional ||
          call.arguments.length !== 0
        )
          closed = false;
      }
      return;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.referenceFor(node)) return;
    if (node.name === "ResizeObserver") {
      closed =
        scopes.isGlobalReference(node) &&
        (isDirectConstructorUse(node) || isNonExposingTypeofUse(node));
    } else if (REALM_OR_PROVIDER_VALUE_NAMES.has(node.name)) {
      closed = false;
    }
  });
  return closed;
};
