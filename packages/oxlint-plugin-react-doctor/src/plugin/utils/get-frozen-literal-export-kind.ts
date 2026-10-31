import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticArrayExpressionLength } from "./get-static-array-expression-length.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const frozenLiteralKindByProgram = new WeakMap<
  EsTreeNode,
  ReadonlyMap<string, "array" | "object">
>();

export const getFrozenLiteralExportKind = (
  program: EsTreeNode,
  exportedName: string,
): "array" | "object" | null => {
  const cachedKinds = frozenLiteralKindByProgram.get(program);
  if (cachedKinds) return cachedKinds.get(exportedName) ?? null;
  const exportKinds = new Map<string, "array" | "object">();
  frozenLiteralKindByProgram.set(program, exportKinds);
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return null;
  const statement = program.body[0];
  if (
    !isNodeOfType(statement, "ExportNamedDeclaration") ||
    statement.source ||
    statement.exportKind === "type" ||
    !isNodeOfType(statement.declaration, "VariableDeclaration") ||
    statement.declaration.kind !== "const" ||
    statement.declaration.declarations.length !== 1
  ) {
    return null;
  }
  const declarator = statement.declaration.declarations[0];
  if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) return null;
  const initializer = stripParenExpression(declarator.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== 1
  ) {
    return null;
  }
  const callee = stripParenExpression(initializer.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.object, "Identifier") ||
    callee.object.name !== "Object" ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "freeze" ||
    !isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Object", analyzeScopes(program))
  ) {
    return null;
  }
  const argument = initializer.arguments[0];
  if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
  const literal = stripParenExpression(argument);
  const isPrimitiveLiteral = (value: EsTreeNode): boolean =>
    isNodeOfType(value, "Literal") && (value.value === null || typeof value.value !== "object");
  if (
    isNodeOfType(literal, "ArrayExpression") &&
    getStaticArrayExpressionLength(literal) !== null &&
    literal.elements.every((element) => element && isPrimitiveLiteral(element))
  ) {
    exportKinds.set(declarator.id.name, "array");
  }
  if (
    isNodeOfType(literal, "ObjectExpression") &&
    literal.properties.every((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        !isPrimitiveLiteral(property.value)
      ) {
        return false;
      }
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      return propertyName !== null && propertyName !== "__proto__";
    })
  ) {
    exportKinds.set(declarator.id.name, "object");
  }
  return exportKinds.get(exportedName) ?? null;
};
