import {
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
  TIMER_TOGGLE_GLOBAL_NAMESPACE_NAMES,
  TIMER_TOGGLE_REFUSED_GLOBAL_NAMES,
  TIMER_TOGGLE_REFUSED_MEMBER_NAMES,
  TIMER_TOGGLE_REFUSED_MODULE_NAMES,
} from "../constants/dom.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isGlobalBrowserFunctionCall } from "./is-global-browser-function-call.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { walkAst } from "./walk-ast.js";

interface NativeTimerProviderInput {
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

export const hasOrdinaryNativeTimerProviders = (proof: NativeTimerProviderInput): boolean => {
  let supported = true;
  walkAst(proof.program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment")
    ) {
      supported = false;
      return false;
    }
    const dependency = getRuntimeStaticDependencySource(node);
    if (dependency && TIMER_TOGGLE_REFUSED_MODULE_NAMES.has(dependency)) supported = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, proof.scopes);
      if (name !== null && TIMER_TOGGLE_REFUSED_MEMBER_NAMES.has(name)) supported = false;
      if (
        name !== null &&
        (TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(name) || TIMER_CLEANUP_CALLEE_NAMES.has(name))
      ) {
        const root = findTransparentExpressionRoot(node);
        const call = root.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          call.optional ||
          !isGlobalBrowserFunctionCall(call, name, proof.scopes)
        )
          supported = false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    const symbol = proof.scopes.symbolFor(node);
    if (!proof.scopes.isGlobalReference(node) && !(symbol && isErasedTypeScriptBinding(symbol)))
      return;
    if (TIMER_TOGGLE_REFUSED_GLOBAL_NAMES.has(node.name)) {
      supported = false;
      return;
    }
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (
      node.name === "setInterval" ||
      node.name === "setTimeout" ||
      node.name === "clearInterval" ||
      node.name === "clearTimeout"
    ) {
      if (!isNodeOfType(parent, "CallExpression") || parent.callee !== root || parent.optional) {
        supported = false;
      }
    } else if (TIMER_TOGGLE_GLOBAL_NAMESPACE_NAMES.has(node.name)) {
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root) {
        supported = false;
        return;
      }
      const name = getStaticPropertyName(parent);
      if (
        name === null ||
        TIMER_TOGGLE_GLOBAL_NAMESPACE_NAMES.has(name) ||
        TIMER_TOGGLE_REFUSED_GLOBAL_NAMES.has(name)
      ) {
        supported = false;
        return;
      }
      if (
        name === "setInterval" ||
        name === "setTimeout" ||
        name === "clearInterval" ||
        name === "clearTimeout"
      ) {
        const member = findTransparentExpressionRoot(parent);
        if (
          !isNodeOfType(member.parent, "CallExpression") ||
          member.parent.callee !== member ||
          member.parent.optional ||
          isMemberMutationTarget(parent)
        )
          supported = false;
      }
    }
  });
  return supported;
};
