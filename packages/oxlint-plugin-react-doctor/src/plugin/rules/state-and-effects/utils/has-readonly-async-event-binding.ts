import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";

export interface AsyncEventSourceModule {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

export const hasReadonlyAsyncEventBinding = (
  symbol: SymbolDescriptor,
  module: AsyncEventSourceModule,
): boolean =>
  hasCompleteSymbolReferences(symbol, module.program, module.scopes) &&
  !hasSymbolBindingWrites(symbol);
