import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  JSON_PARSE_LOCAL_RESULT_CARRIER_PROPERTIES,
  JSON_PARSE_LOCAL_RESULT_PROVIDER_NAMES,
  JSON_PARSE_LOCAL_RESULT_RUNTIME_TYPES,
} from "../../../constants/json-parse-local-result.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const hasClosedJsonParseProvider = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const program = findProgramRoot(node);
  if (!program) return false;
  let isClosed = true;
  walkAst(program, (candidate) => {
    if (!isClosed) return false;
    if (
      candidate.type === "WithStatement" ||
      JSON_PARSE_LOCAL_RESULT_RUNTIME_TYPES.has(candidate.type)
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "Identifier")) {
      const symbol = scopes.symbolFor(candidate);
      if (symbol?.bindingIdentifier === candidate) return;
      if (
        JSON_PARSE_LOCAL_RESULT_PROVIDER_NAMES.has(candidate.name) &&
        symbol &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        isClosed = false;
        return false;
      }
      if (candidate.name === "eval" && scopes.isGlobalReference(candidate)) {
        isClosed = false;
        return false;
      }
    }
    if (isProvenGlobalNamespaceReference(candidate, "JSON", scopes)) {
      const expression = findTransparentExpressionRoot(candidate);
      const member = expression.parent;
      const call = member?.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== expression ||
        member.optional ||
        !["parse", "stringify"].includes(getStaticPropertyName(member) ?? "") ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== member ||
        call.optional
      ) {
        isClosed = false;
        return false;
      }
    }
    if (isNodeOfType(candidate, "Identifier") && isProvenGlobalObjectReference(candidate, scopes)) {
      const expression = findTransparentExpressionRoot(candidate);
      const member = expression.parent;
      const property = isNodeOfType(member, "MemberExpression")
        ? getStaticPropertyName(member)
        : null;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== expression ||
        member.optional ||
        property === null ||
        JSON_PARSE_LOCAL_RESULT_CARRIER_PROPERTIES.has(property)
      ) {
        isClosed = false;
        return false;
      }
    }
    if (
      isNodeOfType(candidate, "Identifier") &&
      candidate.name === "document" &&
      scopes.isGlobalReference(candidate)
    ) {
      const expression = findTransparentExpressionRoot(candidate);
      const member = expression.parent;
      const property = isNodeOfType(member, "MemberExpression")
        ? getStaticPropertyName(member)
        : null;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== expression ||
        member.optional ||
        property === null ||
        property === "defaultView"
      ) {
        isClosed = false;
        return false;
      }
    }
  });
  return isClosed;
};
