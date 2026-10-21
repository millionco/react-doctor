import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { nodeDominatesNode } from "./node-dominates-node.js";
import type { RuleContext } from "./rule-context.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ClosedCancelledNativeSleepLoopInput {
  asyncFunction: EsTreeNode;
  effectCallback: EsTreeNode;
  cleanupFunctions: ReadonlyArray<EsTreeNode>;
  context: RuleContext;
  isStateDispatcherCall: (
    call: EsTreeNodeOfType<"CallExpression">,
    context: RuleContext,
  ) => boolean;
}

interface ClosedNativeSleep {
  symbol: SymbolDescriptor;
  declaration: EsTreeNodeOfType<"VariableDeclaration">;
  construction: EsTreeNodeOfType<"NewExpression">;
  timer: EsTreeNodeOfType<"CallExpression">;
  parameterBindings: ReadonlySet<EsTreeNode>;
}

const getSingletonDeclaration = (
  symbol: SymbolDescriptor,
  kind: "const" | "let",
  owner: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclaration"> | null => {
  const declarator = symbol.declarationNode;
  const declaration = declarator.parent;
  if (
    symbol.kind !== kind ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.id !== symbol.bindingIdentifier ||
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== kind ||
    declaration.declare ||
    declaration.parent !== owner
  ) {
    return null;
  }
  const [onlyDeclarator, ...remainingDeclarators] = declaration.declarations;
  return onlyDeclarator === declarator && !remainingDeclarators.length ? declaration : null;
};

const isPrimitiveLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") &&
  (node.value === null ||
    typeof node.value === "string" ||
    typeof node.value === "number" ||
    typeof node.value === "boolean" ||
    typeof node.value === "bigint");

const isBareReturn = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return node.argument === null;
  if (!isNodeOfType(node, "BlockStatement")) return false;
  const [statement, ...remainingStatements] = node.body;
  return Boolean(
    statement &&
    !remainingStatements.length &&
    isNodeOfType(statement, "ReturnStatement") &&
    statement.argument === null,
  );
};

const hasOnlyReferences = (
  symbol: SymbolDescriptor,
  allowedReads: ReadonlySet<EsTreeNode>,
  allowedWrites: ReadonlySet<EsTreeNode> = new Set(),
): boolean =>
  symbol.references.every((reference) =>
    reference.flag === "read"
      ? allowedReads.has(reference.identifier)
      : reference.flag === "write" && allowedWrites.has(reference.identifier),
  );

const isNativeSleepGlobalReference = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (context.scopes.isGlobalReference(identifier)) return true;
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    !hasRuntimeValueBinding(symbol),
  );
};

const getClosedNativeSleep = (
  callee: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): ClosedNativeSleep | null => {
  const program = findProgramRoot(callee);
  const symbol = context.scopes.symbolFor(callee);
  if (!program || !symbol) return null;
  const declaration = getSingletonDeclaration(symbol, "const", program);
  const helper = getDirectConstInitializer(symbol);
  if (
    !declaration ||
    !helper ||
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.generator
  ) {
    return null;
  }
  const [delay, ...otherParameters] = helper.params;
  const construction = helper.body;
  if (
    !delay ||
    !isNodeOfType(delay, "Identifier") ||
    otherParameters.length ||
    !isNodeOfType(construction, "NewExpression") ||
    !isNodeOfType(construction.callee, "Identifier") ||
    construction.callee.name !== "Promise" ||
    !isNativeSleepGlobalReference(construction.callee, context)
  ) {
    return null;
  }
  const [executor, ...otherConstructionArguments] = construction.arguments;
  if (
    !executor ||
    otherConstructionArguments.length ||
    !isNodeOfType(executor, "ArrowFunctionExpression") ||
    executor.async ||
    executor.generator
  ) {
    return null;
  }
  const [resolver, ...otherExecutorParameters] = executor.params;
  const timer = executor.body;
  if (
    !resolver ||
    !isNodeOfType(resolver, "Identifier") ||
    otherExecutorParameters.length ||
    !isNodeOfType(timer, "CallExpression") ||
    timer.optional ||
    !isNodeOfType(timer.callee, "Identifier") ||
    timer.callee.name !== "setTimeout" ||
    !isNativeSleepGlobalReference(timer.callee, context)
  ) {
    return null;
  }
  const [resolveArgument, delayArgument, ...otherTimerArguments] = timer.arguments;
  const delaySymbol = context.scopes.symbolFor(delay);
  const resolverSymbol = context.scopes.symbolFor(resolver);
  if (
    !resolveArgument ||
    !delayArgument ||
    otherTimerArguments.length ||
    !isNodeOfType(resolveArgument, "Identifier") ||
    !isNodeOfType(delayArgument, "Identifier") ||
    !delaySymbol ||
    !resolverSymbol ||
    context.scopes.symbolFor(resolveArgument) !== resolverSymbol ||
    context.scopes.symbolFor(delayArgument) !== delaySymbol ||
    !hasOnlyReferences(resolverSymbol, new Set([resolveArgument])) ||
    !hasOnlyReferences(delaySymbol, new Set([delayArgument]))
  ) {
    return null;
  }
  return {
    symbol,
    declaration,
    construction,
    timer,
    parameterBindings: new Set([delay, resolver]),
  };
};

const hasUnsupportedModule = (
  owner: EsTreeNode,
  nativeSleep: ClosedNativeSleep,
  bindings: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(owner);
  if (!program) return true;
  const settings = context.settings?.["react-doctor"];
  if (settings && typeof settings === "object") {
    if (
      ("preactVersion" in settings && settings.preactVersion) ||
      ("hasReactNativeWorkspace" in settings && settings.hasReactNativeWorkspace)
    ) {
      return true;
    }
    if ("capabilities" in settings && Array.isArray(settings.capabilities)) {
      if (
        settings.capabilities.includes("react-native") ||
        settings.capabilities.includes("expo") ||
        (settings.capabilities.includes("preact") && !settings.capabilities.includes("react"))
      ) {
        return true;
      }
    }
  }
  const bindingNames = new Set(
    [...bindings].flatMap((binding) => (isNodeOfType(binding, "Identifier") ? [binding.name] : [])),
  );
  const nativeReferences = new Map<EsTreeNode, string>([
    [nativeSleep.construction.callee, "Promise"],
    [nativeSleep.timer.callee, "setTimeout"],
  ]);
  return someAst(program, (node) => {
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "MetaProperty")
    ) {
      return true;
    }
    if (isNodeOfType(node, "ImportDeclaration") && node.importKind !== "type") {
      const source = node.source.value;
      if (typeof source !== "string") return true;
      if (
        /^(?:node:)?(?:module|process|vm|repl|inspector(?:\/promises)?)$/.test(source) ||
        /^(?:preact(?:\/|$)|react-native(?:\/|$)|expo(?:\/|$))/.test(source)
      ) {
        return true;
      }
      if (source === "react") {
        return node.specifiers.some((specifier) => {
          if (!isNodeOfType(specifier, "ImportSpecifier")) return true;
          if (specifier.importKind === "type") return false;
          const symbol = context.scopes.symbolFor(specifier.local);
          return (
            !symbol ||
            symbol.references.some((reference) => {
              const identifier = reference.identifier;
              return (
                reference.flag !== "read" ||
                !isNodeOfType(identifier.parent, "CallExpression") ||
                identifier.parent.callee !== identifier ||
                identifier.parent.optional
              );
            })
          );
        });
      }
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") return true;
      if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "eval") {
        const receiver = stripParenExpression(callee.object);
        if (
          isNodeOfType(receiver, "Identifier") &&
          (receiver.name === "globalThis" || receiver.name === "window")
        )
          return true;
      }
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (propertyName === "constructor" || (node.computed && propertyName === null)) return true;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      if (getStaticPropertyName(node) === "constructor") return true;
      if (node.computed && !isPrimitiveLiteral(node.property)) return true;
    }
    if (!isNodeOfType(node, "Identifier")) return false;
    const reference = context.scopes.referenceFor(node);
    if (reference) {
      if (
        /^(?:eval|Function|require|module|process|globalThis|window|self|Reflect|Object)$/.test(
          node.name,
        )
      ) {
        return true;
      }
      if ((node.name === "Promise" || node.name === "setTimeout") && !nativeReferences.has(node))
        return true;
    }
    if (!bindingNames.has(node.name) && node.name !== "Promise" && node.name !== "setTimeout") {
      return false;
    }
    const parent = node.parent;
    if (!parent) return true;
    const isBinding =
      (isNodeOfType(parent, "VariableDeclarator") && parent.id === node) ||
      (isNodeOfType(parent, "ImportSpecifier") && parent.local === node) ||
      (isNodeOfType(parent, "ImportDefaultSpecifier") && parent.local === node) ||
      (isNodeOfType(parent, "ImportNamespaceSpecifier") && parent.local === node) ||
      ((isNodeOfType(parent, "FunctionDeclaration") ||
        isNodeOfType(parent, "ClassDeclaration") ||
        isNodeOfType(parent, "TSEnumDeclaration") ||
        isNodeOfType(parent, "TSModuleDeclaration")) &&
        parent.id === node) ||
      ((isNodeOfType(parent, "ArrowFunctionExpression") ||
        isNodeOfType(parent, "FunctionExpression") ||
        isNodeOfType(parent, "FunctionDeclaration")) &&
        parent.params.some((parameter) => parameter === node));
    return Boolean(isBinding && !bindings.has(node));
  });
};

export const hasClosedCancelledNativeSleepLoop = ({
  asyncFunction,
  effectCallback,
  cleanupFunctions,
  context,
  isStateDispatcherCall,
}: ClosedCancelledNativeSleepLoopInput): boolean => {
  if (
    !isNodeOfType(asyncFunction, "ArrowFunctionExpression") ||
    !asyncFunction.async ||
    asyncFunction.generator ||
    asyncFunction.params.length ||
    !isNodeOfType(asyncFunction.body, "BlockStatement") ||
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
    effectCallback.async ||
    effectCallback.params.length ||
    !isNodeOfType(effectCallback.body, "BlockStatement")
  )
    return false;
  const [loop, ...otherStatements] = asyncFunction.body.body;
  if (
    !loop ||
    otherStatements.length ||
    !isNodeOfType(loop, "WhileStatement") ||
    !isNodeOfType(loop.body, "BlockStatement") ||
    !isNodeOfType(loop.test, "UnaryExpression") ||
    loop.test.operator !== "!" ||
    !isNodeOfType(loop.test.argument, "Identifier")
  )
    return false;
  const cancellationFlagSymbol = context.scopes.symbolFor(loop.test.argument);
  const asyncRunnerSymbol = context.scopes
    .scopeFor(asyncFunction)
    .symbols.find((symbol) => symbol.initializer === asyncFunction);
  if (!cancellationFlagSymbol || !asyncRunnerSymbol) return false;
  const asyncRunnerDeclaration = getSingletonDeclaration(
    asyncRunnerSymbol,
    "const",
    effectCallback.body,
  );
  const cancellationFlagDeclaration = getSingletonDeclaration(
    cancellationFlagSymbol,
    "let",
    effectCallback.body,
  );
  if (
    !asyncRunnerDeclaration ||
    !cancellationFlagDeclaration ||
    !isNodeOfType(cancellationFlagSymbol.initializer, "Literal") ||
    cancellationFlagSymbol.initializer.value !== false
  )
    return false;
  const [invocationReference, ...otherAsyncRunnerReferences] = asyncRunnerSymbol.references;
  const invocation = invocationReference?.identifier.parent;
  if (
    !invocationReference ||
    otherAsyncRunnerReferences.length ||
    invocationReference.flag !== "read" ||
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.callee !== invocationReference.identifier ||
    invocation.optional ||
    invocation.arguments.length ||
    !isNodeOfType(invocation.parent, "ExpressionStatement") ||
    invocation.parent.parent !== effectCallback.body
  )
    return false;
  const [invocationStatement, cleanupReturn, ...trailingStatements] =
    effectCallback.body.body.slice(
      effectCallback.body.body.findIndex((statement) => statement === invocation.parent),
    );
  if (
    invocationStatement !== invocation.parent ||
    !cleanupReturn ||
    trailingStatements.length ||
    !isNodeOfType(cleanupReturn, "ReturnStatement") ||
    !isNodeOfType(cleanupReturn.argument, "ArrowFunctionExpression")
  )
    return false;
  const cleanup = cleanupReturn.argument;
  const [onlyCleanup, ...otherCleanups] = cleanupFunctions;
  if (
    onlyCleanup !== cleanup ||
    otherCleanups.length ||
    cleanup.async ||
    cleanup.params.length ||
    !isNodeOfType(cleanup.body, "BlockStatement")
  )
    return false;
  const [cleanupStatement, ...otherCleanupStatements] = cleanup.body.body;
  if (
    !cleanupStatement ||
    otherCleanupStatements.length ||
    !isNodeOfType(cleanupStatement, "ExpressionStatement") ||
    !isNodeOfType(cleanupStatement.expression, "AssignmentExpression")
  )
    return false;
  const assignment = cleanupStatement.expression;
  if (
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "Identifier") ||
    context.scopes.symbolFor(assignment.left) !== cancellationFlagSymbol ||
    !isNodeOfType(assignment.right, "Literal") ||
    assignment.right.value !== true ||
    !nodeDominatesNode(cancellationFlagDeclaration, invocation, context) ||
    !nodeDominatesNode(asyncRunnerDeclaration, invocation, context)
  )
    return false;
  const cancellationFlagReads = new Set<EsTreeNode>([loop.test.argument]);
  const nativeSleepCalls = new Set<EsTreeNode>();
  const argumentReads = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  const dispatchReads = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  const declarations = new Set<EsTreeNode>([cancellationFlagDeclaration, asyncRunnerDeclaration]);
  const bindings = new Set<EsTreeNode>([
    cancellationFlagSymbol.bindingIdentifier,
    asyncRunnerSymbol.bindingIdentifier,
  ]);
  let nativeSleep: ClosedNativeSleep | null = null;
  let hasFreshCancellationGuard = true;
  for (const statement of loop.body.body) {
    if (
      isNodeOfType(statement, "IfStatement") &&
      !statement.alternate &&
      isNodeOfType(statement.test, "Identifier") &&
      context.scopes.symbolFor(statement.test) === cancellationFlagSymbol &&
      isBareReturn(statement.consequent)
    ) {
      cancellationFlagReads.add(statement.test);
      hasFreshCancellationGuard = true;
      continue;
    }
    if (!isNodeOfType(statement, "ExpressionStatement")) return false;
    const expression = statement.expression;
    if (isNodeOfType(expression, "AwaitExpression")) {
      const call = expression.argument;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        !isNodeOfType(call.callee, "Identifier")
      )
        return false;
      const candidateNativeSleep = getClosedNativeSleep(call.callee, context);
      if (
        !candidateNativeSleep ||
        (nativeSleep && candidateNativeSleep.symbol !== nativeSleep.symbol)
      )
        return false;
      nativeSleep = candidateNativeSleep;
      nativeSleepCalls.add(call.callee);
      const [argument, ...otherArguments] = call.arguments;
      if (!argument || otherArguments.length) return false;
      if (!isPrimitiveLiteral(argument)) {
        if (!isNodeOfType(argument, "Identifier")) return false;
        const symbol = context.scopes.symbolFor(argument);
        if (!symbol) return false;
        const declaration = getSingletonDeclaration(symbol, "const", effectCallback.body);
        const initializer = getDirectConstInitializer(symbol);
        if (
          !declaration ||
          !initializer ||
          !isPrimitiveLiteral(initializer) ||
          !nodeDominatesNode(declaration, invocation, context)
        )
          return false;
        declarations.add(declaration);
        bindings.add(symbol.bindingIdentifier);
        const reads = argumentReads.get(symbol) ?? new Set<EsTreeNode>();
        reads.add(argument);
        argumentReads.set(symbol, reads);
      }
      hasFreshCancellationGuard = false;
      continue;
    }
    if (
      !hasFreshCancellationGuard ||
      !isNodeOfType(expression, "CallExpression") ||
      expression.optional ||
      !isNodeOfType(expression.callee, "Identifier") ||
      !expression.arguments.length ||
      !expression.arguments.every(isPrimitiveLiteral) ||
      !isStateDispatcherCall(expression, context)
    )
      return false;
    const symbol = context.scopes.symbolFor(expression.callee);
    if (
      !symbol ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      !isNodeOfType(symbol.declarationNode.id, "ArrayPattern")
    )
      return false;
    const reads = dispatchReads.get(symbol) ?? new Set<EsTreeNode>();
    reads.add(expression.callee);
    dispatchReads.set(symbol, reads);
  }
  if (
    !nativeSleep ||
    !dispatchReads.size ||
    !hasOnlyReferences(asyncRunnerSymbol, new Set([invocationReference.identifier])) ||
    !hasOnlyReferences(cancellationFlagSymbol, cancellationFlagReads, new Set([assignment.left])) ||
    !hasOnlyReferences(nativeSleep.symbol, nativeSleepCalls)
  )
    return false;
  for (const [symbol, reads] of [...argumentReads, ...dispatchReads]) {
    if (!hasOnlyReferences(symbol, reads)) return false;
  }
  let sawDeclaration = false;
  for (const statement of effectCallback.body.body) {
    if (statement === invocation.parent) break;
    if (declarations.has(statement)) {
      sawDeclaration = true;
      continue;
    }
    if (
      sawDeclaration ||
      !isNodeOfType(statement, "IfStatement") ||
      statement.alternate ||
      !isBareReturn(statement.consequent)
    )
      return false;
    const test = statement.test;
    if (
      !isNodeOfType(test, "Identifier") &&
      !(
        isNodeOfType(test, "UnaryExpression") &&
        test.operator === "!" &&
        isNodeOfType(test.argument, "Identifier")
      )
    )
      return false;
  }
  const program = findProgramRoot(effectCallback);
  if (!program) return false;
  let moduleOwner: EsTreeNode = effectCallback;
  while (moduleOwner.parent && moduleOwner.parent !== program) moduleOwner = moduleOwner.parent;
  if (
    moduleOwner.parent !== program ||
    program.body.findIndex((statement) => statement === nativeSleep.declaration) >=
      program.body.findIndex((statement) => statement === moduleOwner)
  )
    return false;
  bindings.add(nativeSleep.symbol.bindingIdentifier);
  for (const binding of nativeSleep.parameterBindings) bindings.add(binding);
  return !hasUnsupportedModule(effectCallback, nativeSleep, bindings, context);
};
