import { hasClosedKeyboardModuleInitialization } from "./has-closed-keyboard-module-initialization.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const readPlainCall = (expression: EsTreeNode | null | undefined, arity: number) =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  expression.arguments.length === arity &&
  expression.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? expression
    : null;

const readClosedConstValue = (reference: EsTreeNode, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(reference, "Identifier")) return null;
  const binding = scopes.symbolFor(reference);
  return binding && isSymbolReadOnly(binding) ? getDirectConstInitializer(binding) : null;
};

const isStringConstant = (value: EsTreeNode | null | undefined, scopes: ScopeAnalysis): boolean => {
  if (!value) return false;
  const expression = stripParenExpression(readClosedConstValue(value, scopes) ?? value);
  return isNodeOfType(expression, "Literal") && typeof expression.value === "string";
};

const isPrivateKeyJoin = (value: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const join = readPlainCall(value, 0);
  if (
    !join ||
    !isNodeOfType(join.callee, "MemberExpression") ||
    join.callee.optional ||
    join.callee.computed ||
    getStaticPropertyName(join.callee) !== "join" ||
    !isNodeOfType(join.callee.object, "Identifier")
  ) {
    return false;
  }
  const binding = scopes.symbolFor(join.callee.object);
  if (!binding || !isSymbolReadOnly(binding)) return false;
  const initializer = getDirectConstInitializer(binding);
  return Boolean(
    isNodeOfType(initializer, "ArrayExpression") &&
    initializer.elements.length > 0 &&
    initializer.elements.every((entry) => isStringConstant(entry, scopes)) &&
    hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) &&
    binding.references.every(({ identifier, flag }) => {
      const member = identifier.parent;
      return (
        flag === "read" &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === identifier &&
        !member.computed &&
        !member.optional &&
        getStaticPropertyName(member) === "join" &&
        readPlainCall(member.parent, 0)?.callee === member
      );
    }),
  );
};

const isStockHotkeysDefaultImport = (value: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(value, "Identifier")) return false;
  const binding = scopes.symbolFor(value);
  const declaration = binding && getImportDeclarationForSymbol(binding);
  return Boolean(
    declaration &&
    declaration.importKind !== "type" &&
    declaration.source.value === "hotkeys-js" &&
    isNodeOfType(binding?.declarationNode, "ImportDefaultSpecifier"),
  );
};

const isForwardedHotkeysImport = (value: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isStockHotkeysDefaultImport(value, scopes)) return true;
  const initializer = readClosedConstValue(value, scopes);
  const relay = initializer && stripParenExpression(initializer);
  if (
    !isFunctionLike(relay) ||
    relay.async ||
    relay.generator ||
    relay.params.length !== 2 ||
    !isNodeOfType(relay.params[0], "Identifier") ||
    !isNodeOfType(relay.params[1], "Identifier")
  ) {
    return false;
  }
  const statements = isNodeOfType(relay.body, "BlockStatement") ? relay.body.body : null;
  const returned = statements?.length === 1 ? statements[0] : null;
  const result = statements
    ? isNodeOfType(returned, "ReturnStatement")
      ? returned.argument
      : null
    : relay.body;
  const call = readPlainCall(result, 2);
  return Boolean(
    call &&
    isStockHotkeysDefaultImport(call.callee, scopes) &&
    call.arguments.every((argument, index) => {
      const parameterBinding = scopes.symbolFor(relay.params[index]);
      return (
        parameterBinding &&
        isNodeOfType(argument, "Identifier") &&
        scopes.symbolFor(argument) === parameterBinding
      );
    }),
  );
};

export const isDeferredHotkeysRegistrationExport = (
  filename: string,
  source: string,
  exportedName: string,
): boolean => {
  const program = parseSourceText({ filename, sourceText: source });
  if (!isNodeOfType(program, "Program")) return false;
  const exported = findExportedValue(program, exportedName);
  const declarator = exported?.parent;
  if (
    !isFunctionLike(exported) ||
    exported.async ||
    exported.generator ||
    exported.params.length !== 1 ||
    !isNodeOfType(exported.params[0], "Identifier") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== exported ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(declarator.parent.parent, "ExportNamedDeclaration") ||
    !isNodeOfType(exported.body, "BlockStatement") ||
    exported.body.body.length !== 1 ||
    !isNodeOfType(exported.body.body[0], "ExpressionStatement")
  ) {
    return false;
  }
  const call = readPlainCall(exported.body.body[0].expression, 2);
  const handler = call?.arguments[1];
  if (!call || !isNodeOfType(handler, "ArrowFunctionExpression")) return false;
  const scopes = analyzeScopes(program);
  return (
    hasClosedKeyboardModuleInitialization(program, scopes, call.callee) &&
    isPrivateKeyJoin(call.arguments[0], scopes) &&
    isForwardedHotkeysImport(call.callee, scopes)
  );
};
