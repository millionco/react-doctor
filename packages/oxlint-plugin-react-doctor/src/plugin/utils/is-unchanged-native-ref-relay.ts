import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { ResolvedCrossFileFunctionExport } from "./resolve-cross-file-function-export.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasExactRefRelayReads } from "./has-exact-ref-relay-reads.js";
import { hasOrdinaryRefRelayRuntime } from "./has-ordinary-ref-relay-runtime.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNamedReactRefRelayCall } from "./is-named-react-ref-relay-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const getConstDeclarator = (
  statement: EsTreeNode | undefined,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
  const [declarator, ...others] = statement.declarations;
  return declarator && others.length === 0 && isNodeOfType(declarator.id, "Identifier")
    ? declarator
    : null;
};

const getOnlyExpression = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "BlockStatement")) return null;
  const [statement, ...others] = node.body;
  return others.length === 0 && isNodeOfType(statement, "ExpressionStatement")
    ? statement.expression
    : null;
};

const hasClosedFunctionBinding = (
  node: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbols = new Set(getFunctionBindingSymbols(node, scopes));
  if (isFunctionLike(node) && "id" in node && node.id) {
    for (const symbol of scopes.ownScopeFor(node)?.symbols ?? []) {
      if (symbol.bindingIdentifier === node.id) symbols.add(symbol);
    }
  }
  return (
    symbols.size > 0 &&
    [...symbols].every(
      (symbol) =>
        hasCompleteSymbolReferences(symbol, program, scopes) &&
        getRuntimeSymbolReferences(symbol).every(
          (reference) =>
            reference.flag === "read" &&
            isNodeOfType(reference.identifier.parent, "ExportSpecifier") &&
            reference.identifier.parent.local === reference.identifier,
        ),
    )
  );
};

export const isUnchangedNativeRefRelay = (resolved: ResolvedCrossFileFunctionExport): boolean => {
  const { functionNode, programNode } = resolved;
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    !isNodeOfType(functionNode.body, "BlockStatement")
  )
    return false;
  const scopes = analyzeScopes(programNode);
  if (!hasOrdinaryRefRelayRuntime(programNode, scopes)) return false;
  if (!hasClosedFunctionBinding(functionNode, programNode, scopes)) return false;
  if (
    !isNodeOfType(programNode, "Program") ||
    !programNode.body.every((statement) => {
      if (isNodeOfType(statement, "ImportDeclaration"))
        return statement.importKind === "type" || statement.source.value === "react";
      const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
        ? statement.declaration
        : statement;
      if (!declaration)
        return isNodeOfType(statement, "ExportNamedDeclaration") && !statement.source;
      if (
        isNodeOfType(declaration, "TSTypeAliasDeclaration") ||
        isNodeOfType(declaration, "TSInterfaceDeclaration")
      )
        return true;
      if (declaration === functionNode) return true;
      const declarator = getConstDeclarator(declaration);
      return Boolean(declarator?.init && stripParenExpression(declarator.init) === functionNode);
    })
  )
    return false;
  const [rest, ...otherParameters] = functionNode.params;
  if (
    !isNodeOfType(rest, "RestElement") ||
    !isNodeOfType(rest.argument, "Identifier") ||
    otherParameters.length > 0
  )
    return false;
  const restSymbol = scopes.symbolFor(rest.argument);
  const [creation, terminal, ...extraStatements] = functionNode.body.body;
  const result = getConstDeclarator(creation);
  if (
    !restSymbol ||
    !result?.init ||
    !isNodeOfType(result.id, "Identifier") ||
    extraStatements.length > 0
  )
    return false;
  if (!isNodeOfType(terminal, "ReturnStatement") || !terminal.argument) return false;
  const returned = stripParenExpression(terminal.argument);
  const resultSymbol = scopes.symbolFor(result.id);
  if (!resultSymbol || !hasExactRefRelayReads(resultSymbol, [returned], programNode, scopes))
    return false;
  const hook = stripParenExpression(result.init);
  if (
    !isNamedReactRefRelayCall(hook, "useCallback", scopes) ||
    !isNodeOfType(hook, "CallExpression")
  )
    return false;
  const [callbackArgument, dependencies, ...otherArguments] = hook.arguments;
  if (!callbackArgument || !dependencies || otherArguments.length > 0) return false;
  if (
    isNodeOfType(callbackArgument, "SpreadElement") ||
    isNodeOfType(dependencies, "SpreadElement")
  )
    return false;
  const callback = stripParenExpression(callbackArgument);
  const dependencyIdentifier = stripParenExpression(dependencies);
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return false;
  const [element, ...otherCallbackParameters] = callback.params;
  if (!isNodeOfType(element, "Identifier") || otherCallbackParameters.length > 0) return false;
  const elementSymbol = scopes.symbolFor(element);
  const [updaterCreation, iterationStatement, ...otherCallbackStatements] = callback.body.body;
  const updater = getConstDeclarator(updaterCreation);
  if (
    !elementSymbol ||
    !updater?.init ||
    !isNodeOfType(updater.id, "Identifier") ||
    otherCallbackStatements.length > 0
  )
    return false;
  const updateFunction = stripParenExpression(updater.init);
  if (
    !isFunctionLike(updateFunction) ||
    updateFunction.async ||
    updateFunction.generator ||
    !isNodeOfType(updateFunction.body, "BlockStatement")
  )
    return false;
  const [referenceParameter, ...otherUpdaterParameters] = updateFunction.params;
  if (!isNodeOfType(referenceParameter, "Identifier") || otherUpdaterParameters.length > 0)
    return false;
  const referenceSymbol = scopes.symbolFor(referenceParameter);
  const [nullGuard, dispatch, ...otherUpdaterStatements] = updateFunction.body.body;
  if (!referenceSymbol || otherUpdaterStatements.length > 0) return false;
  if (
    !isNodeOfType(nullGuard, "IfStatement") ||
    nullGuard.alternate ||
    !isNodeOfType(nullGuard.test, "UnaryExpression") ||
    nullGuard.test.operator !== "!" ||
    !isNodeOfType(nullGuard.consequent, "ReturnStatement") ||
    nullGuard.consequent.argument
  )
    return false;
  if (!isNodeOfType(dispatch, "IfStatement") || !dispatch.alternate) return false;
  const test = dispatch.test;
  if (
    !isNodeOfType(test, "BinaryExpression") ||
    test.operator !== "===" ||
    !isNodeOfType(test.left, "UnaryExpression") ||
    test.left.operator !== "typeof" ||
    !isNodeOfType(test.right, "Literal") ||
    test.right.value !== "function"
  )
    return false;
  const functionCall = getOnlyExpression(dispatch.consequent);
  const objectWrite = getOnlyExpression(dispatch.alternate);
  if (!isNodeOfType(functionCall, "CallExpression") || functionCall.optional) return false;
  const [forwardedElement, ...otherForwardedArguments] = functionCall.arguments;
  if (
    !forwardedElement ||
    isNodeOfType(forwardedElement, "SpreadElement") ||
    otherForwardedArguments.length > 0
  )
    return false;
  if (!isNodeOfType(objectWrite, "AssignmentExpression") || objectWrite.operator !== "=")
    return false;
  const target = objectWrite.left;
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    target.optional ||
    !isNodeOfType(target.property, "Identifier") ||
    target.property.name !== "current"
  )
    return false;
  if (
    !hasExactRefRelayReads(
      referenceSymbol,
      [nullGuard.test.argument, test.left.argument, functionCall.callee, target.object],
      programNode,
      scopes,
    )
  )
    return false;
  if (
    !hasExactRefRelayReads(
      elementSymbol,
      [stripParenExpression(forwardedElement), stripParenExpression(objectWrite.right)],
      programNode,
      scopes,
    )
  )
    return false;
  if (!isNodeOfType(iterationStatement, "ExpressionStatement")) return false;
  const iteration = iterationStatement.expression;
  if (!isNodeOfType(iteration, "CallExpression") || iteration.optional) return false;
  const receiver = iteration.callee;
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.computed ||
    receiver.optional ||
    !isNodeOfType(receiver.property, "Identifier") ||
    receiver.property.name !== "forEach"
  )
    return false;
  const [updateArgument, ...otherIterationArguments] = iteration.arguments;
  if (
    !updateArgument ||
    isNodeOfType(updateArgument, "SpreadElement") ||
    otherIterationArguments.length > 0
  )
    return false;
  const updaterSymbol = scopes.symbolFor(updater.id);
  return (
    updaterSymbol !== null &&
    hasExactRefRelayReads(
      updaterSymbol,
      [stripParenExpression(updateArgument)],
      programNode,
      scopes,
    ) &&
    hasExactRefRelayReads(restSymbol, [dependencyIdentifier, receiver.object], programNode, scopes)
  );
};
