import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectConstAliasSymbols } from "./collect-const-alias-symbols.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { SynchronousRenderOwnerProof } from "./find-synchronously-called-render-owner.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenNonThrowingNumberExpression } from "./is-proven-non-throwing-number-expression.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveReactRefSymbol } from "./react-ref-origin.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ProvenRefContainerField {
  container: ClosedRefContainer;
  name: string;
}

interface ClosedRefContainer {
  numericFields: Map<string, boolean>;
}

const NUMBER_ASSIGNMENT_OPERATORS = new Set([
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "|=",
  "^=",
]);

export const createClosedRefContainerMutationInspector = (
  context: RuleContext,
): SynchronousRenderOwnerProof => {
  const containers = new Map<SymbolDescriptor, ClosedRefContainer | null>();
  const getFieldName = (node: EsTreeNode): string | null =>
    getResolvedStaticPropertyName(node, context.scopes, { stringifyNonStringLiterals: true });

  const getContainer = (symbol: SymbolDescriptor): ClosedRefContainer | null => {
    if (containers.has(symbol)) return containers.get(symbol) ?? null;
    containers.set(symbol, null);
    const initializer = getDirectConstInitializer(symbol);
    const call = initializer ? stripParenExpression(initializer) : null;
    const initialValue = isNodeOfType(call, "CallExpression") ? call.arguments[0] : null;
    if (!initialValue || isNodeOfType(initialValue, "SpreadElement")) return null;
    const payload = stripParenExpression(initialValue);
    const fields = new Map<string, EsTreeNode>();
    if (isNodeOfType(payload, "ObjectExpression")) {
      for (const property of payload.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          property.computed ||
          property.method ||
          property.kind !== "init"
        )
          return null;
        const name = getStaticPropertyKeyName(property, { stringifyNonStringLiterals: true });
        if (name === null || name === "__proto__" || fields.has(name)) return null;
        fields.set(name, property.value);
      }
    } else if (isNodeOfType(payload, "ArrayExpression")) {
      for (const [index, element] of payload.elements.entries()) {
        if (!element || isNodeOfType(element, "SpreadElement")) return null;
        fields.set(String(index), element);
      }
    } else return null;

    const numericFields = new Map(
      [...fields].map(([name, value]) => [
        name,
        isProvenNonThrowingNumberExpression(value, context.scopes),
      ]),
    );
    const aliases = collectConstAliasSymbols(symbol, context.scopes);
    const aliasSet = new Set(aliases);
    const aliasNames = new Set(aliases.map((alias) => alias.name));
    let closed = true;
    const program = findProgramRoot(symbol.declarationNode);
    if (!program) return null;
    walkAst(program, (node) => {
      if (!closed || !isNodeOfType(node, "Identifier") || !aliasNames.has(node.name)) return;
      const reference = context.scopes.referenceFor(node);
      if (reference && (!reference.resolvedSymbol || !aliasSet.has(reference.resolvedSymbol)))
        closed = false;
    });
    if (!closed) return null;
    for (const alias of aliases) {
      for (const reference of alias.references) {
        if (reference.flag !== "read") return null;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const aliasSymbol = context.scopes.symbolFor(parent.id);
          if (aliasSymbol && aliasSet.has(aliasSymbol)) continue;
          return null;
        }
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          parent.optional ||
          getStaticPropertyName(parent) !== "current"
        )
          return null;
        const current = findTransparentExpressionRoot(parent);
        const field = current.parent;
        if (!isNodeOfType(field, "MemberExpression") || field.object !== current) return null;
        const name = getFieldName(field);
        if (name === null || !fields.has(name)) return null;
        const fieldRoot = findTransparentExpressionRoot(field);
        const use = fieldRoot.parent;
        if (
          (isNodeOfType(use, "MemberExpression") && use.object === fieldRoot) ||
          ((isNodeOfType(use, "CallExpression") || isNodeOfType(use, "NewExpression")) &&
            use.callee === fieldRoot) ||
          (isNodeOfType(use, "TaggedTemplateExpression") && use.tag === fieldRoot)
        )
          return null;
        if (!isWithinAssignmentTarget(fieldRoot)) continue;
        if (isNodeOfType(use, "UpdateExpression") && use.argument === fieldRoot) continue;
        if (!isNodeOfType(use, "AssignmentExpression") || use.left !== fieldRoot) return null;
        numericFields.set(
          name,
          Boolean(
            numericFields.get(name) &&
            (use.operator === "=" || NUMBER_ASSIGNMENT_OPERATORS.has(use.operator)) &&
            isProvenNonThrowingNumberExpression(use.right, context.scopes),
          ),
        );
      }
    }
    const container = { numericFields };
    containers.set(symbol, container);
    return container;
  };

  const getProvenField = (node: EsTreeNode): ProvenRefContainerField | null => {
    const field = stripParenExpression(node);
    if (!isNodeOfType(field, "MemberExpression") || field.optional) return null;
    const current = stripParenExpression(field.object);
    const symbol = resolveReactRefSymbol(current, context.scopes);
    if (!symbol) return null;
    const name = getFieldName(field);
    const container = getContainer(symbol);
    return name !== null && container?.numericFields.has(name) ? { container, name } : null;
  };

  return {
    isProvenComputedMember: (node) => getProvenField(node) !== null,
    isProvenRefMutation: (node) => {
      const mutation = stripParenExpression(node);
      const target = isNodeOfType(mutation, "AssignmentExpression")
        ? mutation.left
        : isNodeOfType(mutation, "UpdateExpression")
          ? mutation.argument
          : null;
      const field = target ? getProvenField(target) : null;
      if (!field) return false;
      if (isNodeOfType(mutation, "AssignmentExpression")) {
        return (
          mutation.operator === "=" ||
          Boolean(
            NUMBER_ASSIGNMENT_OPERATORS.has(mutation.operator) &&
            field.container.numericFields.get(field.name) &&
            isProvenNonThrowingNumberExpression(mutation.right, context.scopes),
          )
        );
      }
      return Boolean(field.container.numericFields.get(field.name));
    },
  };
};
