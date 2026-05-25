import type { EsTreeNode } from "../utils/es-tree-node.js";

export type SymbolKind =
  | "var"
  | "let"
  | "const"
  | "using"
  | "function"
  | "class"
  | "parameter"
  | "import"
  | "ts-import-equals"
  | "ts-enum"
  | "ts-type-alias"
  | "ts-interface"
  | "ts-module"
  | "catch-clause-parameter";

export type ScopeKind =
  | "module"
  | "function"
  | "arrow-function"
  | "method"
  | "block"
  | "class"
  | "catch"
  | "for"
  | "switch"
  | "with"
  | "ts-module"
  | "ts-enum";

export interface SymbolDescriptor {
  readonly id: number;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly bindingIdentifier: EsTreeNode;
  readonly declarationNode: EsTreeNode;
  readonly scope: ScopeDescriptor;
  readonly initializer: EsTreeNode | null;
  readonly references: ReferenceDescriptor[];
}

export type ReferenceFlag = "read" | "write" | "read-write";

export interface ReferenceDescriptor {
  readonly id: number;
  readonly identifier: EsTreeNode;
  resolvedSymbol: SymbolDescriptor | null;
  readonly flag: ReferenceFlag;
  readonly scope: ScopeDescriptor;
}

export interface ScopeDescriptor {
  readonly id: number;
  readonly kind: ScopeKind;
  readonly node: EsTreeNode;
  readonly parent: ScopeDescriptor | null;
  readonly children: ScopeDescriptor[];
  readonly symbols: SymbolDescriptor[];
  readonly references: ReferenceDescriptor[];
  readonly symbolsByName: Map<string, SymbolDescriptor>;
}

export interface ScopeAnalysis {
  readonly rootScope: ScopeDescriptor;
  readonly scopeFor: (node: EsTreeNode) => ScopeDescriptor;
  readonly ownScopeFor: (node: EsTreeNode) => ScopeDescriptor | null;
  readonly symbolFor: (identifier: EsTreeNode) => SymbolDescriptor | null;
  readonly referenceFor: (identifier: EsTreeNode) => ReferenceDescriptor | null;
  readonly isGlobalReference: (identifier: EsTreeNode) => boolean;
}
