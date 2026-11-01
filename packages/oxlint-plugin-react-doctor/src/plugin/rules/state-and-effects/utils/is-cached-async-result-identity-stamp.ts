import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../../utils/find-same-file-type-declaration.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasOnlyErasedTypeNameBindings } from "../../../utils/has-only-erased-type-name-bindings.js";
import { hasVisibleAmbientFunctionDeclaration } from "../../../utils/has-visible-ambient-function-declaration.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface IdentityStampBindings {
  readonly permitted: Map<SymbolDescriptor, Set<EsTreeNode>>;
  readonly permittedWrites: Set<EsTreeNode>;
  readonly context: RuleContext;
}

const isNativeIdentityStampMap = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(identifier, "Identifier") || identifier.name !== "Map") return false;
  if (hasVisibleAmbientFunctionDeclaration(context.scopes.scopeFor(identifier), identifier.name))
    return false;
  if (context.scopes.isGlobalReference(identifier)) return true;
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(symbol && hasOnlyErasedTypeNameBindings(symbol));
};

const isNullExpression = (node: EsTreeNode | null | undefined): boolean => {
  const candidate = node ? stripParenExpression(node) : null;
  return isNodeOfType(candidate, "Literal") && candidate.value === null;
};

const getDirectNonOptionalCall = (statement: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!statement || !isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};

const getBlockStatements = (node: EsTreeNode): ReadonlyArray<EsTreeNode> =>
  isNodeOfType(node, "BlockStatement") ? node.body : [];

const isOwnedConstDeclarator = (declarator: EsTreeNode, component: EsTreeNode): boolean =>
  isFunctionLike(component) &&
  isNodeOfType(declarator, "VariableDeclarator") &&
  isNodeOfType(declarator.parent, "VariableDeclaration") &&
  declarator.parent.kind === "const" &&
  declarator.parent.parent === component.body;

const isReadOnlyConstValue = (symbol: SymbolDescriptor | null): boolean =>
  Boolean(
    symbol &&
    symbol.kind === "const" &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.initializer &&
    !symbol.references.some((reference) => reference.flag !== "read"),
  );

const getNamedReactImportCallName = (call: EsTreeNode, context: RuleContext): string | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.optional
  )
    return null;
  const symbol = context.scopes.symbolFor(call.callee);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.source.value !== "react" ||
    declaration.importKind === "type" ||
    specifier.importKind === "type" ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return null;
  return specifier.imported.name;
};

const permitSelectedBindingReference = (
  bindings: IdentityStampBindings,
  symbol: SymbolDescriptor,
  node: EsTreeNode,
): boolean => {
  if (!isNodeOfType(node, "Identifier") || bindings.context.scopes.symbolFor(node) !== symbol)
    return false;
  const nodes = bindings.permitted.get(symbol) ?? new Set<EsTreeNode>();
  nodes.add(node);
  bindings.permitted.set(symbol, nodes);
  return true;
};

const isSelectedSymbolReference = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean =>
  Boolean(
    node &&
    isNodeOfType(stripParenExpression(node), "Identifier") &&
    context.scopes.symbolFor(stripParenExpression(node)) === symbol,
  );

const isStaticIdentifierPosition = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression") && parent.property === node && !parent.computed)
    return true;
  if (
    isNodeOfType(parent, "Property") &&
    parent.key === node &&
    !parent.computed &&
    (!parent.shorthand || parent.value !== node)
  )
    return true;
  return Boolean(
    (isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
    parent.key === node &&
    !parent.computed,
  );
};

const hasUnmodifiedIdentityStampProviders = (
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  let stable = true;
  walkAst(program, (node) => {
    if (!stable) return false;
    if (
      [
        "TSParameterProperty",
        "TSEnumDeclaration",
        "TSModuleDeclaration",
        "TSImportEqualsDeclaration",
        "TSExportAssignment",
        "TSInstantiationExpression",
      ].includes(node.type)
    ) {
      stable = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (
        (node.computed &&
          name === null &&
          !(isNodeOfType(node.property, "Literal") && typeof node.property.value === "number")) ||
        [
          "constructor",
          "prototype",
          "__proto__",
          "__defineGetter__",
          "__defineSetter__",
          "eval",
          "Function",
          "Reflect",
          "React",
          "Map",
          "getPrototypeOf",
          "getOwnPropertyDescriptor",
          "getOwnPropertyDescriptors",
          "defineProperty",
          "defineProperties",
          "setPrototypeOf",
        ].includes(name ?? "")
      )
        stable = false;
    }
    if (
      isNodeOfType(node, "Property") &&
      isNodeOfType(node.parent, "ObjectPattern") &&
      (node.computed ||
        [
          "constructor",
          "prototype",
          "__proto__",
          "eval",
          "Function",
          "Reflect",
          "React",
          "Map",
          "getPrototypeOf",
          "getOwnPropertyDescriptor",
          "defineProperty",
          "setPrototypeOf",
        ].includes(getStaticKeyName(node.key) ?? ""))
    )
      stable = false;
    if (!isNodeOfType(node, "Identifier") || isStaticIdentifierPosition(node)) return;
    const symbol = context.scopes.symbolFor(node);
    if (symbol?.bindingIdentifier === node) return;
    if (
      [
        "eval",
        "Function",
        "Reflect",
        "arguments",
        "globalThis",
        "global",
        "window",
        "self",
      ].includes(node.name)
    )
      stable = false;
    if (
      node.name === "Map" &&
      (!context.scopes.referenceFor(node) ||
        !isNativeIdentityStampMap(node, context) ||
        !isNodeOfType(node.parent, "NewExpression") ||
        node.parent.callee !== node)
    )
      stable = false;
    if (
      symbol?.kind === "import" &&
      isNodeOfType(symbol.declarationNode.parent, "ImportDeclaration") &&
      symbol.declarationNode.parent.source.value === "react"
    ) {
      const parent = node.parent;
      if (
        !context.scopes.referenceFor(node) ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== node ||
        getNamedReactImportCallName(parent, context) === null
      )
        stable = false;
    }
  });
  return stable;
};

const hasClosedReferences = (root: EsTreeNode, bindings: IdentityStampBindings): boolean => {
  const symbols = [...bindings.permitted.keys()];
  if (
    symbols.some((symbol) =>
      symbol.references.some(
        (reference) =>
          !bindings.permitted.get(symbol)?.has(reference.identifier) ||
          (reference.flag !== "read" && !bindings.permittedWrites.has(reference.identifier)),
      ),
    )
  )
    return false;
  let closed = true;
  walkAst(root, (node) => {
    if (!closed) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (!isNodeOfType(node, "Identifier") || isStaticIdentifierPosition(node)) return;
    const matching = symbols.filter((symbol) => symbol.name === node.name);
    if (matching.length === 0 || matching.some((symbol) => symbol.bindingIdentifier === node))
      return;
    const reference = bindings.context.scopes.referenceFor(node);
    const symbol = reference?.resolvedSymbol;
    if (!symbol || !matching.includes(symbol) || !bindings.permitted.get(symbol)?.has(node))
      closed = false;
  });
  return closed;
};

const hasStringRequestDomain = (
  symbol: SymbolDescriptor,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (isNodeOfType(getSymbolTypeAnnotation(symbol), "TSStringKeyword")) return true;
  const declaration = symbol.declarationNode;
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ArrayPattern") &&
    declaration.id.elements[0] === symbol.bindingIdentifier &&
    isNodeOfType(declaration.init, "CallExpression") &&
    getNamedReactImportCallName(declaration.init, context) === "useState"
  ) {
    const typeArguments = declaration.init.typeArguments;
    return Boolean(
      typeArguments &&
      typeArguments.params.length === 1 &&
      isNodeOfType(typeArguments.params[0], "TSStringKeyword"),
    );
  }
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  const annotation = isNodeOfType(pattern, "ObjectPattern")
    ? pattern.typeAnnotation?.typeAnnotation
    : null;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    !isNodeOfType(annotation, "TSTypeReference") ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    hasEnclosingTypeParameterNamed(annotation, annotation.typeName.name)
  )
    return false;
  const interfaceName = annotation.typeName.name;
  const candidates = findSameFileTypeDeclarations(component, interfaceName);
  if (
    candidates.length !== 1 ||
    !isNodeOfType(candidates[0], "TSInterfaceDeclaration") ||
    candidates[0].extends.length !== 0 ||
    candidates[0].typeParameters
  )
    return false;
  let collisions = 0;
  const program = findProgramRoot(component);
  if (!program) return false;
  walkAst(program, (node) => {
    let declaredName: EsTreeNode | null = null;
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "ClassDeclaration")
    )
      declaredName = node.id;
    if (isNodeOfType(node, "TSTypeParameter")) declaredName = node.name;
    if (isNodeOfType(declaredName, "Identifier") && declaredName.name === interfaceName)
      collisions += 1;
  });
  const members = candidates[0].body.body.filter(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      getStaticKeyName(member.key) === getStaticKeyName(property.key),
  );
  return (
    collisions === 1 &&
    members.length === 1 &&
    isNodeOfType(members[0], "TSPropertySignature") &&
    !members[0].optional &&
    isNodeOfType(members[0].typeAnnotation?.typeAnnotation, "TSStringKeyword")
  );
};

const isCachedAsyncResultIdentityStampProof = (
  effect: EsTreeNode,
  stateDeclarator: EsTreeNode,
  selectedCall: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(effect, "CallExpression") ||
    getNamedReactImportCallName(effect, context) !== "useEffect" ||
    !isNodeOfType(selectedCall, "CallExpression") ||
    !isNodeOfType(selectedCall.callee, "Identifier") ||
    selectedCall.arguments.length !== 1
  )
    return false;
  const effectArgument = effect.arguments[0];
  if (!effectArgument || !isFunctionLike(stripParenExpression(effectArgument))) return false;
  const effectFunction = stripParenExpression(effectArgument);
  const component = findEnclosingFunction(effect);
  const program = findProgramRoot(effect);
  if (
    !isFunctionLike(effectFunction) ||
    effectFunction.async ||
    effectFunction.generator ||
    effectFunction.params.length !== 0 ||
    !isNodeOfType(effectFunction.body, "BlockStatement") ||
    !component ||
    !isFunctionLike(component) ||
    component.async ||
    component.generator ||
    !program ||
    !hasUnmodifiedIdentityStampProviders(program, context)
  )
    return false;
  const stampPair = resolveReactUseStatePair(selectedCall.callee, context.scopes);
  if (
    !stampPair?.stateSymbol ||
    stampPair.declarator !== stateDeclarator ||
    !isNodeOfType(stampPair.declarator.init, "CallExpression") ||
    getNamedReactImportCallName(stampPair.declarator.init, context) !== "useState" ||
    !isNullExpression(stampPair.declarator.init.arguments[0])
  )
    return false;
  const capturedKeySymbol = context.scopes.symbolFor(
    stripParenExpression(selectedCall.arguments[0]),
  );
  if (
    !isReadOnlyConstValue(capturedKeySymbol) ||
    !capturedKeySymbol?.initializer ||
    !isNodeOfType(capturedKeySymbol.initializer, "Identifier")
  )
    return false;
  const requestKeySymbol = context.scopes.symbolFor(capturedKeySymbol.initializer);
  if (
    !requestKeySymbol ||
    requestKeySymbol.references.some((reference) => reference.flag !== "read") ||
    !hasStringRequestDomain(requestKeySymbol, component, context)
  )
    return false;
  const hitStatement = selectedCall.parent;
  const hitBlock = hitStatement?.parent;
  const hitIf = hitBlock?.parent;
  if (
    !isNodeOfType(hitStatement, "ExpressionStatement") ||
    !isNodeOfType(hitBlock, "BlockStatement") ||
    !isNodeOfType(hitIf, "IfStatement") ||
    hitIf.consequent !== hitBlock ||
    hitIf.alternate ||
    !isNodeOfType(hitIf.test, "Identifier")
  )
    return false;
  const hitStatements = hitBlock.body;
  const selectedIndex = hitStatements.findIndex((statement) => statement === hitStatement);
  if (selectedIndex !== 1) return false;
  const payloadCall = getDirectNonOptionalCall(hitStatements[selectedIndex - 1]);
  const finalHitStatement = hitStatements[hitStatements.length - 1];
  if (
    !payloadCall ||
    !isNodeOfType(payloadCall, "CallExpression") ||
    !isNodeOfType(payloadCall.callee, "Identifier") ||
    payloadCall.arguments.length !== 1 ||
    !isNodeOfType(finalHitStatement, "ReturnStatement") ||
    finalHitStatement.argument
  )
    return false;
  const payloadPair = resolveReactUseStatePair(payloadCall.callee, context.scopes);
  const cachedPayloadSymbol = context.scopes.symbolFor(hitIf.test);
  if (
    !payloadPair?.stateSymbol ||
    payloadPair.declarator === stampPair.declarator ||
    !isNodeOfType(payloadPair.declarator.init, "CallExpression") ||
    getNamedReactImportCallName(payloadPair.declarator.init, context) !== "useState" ||
    !isNullExpression(payloadPair.declarator.init.arguments[0]) ||
    !isReadOnlyConstValue(cachedPayloadSymbol) ||
    !cachedPayloadSymbol?.initializer ||
    !isNodeOfType(cachedPayloadSymbol.initializer, "CallExpression") ||
    !isSelectedSymbolReference(payloadCall.arguments[0], cachedPayloadSymbol, context)
  )
    return false;
  const tagState = stampPair.stateSymbol;
  const payloadState = payloadPair.stateSymbol;
  for (const pair of [stampPair, payloadPair]) {
    if (
      !isOwnedConstDeclarator(pair.declarator, component) ||
      !isNodeOfType(pair.declarator.id, "ArrayPattern") ||
      pair.declarator.id.elements.length !== 2 ||
      !isNodeOfType(pair.declarator.id.elements[0], "Identifier") ||
      !isNodeOfType(pair.declarator.id.elements[1], "Identifier") ||
      pair.stateSymbol?.kind !== "const" ||
      pair.setterSymbol.kind !== "const" ||
      !isNodeOfType(pair.declarator.init, "CallExpression") ||
      pair.declarator.init.arguments.length !== 1
    )
      return false;
  }
  const literalSiblingSetters = new Set<SymbolDescriptor>();
  for (const statement of hitStatements.slice(2, -1)) {
    const call = getDirectNonOptionalCall(statement);
    if (
      !isNodeOfType(call, "CallExpression") ||
      !isNodeOfType(call.callee, "Identifier") ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.arguments[0], "Literal") ||
      (typeof call.arguments[0].value === "object" && call.arguments[0].value !== null)
    )
      return false;
    const pair = resolveReactUseStatePair(call.callee, context.scopes);
    if (
      !pair ||
      pair.declarator === stampPair.declarator ||
      pair.declarator === payloadPair.declarator ||
      !isOwnedConstDeclarator(pair.declarator, component) ||
      !isNodeOfType(pair.declarator.init, "CallExpression") ||
      getNamedReactImportCallName(pair.declarator.init, context) !== "useState" ||
      pair.declarator.init.arguments.length !== 1 ||
      pair.setterSymbol.references.some((reference) => reference.flag !== "read")
    )
      return false;
    literalSiblingSetters.add(pair.setterSymbol);
  }
  const cacheGet = cachedPayloadSymbol.initializer;
  if (
    !isNodeOfType(cacheGet.callee, "MemberExpression") ||
    getStaticPropertyName(cacheGet.callee) !== "get" ||
    cacheGet.callee.optional ||
    cacheGet.optional ||
    cacheGet.arguments.length !== 1 ||
    !isSelectedSymbolReference(cacheGet.arguments[0], capturedKeySymbol, context)
  )
    return false;
  const cacheMember = cacheGet.callee.object;
  if (
    !isNodeOfType(cacheMember, "MemberExpression") ||
    getStaticPropertyName(cacheMember) !== "current" ||
    cacheMember.optional ||
    !isNodeOfType(cacheMember.object, "Identifier")
  )
    return false;
  const cacheRefSymbol = context.scopes.symbolFor(cacheMember.object);
  if (
    !isReadOnlyConstValue(cacheRefSymbol) ||
    !cacheRefSymbol?.initializer ||
    !isNodeOfType(cacheRefSymbol.initializer, "CallExpression") ||
    getNamedReactImportCallName(cacheRefSymbol.initializer, context) !== "useRef" ||
    cacheRefSymbol.initializer.arguments.length !== 1 ||
    !isOwnedConstDeclarator(cacheRefSymbol.declarationNode, component)
  )
    return false;
  const map = cacheRefSymbol.initializer.arguments[0];
  if (
    !isNodeOfType(map, "NewExpression") ||
    map.arguments.length !== 0 ||
    !isNodeOfType(map.callee, "Identifier") ||
    map.callee.name !== "Map" ||
    !isNativeIdentityStampMap(map.callee, context)
  )
    return false;
  const effectStatements = effectFunction.body.body;
  for (const binding of [capturedKeySymbol, cachedPayloadSymbol]) {
    const statement = binding.declarationNode.parent;
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.parent !== effectFunction.body ||
      effectStatements.findIndex((candidate) => candidate === statement) >=
        effectStatements.findIndex((candidate) => candidate === hitIf) ||
      effectStatements.findIndex((candidate) => candidate === statement) < 0
    )
      return false;
  }
  const bindings: IdentityStampBindings = {
    permitted: new Map(),
    permittedWrites: new Set(),
    context,
  };
  for (const symbol of [
    tagState,
    stampPair.setterSymbol,
    payloadState,
    payloadPair.setterSymbol,
    capturedKeySymbol,
    cachedPayloadSymbol,
    cacheRefSymbol,
    requestKeySymbol,
  ])
    bindings.permitted.set(symbol, new Set());
  for (const reference of requestKeySymbol.references)
    permitSelectedBindingReference(bindings, requestKeySymbol, reference.identifier);
  for (const symbol of literalSiblingSetters) {
    bindings.permitted.set(symbol, new Set());
    for (const reference of symbol.references)
      permitSelectedBindingReference(bindings, symbol, reference.identifier);
  }
  const permitReference = (symbol: SymbolDescriptor, node: EsTreeNode): boolean =>
    permitSelectedBindingReference(bindings, symbol, stripParenExpression(node));
  if (
    !permitReference(capturedKeySymbol, cacheGet.arguments[0]) ||
    !permitReference(cachedPayloadSymbol, hitIf.test) ||
    !permitReference(cachedPayloadSymbol, payloadCall.arguments[0]) ||
    !permitReference(cacheRefSymbol, cacheMember.object)
  )
    return false;
  const sameSetter = (call: EsTreeNode | null, symbol: SymbolDescriptor): boolean =>
    Boolean(
      call &&
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.arguments.length === 1 &&
      isSelectedSymbolReference(call.callee, symbol, context),
    );
  const pairCalls = new Set<EsTreeNode>([payloadCall, selectedCall]);
  const insertions: EsTreeNode[] = [];
  let cancellationSymbol: SymbolDescriptor | null = null;
  const asyncInvocations: EsTreeNode[] = [];
  walkAst(effectFunction.body, (node) => {
    if (node !== effectFunction.body && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "ArrowFunctionExpression") && callee.async)
      asyncInvocations.push(node);
  });
  if (
    asyncInvocations.length !== 1 ||
    !isNodeOfType(asyncInvocations[0], "CallExpression") ||
    asyncInvocations[0].arguments.length !== 0
  )
    return false;
  const asyncFunction = stripParenExpression(asyncInvocations[0].callee);
  if (
    !isNodeOfType(asyncFunction, "ArrowFunctionExpression") ||
    asyncFunction.generator ||
    asyncFunction.params.length !== 0 ||
    !isNodeOfType(asyncFunction.body, "BlockStatement")
  )
    return false;
  const invocationRoot = findTransparentExpressionRoot(asyncInvocations[0]);
  const invocationStatement =
    isNodeOfType(invocationRoot.parent, "UnaryExpression") &&
    invocationRoot.parent.operator === "void"
      ? invocationRoot.parent.parent
      : invocationRoot.parent;
  if (
    !isNodeOfType(invocationStatement, "ExpressionStatement") ||
    invocationStatement.parent !== effectFunction.body ||
    effectStatements.findIndex((statement) => statement === invocationStatement) <=
      effectStatements.findIndex((statement) => statement === hitIf)
  )
    return false;
  walkAst(asyncFunction.body, (node) => {
    if (node !== asyncFunction.body && isFunctionLike(node)) return false;
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      getStaticPropertyName(node.callee) !== "set"
    )
      return;
    const receiver = node.callee.object;
    if (
      !isNodeOfType(receiver, "MemberExpression") ||
      getStaticPropertyName(receiver) !== "current" ||
      !isSelectedSymbolReference(receiver.object, cacheRefSymbol, context)
    )
      return;
    insertions.push(node);
  });
  const cacheInsertionCall = insertions[0];
  if (
    insertions.length !== 1 ||
    !isNodeOfType(cacheInsertionCall, "CallExpression") ||
    !isNodeOfType(cacheInsertionCall.callee, "MemberExpression") ||
    !isNodeOfType(cacheInsertionCall.callee.object, "MemberExpression") ||
    cacheInsertionCall.optional ||
    cacheInsertionCall.callee.optional ||
    cacheInsertionCall.callee.object.optional ||
    cacheInsertionCall.arguments.length !== 2 ||
    !isSelectedSymbolReference(cacheInsertionCall.arguments[0], capturedKeySymbol, context) ||
    !isNodeOfType(cacheInsertionCall.arguments[1], "Identifier")
  )
    return false;
  const acquiredPayloadSymbol = context.scopes.symbolFor(cacheInsertionCall.arguments[1]);
  if (
    !isReadOnlyConstValue(acquiredPayloadSymbol) ||
    !acquiredPayloadSymbol?.initializer ||
    !isNodeOfType(acquiredPayloadSymbol.initializer, "AwaitExpression") ||
    !isNodeOfType(acquiredPayloadSymbol.initializer.argument, "CallExpression")
  )
    return false;
  const acquisitionCall = acquiredPayloadSymbol.initializer.argument;
  if (
    findEnclosingFunction(acquiredPayloadSymbol.declarationNode) !== asyncFunction ||
    !acquisitionCall.arguments.some((argument) =>
      isSelectedSymbolReference(argument, capturedKeySymbol, context),
    ) ||
    acquisitionCall.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !nodeDominatesNode(acquiredPayloadSymbol.declarationNode, cacheInsertionCall, context)
  )
    return false;
  const insertionStatement = cacheInsertionCall.parent;
  const insertionBlock = insertionStatement?.parent;
  if (!isNodeOfType(insertionBlock, "BlockStatement")) return false;
  const insertionIndex = insertionBlock.body.findIndex(
    (statement) => statement === insertionStatement,
  );
  const asyncPayload = getDirectNonOptionalCall(insertionBlock.body[insertionIndex + 1]);
  const asyncTag = getDirectNonOptionalCall(insertionBlock.body[insertionIndex + 2]);
  if (
    !sameSetter(asyncPayload, payloadPair.setterSymbol) ||
    !sameSetter(asyncTag, stampPair.setterSymbol) ||
    !isNodeOfType(asyncPayload, "CallExpression") ||
    !isNodeOfType(asyncTag, "CallExpression") ||
    !isSelectedSymbolReference(asyncPayload.arguments[0], acquiredPayloadSymbol, context) ||
    !isSelectedSymbolReference(asyncTag.arguments[0], capturedKeySymbol, context)
  )
    return false;
  bindings.permitted.set(acquiredPayloadSymbol, new Set());
  const guards: EsTreeNode[] = [];
  const suspensionPoints: EsTreeNode[] = [];
  let unsupportedSuspension = false;
  walkAst(asyncFunction.body, (node) => {
    if (node !== asyncFunction.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "AwaitExpression")) suspensionPoints.push(node);
    if (
      isNodeOfType(node, "YieldExpression") ||
      (isNodeOfType(node, "ForOfStatement") && node.await)
    )
      unsupportedSuspension = true;
    if (
      isNodeOfType(node, "IfStatement") &&
      !node.alternate &&
      node.parent === insertionBlock &&
      nodeDominatesNode(acquiredPayloadSymbol.declarationNode, node, context) &&
      nodeDominatesNode(node, cacheInsertionCall, context)
    )
      guards.push(node);
  });
  if (
    unsupportedSuspension ||
    suspensionPoints.length !== 1 ||
    suspensionPoints[0] !== acquiredPayloadSymbol.initializer ||
    acquiredPayloadSymbol.declarationNode.parent?.parent !== insertionBlock
  )
    return false;
  let rejectsEmptyPayload = false;
  for (const guard of guards) {
    if (!isNodeOfType(guard, "IfStatement")) continue;
    const statements = isNodeOfType(guard.consequent, "BlockStatement")
      ? guard.consequent.body
      : [guard.consequent];
    const last = statements[statements.length - 1];
    if (!isNodeOfType(last, "ReturnStatement") || last.argument) continue;
    const terms =
      isNodeOfType(guard.test, "LogicalExpression") && guard.test.operator === "||"
        ? [guard.test.left, guard.test.right]
        : [guard.test];
    for (const term of terms) {
      if (
        isNodeOfType(term, "UnaryExpression") &&
        term.operator === "!" &&
        isSelectedSymbolReference(term.argument, acquiredPayloadSymbol, context)
      ) {
        rejectsEmptyPayload = permitReference(acquiredPayloadSymbol, term.argument);
        continue;
      }
      if (!isNodeOfType(term, "Identifier")) continue;
      const possibleCancel = context.scopes.symbolFor(term);
      if (
        possibleCancel?.kind !== "let" ||
        !isNodeOfType(possibleCancel.initializer, "Literal") ||
        possibleCancel.initializer.value !== false ||
        findEnclosingFunction(possibleCancel.declarationNode) !== effectFunction
      )
        continue;
      if (cancellationSymbol && cancellationSymbol !== possibleCancel) return false;
      cancellationSymbol = possibleCancel;
      permitReference(cancellationSymbol, term);
    }
  }
  if (!rejectsEmptyPayload || !cancellationSymbol) return false;
  const cleanupReturns = effectStatements.filter((statement) =>
    isNodeOfType(statement, "ReturnStatement"),
  );
  if (
    cleanupReturns.length !== 1 ||
    !isNodeOfType(cleanupReturns[0], "ReturnStatement") ||
    !cleanupReturns[0].argument ||
    !isFunctionLike(cleanupReturns[0].argument) ||
    cleanupReturns[0].argument.async ||
    cleanupReturns[0].argument.generator ||
    cleanupReturns[0].argument.params.length !== 0
  )
    return false;
  const cleanupBody = getBlockStatements(cleanupReturns[0].argument.body);
  const cancellation =
    cleanupBody.length === 1 && isNodeOfType(cleanupBody[0], "ExpressionStatement")
      ? cleanupBody[0].expression
      : null;
  if (
    !isNodeOfType(cancellation, "AssignmentExpression") ||
    cancellation.operator !== "=" ||
    !isSelectedSymbolReference(cancellation.left, cancellationSymbol, context) ||
    !isNodeOfType(cancellation.right, "Literal") ||
    cancellation.right.value !== true
  )
    return false;
  permitReference(cancellationSymbol, cancellation.left);
  bindings.permittedWrites.add(cancellation.left);
  for (const argument of acquisitionCall.arguments)
    if (isSelectedSymbolReference(argument, capturedKeySymbol, context))
      permitReference(capturedKeySymbol, argument);
  permitReference(acquiredPayloadSymbol, cacheInsertionCall.arguments[1]);
  permitReference(capturedKeySymbol, cacheInsertionCall.arguments[0]);
  permitReference(cacheRefSymbol, cacheInsertionCall.callee.object.object);
  pairCalls.add(asyncPayload);
  pairCalls.add(asyncTag);
  const nullPairs = new Set<EsTreeNode>();
  walkAst(component, (node) => {
    if (
      !sameSetter(node, payloadPair.setterSymbol) ||
      !isNodeOfType(node, "CallExpression") ||
      !isNullExpression(node.arguments[0])
    )
      return;
    const statement = node.parent;
    const block = statement?.parent;
    if (!isNodeOfType(statement, "ExpressionStatement") || !isNodeOfType(block, "BlockStatement"))
      return;
    const next = getDirectNonOptionalCall(
      block.body[block.body.findIndex((candidate) => candidate === statement) + 1],
    );
    if (
      sameSetter(next, stampPair.setterSymbol) &&
      isNodeOfType(next, "CallExpression") &&
      isNullExpression(next.arguments[0])
    ) {
      nullPairs.add(node);
      nullPairs.add(next);
    }
  });
  for (const call of [...pairCalls, ...nullPairs]) {
    if (!isNodeOfType(call, "CallExpression")) return false;
    const setter = context.scopes.symbolFor(call.callee);
    if (!setter || !permitReference(setter, call.callee)) return false;
    if (isSelectedSymbolReference(call.arguments[0], capturedKeySymbol, context))
      permitReference(capturedKeySymbol, call.arguments[0]);
    if (isSelectedSymbolReference(call.arguments[0], acquiredPayloadSymbol, context))
      permitReference(acquiredPayloadSymbol, call.arguments[0]);
  }
  const masks: EsTreeNode[] = [];
  walkAst(component, (node) => {
    if (node !== component && isFunctionLike(node)) return false;
    if (
      !isNodeOfType(node, "ConditionalExpression") ||
      !isNodeOfType(node.test, "BinaryExpression") ||
      node.test.operator !== "===" ||
      !isSelectedSymbolReference(node.test.left, tagState, context) ||
      !isSelectedSymbolReference(node.test.right, requestKeySymbol, context) ||
      !isSelectedSymbolReference(node.consequent, payloadState, context) ||
      !isNullExpression(node.alternate) ||
      !isNodeOfType(node.parent, "VariableDeclarator") ||
      !isNodeOfType(node.parent.id, "Identifier") ||
      !isReadOnlyConstValue(context.scopes.symbolFor(node.parent.id))
    )
      return;
    masks.push(node);
    permitReference(tagState, node.test.left);
    permitReference(payloadState, node.consequent);
  });
  if (masks.length !== 1) return false;
  const cacheCalls: EsTreeNode[] = [];
  walkAst(component, (node) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      !isNodeOfType(node.callee.object, "MemberExpression") ||
      getStaticPropertyName(node.callee.object) !== "current" ||
      !isSelectedSymbolReference(node.callee.object.object, cacheRefSymbol, context)
    )
      return;
    cacheCalls.push(node);
  });
  const releaseCalls = cacheCalls.filter(
    (call) => call !== cacheGet && call !== cacheInsertionCall,
  );
  if (releaseCalls.length !== 0 && releaseCalls.length !== 2) return false;
  if (releaseCalls.length === 2) {
    const releaseEachCall = releaseCalls.find(
      (call) =>
        isNodeOfType(call, "CallExpression") &&
        isNodeOfType(call.callee, "MemberExpression") &&
        getStaticPropertyName(call.callee) === "forEach",
    );
    const cacheClearCall = releaseCalls.find(
      (call) =>
        isNodeOfType(call, "CallExpression") &&
        isNodeOfType(call.callee, "MemberExpression") &&
        getStaticPropertyName(call.callee) === "clear",
    );
    if (
      !isNodeOfType(releaseEachCall, "CallExpression") ||
      !isNodeOfType(cacheClearCall, "CallExpression") ||
      !isNodeOfType(releaseEachCall.callee, "MemberExpression") ||
      !isNodeOfType(releaseEachCall.callee.object, "MemberExpression") ||
      !isNodeOfType(cacheClearCall.callee, "MemberExpression") ||
      !isNodeOfType(cacheClearCall.callee.object, "MemberExpression") ||
      releaseEachCall.optional ||
      cacheClearCall.optional ||
      releaseEachCall.callee.optional ||
      cacheClearCall.callee.optional ||
      releaseEachCall.callee.object.optional ||
      cacheClearCall.callee.object.optional ||
      releaseEachCall.arguments.length !== 1 ||
      cacheClearCall.arguments.length !== 0
    )
      return false;
    const release = findEnclosingFunction(releaseEachCall);
    const releaseHook = release?.parent;
    if (
      !release ||
      !isFunctionLike(release) ||
      release !== findEnclosingFunction(cacheClearCall) ||
      !isNodeOfType(releaseHook, "CallExpression") ||
      getNamedReactImportCallName(releaseHook, context) !== "useCallback" ||
      releaseHook.arguments[0] !== release ||
      !isNodeOfType(releaseHook.arguments[1], "ArrayExpression") ||
      releaseHook.arguments[1].elements.length !== 0 ||
      !isNodeOfType(releaseHook.parent, "VariableDeclarator") ||
      !isNodeOfType(releaseHook.parent.id, "Identifier")
    )
      return false;
    const releaseSymbol = context.scopes.symbolFor(releaseHook.parent.id);
    const releaseBody = getBlockStatements(release.body);
    const callback = releaseEachCall.arguments[0];
    if (
      !releaseSymbol ||
      !isReadOnlyConstValue(releaseSymbol) ||
      release.async ||
      release.generator ||
      release.params.length !== 0 ||
      releaseBody.length !== 2 ||
      getDirectNonOptionalCall(releaseBody[0]) !== releaseEachCall ||
      getDirectNonOptionalCall(releaseBody[1]) !== cacheClearCall ||
      !isFunctionLike(callback) ||
      callback.async ||
      callback.generator ||
      callback.params.length !== 1 ||
      !isNodeOfType(callback.params[0], "Identifier")
    )
      return false;
    const releaseParameter = context.scopes.symbolFor(callback.params[0]);
    const releaseExpression = isNodeOfType(callback.body, "BlockStatement")
      ? getDirectNonOptionalCall(callback.body.body.length === 1 ? callback.body.body[0] : null)
      : callback.body;
    if (
      !releaseParameter ||
      !isNodeOfType(releaseExpression, "CallExpression") ||
      !isNodeOfType(releaseExpression.callee, "MemberExpression") ||
      getStaticPropertyName(releaseExpression.callee) !== "destroy" ||
      !isSelectedSymbolReference(releaseExpression.callee.object, releaseParameter, context) ||
      releaseExpression.arguments.length !== 0
    )
      return false;
    bindings.permitted.set(releaseSymbol, new Set());
    bindings.permitted.set(releaseParameter, new Set());
    permitReference(releaseParameter, releaseExpression.callee.object);
    permitReference(cacheRefSymbol, releaseEachCall.callee.object.object);
    permitReference(cacheRefSymbol, cacheClearCall.callee.object.object);
    let nullLifetimeGuard = false;
    for (const reference of releaseSymbol.references) {
      const identifier = reference.identifier;
      const root = findTransparentExpressionRoot(identifier);
      if (isNodeOfType(root.parent, "ArrayExpression")) {
        const hook = root.parent.parent;
        if (
          isNodeOfType(hook, "CallExpression") &&
          hook.arguments[1] === root.parent &&
          getNamedReactImportCallName(hook, context) === "useEffect"
        ) {
          permitReference(releaseSymbol, identifier);
          continue;
        }
      }
      const call = root.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== root ||
        call.arguments.length !== 0
      )
        return false;
      const owner = findEnclosingFunction(call);
      const hook = owner?.parent;
      if (
        !owner ||
        !isFunctionLike(owner) ||
        !isNodeOfType(hook, "CallExpression") ||
        getNamedReactImportCallName(hook, context) !== "useEffect"
      ) {
        const cleanup = findEnclosingFunction(owner ?? call);
        const cleanupHook = cleanup?.parent;
        if (
          !owner ||
          !isFunctionLike(owner) ||
          owner.async ||
          owner.generator ||
          owner.params.length !== 0 ||
          !cleanup ||
          !isFunctionLike(cleanup) ||
          cleanup.async ||
          cleanup.generator ||
          cleanup.params.length !== 0 ||
          !isNodeOfType(cleanupHook, "CallExpression") ||
          getNamedReactImportCallName(cleanupHook, context) !== "useEffect" ||
          !isNodeOfType(owner.parent, "ReturnStatement") ||
          owner.parent.argument !== owner ||
          getBlockStatements(cleanup.body).length !== 1 ||
          getBlockStatements(owner.body).length !== 1 ||
          getDirectNonOptionalCall(getBlockStatements(owner.body)[0]) !== call
        )
          return false;
        permitReference(releaseSymbol, identifier);
        continue;
      }
      if (owner.async || owner.generator || owner.params.length !== 0) return false;
      const statements = getBlockStatements(owner.body);
      const guard = statements[0];
      if (
        statements.length !== 1 ||
        !isNodeOfType(guard, "IfStatement") ||
        guard.alternate ||
        !isNodeOfType(guard.test, "LogicalExpression") ||
        guard.test.operator !== "&&"
      )
        return false;
      const nullTest = guard.test.right;
      if (
        !isNodeOfType(guard.test.left, "UnaryExpression") ||
        guard.test.left.operator !== "!" ||
        !isNodeOfType(nullTest, "BinaryExpression") ||
        nullTest.operator !== "===" ||
        !isSelectedSymbolReference(nullTest.left, payloadState, context) ||
        !isNullExpression(nullTest.right) ||
        getBlockStatements(guard.consequent).length !== 1 ||
        getDirectNonOptionalCall(getBlockStatements(guard.consequent)[0]) !== call
      )
        return false;
      permitReference(payloadState, nullTest.left);
      permitReference(releaseSymbol, identifier);
      nullLifetimeGuard = true;
      const dependencies = hook.arguments[1];
      if (!isNodeOfType(dependencies, "ArrayExpression")) return false;
      for (const element of dependencies.elements)
        if (element && isSelectedSymbolReference(element, payloadState, context))
          permitReference(payloadState, element);
    }
    if (!nullLifetimeGuard) return false;
  }
  const acquiredUses = acquiredPayloadSymbol.references.filter(
    (reference) => !bindings.permitted.get(acquiredPayloadSymbol)?.has(reference.identifier),
  );
  for (const reference of acquiredUses) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    const call = member?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      getStaticPropertyName(member) !== "destroy" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.arguments.length !== 0 ||
      !guards.some(
        (guard) => isNodeOfType(guard, "IfStatement") && isAstDescendant(call, guard.consequent),
      )
    )
      return false;
    permitReference(acquiredPayloadSymbol, reference.identifier);
  }
  for (const reference of cancellationSymbol.references) {
    if (bindings.permitted.get(cancellationSymbol)?.has(reference.identifier)) continue;
    const identifier = reference.identifier;
    const negation = identifier.parent;
    const guard = negation?.parent;
    const catchBody = guard?.parent;
    const catchClause = catchBody?.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(negation, "UnaryExpression") ||
      negation.operator !== "!" ||
      negation.argument !== identifier ||
      !isNodeOfType(guard, "IfStatement") ||
      guard.test !== negation ||
      guard.alternate ||
      !isNodeOfType(catchBody, "BlockStatement") ||
      !isNodeOfType(catchClause, "CatchClause") ||
      catchClause.body !== catchBody ||
      findEnclosingFunction(catchClause) !== asyncFunction ||
      ![...nullPairs].some((call) => isAstDescendant(call, guard.consequent))
    )
      return false;
    permitReference(cancellationSymbol, identifier);
  }
  return hasClosedReferences(component, bindings);
};

export const isCachedAsyncResultIdentityStamp = (
  effectNode: EsTreeNode,
  stateDeclarator: EsTreeNode,
  callExpression: EsTreeNode,
  context: RuleContext,
): boolean => {
  try {
    return isCachedAsyncResultIdentityStampProof(
      effectNode,
      stateDeclarator,
      callExpression,
      context,
    );
  } catch {
    return false;
  }
};
