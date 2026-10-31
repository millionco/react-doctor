import {
  REF_CLEANUP_CONTEXT_ARGUMENT_COUNT,
  REF_CLEANUP_HOOK_ARGUMENT_COUNT,
  REF_CLEANUP_NODE_PARAMETER_COUNT,
} from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { getNativeRefCleanupHookCall } from "./get-native-ref-cleanup-hook-call.js";
import { hasRefCleanupProviderHazard } from "./has-ref-cleanup-provider-hazard.js";

export const isForwardedRefHelperCleanup = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  const openingElement = attribute.parent;
  if (
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isProvenIntrinsicJsxElement(openingElement, scopes) ||
    getAuthoritativeJsxAttribute(openingElement.attributes, "ref") !== attribute ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  ) {
    return false;
  }
  const expression = stripParenExpression(attribute.value.expression);
  if (!isNodeOfType(expression, "Identifier")) return false;
  const callbackSymbol = scopes.symbolFor(expression);
  const owner = callbackSymbol ? findEnclosingFunction(callbackSymbol.declarationNode) : null;
  if (!callbackSymbol || !isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement"))
    return false;
  const ownerBody = owner.body;
  const callbackCall = getNativeRefCleanupHookCall(expression, "useCallback", ownerBody, scopes);
  if (!callbackCall || callbackCall.arguments.length !== REF_CLEANUP_HOOK_ARGUMENT_COUNT)
    return false;
  const [callbackArgument, callbackDependencies] = callbackCall.arguments;
  const callback = callbackArgument ? stripParenExpression(callbackArgument) : null;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    callback.params.length !== REF_CLEANUP_NODE_PARAMETER_COUNT ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !isNodeOfType(callbackDependencies, "ArrayExpression") ||
    callbackSymbol.references.some((reference) => reference.identifier !== expression)
  ) {
    return false;
  }
  const [nodeParameter] = callback.params;
  if (!isNodeOfType(nodeParameter, "Identifier")) return false;
  const nodeSymbol = scopes.symbolFor(nodeParameter);
  if (!nodeSymbol || nodeSymbol.references.some((reference) => reference.flag !== "read"))
    return false;
  const statements = getCallbackStatements(callback);
  const finalReturn = statements.pop();
  if (!isNodeOfType(finalReturn, "ReturnStatement") || !finalReturn.argument) return false;
  let invocation = stripParenExpression(finalReturn.argument);
  if (isNodeOfType(invocation, "Identifier")) {
    const declarationStatement = statements.pop();
    if (
      !isNodeOfType(declarationStatement, "VariableDeclaration") ||
      declarationStatement.kind !== "const"
    )
      return false;
    const [declaration, ...extraDeclarations] = declarationStatement.declarations;
    if (
      extraDeclarations.length > 0 ||
      !declaration ||
      !declaration.init ||
      !isNodeOfType(declaration.id, "Identifier")
    )
      return false;
    const resultSymbol = scopes.symbolFor(invocation);
    if (
      resultSymbol?.declarationNode !== declaration ||
      resultSymbol.references.some((reference) => reference.identifier !== invocation)
    ) {
      return false;
    }
    invocation = stripParenExpression(declaration.init);
  }
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.arguments.length !== REF_CLEANUP_NODE_PARAMETER_COUNT
  )
    return false;
  const [forwardedArgument] = invocation.arguments;
  const forwardedNode = forwardedArgument ? stripParenExpression(forwardedArgument) : null;
  const callee = stripParenExpression(invocation.callee);
  if (
    !isNodeOfType(callee, "Identifier") ||
    !isNodeOfType(forwardedNode, "Identifier") ||
    scopes.symbolFor(forwardedNode) !== nodeSymbol
  )
    return false;
  const helperSymbol = scopes.symbolFor(callee);
  const helperCall = getNativeRefCleanupHookCall(callee, "useCallback", ownerBody, scopes);
  if (
    !helperSymbol ||
    !helperCall ||
    helperCall.arguments.length !== REF_CLEANUP_HOOK_ARGUMENT_COUNT
  )
    return false;
  if (
    helperSymbol.references.some((reference) => {
      if (reference.identifier === callee) return false;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      return (
        referenceRoot.parent !== callbackDependencies ||
        !callbackDependencies.elements.some((element) => element === referenceRoot)
      );
    })
  )
    return false;
  const [helperArgument, helperDependencies] = helperCall.arguments;
  const helper = helperArgument ? stripParenExpression(helperArgument) : null;
  if (
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.generator ||
    helper.params.length !== REF_CLEANUP_NODE_PARAMETER_COUNT ||
    !isNodeOfType(helper.body, "BlockStatement") ||
    !isNodeOfType(helperDependencies, "ArrayExpression")
  )
    return false;
  const [helperParameter] = helper.params;
  if (!isNodeOfType(helperParameter, "Identifier")) return false;
  const helperParameterSymbol = scopes.symbolFor(helperParameter);
  if (
    !helperParameterSymbol ||
    helperParameterSymbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  const [storeStatement, ...extraStatements] = statements;
  if (extraStatements.length > 0) return false;
  if (storeStatement) {
    if (!isNodeOfType(storeStatement, "ExpressionStatement")) return false;
    const store = stripParenExpression(storeStatement.expression);
    if (!isNodeOfType(store, "AssignmentExpression") || store.operator !== "=") return false;
    const destination = stripParenExpression(store.left);
    const storedNode = stripParenExpression(store.right);
    if (
      !isNodeOfType(destination, "MemberExpression") ||
      destination.computed ||
      destination.optional ||
      !isNodeOfType(destination.property, "Identifier") ||
      destination.property.name !== "current" ||
      !isNodeOfType(storedNode, "Identifier") ||
      scopes.symbolFor(storedNode) !== nodeSymbol
    )
      return false;
    const receiver = stripParenExpression(destination.object);
    const refCall = getNativeRefCleanupHookCall(receiver, "useRef", ownerBody, scopes);
    const refSymbol = isNodeOfType(receiver, "Identifier") ? scopes.symbolFor(receiver) : null;
    if (!refCall || !refSymbol || refCall.arguments.length !== REF_CLEANUP_CONTEXT_ARGUMENT_COUNT)
      return false;
    if (
      refSymbol.references.some((reference) => {
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const member = referenceRoot.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== referenceRoot ||
          member.computed ||
          !isNodeOfType(member.property, "Identifier") ||
          member.property.name !== "current"
        )
          return true;
        if (member === destination) return false;
        const memberRoot = findTransparentExpressionRoot(member);
        const consumer = memberRoot.parent;
        return (
          !isNodeOfType(consumer, "CallExpression") ||
          !consumer.arguments.some((argument) => argument === memberRoot)
        );
      })
    )
      return false;
  }
  const helperStatements = getCallbackStatements(helper);
  const cleanupReturn = helperStatements.pop();
  if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
  const cleanup = stripParenExpression(cleanupReturn.argument);
  if (
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    cleanup.generator ||
    cleanup.params.length > 0
  )
    return false;
  const acceptedReturns = new Set<EsTreeNode>([cleanupReturn]);
  const guardRoles = new Set<string>();
  while (isNodeOfType(helperStatements[0], "IfStatement")) {
    const guard = helperStatements.shift();
    if (!isNodeOfType(guard, "IfStatement") || guard.alternate) return false;
    const test = stripParenExpression(guard.test);
    if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return false;
    let exit: EsTreeNode = guard.consequent;
    if (isNodeOfType(exit, "BlockStatement")) {
      const [onlyStatement, ...otherStatements] = exit.body;
      if (!onlyStatement || otherStatements.length > 0) return false;
      exit = onlyStatement;
    }
    if (!isNodeOfType(exit, "ReturnStatement") || exit.argument) return false;
    const atom = stripParenExpression(test.argument);
    let role: string | null = null;
    if (isNodeOfType(atom, "Identifier")) {
      if (scopes.symbolFor(atom) === helperParameterSymbol) {
        role = "node";
      } else {
        const contextCall = getNativeRefCleanupHookCall(atom, "useContext", ownerBody, scopes);
        if (!contextCall || contextCall.arguments.length !== REF_CLEANUP_CONTEXT_ARGUMENT_COUNT)
          return false;
        const [contextArgument] = contextCall.arguments;
        const contextIdentifier = contextArgument ? stripParenExpression(contextArgument) : null;
        const contextSymbol = isNodeOfType(contextIdentifier, "Identifier")
          ? scopes.symbolFor(contextIdentifier)
          : null;
        if (
          !contextSymbol ||
          !getValueImportSource(contextSymbol) ||
          !isNodeOfType(contextSymbol.declarationNode, "ImportSpecifier") ||
          !getImportedName(contextSymbol.declarationNode) ||
          contextSymbol.references.some((reference) => reference.flag !== "read")
        )
          return false;
        role = "context";
      }
    } else if (
      isNodeOfType(atom, "MemberExpression") &&
      !atom.computed &&
      !atom.optional &&
      isNodeOfType(atom.object, "Identifier") &&
      atom.object.name === "window" &&
      scopes.isGlobalReference(atom.object) &&
      isNodeOfType(atom.property, "Identifier") &&
      atom.property.name === "ResizeObserver"
    ) {
      role = "capability";
    }
    if (!role || guardRoles.has(role)) return false;
    guardRoles.add(role);
    acceptedReturns.add(exit);
  }
  if (
    helperStatements.some(
      (statement) =>
        !isNodeOfType(statement, "VariableDeclaration") &&
        !isNodeOfType(statement, "ExpressionStatement"),
    )
  )
    return false;
  if (collectFunctionReturnStatements(helper).some((statement) => !acceptedReturns.has(statement)))
    return false;
  let hasUnsupportedFrameInput = false;
  for (const frame of [helper, callback]) {
    walkAst(frame.body, (child) => {
      if (isTypeScriptTypePosition(child)) return false;
      if (
        isNodeOfType(child, "ThisExpression") ||
        isNodeOfType(child, "ClassDeclaration") ||
        isNodeOfType(child, "ClassExpression") ||
        (isNodeOfType(child, "Identifier") && child.name === "arguments")
      )
        hasUnsupportedFrameInput = true;
    });
  }
  return !hasUnsupportedFrameInput && !hasRefCleanupProviderHazard(scopes);
};
