import type { SourceProjectModule } from "../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getSingleReturnExpression } from "../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { JestExplicitSourceSubstitution } from "../../utils/read-named-jest-caller.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

type Module = SourceProjectModule;
type Func = EsTreeNodeOfType<"FunctionDeclaration">;
type Call = EsTreeNodeOfType<"CallExpression">;

export interface PlainJestHookSite {
  readonly filePath: string;
  readonly specifier: string;
  readonly name: string;
  readonly call: Call;
}

const readNamedReference = (unit: Module, node: EsTreeNode) => {
  const symbol = unit.scopes.symbolFor(node);
  const spec = symbol?.declarationNode;
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !declaration ||
    isTypeOnlyImport(declaration) ||
    !hasCompleteSymbolReferences(symbol, unit.programNode, unit.scopes) ||
    symbol.references.some(({ flag }) => flag !== "read") ||
    !isNodeOfType(spec, "ImportSpecifier") ||
    spec.importKind === "type" ||
    !isNodeOfType(spec.imported, "Identifier") ||
    typeof declaration.source.value !== "string"
  )
    return null;
  return { name: spec.imported.name, specifier: declaration.source.value };
};

const isStockReactCall = (unit: Module, node: EsTreeNode, name: string): node is Call => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const binding = readNamedReference(unit, node.callee);
  return binding?.name === name && binding.specifier === "react";
};

const containsJsx = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (nested) => {
    if (isNodeOfType(nested, "JSXElement") || isNodeOfType(nested, "JSXFragment")) found = true;
  });
  return found;
};

/**
 * Locate a bare imported call on the initial straight-line path of a render.
 * The caller must establish the component entry and that no other branch
 * mounts the focal. This describes render-time order, not module imports.
 */
export const readPlainJestPreRenderHookSites = (
  unit: Module,
  component: Func,
): readonly PlainJestHookSite[] => {
  if (component.async || component.generator || !isNodeOfType(component.body, "BlockStatement"))
    return [];
  const result: PlainJestHookSite[] = [];
  for (const statement of component.body.body) {
    if (containsJsx(statement)) break;
    const initializer =
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.declarations.length === 1 &&
      isNodeOfType(statement.declarations[0], "VariableDeclarator")
        ? statement.declarations[0].init
        : isNodeOfType(statement, "ExpressionStatement")
          ? statement.expression
          : null;
    if (!initializer) break;
    const value = stripParenExpression(initializer);
    if (
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      !isNodeOfType(value.callee, "Identifier")
    )
      continue;
    const binding = readNamedReference(unit, value.callee);
    if (binding?.name.startsWith("use"))
      result.push({ filePath: unit.filePath, ...binding, call: value });
  }
  return result;
};

/** The accepted effective mock must really be the one selected by the hook call. */
export const omitsNamedHookFromOwnedJestMock = (
  hook: PlainJestHookSite,
  matched: JestExplicitSourceSubstitution,
): boolean => {
  const returned = getSingleReturnExpression(matched.factory);
  const object = returned && stripParenExpression(returned);
  if (!object || !isNodeOfType(object, "ObjectExpression")) return false;
  const fields = new Set<string>();
  for (const item of object.properties) {
    if (!isNodeOfType(item, "Property") || item.kind !== "init" || item.method) return false;
    const field = getStaticPropertyKeyName(item);
    if (!field || field === "__proto__" || fields.has(field)) return false;
    fields.add(field);
  }
  return !fields.has(hook.name);
};

/** Detects a direct first-reader hook that throws before returning a null value. */
export const readJestNoProviderContext = (
  source: Module,
  hook: PlainJestHookSite,
): { readonly specifier: string; readonly name: string } | null => {
  const selection = findExportedValue(source.programNode, hook.name);
  if (
    !isNodeOfType(selection, "FunctionDeclaration") ||
    !selection.id ||
    selection.async ||
    selection.generator ||
    selection.params.length !== 0 ||
    !isNodeOfType(selection.body, "BlockStatement")
  )
    return null;
  const bound = source.scopes.rootScope.symbolsByName.get(selection.id.name);
  if (
    !bound ||
    bound.declarationNode !== selection ||
    !hasCompleteSymbolReferences(bound, source.programNode, source.scopes) ||
    bound.references.some(({ flag }) => flag !== "read") ||
    selection.body.body.length !== 3
  )
    return null;
  const [first, guard, result] = selection.body.body;
  if (
    !isNodeOfType(first, "VariableDeclaration") ||
    first.kind !== "const" ||
    first.declarations.length !== 1 ||
    !isNodeOfType(first.declarations[0], "VariableDeclarator")
  )
    return null;
  const { id, init } = first.declarations[0];
  const symbol = source.scopes.symbolFor(id);
  if (
    !symbol ||
    !init ||
    !isStockReactCall(source, init, "useContext") ||
    init.arguments.length !== 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    source.scopes.symbolFor(guard.test.argument) !== symbol ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 1 ||
    !isNodeOfType(guard.consequent.body[0], "ThrowStatement") ||
    !isNodeOfType(result, "ReturnStatement") ||
    !result.argument ||
    source.scopes.symbolFor(result.argument) !== symbol
  )
    return null;
  return readNamedReference(source, init.arguments[0]);
};

export const isJestNullDefaultContext = (unit: Module, name: string): boolean => {
  const value = findExportedValue(unit.programNode, name);
  const candidate = value?.parent;
  if (
    !value ||
    !isStockReactCall(unit, value, "createContext") ||
    value.arguments.length !== 1 ||
    !isNodeOfType(value.arguments[0], "Literal") ||
    value.arguments[0].value !== null ||
    !isNodeOfType(candidate, "VariableDeclarator") ||
    !isNodeOfType(candidate.id, "Identifier") ||
    candidate.parent?.parent?.type !== "ExportNamedDeclaration"
  )
    return false;
  const symbol = unit.scopes.rootScope.symbolsByName.get(candidate.id.name);
  return Boolean(
    symbol &&
    symbol.kind === "const" &&
    symbol.declarationNode === candidate &&
    hasCompleteSymbolReferences(symbol, unit.programNode, unit.scopes) &&
    !symbol.references.length,
  );
};
