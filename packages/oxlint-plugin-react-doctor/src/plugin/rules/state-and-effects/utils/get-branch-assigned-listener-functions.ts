import { hasOnlyErasedTypeNameBindings } from "../../../utils/has-only-erased-type-name-bindings.js";
import { hasVisibleAmbientFunctionDeclaration } from "../../../utils/has-visible-ambient-function-declaration.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { isPropertyNamePosition } from "../../../utils/is-property-name-position.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { collectReturnedCleanupFunctions } from "../../../utils/collect-returned-cleanup-functions.js";
import { collectSynchronouslyInvokedLocalFunctions } from "../../../utils/collect-effect-invoked-functions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { nodesCanCoExecute } from "../../../utils/nodes-can-co-execute.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import { isProvenBrowserApiReceiver } from "../../../utils/is-proven-browser-api-receiver.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface BranchListenerAssignment {
  readonly assignment: EsTreeNodeOfType<"AssignmentExpression">;
  readonly callback: EsTreeNode;
}

interface BranchListenerPredicate {
  readonly consequent: boolean;
  readonly alternate: boolean;
}

const nativeConstructorNames = new Set([
  "Audio",
  "DocumentFragment",
  "EventTarget",
  "Image",
  "Option",
]);
const ordinaryObjectPropertyNames = new Set([
  "create",
  "entries",
  "freeze",
  "fromEntries",
  "hasOwn",
  "is",
  "isExtensible",
  "isFrozen",
  "isSealed",
  "keys",
  "length",
  "name",
  "preventExtensions",
  "seal",
  "values",
]);
const reflectiveProviderCapabilityNames = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "set",
  "deleteProperty",
  "get",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "construct",
  "apply",
]);

const dynamicScopeByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const isProviderWriteTarget = (node: EsTreeNode): boolean => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "Identifier"))
    return (
      nativeConstructorNames.has(target.name) ||
      target.name === "window" ||
      target.name === "document" ||
      target.name === "self" ||
      target.name === "globalThis"
    );
  if (!isNodeOfType(target, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(target);
  return (
    (target.computed && propertyName === null) ||
    nativeConstructorNames.has(propertyName ?? "") ||
    propertyName === "window" ||
    propertyName === "document" ||
    propertyName === "self" ||
    propertyName === "globalThis" ||
    propertyName === "addEventListener" ||
    propertyName === "removeEventListener"
  );
};

const hasDynamicScope = (program: EsTreeNode, context: RuleContext): boolean => {
  const cached = dynamicScopeByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  const objectProviderScopes: ScopeAnalysis = {
    ...context.scopes,
    isGlobalReference: (identifier) => {
      if (
        !isNodeOfType(identifier, "Identifier") ||
        (identifier.name !== "Object" &&
          identifier.name !== "window" &&
          identifier.name !== "self" &&
          identifier.name !== "global" &&
          identifier.name !== "globalThis")
      )
        return context.scopes.isGlobalReference(identifier);
      if (
        hasVisibleAmbientFunctionDeclaration(context.scopes.scopeFor(identifier), identifier.name)
      )
        return false;
      if (context.scopes.isGlobalReference(identifier)) return true;
      const symbol = context.scopes.symbolFor(identifier);
      return Boolean(symbol && hasOnlyErasedTypeNameBindings(symbol));
    },
  };
  let result = false;
  walkAst(program, (node) => {
    if (result) return false;
    if (
      node.type === "TSParameterProperty" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment"
    ) {
      result = true;
      return false;
    }
    if (
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      (node.type === "ImportDeclaration" && node.importKind === "type") ||
      (node.type === "ImportSpecifier" && node.importKind === "type") ||
      (node.type === "ExportNamedDeclaration" && node.exportKind === "type") ||
      (node.type === "ExportSpecifier" && node.exportKind === "type") ||
      isTypeScriptTypePosition(node)
    )
      return false;
    const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
    const destructuredProviderName =
      node.type === "Property" && node.parent?.type === "ObjectPattern"
        ? getStaticPropertyKeyName(node, { allowComputedString: true })
        : null;
    const parent = node.parent;
    const expressionRoot = findTransparentExpressionRoot(node);
    const expressionParent = expressionRoot.parent;
    const objectReadProperty =
      isNodeOfType(expressionParent, "MemberExpression") &&
      expressionParent.object === expressionRoot
        ? getStaticPropertyName(expressionParent)
        : null;
    const isOrdinaryObjectRead =
      ((isNodeOfType(node, "Identifier") && node.name === "Object") ||
        (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "Object")) &&
      !isWithinAssignmentTarget(node) &&
      isProvenGlobalNamespaceReference(node, "Object", objectProviderScopes) &&
      ((objectReadProperty !== null && ordinaryObjectPropertyNames.has(objectReadProperty)) ||
        (isNodeOfType(expressionParent, "UnaryExpression") &&
          expressionParent.operator === "typeof"));
    const isRuntimeCapabilityIdentifier =
      isNodeOfType(node, "Identifier") &&
      (node.name === "Function" ||
        node.name === "eval" ||
        node.name === "Reflect" ||
        (node.name === "Object" && !isOrdinaryObjectRead)) &&
      context.scopes.symbolFor(node)?.bindingIdentifier !== node &&
      !(parent?.type === "AssignmentPattern" && parent.left === node) &&
      parent?.type !== "RestElement" &&
      parent?.type !== "ArrayPattern" &&
      !(
        parent?.type === "Property" &&
        parent.parent?.type === "ObjectPattern" &&
        parent.value === node
      ) &&
      !(parent?.type === "VariableDeclarator" && parent.id === node) &&
      !(parent?.type === "CatchClause" && parent.param === node) &&
      !(
        parent &&
        isFunctionLike(parent) &&
        parent.params.some((parameter) => parameter === node)
      ) &&
      parent?.type !== "ImportSpecifier" &&
      parent?.type !== "ImportDefaultSpecifier" &&
      parent?.type !== "ImportNamespaceSpecifier" &&
      !(parent?.type === "ExportSpecifier" && parent.exported === node && parent.local !== node) &&
      !(parent?.type === "LabeledStatement" && parent.label === node) &&
      !(
        (parent?.type === "BreakStatement" || parent?.type === "ContinueStatement") &&
        parent.label === node
      ) &&
      !(
        (parent?.type === "MethodDefinition" ||
          parent?.type === "PropertyDefinition" ||
          parent?.type === "AccessorProperty") &&
        parent.key === node &&
        !parent.computed
      ) &&
      (!isPropertyNamePosition(node) ||
        (parent?.type === "Property" &&
          parent.parent?.type === "ObjectExpression" &&
          parent.value === node));
    result =
      node.type === "WithStatement" ||
      isRuntimeCapabilityIdentifier ||
      (isNodeOfType(node, "MemberExpression") &&
        (getStaticPropertyName(node) === "Reflect" ||
          (getStaticPropertyName(node) === "Object" && !isOrdinaryObjectRead))) ||
      (isNodeOfType(node, "MemberExpression") &&
        (getStaticPropertyName(node) === "Function" ||
          getStaticPropertyName(node) === "eval" ||
          getStaticPropertyName(node) === "constructor")) ||
      (node.type === "TSDeclareFunction" &&
        node.id &&
        (nativeConstructorNames.has(node.id.name) ||
          node.id.name === "window" ||
          node.id.name === "document" ||
          node.id.name === "self" ||
          node.id.name === "globalThis")) ||
      (node.type === "Property" &&
        node.parent?.type === "ObjectPattern" &&
        ((node.computed && destructuredProviderName === null) ||
          reflectiveProviderCapabilityNames.has(destructuredProviderName ?? "") ||
          destructuredProviderName === "constructor" ||
          destructuredProviderName === "Function" ||
          destructuredProviderName === "eval")) ||
      (isNodeOfType(callee, "Identifier") && callee.name === "eval") ||
      (isNodeOfType(node, "AssignmentExpression") && isProviderWriteTarget(node.left)) ||
      (isNodeOfType(node, "UpdateExpression") && isProviderWriteTarget(node.argument)) ||
      (isNodeOfType(node, "UnaryExpression") &&
        node.operator === "delete" &&
        isProviderWriteTarget(node.argument));
    return result ? false : undefined;
  });
  dynamicScopeByAnalysis.set(context.scopes, result);
  return result;
};

const getBranchAssignment = (
  branch: EsTreeNode,
  symbol: SymbolDescriptor,
  context: RuleContext,
): BranchListenerAssignment | null => {
  if (!isNodeOfType(branch, "BlockStatement")) return null;
  const [statement, ...remainingStatements] = branch.body;
  if (remainingStatements.length || !isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = stripParenExpression(statement.expression);
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=") return null;
  const target = stripParenExpression(assignment.left);
  if (!isNodeOfType(target, "Identifier") || context.scopes.symbolFor(target)?.id !== symbol.id)
    return null;
  const callback = stripParenExpression(assignment.right);
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator
  )
    return null;
  return { assignment, callback };
};

const isDirectParameter = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "parameter") return false;
  let current: EsTreeNode | null | undefined = symbol.bindingIdentifier;
  while (current && current !== symbol.scope.node) {
    if (isNodeOfType(current, "AssignmentPattern")) return false;
    current = current.parent;
  }
  if (current !== symbol.scope.node) return false;
  const declaration = symbol.declarationNode;
  if (isNodeOfType(declaration, "Identifier")) return declaration === symbol.bindingIdentifier;
  if (!isNodeOfType(declaration, "ObjectPattern")) return false;
  return declaration.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      property.value === symbol.bindingIdentifier &&
      isNodeOfType(property.value, "Identifier"),
  );
};

const isEventOnlyFunction = (
  functionNode: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const isEventReference = (node: EsTreeNode): boolean => {
    const container = node.parent;
    if (
      !isNodeOfType(container, "JSXExpressionContainer") ||
      container.expression !== node ||
      !isEventHandlerAttribute(container.parent)
    )
      return false;
    const openingElement = container.parent.parent;
    let element = openingElement?.parent;
    if (!isNodeOfType(openingElement, "JSXOpeningElement") || !isNodeOfType(element, "JSXElement"))
      return false;
    while (
      isNodeOfType(element.parent, "JSXElement") ||
      isNodeOfType(element.parent, "JSXFragment")
    )
      element = element.parent;
    const returnStatement = element.parent;
    return (
      isNodeOfType(returnStatement, "ReturnStatement") &&
      returnStatement.argument === element &&
      context.cfg.enclosingFunction(returnStatement) === component
    );
  };
  if (isEventReference(functionNode)) return true;
  const declarator = functionNode.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== functionNode ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(declarator.id);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.references.length &&
    symbol.references.every(
      (reference) => reference.flag === "read" && isEventReference(reference.identifier),
    ),
  );
};

const isNativeTargetValue = (value: EsTreeNode, context: RuleContext): boolean => {
  let initializer = stripParenExpression(value);
  if (isNodeOfType(initializer, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(initializer, context.scopes);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      symbol.references.some(
        (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
      )
    )
      return false;
    initializer = stripParenExpression(symbol.initializer);
  }
  if (!isNodeOfType(initializer, "NewExpression")) return false;
  const callee = stripParenExpression(initializer.callee);
  return (
    isProvenBrowserApiReceiver(initializer, "dom-event-target", context.scopes) ||
    (isNodeOfType(callee, "Identifier") &&
      callee.name === "Audio" &&
      context.scopes.isGlobalReference(callee))
  );
};

const hasNativeReceiverValue = (receiver: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (
    (receiver.name === "window" ||
      receiver.name === "document" ||
      receiver.name === "self" ||
      receiver.name === "globalThis") &&
    context.scopes.isGlobalReference(receiver)
  )
    return true;
  const symbol = resolveConstIdentifierAlias(receiver, context.scopes, true);
  if (!symbol) return false;
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return false;
  if (isNativeTargetValue(receiver, context)) return true;
  const declarator = symbol.declarationNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression")
  )
    return false;
  const [state, setter] = declarator.id.elements;
  const [seedArgument, ...additionalArguments] = declarator.init.arguments;
  const seed = seedArgument ? stripParenExpression(seedArgument) : null;
  if (
    state !== symbol.bindingIdentifier ||
    !isNodeOfType(setter, "Identifier") ||
    !seed ||
    isNodeOfType(seed, "SpreadElement") ||
    additionalArguments.length
  )
    return false;
  const pair = resolveReactUseStatePair(setter, context.scopes);
  const component = context.cfg.enclosingFunction(declarator);
  if (!pair || pair.stateSymbol?.id !== symbol.id || !component) return false;
  const renderFunctions = collectSynchronouslyInvokedLocalFunctions(component, context.scopes);
  let hasNativeValue = isNativeTargetValue(seed, context);
  if (!hasNativeValue && !(isNodeOfType(seed, "Literal") && seed.value === null)) return false;
  for (const reference of pair.setterSymbol.references) {
    const call = findTransparentExpressionRoot(reference.identifier).parent;
    const owner = context.cfg.enclosingFunction(reference.identifier);
    if (
      !isNodeOfType(call, "CallExpression") ||
      stripParenExpression(call.callee) !== reference.identifier ||
      !owner ||
      renderFunctions.has(owner)
    )
      return false;
    const [valueArgument, ...additionalValues] = call.arguments;
    const value = valueArgument ? stripParenExpression(valueArgument) : null;
    if (!value || isNodeOfType(value, "SpreadElement") || additionalValues.length) return false;
    if (isNativeTargetValue(value, context)) hasNativeValue = true;
    else if (!isNodeOfType(value, "Literal") || value.value !== null) return false;
  }
  return hasNativeValue;
};

const getPredicateBranches = (
  predicate: EsTreeNode,
  context: RuleContext,
): BranchListenerPredicate | null => {
  const reference = stripParenExpression(predicate);
  if (!isNodeOfType(reference, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(reference);
  if (
    !symbol ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return null;
  if (isDirectParameter(symbol)) return { consequent: true, alternate: true };
  const declarator = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression")
  )
    return null;
  const [state, setter] = declarator.id.elements;
  const [seedArgument, ...additionalArguments] = declarator.init.arguments;
  const seed = seedArgument ? stripParenExpression(seedArgument) : null;
  if (
    state !== symbol.bindingIdentifier ||
    !isNodeOfType(setter, "Identifier") ||
    additionalArguments.length ||
    !isNodeOfType(seed, "Literal") ||
    typeof seed.value !== "boolean"
  )
    return null;
  const pair = resolveReactUseStatePair(setter, context.scopes);
  const component = context.cfg.enclosingFunction(declarator);
  if (!pair || pair.stateSymbol?.id !== symbol.id || !component) return null;
  const renderFunctions = collectSynchronouslyInvokedLocalFunctions(component, context.scopes);
  if (
    pair.setterSymbol.references.some((reference) => {
      const call = findTransparentExpressionRoot(reference.identifier).parent;
      const owner = context.cfg.enclosingFunction(reference.identifier);
      return (
        !isNodeOfType(call, "CallExpression") ||
        stripParenExpression(call.callee) !== reference.identifier ||
        !owner ||
        renderFunctions.has(owner) ||
        !isEventOnlyFunction(owner, component, context)
      );
    })
  )
    return null;
  return { consequent: seed.value, alternate: !seed.value };
};

const isMatchingCleanupReference = (
  identifier: EsTreeNode,
  registration: EsTreeNodeOfType<"CallExpression">,
  cleanupFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const call = findTransparentExpressionRoot(identifier).parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  const registrationCallee = stripParenExpression(registration.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "removeEventListener" ||
    !isNodeOfType(stripParenExpression(callee.object), "Identifier") ||
    !isNodeOfType(registrationCallee, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(registrationCallee.object), "Identifier")
  )
    return false;
  const [eventArgument, callback, ...otherArguments] = call.arguments;
  const [registeredEventArgument] = registration.arguments;
  const event = eventArgument ? stripParenExpression(eventArgument) : null;
  const registeredEvent = registeredEventArgument
    ? stripParenExpression(registeredEventArgument)
    : null;
  const owner = context.cfg.enclosingFunction(call);
  return Boolean(
    !otherArguments.length &&
    callback &&
    stripParenExpression(callback) === identifier &&
    isNodeOfType(event, "Literal") &&
    isNodeOfType(registeredEvent, "Literal") &&
    event.value === registeredEvent.value &&
    owner &&
    cleanupFunctions.has(owner) &&
    resolveExpressionKey(callee.object, context) !== null &&
    resolveExpressionKey(callee.object, context) ===
      resolveExpressionKey(registrationCallee.object, context),
  );
};

export const getBranchAssignedListenerFunctions = (
  registration: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode[] => {
  const [eventArgument, listenerArgument, ...otherArguments] = registration.arguments;
  const event = eventArgument ? stripParenExpression(eventArgument) : null;
  const listener = listenerArgument ? stripParenExpression(listenerArgument) : null;
  const callee = stripParenExpression(registration.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : null;
  if (
    registration.optional ||
    otherArguments.length ||
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(listener, "Identifier") ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "addEventListener" ||
    !isNodeOfType(receiver, "Identifier")
  )
    return [];
  const nativeProviderContext: RuleContext = {
    ...context,
    get cfg() {
      return context.cfg;
    },
    scopes: {
      ...context.scopes,
      isGlobalReference: (identifier) => {
        const providerName = identifier.type === "Identifier" ? identifier.name : null;
        const isNativeProviderName =
          providerName !== null &&
          (nativeConstructorNames.has(providerName) ||
            providerName === "window" ||
            providerName === "document" ||
            providerName === "self" ||
            providerName === "globalThis");
        if (!isNativeProviderName) return context.scopes.isGlobalReference(identifier);
        if (hasVisibleAmbientFunctionDeclaration(context.scopes.scopeFor(identifier), providerName))
          return false;
        if (context.scopes.isGlobalReference(identifier)) return true;
        const symbol = context.scopes.symbolFor(identifier);
        return Boolean(symbol && hasOnlyErasedTypeNameBindings(symbol));
      },
    },
  };
  if (!hasNativeReceiverValue(receiver, nativeProviderContext)) return [];
  const program = findProgramRoot(registration);
  if (!program || hasDynamicScope(program, context)) return [];
  const effect = context.cfg.enclosingFunction(registration);
  const effectCall = effect ? findTransparentExpressionRoot(effect).parent : null;
  if (
    !effect ||
    !isFunctionLike(effect) ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !effectCall.arguments[0] ||
    stripParenExpression(effectCall.arguments[0]) !== effect ||
    !isReactApiCall(effectCall, "useEffect", context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  )
    return [];
  let ancestor: EsTreeNode | null | undefined = registration.parent;
  while (ancestor && ancestor !== effect) {
    if (
      ancestor.type === "ForStatement" ||
      ancestor.type === "ForInStatement" ||
      ancestor.type === "ForOfStatement" ||
      ancestor.type === "WhileStatement" ||
      ancestor.type === "DoWhileStatement" ||
      ancestor.type === "SwitchStatement"
    )
      return [];
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      !isNodeOfType(stripParenExpression(ancestor.test), "Identifier")
    )
      return [];
    ancestor = ancestor.parent;
  }
  const statement = findTransparentExpressionRoot(registration).parent;
  const block = statement?.parent;
  if (!isNodeOfType(statement, "ExpressionStatement") || !isNodeOfType(block, "BlockStatement"))
    return [];
  let declaration: EsTreeNode | null = null;
  let conditional: EsTreeNode | null = null;
  for (const sibling of block.body) {
    if (sibling === statement) break;
    if (sibling.type === "EmptyStatement") continue;
    declaration = conditional;
    conditional = sibling;
  }
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "let" ||
    !isNodeOfType(conditional, "IfStatement") ||
    !conditional.alternate
  )
    return [];
  const [declarator, ...otherDeclarations] = declaration.declarations;
  if (
    otherDeclarations.length ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return [];
  const symbol = context.scopes.symbolFor(listener);
  if (
    !symbol ||
    symbol.kind !== "let" ||
    symbol.declarationNode !== declarator ||
    symbol.bindingIdentifier !== declarator.id
  )
    return [];
  const branches = getPredicateBranches(conditional.test, context);
  const consequent = getBranchAssignment(conditional.consequent, symbol, context);
  const alternate = getBranchAssignment(conditional.alternate, symbol, context);
  if (!branches || !consequent || !alternate) return [];
  const assignments = new Set<EsTreeNode>([consequent.assignment.left, alternate.assignment.left]);
  const cleanupFunctions = new Set(collectReturnedCleanupFunctions(effect, context.scopes));
  if (
    !symbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      if (assignments.has(referenceRoot))
        return (
          reference.flag === "write" ||
          (reference.flag === "read" && referenceRoot !== reference.identifier)
        );
      return (
        reference.flag === "read" &&
        (reference.identifier === listener ||
          isMatchingCleanupReference(reference.identifier, registration, cleanupFunctions, context))
      );
    })
  )
    return [];
  return [
    ...(branches.consequent && nodesCanCoExecute(consequent.assignment, registration, context)
      ? [consequent.callback]
      : []),
    ...(branches.alternate && nodesCanCoExecute(alternate.assignment, registration, context)
      ? [alternate.callback]
      : []),
  ];
};
