import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  FRAME_CANCELLATION_EXPOSED_PROPERTY_NAMES,
  FRAME_CANCELLATION_RECEIVER_NAMES,
} from "./constants.js";

export const hasClosedFrameCancellationProvider = (
  source: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const program = findProgramRoot(source);
  if (!program) return false;
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (
      (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSParameterProperty")
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isProvenGlobalNamespaceReference(node, "document", scopes)) {
      const documentValue = findTransparentExpressionRoot(node);
      const member = documentValue.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== documentValue ||
        member.optional ||
        getStaticPropertyName(member) === null ||
        getStaticPropertyName(member) === "defaultView"
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier")) return;
    if (node.name !== "cancelAnimationFrame" && !FRAME_CANCELLATION_RECEIVER_NAMES.has(node.name))
      return;
    if (!scopes.isGlobalReference(node)) {
      if (!scopes.symbolFor(node) && isWithinAssignmentTarget(node)) isClosed = false;
      return;
    }
    const reference = findTransparentExpressionRoot(node);
    const consumer = reference.parent;
    if (node.name === "cancelAnimationFrame") {
      if (
        !isNodeOfType(consumer, "CallExpression") ||
        consumer.callee !== reference ||
        consumer.optional ||
        isWithinAssignmentTarget(node)
      )
        isClosed = false;
      return;
    }
    if (
      !isNodeOfType(consumer, "MemberExpression") ||
      consumer.object !== reference ||
      consumer.optional
    ) {
      isClosed = false;
      return;
    }
    const propertyName = getStaticPropertyName(consumer);
    if (propertyName === null || FRAME_CANCELLATION_EXPOSED_PROPERTY_NAMES.has(propertyName)) {
      isClosed = false;
      return;
    }
    if (propertyName !== "cancelAnimationFrame") return;
    const member = findTransparentExpressionRoot(consumer);
    const call = member.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.optional ||
      isWithinAssignmentTarget(consumer)
    )
      isClosed = false;
  });
  return isClosed;
};
