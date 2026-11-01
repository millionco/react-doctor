import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import {
  OWNED_ABORT_UNSUPPORTED_CAPABILITY_NAMES,
  OWNED_ABORT_UNSUPPORTED_CONTINUATION_TYPES,
  OWNED_ABORT_UNSUPPORTED_MEMBER_NAMES,
  OWNED_ABORT_UNSUPPORTED_RUNTIME_TYPES,
} from "./constants.js";

interface UnguardedOwnedAbortContinuationInput {
  asyncFunction: EsTreeNode;
  effectCallback: EsTreeNode;
  cleanupFunctions: ReadonlyArray<EsTreeNode>;
  context: RuleContext;
  isStateDispatcherCall: (
    call: EsTreeNodeOfType<"CallExpression">,
    context: RuleContext,
  ) => boolean;
}

interface OwnedAbortProgramFacts {
  supported: boolean;
  functions: ReadonlyArray<EsTreeNode>;
}

const programCapabilitiesByScopes = new WeakMap<
  RuleContext["scopes"],
  WeakMap<EsTreeNode, OwnedAbortProgramFacts>
>();

const getDirectMember = (
  node: EsTreeNode,
  name: string,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const member = stripParenExpression(node);
  return isNodeOfType(member, "MemberExpression") &&
    !member.computed &&
    !member.optional &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === name
    ? member
    : null;
};

const hasSupportedNativeCapabilities = (program: EsTreeNode, context: RuleContext): boolean => {
  let byProgram = programCapabilitiesByScopes.get(context.scopes);
  if (!byProgram) {
    byProgram = new WeakMap();
    programCapabilitiesByScopes.set(context.scopes, byProgram);
  }
  const cached = byProgram.get(program);
  if (cached !== undefined) return cached.supported;
  let supported = true;
  const functions: EsTreeNode[] = [];
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      OWNED_ABORT_UNSUPPORTED_RUNTIME_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isFunctionLike(node)) functions.push(node);
    if (
      (isNodeOfType(node, "Property") ||
        isNodeOfType(node, "MethodDefinition") ||
        isNodeOfType(node, "PropertyDefinition")) &&
      (node.computed ||
        OWNED_ABORT_UNSUPPORTED_MEMBER_NAMES.has(getStaticPropertyKeyName(node) ?? ""))
    ) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      typeof node.source.value === "string" &&
      /^(?:node:)?(?:module|process|vm|repl|inspector(?:\/promises)?)$/.test(node.source.value)
    ) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      (node.computed ||
        (isNodeOfType(node.property, "Identifier") &&
          OWNED_ABORT_UNSUPPORTED_MEMBER_NAMES.has(node.property.name)))
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (OWNED_ABORT_UNSUPPORTED_CAPABILITY_NAMES.has(node.name)) supported = false;
    if (node.name !== "AbortController") return;
    const construction = node.parent;
    if (
      !context.scopes.isGlobalReference(node) ||
      !isNodeOfType(construction, "NewExpression") ||
      construction.callee !== node ||
      construction.arguments.length
    ) {
      supported = false;
    }
  });
  byProgram.set(program, { supported, functions });
  return supported;
};

const getStatementAwait = (statement: EsTreeNode): EsTreeNodeOfType<"AwaitExpression"> | null => {
  if (isNodeOfType(statement, "ExpressionStatement")) {
    const expression = stripParenExpression(statement.expression);
    return isNodeOfType(expression, "AwaitExpression") ? expression : null;
  }
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
  const [declarator, ...remaining] = statement.declarations;
  if (!declarator || remaining.length || !declarator.init) return null;
  const initializer = stripParenExpression(declarator.init);
  return isNodeOfType(declarator.id, "Identifier") && isNodeOfType(initializer, "AwaitExpression")
    ? initializer
    : null;
};

const isPlainValueRead = (
  node: EsTreeNode,
  awaited: EsTreeNodeOfType<"AwaitExpression">,
  context: RuleContext,
): boolean => {
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Literal")) {
    return (
      value.value === null ||
      typeof value.value === "boolean" ||
      typeof value.value === "number" ||
      typeof value.value === "string" ||
      typeof value.value === "bigint"
    );
  }
  if (!isNodeOfType(value, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(value);
  const declarator = symbol?.declarationNode;
  return Boolean(
    symbol &&
    symbol.kind === "const" &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.id === symbol.bindingIdentifier &&
    declarator.init &&
    stripParenExpression(declarator.init) === awaited &&
    nodeDominatesNode(awaited, value, context),
  );
};

const getRuntimeReactApiName = (
  call: EsTreeNode,
  program: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(callee);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  const apiName = symbol ? getImportedName(symbol.declarationNode) : undefined;
  return symbol &&
    declaration?.source.value === "react" &&
    apiName &&
    hasCompleteSymbolReferences(symbol, program, context.scopes) &&
    hasRefNotificationReactCall(call, apiName, context)
    ? apiName
    : null;
};

const hasRuntimeReactStateProducer = (
  setter: EsTreeNodeOfType<"CallExpression">,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(setter.callee);
  const declarator = symbol?.declarationNode;
  if (
    !symbol ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !declarator.init ||
    symbol.kind !== "const" ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !hasCompleteSymbolReferences(symbol, program, context.scopes) ||
    !symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    )
  )
    return false;
  const [, dispatcher] = declarator.id.elements;
  if (dispatcher !== symbol.bindingIdentifier) return false;
  const apiName = getRuntimeReactApiName(stripParenExpression(declarator.init), program, context);
  return apiName === "useState" || apiName === "useReducer";
};

const hasOnlyProtocolFunctions = (
  input: UnguardedOwnedAbortContinuationInput,
  program: EsTreeNode,
): boolean => {
  const functions = programCapabilitiesByScopes.get(input.context.scopes)?.get(program)?.functions;
  return Boolean(
    functions &&
    functions.every(
      (candidate) =>
        candidate === input.asyncFunction ||
        isAstDescendant(input.asyncFunction, candidate) ||
        input.cleanupFunctions.some((cleanup) => cleanup === candidate),
    ),
  );
};

const hasOnlyDirectEffectInvocations = (
  asyncFunction: EsTreeNode,
  construction: EsTreeNode,
  effectCallback: EsTreeNode,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declarator = asyncFunction.parent;
  const declaration = declarator?.parent;
  if (
    !isFunctionLike(effectCallback) ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    declarator.init !== asyncFunction ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.parent !== effectCallback.body
  )
    return false;
  const symbol = context.scopes.symbolFor(declarator.id);
  return Boolean(
    symbol &&
    hasCompleteSymbolReferences(symbol, program, context.scopes) &&
    symbol.references.length &&
    symbol.references.every((reference) => {
      const call = reference.identifier.parent;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.callee !== reference.identifier ||
        call.arguments.length ||
        !nodeDominatesNode(construction, call, context)
      )
        return false;
      const owner =
        isNodeOfType(call.parent, "UnaryExpression") && call.parent.operator === "void"
          ? call.parent
          : call;
      return (
        isNodeOfType(owner.parent, "ExpressionStatement") &&
        owner.parent.parent === effectCallback.body
      );
    }),
  );
};

const getLeadingCleanupAbort = (
  cleanup: EsTreeNode,
  controller: SymbolDescriptor,
  context: RuleContext,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isFunctionLike(cleanup) || cleanup.async || cleanup.generator || cleanup.params.length)
    return null;
  const body = cleanup.body;
  if (!body) return null;
  let expression = stripParenExpression(body);
  if (isNodeOfType(body, "BlockStatement")) {
    const [firstStatement] = body.body;
    if (!isNodeOfType(firstStatement, "ExpressionStatement")) return null;
    expression = stripParenExpression(firstStatement.expression);
  }
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length
  )
    return null;
  const member = getDirectMember(expression.callee, "abort");
  const receiver = member ? stripParenExpression(member.object) : null;
  return isNodeOfType(receiver, "Identifier") && context.scopes.symbolFor(receiver) === controller
    ? receiver
    : null;
};

const hasOwnedNativeController = (
  signalReceiver: EsTreeNodeOfType<"Identifier">,
  awaited: EsTreeNodeOfType<"AwaitExpression">,
  input: UnguardedOwnedAbortContinuationInput,
  program: EsTreeNode,
): boolean => {
  const { asyncFunction, effectCallback, cleanupFunctions, context } = input;
  const controller = context.scopes.symbolFor(signalReceiver);
  const declarator = controller?.declarationNode;
  const declaration = declarator?.parent;
  const construction =
    isNodeOfType(declarator, "VariableDeclarator") && declarator.init
      ? stripParenExpression(declarator.init)
      : null;
  if (
    !isFunctionLike(effectCallback) ||
    !controller ||
    controller.kind !== "const" ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.id !== controller.bindingIdentifier ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.parent !== effectCallback.body ||
    !isNodeOfType(construction, "NewExpression") ||
    !isNodeOfType(construction.callee, "Identifier") ||
    construction.callee.name !== "AbortController" ||
    construction.arguments.length ||
    !context.scopes.isGlobalReference(construction.callee) ||
    !cleanupFunctions.length ||
    !hasCompleteSymbolReferences(controller, program, context.scopes) ||
    !hasOnlyDirectEffectInvocations(asyncFunction, construction, effectCallback, program, context)
  )
    return false;
  const cleanupReads = new Set<EsTreeNode>();
  for (const cleanup of cleanupFunctions) {
    const receiver = getLeadingCleanupAbort(cleanup, controller, context);
    if (!receiver) return false;
    cleanupReads.add(receiver);
  }
  return controller.references.every((reference) => {
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return false;
    if (cleanupReads.has(reference.identifier)) return true;
    const member = reference.identifier.parent;
    return Boolean(
      member &&
      getDirectMember(member, "signal") === member &&
      member.object === reference.identifier &&
      isAstDescendant(member, awaited.argument),
    );
  });
};

export const hasUnguardedOwnedAbortContinuation = (
  input: UnguardedOwnedAbortContinuationInput,
): boolean => {
  const { asyncFunction, effectCallback, context, isStateDispatcherCall } = input;
  if (
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length ||
    !isNodeOfType(asyncFunction, "ArrowFunctionExpression") ||
    !asyncFunction.async ||
    asyncFunction.generator ||
    asyncFunction.params.length ||
    !isNodeOfType(asyncFunction.body, "BlockStatement")
  )
    return false;
  let hasPossibleGuard = false;
  walkOwnFunctionScope(asyncFunction, (node) => {
    if (OWNED_ABORT_UNSUPPORTED_CONTINUATION_TYPES.has(node.type)) hasPossibleGuard = true;
  });
  if (hasPossibleGuard) return false;
  const program = findProgramRoot(asyncFunction);
  if (
    !program ||
    !hasSupportedNativeCapabilities(program, context) ||
    !hasOnlyProtocolFunctions(input, program)
  )
    return false;
  const effectCall = effectCallback.parent;
  const effectApiName = effectCall ? getRuntimeReactApiName(effectCall, program, context) : null;
  if (!effectApiName || !EFFECT_HOOK_NAMES.has(effectApiName)) return false;
  let previousStatement: EsTreeNode | null = null;
  for (const statement of asyncFunction.body.body) {
    const awaited = previousStatement ? getStatementAwait(previousStatement) : null;
    previousStatement = statement;
    if (!awaited || !isNodeOfType(statement, "ExpressionStatement")) continue;
    const setter = stripParenExpression(statement.expression);
    if (
      !isNodeOfType(setter, "CallExpression") ||
      setter.optional ||
      !isNodeOfType(setter.callee, "Identifier") ||
      !isStateDispatcherCall(setter, context) ||
      !hasRuntimeReactStateProducer(setter, program, context)
    )
      continue;
    const [value, ...otherArguments] = setter.arguments;
    if (!value || otherArguments.length || !isPlainValueRead(value, awaited, context)) continue;
    let hasOwnedSignal = false;
    walkAst(awaited.argument, (node) => {
      if (isFunctionLike(node)) return false;
      const member = getDirectMember(node, "signal");
      if (!member || !isNodeOfType(member.object, "Identifier")) return;
      if (hasOwnedNativeController(member.object, awaited, input, program)) {
        hasOwnedSignal = true;
        return false;
      }
    });
    if (hasOwnedSignal) return true;
  }
  return false;
};
