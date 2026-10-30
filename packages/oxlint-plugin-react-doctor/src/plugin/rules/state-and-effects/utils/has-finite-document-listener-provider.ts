import type { RuleContext } from "../../../utils/rule-context.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  DOCUMENT_LISTENER_METHOD_NAMES,
  DOCUMENT_LISTENER_WITNESS_REFERENCE_COUNT,
  DOCUMENT_LISTENER_UNSUPPORTED_MEMBERS,
  DOCUMENT_LISTENER_UNSUPPORTED_NODES,
  DOCUMENT_LISTENER_UNSUPPORTED_ROOT_NAMES,
} from "./constants.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";

const providerByAnalysis = new WeakMap<ProgramAnalysis, boolean>();

const isLiteralDocumentListenerMember = (node: EsTreeNode, analysis: ProgramAnalysis): boolean => {
  const call = node.parent;
  return Boolean(
    isNodeOfType(node, "MemberExpression") &&
    !node.optional &&
    !node.computed &&
    isNodeOfType(node.object, "Identifier") &&
    node.object.name === "document" &&
    analysis.referenceByIdentifier.get(node.object)?.resolved === null &&
    isNodeOfType(node.property, "Identifier") &&
    DOCUMENT_LISTENER_METHOD_NAMES.has(node.property.name) &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === node &&
    !call.optional &&
    call.arguments.length === 2 &&
    isNodeOfType(call.arguments[0], "Literal") &&
    call.arguments[0].value === "click" &&
    isNodeOfType(call.arguments[1], "Identifier"),
  );
};

export const hasFiniteDocumentListenerProvider = (
  analysis: ProgramAnalysis,
  context: RuleContext,
): boolean => {
  const cached = providerByAnalysis.get(analysis);
  if (cached !== undefined) return cached;
  let accepted = true;
  let documentReferenceCount = 0;
  walkAst(analysis.programNode, (node) => {
    if (!accepted) return false;
    if (
      DOCUMENT_LISTENER_UNSUPPORTED_NODES.has(node.type) ||
      (isNodeOfType(node, "JSXMemberExpression") &&
        (DOCUMENT_LISTENER_UNSUPPORTED_MEMBERS.has(node.property.name) ||
          DOCUMENT_LISTENER_METHOD_NAMES.has(node.property.name))) ||
      ("declare" in node && node.declare === true) ||
      (isNodeOfType(node, "ImportDeclaration") &&
        (node.source.value !== "react" ||
          node.importKind === "type" ||
          node.specifiers.some(
            (specifier) =>
              !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type",
          ))) ||
      (isNodeOfType(node, "Property") &&
        (node.computed ||
          (isNodeOfType(node.key, "Identifier") &&
            (DOCUMENT_LISTENER_UNSUPPORTED_MEMBERS.has(node.key.name) ||
              DOCUMENT_LISTENER_METHOD_NAMES.has(node.key.name))) ||
          (isNodeOfType(node.key, "Literal") &&
            typeof node.key.value === "string" &&
            (DOCUMENT_LISTENER_UNSUPPORTED_MEMBERS.has(node.key.value) ||
              DOCUMENT_LISTENER_METHOD_NAMES.has(node.key.value))))) ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed ||
          (isNodeOfType(node.property, "Identifier") &&
            (DOCUMENT_LISTENER_UNSUPPORTED_MEMBERS.has(node.property.name) ||
              (DOCUMENT_LISTENER_METHOD_NAMES.has(node.property.name) &&
                !isLiteralDocumentListenerMember(node, analysis))))))
    ) {
      accepted = false;
      return false;
    }
    if (isNodeOfType(node, "ImportSpecifier")) {
      const symbol = context.scopes.symbolFor(node.local);
      if (
        !symbol ||
        symbol.references.some(
          (reference) =>
            reference.flag !== "read" ||
            !isNodeOfType(reference.identifier.parent, "CallExpression") ||
            reference.identifier.parent.callee !== reference.identifier ||
            reference.identifier.parent.optional,
        )
      ) {
        accepted = false;
        return false;
      }
    }
    if (isNodeOfType(node, "JSXIdentifier")) {
      const reference = context.scopes.referenceFor(node);
      if (
        reference &&
        (!reference.resolvedSymbol || DOCUMENT_LISTENER_UNSUPPORTED_ROOT_NAMES.has(node.name))
      )
        accepted = false;
      return;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = analysis.referenceByIdentifier.get(node);
    if (!reference) return;
    if (DOCUMENT_LISTENER_UNSUPPORTED_ROOT_NAMES.has(node.name)) {
      accepted = false;
      return false;
    }
    if (reference.resolved) return;
    documentReferenceCount += 1;
    if (
      node.name !== "document" ||
      reference.isWrite() ||
      !node.parent ||
      !isLiteralDocumentListenerMember(node.parent, analysis)
    ) {
      accepted = false;
      return false;
    }
  });
  accepted = accepted && documentReferenceCount === DOCUMENT_LISTENER_WITNESS_REFERENCE_COUNT;
  providerByAnalysis.set(analysis, accepted);
  return accepted;
};
