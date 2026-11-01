import type { ScopeDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";

interface RuntimeValueBindingIndex {
  readonly bindings: ReadonlyMap<string, SymbolDescriptor | null>;
  readonly ambientFunctionNames: ReadonlySet<string>;
}

const runtimeValueBindingIndices = new WeakMap<ScopeDescriptor, RuntimeValueBindingIndex>();
const runtimeValueBindingResults = new WeakMap<
  ScopeDescriptor,
  Map<string, SymbolDescriptor | null>
>();

export const resolveRuntimeValueBinding = (
  scope: ScopeDescriptor,
  name: string,
): SymbolDescriptor | null => {
  let results = runtimeValueBindingResults.get(scope);
  if (!results) {
    results = new Map();
    runtimeValueBindingResults.set(scope, results);
  }
  if (results.has(name)) return results.get(name) ?? null;

  let index = runtimeValueBindingIndices.get(scope);
  if (!index) {
    const bindings = new Map<string, SymbolDescriptor | null>();
    for (const symbol of scope.symbols) {
      if (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") continue;
      bindings.set(symbol.name, bindings.has(symbol.name) ? null : symbol);
    }

    const owner = scope.node;
    let statements: ReadonlyArray<EsTreeNode> = [];
    if (
      owner.type === "Program" ||
      owner.type === "BlockStatement" ||
      owner.type === "StaticBlock"
    ) {
      statements = owner.body;
    } else if (isFunctionLike(owner) && owner.body.type === "BlockStatement") {
      statements = owner.body.body;
    } else if (owner.type === "CatchClause") {
      statements = owner.body.body;
    } else if (owner.type === "SwitchStatement") {
      statements = owner.cases.flatMap((branch) => branch.consequent);
    }
    const ambientFunctionNames = new Set<string>();
    for (const statement of statements) {
      const declaration =
        statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
          ? statement.declaration
          : statement;
      if (declaration?.type === "TSDeclareFunction" && declaration.id)
        ambientFunctionNames.add(declaration.id.name);
    }
    index = { bindings, ambientFunctionNames };
    runtimeValueBindingIndices.set(scope, index);
  }

  let binding: SymbolDescriptor | null = null;
  if (
    scope.kind !== "with" &&
    scope.kind !== "ts-module" &&
    !index.ambientFunctionNames.has(name)
  ) {
    if (index.bindings.has(name)) binding = index.bindings.get(name) ?? null;
    else if (scope.parent) binding = resolveRuntimeValueBinding(scope.parent, name);
  }
  results.set(name, binding);
  return binding;
};
