import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { statementAlwaysExits } from "../../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const FORBIDDEN_FORMATTER_STATEMENTS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "TryStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
]);
const dynamicProviderAccessByScopes = new WeakMap<ScopeAnalysis, boolean>();

// These expressions either produce a primitive string or throw. Type names,
// arbitrary calls and bare identifiers do not establish this runtime domain.
const isStringExpression = (expression: EsTreeNode): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) return typeof value.value === "string";
  if (isNodeOfType(value, "TemplateLiteral")) return true;
  if (isNodeOfType(value, "BinaryExpression") && value.operator === "+") {
    return isStringExpression(value.left) || isStringExpression(value.right);
  }
  return (
    isNodeOfType(value, "ConditionalExpression") &&
    isStringExpression(value.consequent) &&
    isStringExpression(value.alternate)
  );
};

const hasDynamicProviderAccess = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = dynamicProviderAccessByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let unsafe = false;
  walkAst(program, (node) => {
    if (unsafe) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression"))
      unsafe = true;
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.isGlobalReference(node) &&
      (node.name === "eval" || node.name === "require")
    )
      unsafe = true;
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    if (node.source.value === "module" || node.source.value === "node:module") unsafe = true;
    if (node.source.value !== "react" || node.importKind === "type") return;
    for (const specifier of node.specifiers) {
      if (
        !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
        !isNodeOfType(specifier, "ImportNamespaceSpecifier")
      )
        continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (
        !symbol ||
        !hasCompleteSymbolReferences(symbol, program, scopes) ||
        symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
      ) {
        unsafe = true;
      }
    }
  });
  dynamicProviderAccessByScopes.set(scopes, unsafe);
  return unsafe;
};

export const isClosedStringReactState = (
  state: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const declaration = state.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    declaration.id.elements[0] !== state.bindingIdentifier ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !declaration.init ||
    !isNodeOfType(declaration.init, "CallExpression")
  )
    return false;
  const setterNode = declaration.id.elements[1];
  const initializer = declaration.init;
  if (
    !setterNode ||
    !isNodeOfType(setterNode, "Identifier") ||
    initializer.optional ||
    initializer.arguments.length !== 1 ||
    !isStringExpression(initializer.arguments[0]) ||
    !isNodeOfType(initializer.callee, "Identifier")
  )
    return false;
  const hook = scopes.symbolFor(initializer.callee);
  if (
    !hook ||
    !isNodeOfType(hook.declarationNode, "ImportSpecifier") ||
    hook.declarationNode.importKind === "type" ||
    getImportedName(hook.declarationNode) !== "useState"
  )
    return false;
  const importDeclaration = hook.declarationNode.parent;
  if (
    !importDeclaration ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    importDeclaration.importKind === "type" ||
    importDeclaration.source.value !== "react"
  )
    return false;
  const setter = scopes.symbolFor(setterNode);
  if (!setter) return false;
  let program: EsTreeNode = declaration;
  while (program.parent) program = program.parent;
  const readonly = (symbol: SymbolDescriptor): boolean =>
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
    );
  if (!readonly(state) || !readonly(setter) || !readonly(hook)) return false;
  if (
    !hook.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const call = reference.identifier.parent;
      return (
        call &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === reference.identifier &&
        !call.optional
      );
    })
  )
    return false;

  const formatterIsString = (call: EsTreeNode): boolean => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
      !isNodeOfType(call.callee, "Identifier")
    )
      return false;
    const binding = scopes.symbolFor(call.callee);
    if (!binding || !readonly(binding)) return false;
    const formatter =
      binding.kind === "function" ? binding.declarationNode : getDirectConstInitializer(binding);
    if (
      !formatter ||
      !isFunctionLike(formatter) ||
      formatter.async ||
      formatter.generator ||
      (isNodeOfType(formatter, "FunctionExpression") && formatter.id) ||
      !formatter.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
    )
      return false;
    const owner = isNodeOfType(binding.declarationNode, "VariableDeclarator")
      ? binding.declarationNode.parent
      : binding.declarationNode;
    if (
      isNodeOfType(owner?.parent, "ExportNamedDeclaration") ||
      isNodeOfType(owner?.parent, "ExportDefaultDeclaration")
    )
      return false;
    if (
      !binding.references.every((reference) => {
        if (isTypeScriptTypePosition(reference.identifier)) return true;
        const target = findTransparentExpressionRoot(reference.identifier);
        return (
          (reference.identifier.range[0] < formatter.range[0] ||
            reference.identifier.range[0] > formatter.range[1]) &&
          isNodeOfType(target.parent, "CallExpression") &&
          target.parent.callee === target &&
          !target.parent.optional
        );
      })
    )
      return false;
    if (!isNodeOfType(formatter.body, "BlockStatement")) return isStringExpression(formatter.body);
    // Exclude abrupt constructs whose break/finally paths would need a CFG.
    // Then the existing termination helper establishes no implicit undefined.
    let unsupported = false;
    walkAst(formatter.body, (node) => {
      if (unsupported) return false;
      if (
        FORBIDDEN_FORMATTER_STATEMENTS.has(node.type) ||
        isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")
      )
        unsupported = true;
    });
    if (unsupported || !statementAlwaysExits(formatter.body)) return false;
    const returns = collectFunctionReturnStatements(formatter);
    return (
      returns.length > 0 &&
      returns.every((statement) =>
        Boolean(statement.argument && isStringExpression(statement.argument)),
      )
    );
  };
  let writes = 0;
  for (const reference of setter.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    const call = reference.identifier.parent;
    if (
      !call ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      call.optional ||
      call.arguments.length !== 1 ||
      isNodeOfType(call.arguments[0], "SpreadElement")
    )
      return false;
    const argument = call.arguments[0];
    if (!isStringExpression(argument) && !formatterIsString(argument)) return false;
    writes++;
  }
  return writes > 0 && !hasDynamicProviderAccess(program, scopes);
};
