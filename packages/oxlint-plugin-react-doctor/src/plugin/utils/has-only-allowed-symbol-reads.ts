import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";

interface AllowedSymbolReadsInput {
  readonly symbol: SymbolDescriptor;
  readonly allowedIdentifiers: ReadonlySet<EsTreeNode>;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

export const hasOnlyAllowedSymbolReads = ({
  symbol,
  allowedIdentifiers,
  program,
  scopes,
}: AllowedSymbolReadsInput): boolean =>
  hasCompleteSymbolReferences(symbol, program, scopes) &&
  symbol.references.every(
    (reference) =>
      isNonReferenceIdentifier(reference.identifier) ||
      reference.identifier === symbol.bindingIdentifier ||
      (reference.flag === "read" &&
        !isBindingAssignmentTarget(reference.identifier) &&
        allowedIdentifiers.has(reference.identifier)),
  );
