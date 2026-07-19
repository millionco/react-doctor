import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findDeclaratorForBinding } from "./find-declarator-for-binding.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isHookCall } from "./is-hook-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// Array iteration methods that invoke their callback synchronously — the
// callback runs wherever the method call itself executes, so it inherits
// the render-phase status of its call site.
const SYNCHRONOUS_ITERATION_METHOD_NAMES = new Set([
  "map",
  "filter",
  "forEach",
  "flatMap",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "sort",
  "toSorted",
]);

const REACT_RENDER_PHASE_HOOK_NAMES = new Set(["useMemo", "useState"]);

const isGlobalArrayFromMember = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (
    !isNodeOfType(unwrappedNode, "MemberExpression") ||
    unwrappedNode.computed ||
    !isNodeOfType(unwrappedNode.object, "Identifier") ||
    unwrappedNode.object.name !== "Array" ||
    !scopes.isGlobalReference(unwrappedNode.object) ||
    !isNodeOfType(unwrappedNode.property, "Identifier")
  ) {
    return false;
  }
  return unwrappedNode.property.name === "from";
};

const isConstAliasOfGlobalArrayFrom = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "Identifier")) return false;
  const binding = findVariableInitializer(unwrappedNode, unwrappedNode.name);
  if (!binding?.initializer) return false;
  const declarator = findDeclaratorForBinding(binding.bindingIdentifier);
  return Boolean(
    declarator &&
    scopes.symbolFor(unwrappedNode)?.declarationNode === declarator &&
    declarator.init &&
    declarator.parent &&
    isNodeOfType(declarator.parent, "VariableDeclaration") &&
    declarator.parent.kind === "const" &&
    isGlobalArrayFromMember(declarator.init, scopes),
  );
};

// A nested function usually runs on a user event, not during the render
// pass — but four shapes DO execute while rendering: an immediately
// invoked function (`{(() => new Date().toLocaleString())()}`), a
// useMemo factory (`{useMemo(() => Date.now(), [])}`), and a synchronous
// iteration callback (`{rows.map((row) => …)}`), or a global Promise
// constructor executor (`new Promise((resolve) => resolve())`).
export const executesDuringRender = (
  callbackExpression: EsTreeNode,
  scopes?: ScopeAnalysis,
): boolean => {
  const callbackRoot = findTransparentExpressionRoot(callbackExpression);
  const parent = callbackRoot.parent;
  if (isNodeOfType(parent, "NewExpression")) {
    const callee = stripParenExpression(parent.callee);
    return Boolean(
      scopes &&
      parent.arguments?.[0] === callbackRoot &&
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Promise" &&
      scopes.isGlobalReference(callee),
    );
  }
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (parent.callee === callbackRoot) return true;
  const isRenderPhaseHook = scopes
    ? isReactApiCall(parent, REACT_RENDER_PHASE_HOOK_NAMES, scopes, {
        allowGlobalReactNamespace: true,
      })
    : isHookCall(parent, REACT_RENDER_PHASE_HOOK_NAMES);
  if (isRenderPhaseHook && parent.arguments?.[0] === callbackRoot) return true;
  if (
    scopes &&
    parent.arguments?.[1] === callbackRoot &&
    (isGlobalArrayFromMember(parent.callee, scopes) ||
      isConstAliasOfGlobalArrayFrom(parent.callee, scopes))
  ) {
    return true;
  }
  return (
    isNodeOfType(parent.callee, "MemberExpression") &&
    !parent.callee.computed &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    SYNCHRONOUS_ITERATION_METHOD_NAMES.has(parent.callee.property.name) &&
    parent.arguments?.[0] === callbackRoot
  );
};
