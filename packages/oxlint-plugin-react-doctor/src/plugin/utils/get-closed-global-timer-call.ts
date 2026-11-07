import {
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../constants/dom.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const GLOBAL_TIMER_RECEIVER_NAMES = new Set(["globalThis", "global", "self", "window"]);
const OPAQUE_GLOBAL_TIMER_RECEIVER_NAMES = new Set(["frames", "top", "parent"]);
const NATIVE_TIMER_API_NAMES = new Set([
  ...TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  ...TIMER_CLEANUP_CALLEE_NAMES,
]);

interface DirectGlobalTimerCall {
  readonly name: string;
  readonly realm: string;
}

const closedGlobalTimerUsesByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasOpaqueTimerRealmAccess = (scopes: ScopeAnalysis): boolean => {
  let hasOpaqueAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasOpaqueAccess) return false;
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      if (getResolvedStaticPropertyName(node, scopes) === "defaultView") hasOpaqueAccess = true;
      return;
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const propertyName = getResolvedStaticPropertyName(node, scopes);
    if (
      propertyName === "defaultView" ||
      (propertyName !== null &&
        NATIVE_TIMER_API_NAMES.has(propertyName) &&
        isWithinAssignmentTarget(node))
    ) {
      hasOpaqueAccess = true;
    }
  });
  return hasOpaqueAccess;
};

const hasOnlyDirectGlobalTimerUses = (scopes: ScopeAnalysis): boolean => {
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    if (scope.kind === "with") return false;
    for (const child of scope.children) pendingScopes.push(child);
    for (const { identifier, flag, resolvedSymbol } of scope.references) {
      if (!isNodeOfType(identifier, "Identifier")) continue;
      const expression = findTransparentExpressionRoot(identifier);
      if (
        (identifier.name === "eval" &&
          (!resolvedSymbol ||
            (isNodeOfType(expression.parent, "CallExpression") &&
              expression.parent.callee === expression))) ||
        (identifier.name === "Function" && !resolvedSymbol)
      ) {
        return false;
      }
      if (resolvedSymbol) continue;
      if (OPAQUE_GLOBAL_TIMER_RECEIVER_NAMES.has(identifier.name)) return false;
      if (identifier.name === "document") {
        const member = expression.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== expression ||
          getResolvedStaticPropertyName(member, scopes) === null
        ) {
          return false;
        }
        continue;
      }
      let timerReference = expression;
      if (GLOBAL_TIMER_RECEIVER_NAMES.has(identifier.name)) {
        const member = expression.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== expression ||
          !NATIVE_TIMER_API_NAMES.has(getStaticPropertyName(member) ?? "")
        ) {
          return false;
        }
        timerReference = findTransparentExpressionRoot(member);
      } else if (!NATIVE_TIMER_API_NAMES.has(identifier.name)) {
        continue;
      }
      if (
        flag !== "read" ||
        !isNodeOfType(timerReference.parent, "CallExpression") ||
        timerReference.parent.callee !== timerReference
      ) {
        return false;
      }
    }
  }
  return !hasOpaqueTimerRealmAccess(scopes);
};

export const getClosedGlobalTimerCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): DirectGlobalTimerCall | null => {
  if (call.optional) return null;
  const callee = stripParenExpression(call.callee);
  let name: string | null;
  let realm = "globalThis";
  if (isNodeOfType(callee, "MemberExpression")) {
    const receiver = stripParenExpression(callee.object);
    if (
      callee.optional ||
      !isNodeOfType(receiver, "Identifier") ||
      !GLOBAL_TIMER_RECEIVER_NAMES.has(receiver.name) ||
      !scopes.isGlobalReference(receiver)
    ) {
      return null;
    }
    name = getStaticPropertyName(callee);
    realm = receiver.name;
  } else if (isNodeOfType(callee, "Identifier") && scopes.isGlobalReference(callee)) {
    name = callee.name;
  } else {
    return null;
  }
  if (!name || !NATIVE_TIMER_API_NAMES.has(name)) return null;
  let hasClosedUses = closedGlobalTimerUsesByScope.get(scopes);
  if (hasClosedUses === undefined) {
    hasClosedUses = hasOnlyDirectGlobalTimerUses(scopes);
    closedGlobalTimerUsesByScope.set(scopes, hasClosedUses);
  }
  return hasClosedUses ? { name, realm } : null;
};
