import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";

interface PlainValidationInputDataInput {
  readonly value: EsTreeNode;
  readonly module: AsyncEventSourceModule;
}

export const hasPlainValidationInputData = ({
  value,
  module,
}: PlainValidationInputDataInput): boolean => {
  const hasClosedValidationInputRecordReads = (
    symbol: SymbolDescriptor,
    seen: ReadonlySet<SymbolDescriptor>,
  ): boolean => {
    if (seen.has(symbol) || !hasReadonlyAsyncEventBinding(symbol, module)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(symbol);
    const allowed = new Set<EsTreeNode>();
    for (const reference of symbol.references) {
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "SpreadElement") &&
        parent.argument === root &&
        isNodeOfType(parent.parent, "ObjectExpression")
      )
        allowed.add(reference.identifier);
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const"
      ) {
        const alias = module.scopes.symbolFor(parent.id);
        if (!alias || !hasClosedValidationInputRecordReads(alias, nextSeen)) return false;
        allowed.add(reference.identifier);
      }
    }
    return hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers: allowed,
      program: module.program,
      scopes: module.scopes,
    });
  };
  const readValidationInputDataKind = (
    raw: EsTreeNode,
    seen: ReadonlySet<SymbolDescriptor>,
  ): "primitive" | "record" | null => {
    const candidate = stripParenExpression(raw);
    if (isNodeOfType(candidate, "Literal"))
      return candidate.value === null ||
        typeof candidate.value === "string" ||
        typeof candidate.value === "number" ||
        typeof candidate.value === "boolean"
        ? "primitive"
        : null;
    if (
      isNodeOfType(candidate, "UnaryExpression") &&
      (candidate.operator === "-" || candidate.operator === "+" || candidate.operator === "!")
    )
      return readValidationInputDataKind(candidate.argument, seen) === "primitive"
        ? "primitive"
        : null;
    if (isNodeOfType(candidate, "Identifier")) {
      const symbol = module.scopes.symbolFor(candidate);
      const declaration = symbol?.declarationNode;
      if (
        !symbol ||
        seen.has(symbol) ||
        symbol.kind !== "const" ||
        !hasReadonlyAsyncEventBinding(symbol, module) ||
        !isNodeOfType(declaration, "VariableDeclarator") ||
        declaration.id !== symbol.bindingIdentifier ||
        !declaration.init
      )
        return null;
      const nextSeen = new Set(seen);
      nextSeen.add(symbol);
      const kind = readValidationInputDataKind(declaration.init, nextSeen);
      return kind === "record" && !hasClosedValidationInputRecordReads(symbol, new Set())
        ? null
        : kind;
    }
    if (!isNodeOfType(candidate, "ObjectExpression")) return null;
    const names = new Set<string>();
    for (const property of candidate.properties) {
      if (isNodeOfType(property, "SpreadElement")) {
        if (readValidationInputDataKind(property.argument, seen) !== "record") return null;
        continue;
      }
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        return null;
      const name = getStaticPropertyKeyName(property);
      if (
        !name ||
        name === "__proto__" ||
        names.has(name) ||
        readValidationInputDataKind(property.value, seen) !== "primitive"
      )
        return null;
      names.add(name);
    }
    return "record";
  };
  return readValidationInputDataKind(value, new Set()) === "record";
};
