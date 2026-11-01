import {
  MATCHER_FORBIDDEN_GLOBALS,
  MATCHER_PROVIDER_KEYS,
  MATCHER_PROTOCOL_KEYS,
  MATCHER_UNSUPPORTED_RUNTIME_NODE_TYPES,
} from "./stable-matcher/constants.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../../utils/do-nodes-cover-every-path-from-function-entry.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFiniteStaticStringValues } from "../../../utils/get-finite-static-string-values.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { FIRST_ARGUMENT_INDEX, SECOND_ARGUMENT_INDEX } from "./effect/constants.js";

interface StableMatcherCollectionInput {
  readonly classBody: EsTreeNodeOfType<"ClassBody">;
  readonly context: RuleContext;
  readonly resolveMember: (memberName: string) => EsTreeNode | null;
}

interface MatcherCollectionProof extends StableMatcherCollectionInput {
  readonly fieldName: string;
  readonly allowedCalls: Set<EsTreeNode>;
  readonly allowedRecordReads: Set<EsTreeNode>;
  readonly allowedThisDestructures: Set<EsTreeNode>;
  readonly symbolUses: Map<SymbolDescriptor, Set<EsTreeNode>>;
}

interface MatcherIteration {
  readonly registration: EsTreeNodeOfType<"CallExpression">;
  readonly handlerName: string;
}

const matcherProvidersByAnalysis = new WeakMap<RuleContext["scopes"], boolean>();
const matcherMemberReferencesByAnalysis = new WeakMap<
  RuleContext["scopes"],
  ReadonlyMap<string, ReadonlyArray<EsTreeNode>>
>();
const matcherMemberWritesByAnalysis = new WeakMap<
  RuleContext["scopes"],
  ReadonlyMap<string, ReadonlyArray<EsTreeNode>>
>();

const getMatcherMemberName = (node: EsTreeNode): string | null =>
  getStaticPropertyKeyName(node, { allowComputedString: true });

const unwrapMatcherExpression = (node: EsTreeNode | null | undefined): EsTreeNode | null =>
  node ? stripParenExpression(node) : null;

const isDirectMatcherThisMember = (node: EsTreeNode | null | undefined, name: string): boolean => {
  const expression = unwrapMatcherExpression(node);
  return (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.optional &&
    !expression.computed &&
    isNodeOfType(unwrapMatcherExpression(expression.object), "ThisExpression") &&
    getMatcherMemberName(expression) === name
  );
};

const isSelectedMatcherStateRecord = (
  node: EsTreeNode | null | undefined,
  fieldName: string,
): boolean => {
  const expression = unwrapMatcherExpression(node);
  return (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.optional &&
    !expression.computed &&
    getMatcherMemberName(expression) === fieldName &&
    isDirectMatcherThisMember(expression.object, "state")
  );
};

const getMatcherMethodCall = (node: EsTreeNode | null | undefined, name: string) => {
  const expression = unwrapMatcherExpression(node);
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return null;
  const callee = unwrapMatcherExpression(expression.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    !callee.computed &&
    getMatcherMemberName(callee) === name
    ? { call: expression, callee }
    : null;
};

const nativeMatcherScopesByAnalysis = new WeakMap<ScopeAnalysis, ScopeAnalysis>();

const isNativeMatcherGlobalReference = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (scopes.isGlobalReference(identifier)) return true;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    !hasRuntimeValueBinding(symbol),
  );
};

const isNativeMatcherNamespaceReference = (
  expression: EsTreeNode,
  namespace: string,
  context: RuleContext,
  memberName: string,
): boolean => {
  if (
    isProvenUnmodifiedGlobalNamespaceReference(expression, namespace, context.scopes, memberName)
  ) {
    return true;
  }
  const receiver = unwrapMatcherExpression(expression);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== namespace ||
    (namespace !== "Object" && namespace !== "window") ||
    matcherProvidersByAnalysis.get(context.scopes) !== true ||
    context.scopes.isGlobalReference(receiver) ||
    !isNativeMatcherGlobalReference(receiver, context.scopes)
  ) {
    return false;
  }
  let nativeScopes = nativeMatcherScopesByAnalysis.get(context.scopes);
  if (!nativeScopes) {
    const scopes = context.scopes;
    nativeScopes = {
      ...scopes,
      isGlobalReference: (identifier) =>
        scopes.isGlobalReference(identifier) ||
        (isNodeOfType(identifier, "Identifier") &&
          (identifier.name === "Object" || identifier.name === "window") &&
          isNativeMatcherGlobalReference(identifier, scopes)),
    };
    nativeMatcherScopesByAnalysis.set(scopes, nativeScopes);
  }
  return isProvenUnmodifiedGlobalNamespaceReference(receiver, namespace, nativeScopes, memberName);
};

const getNativeMatcherMethodCall = (
  node: EsTreeNode | null | undefined,
  namespace: string,
  name: string,
  context: RuleContext,
) => {
  const matchingCall = getMatcherMethodCall(node, name);
  return matchingCall &&
    isNativeMatcherNamespaceReference(matchingCall.callee.object, namespace, context, name)
    ? matchingCall
    : null;
};

const getMatcherArrowReturnedExpression = (
  node: EsTreeNode | null | undefined,
): EsTreeNode | null => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") || node.async || node.generator) return null;
  if (!isNodeOfType(node.body, "BlockStatement")) return unwrapMatcherExpression(node.body);
  const [statement, extra] = node.body.body;
  return !extra && isNodeOfType(statement, "ReturnStatement")
    ? unwrapMatcherExpression(statement.argument)
    : null;
};

const hasPlainParameters = (node: EsTreeNode | null, names: ReadonlyArray<EsTreeNode>): boolean => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") || node.async || node.generator) return false;
  const remaining = [...node.params];
  for (const name of names)
    if (remaining.shift() !== name || !isNodeOfType(name, "Identifier")) return false;
  return !remaining.length;
};

const allowSymbolUse = (
  expression: EsTreeNode | null | undefined,
  binding: EsTreeNode,
  proof: MatcherCollectionProof,
): boolean => {
  const identifier = unwrapMatcherExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = proof.context.scopes.symbolFor(binding);
  if (!symbol || proof.context.scopes.symbolFor(identifier) !== symbol) return false;
  const references = proof.symbolUses.get(symbol) ?? new Set<EsTreeNode>();
  references.add(identifier);
  proof.symbolUses.set(symbol, references);
  return true;
};

const ownShorthandKey = (identifier: EsTreeNode, symbol: SymbolDescriptor): boolean => {
  const property = identifier.parent;
  return (
    isNodeOfType(property, "Property") &&
    property.shorthand &&
    property.key === identifier &&
    property.key !== property.value &&
    property.value === symbol.bindingIdentifier
  );
};

const recordedShorthandKey = (
  identifier: EsTreeNode,
  symbol: SymbolDescriptor,
  proof: MatcherCollectionProof,
): boolean => {
  const property = identifier.parent;
  return (
    isNodeOfType(property, "Property") &&
    property.shorthand &&
    property.key === identifier &&
    property.key !== property.value &&
    isNodeOfType(property.value, "Identifier") &&
    proof.context.scopes.symbolFor(property.value) === symbol &&
    Boolean(proof.symbolUses.get(symbol)?.has(property.value))
  );
};

const referencesAreClosed = (proof: MatcherCollectionProof): boolean =>
  [...proof.symbolUses].every(([symbol, uses]) =>
    symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        ownShorthandKey(reference.identifier, symbol) ||
        recordedShorthandKey(reference.identifier, symbol, proof) ||
        uses.has(reference.identifier),
    ),
  );

const isMatcherStateLiteralData = (expression: EsTreeNode | null | undefined): boolean => {
  const node = unwrapMatcherExpression(expression);
  if (isNodeOfType(node, "Literal"))
    return (
      node.value === null || ["string", "number", "boolean", "bigint"].includes(typeof node.value)
    );
  if (!isNodeOfType(node, "ObjectExpression")) return false;
  return node.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      property.kind === "init" &&
      !property.method &&
      getMatcherMemberName(property) !== "__proto__" &&
      isMatcherStateLiteralData(property.value),
  );
};

const isMatcherDataIndexRead = (node: EsTreeNode, context: RuleContext): boolean => {
  const root = findTransparentExpressionRoot(node);
  const consumer = root.parent;
  if (
    isNodeOfType(consumer, "BinaryExpression") &&
    (consumer.operator === "===" || consumer.operator === "!==")
  )
    return true;
  if (
    isNodeOfType(consumer, "MemberExpression") &&
    !consumer.computed &&
    getMatcherMemberName(consumer) === "matches" &&
    !isWithinAssignmentTarget(consumer)
  )
    return true;
  const nativeQuery = getMatcherMethodCall(consumer, "matchMedia");
  const receiver = nativeQuery && unwrapMatcherExpression(nativeQuery.callee.object);
  return Boolean(
    nativeQuery &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    isNativeMatcherGlobalReference(receiver, context.scopes) &&
    nativeQuery.call.arguments.at(FIRST_ARGUMENT_INDEX) === root &&
    !nativeQuery.call.arguments.at(SECOND_ARGUMENT_INDEX),
  );
};

const isMatcherNonReferenceIdentifier = (
  node: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  if (isTypeScriptTypePosition(node) || scopes.symbolFor(node)?.bindingIdentifier === node)
    return true;
  const parent = node.parent;
  return (
    (isNodeOfType(parent, "MemberExpression") && !parent.computed && parent.property === node) ||
    (isNodeOfType(parent, "Property") &&
      !parent.computed &&
      parent.key === node &&
      (!parent.shorthand || parent.value !== node)) ||
    ((isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
      !parent.computed &&
      parent.key === node) ||
    isNodeOfType(parent, "ImportSpecifier") ||
    isNodeOfType(parent, "ImportDefaultSpecifier") ||
    isNodeOfType(parent, "ImportNamespaceSpecifier") ||
    isNodeOfType(parent, "ExportSpecifier") ||
    (isNodeOfType(parent, "LabeledStatement") && parent.label === node) ||
    ((isNodeOfType(parent, "BreakStatement") || isNodeOfType(parent, "ContinueStatement")) &&
      parent.label === node)
  );
};

const hasClosedMatcherProviders = (context: RuleContext): boolean => {
  const saved = matcherProvidersByAnalysis.get(context.scopes);
  if (saved !== undefined) return saved;
  let valid = true;
  const writesByName = new Map<string, EsTreeNode[]>();
  const memberReferencesByName = new Map<string, EsTreeNode[]>();
  const readonlyImports = new Map<SymbolDescriptor, boolean>();
  const reactImportNames = new Set<string>();
  for (const symbol of context.scopes.rootScope.symbols) {
    const declaration = getValueImportDeclaration(symbol);
    if (isNodeOfType(declaration, "ImportDeclaration") && declaration.source.value === "react")
      reactImportNames.add(symbol.name);
  }
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!valid) return false;
    if (MATCHER_UNSUPPORTED_RUNTIME_NODE_TYPES.has(node.type)) {
      valid = false;
      return false;
    }
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    ) {
      return false;
    }
    if (
      node.type === "Decorator" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "WithStatement"
    )
      valid = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getMatcherMemberName(node);
      if (name) {
        const references = memberReferencesByName.get(name) ?? [];
        references.push(node);
        memberReferencesByName.set(name, references);
      }
      if (isNodeOfType(unwrapMatcherExpression(node.object), "Super") || name === "constructor")
        valid = false;
      if (
        node.computed &&
        (getFiniteStaticStringValues(node.property, context).has("constructor") ||
          (!name && !isMatcherDataIndexRead(node, context)))
      )
        valid = false;
      const consumer = findTransparentExpressionRoot(node).parent;
      if (name && isWithinAssignmentTarget(node)) {
        const writes = writesByName.get(name) ?? [];
        writes.push(node);
        writesByName.set(name, writes);
      }
      if (
        (name && MATCHER_PROVIDER_KEYS.has(name)) ||
        (node.computed && isNodeOfType(consumer, "CallExpression") && consumer.callee === node) ||
        (isWithinAssignmentTarget(node) && (!name || MATCHER_PROTOCOL_KEYS.has(name)))
      )
        valid = false;
    }
    if (
      isNodeOfType(node, "Property") ||
      isNodeOfType(node, "MethodDefinition") ||
      isNodeOfType(node, "PropertyDefinition")
    ) {
      const name = getMatcherMemberName(node);
      if (name && isNodeOfType(node.parent, "ObjectPattern")) {
        const references = memberReferencesByName.get(name) ?? [];
        references.push(node);
        memberReferencesByName.set(name, references);
      }
      if (name && MATCHER_PROVIDER_KEYS.has(name)) valid = false;
      if (
        isNodeOfType(node.parent, "ObjectPattern") &&
        (!name || name === "constructor" || MATCHER_PROTOCOL_KEYS.has(name))
      )
        valid = false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      (MATCHER_FORBIDDEN_GLOBALS.has(node.name) ||
        node.name === "Object" ||
        node.name === "window" ||
        reactImportNames.has(node.name)) &&
      !isMatcherNonReferenceIdentifier(node, context.scopes)
    ) {
      const symbol = context.scopes.symbolFor(node);
      if (
        !context.scopes.referenceFor(node) ||
        (MATCHER_FORBIDDEN_GLOBALS.has(node.name) &&
          symbol &&
          isErasedTypeScriptBinding(symbol) &&
          !hasRuntimeValueBinding(symbol))
      ) {
        valid = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || !context.scopes.referenceFor(node)) return;
    const symbol = context.scopes.symbolFor(node);
    if (symbol?.kind === "import") {
      const declaration = getValueImportDeclaration(symbol);
      if (isNodeOfType(declaration, "ImportDeclaration") && declaration.source.value === "react") {
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        let readonlyImport = readonlyImports.get(symbol);
        if (readonlyImport === undefined) {
          readonlyImport = symbol.references.every((reference) => reference.flag === "read");
          readonlyImports.set(symbol, readonlyImport);
        }
        if (!readonlyImport || isWithinAssignmentTarget(node)) valid = false;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === root &&
          isWithinAssignmentTarget(parent)
        )
          valid = false;
      }
    }
    if (!isNativeMatcherGlobalReference(node, context.scopes)) return;
    if (MATCHER_FORBIDDEN_GLOBALS.has(node.name)) {
      valid = false;
      return;
    }
    if (node.name !== "Object" && node.name !== "window") return;
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (
      node.name === "window" &&
      isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "typeof"
    )
      return;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== root ||
      parent.computed ||
      isWithinAssignmentTarget(parent)
    ) {
      valid = false;
      return;
    }
    const name = getMatcherMemberName(parent);
    if (node.name === "Object" && name !== "keys" && name !== "values") valid = false;
    if (node.name === "window" && name !== "matchMedia") valid = false;
    const consumer = findTransparentExpressionRoot(parent).parent;
    if (
      !(isNodeOfType(consumer, "CallExpression") && consumer.callee === parent) &&
      !(
        node.name === "window" &&
        isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "typeof"
      )
    )
      valid = false;
  });
  matcherProvidersByAnalysis.set(context.scopes, valid);
  matcherMemberWritesByAnalysis.set(context.scopes, writesByName);
  matcherMemberReferencesByAnalysis.set(context.scopes, memberReferencesByName);
  return valid;
};

const hasReactSuperclass = (input: StableMatcherCollectionInput): boolean => {
  const classNode = input.classBody.parent;
  if (!isNodeOfType(classNode, "ClassExpression") && !isNodeOfType(classNode, "ClassDeclaration"))
    return false;
  const superclass = unwrapMatcherExpression(classNode.superClass);
  if (
    !isNodeOfType(superclass, "MemberExpression") ||
    superclass.computed ||
    !["Component", "PureComponent"].includes(getMatcherMemberName(superclass) ?? "")
  )
    return false;
  const receiver = unwrapMatcherExpression(superclass.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = input.context.scopes.symbolFor(receiver);
  const declaration = symbol ? getValueImportDeclaration(symbol) : null;
  return Boolean(
    symbol &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.source.value === "react" &&
    (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const hasUniqueOwnMembers = (input: StableMatcherCollectionInput): boolean => {
  const names = new Set<string>();
  for (const member of input.classBody.body) {
    if (
      (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) ||
      member.static ||
      member.computed ||
      member.decorators?.length
    )
      return false;
    const name = getMatcherMemberName(member);
    if (!name || names.has(name) || ["state", "props", "setState", "__proto__"].includes(name))
      return false;
    if (
      isNodeOfType(member, "MethodDefinition") &&
      (member.kind === "get" || member.kind === "set")
    )
      return false;
    names.add(name);
  }
  return true;
};

const collectRecordProjection = (
  functionNode: EsTreeNode,
  factory: boolean,
  proof: MatcherCollectionProof,
): boolean => {
  const [input, extraParameter] = isNodeOfType(functionNode, "ArrowFunctionExpression")
    ? functionNode.params
    : [];
  if (
    extraParameter ||
    !isNodeOfType(input, "Identifier") ||
    !hasPlainParameters(functionNode, [input])
  )
    return false;
  const reduction = getMatcherMethodCall(getMatcherArrowReturnedExpression(functionNode), "reduce");
  const keys =
    reduction &&
    getNativeMatcherMethodCall(reduction.callee.object, "Object", "keys", proof.context);
  if (!reduction || !keys) return false;
  const [keyInput, extraKeyInput] = keys.call.arguments;
  const [callback, initial, extraArgument] = reduction.call.arguments;
  if (
    extraKeyInput ||
    !allowSymbolUse(keyInput, input, proof) ||
    !isNodeOfType(initial, "ObjectExpression") ||
    initial.properties.length ||
    extraArgument ||
    !isNodeOfType(callback, "ArrowFunctionExpression")
  )
    return false;
  const [accumulator, key, extraCallbackParameter] = callback.params;
  if (
    extraCallbackParameter ||
    !isNodeOfType(accumulator, "Identifier") ||
    !isNodeOfType(key, "Identifier") ||
    !hasPlainParameters(callback, [accumulator, key])
  )
    return false;
  const result = getMatcherArrowReturnedExpression(callback);
  if (!isNodeOfType(result, "ObjectExpression")) return false;
  const [spread, entry, extraEntry] = result.properties;
  if (
    extraEntry ||
    !isNodeOfType(spread, "SpreadElement") ||
    !allowSymbolUse(spread.argument, accumulator, proof) ||
    !isNodeOfType(entry, "Property") ||
    !entry.computed ||
    entry.method ||
    entry.kind !== "init" ||
    !allowSymbolUse(entry.key, key, proof)
  )
    return false;
  let indexedValue = unwrapMatcherExpression(entry.value);
  if (factory) {
    const native = getNativeMatcherMethodCall(indexedValue, "window", "matchMedia", proof.context);
    if (!native) return false;
    const [query, extraQuery] = native.call.arguments;
    if (extraQuery) return false;
    indexedValue = unwrapMatcherExpression(query);
    proof.allowedCalls.add(native.call);
  } else {
    if (
      !isNodeOfType(indexedValue, "MemberExpression") ||
      indexedValue.computed ||
      indexedValue.optional ||
      getMatcherMemberName(indexedValue) !== "matches"
    )
      return false;
    indexedValue = unwrapMatcherExpression(indexedValue.object);
  }
  if (
    !isNodeOfType(indexedValue, "MemberExpression") ||
    !indexedValue.computed ||
    indexedValue.optional ||
    !allowSymbolUse(indexedValue.object, input, proof) ||
    !allowSymbolUse(indexedValue.property, key, proof)
  )
    return false;
  proof.allowedCalls.add(keys.call);
  proof.allowedCalls.add(reduction.call);
  return true;
};

const collectMatcherIteration = (
  functionNode: EsTreeNode | null,
  removal: boolean,
  proof: MatcherCollectionProof,
): MatcherIteration | null => {
  if (
    !isNodeOfType(functionNode, "FunctionExpression") ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length ||
    !isNodeOfType(functionNode.body, "BlockStatement")
  )
    return null;
  const [condition, extraStatement] = functionNode.body.body;
  if (
    extraStatement ||
    !isNodeOfType(condition, "IfStatement") ||
    condition.alternate ||
    !isSelectedMatcherStateRecord(condition.test, proof.fieldName) ||
    !isNodeOfType(condition.consequent, "BlockStatement")
  )
    return null;
  const recordGuard = unwrapMatcherExpression(condition.test);
  if (!recordGuard) return null;
  proof.allowedRecordReads.add(recordGuard);
  const [declaration, iterationStatement, extraConsequent] = condition.consequent.body;
  if (
    extraConsequent ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !isNodeOfType(iterationStatement, "ExpressionStatement")
  )
    return null;
  const [binding, extraBinding] = declaration.declarations;
  if (
    extraBinding ||
    !binding ||
    !isNodeOfType(binding.id, "ObjectPattern") ||
    !isNodeOfType(unwrapMatcherExpression(binding.init), "ThisExpression")
  )
    return null;
  const [property, extraProperty] = binding.id.properties;
  if (
    extraProperty ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    !isNodeOfType(property.value, "Identifier")
  )
    return null;
  const handlerName = getMatcherMemberName(property);
  if (!handlerName) return null;
  const iteration = getMatcherMethodCall(iterationStatement.expression, "forEach");
  const values =
    iteration &&
    getNativeMatcherMethodCall(iteration.callee.object, "Object", "values", proof.context);
  if (!iteration || !values) return null;
  const [record, extraRecord] = values.call.arguments;
  const [callback, extraCallback] = iteration.call.arguments;
  if (
    extraRecord ||
    !isSelectedMatcherStateRecord(record, proof.fieldName) ||
    extraCallback ||
    !isNodeOfType(callback, "ArrowFunctionExpression")
  )
    return null;
  const [matcher, extraMatcher] = callback.params;
  if (
    extraMatcher ||
    !isNodeOfType(matcher, "Identifier") ||
    !hasPlainParameters(callback, [matcher])
  )
    return null;
  let callbackExpression: EsTreeNode | null = unwrapMatcherExpression(callback.body);
  if (isNodeOfType(callbackExpression, "BlockStatement")) {
    const [statement, extraCallbackStatement] = callbackExpression.body;
    if (extraCallbackStatement || !isNodeOfType(statement, "ExpressionStatement")) return null;
    callbackExpression = unwrapMatcherExpression(statement.expression);
  }
  const operation = getMatcherMethodCall(
    callbackExpression,
    removal ? "removeListener" : "addListener",
  );
  if (!operation || !allowSymbolUse(operation.callee.object, matcher, proof)) return null;
  const [handler, extraHandler] = operation.call.arguments;
  if (
    extraHandler ||
    !allowSymbolUse(handler, property.value, proof) ||
    !isNodeReachableWithinFunction(operation.call, proof.context) ||
    !doNodesCoverEveryPathFromFunctionEntry(callback, [operation.call], proof.context)
  )
    return null;
  const recordExpression = unwrapMatcherExpression(record);
  const thisExpression = unwrapMatcherExpression(binding.init);
  if (!recordExpression || !thisExpression) return null;
  proof.allowedRecordReads.add(recordExpression);
  proof.allowedThisDestructures.add(thisExpression);
  proof.allowedCalls.add(values.call);
  proof.allowedCalls.add(iteration.call);
  proof.allowedCalls.add(operation.call);
  return { registration: operation.call, handlerName };
};

const collectReadonlyReaderCall = (
  expression: EsTreeNode,
  proof: MatcherCollectionProof,
  constructorBinding?: EsTreeNode,
): boolean => {
  const call = unwrapMatcherExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = unwrapMatcherExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(unwrapMatcherExpression(callee.object), "ThisExpression") ||
    callee.computed ||
    callee.optional
  )
    return false;
  const name = getMatcherMemberName(callee);
  const reader = name ? proof.resolveMember(name) : null;
  const [record, extraRecord] = call.arguments;
  if (!reader || !record || extraRecord || !collectRecordProjection(reader, false, proof))
    return false;
  if (constructorBinding) {
    if (!allowSymbolUse(record, constructorBinding, proof)) return false;
  } else {
    if (!isSelectedMatcherStateRecord(record, proof.fieldName)) return false;
    const recordExpression = unwrapMatcherExpression(record);
    if (!recordExpression) return false;
    proof.allowedRecordReads.add(recordExpression);
  }
  proof.allowedCalls.add(call);
  return true;
};

const collectStateUpdate = (
  call: EsTreeNode,
  proof: MatcherCollectionProof,
  projectedBinding?: EsTreeNode,
): boolean => {
  const update = getMatcherMethodCall(call, "setState");
  if (!update || !isNodeOfType(unwrapMatcherExpression(update.callee.object), "ThisExpression"))
    return false;
  const [payload, extraPayload] = update.call.arguments;
  if (extraPayload || !isNodeOfType(payload, "ObjectExpression")) return false;
  for (const property of payload.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const name = getMatcherMemberName(property);
    if (!name || name === proof.fieldName || name === "__proto__") return false;
    if (
      !isMatcherStateLiteralData(property.value) &&
      !(projectedBinding && allowSymbolUse(property.value, projectedBinding, proof))
    )
      return false;
  }
  proof.allowedCalls.add(update.call);
  return true;
};

const collectStableHandler = (handlerName: string, proof: MatcherCollectionProof): boolean => {
  const handler = proof.resolveMember(handlerName);
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length ||
    !isNodeOfType(handler.body, "BlockStatement")
  )
    return false;
  const statements = [...handler.body.body];
  let projectedBinding: EsTreeNode | undefined;
  const first = statements.shift();
  if (isNodeOfType(first, "VariableDeclaration") && first.kind === "const") {
    const [binding, extraBinding] = first.declarations;
    if (
      extraBinding ||
      !binding ||
      !isNodeOfType(binding.id, "Identifier") ||
      !binding.init ||
      !collectReadonlyReaderCall(binding.init, proof)
    )
      return false;
    projectedBinding = binding.id;
  } else if (first) statements.unshift(first);
  const update = statements.shift();
  return (
    !statements.length &&
    isNodeOfType(update, "ExpressionStatement") &&
    collectStateUpdate(update.expression, proof, projectedBinding)
  );
};

const collectSupportCheck = (expression: EsTreeNode, proof: MatcherCollectionProof): boolean => {
  const call = unwrapMatcherExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length || call.optional) return false;
  const callee = unwrapMatcherExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(unwrapMatcherExpression(callee.object), "ThisExpression")
  )
    return false;
  const name = getMatcherMemberName(callee);
  const helper = name ? proof.resolveMember(name) : null;
  if (!isNodeOfType(helper, "ArrowFunctionExpression") || helper.params.length) return false;
  const returned = getMatcherArrowReturnedExpression(helper);
  if (!isNodeOfType(returned, "LogicalExpression") || returned.operator !== "&&") return false;
  const checks = [returned.left, returned.right];
  for (const [checkIndex, check] of checks.entries()) {
    if (
      !isNodeOfType(check, "BinaryExpression") ||
      check.operator !== "!==" ||
      !isNodeOfType(check.right, "Literal") ||
      check.right.value !== "undefined" ||
      !isNodeOfType(check.left, "UnaryExpression") ||
      check.left.operator !== "typeof"
    )
      return false;
    const target = unwrapMatcherExpression(check.left.argument);
    if (!checkIndex) {
      if (
        !isNodeOfType(target, "Identifier") ||
        target.name !== "window" ||
        !isNativeMatcherGlobalReference(target, proof.context.scopes)
      )
        return false;
    } else {
      if (
        !isNodeOfType(target, "MemberExpression") ||
        target.computed ||
        getMatcherMemberName(target) !== "matchMedia" ||
        !isNativeMatcherNamespaceReference(target.object, "window", proof.context, "matchMedia")
      )
        return false;
    }
  }
  proof.allowedCalls.add(call);
  return true;
};

const collectConstructorOrigin = (
  constructorNode: EsTreeNode,
  selectedValue: EsTreeNode,
  assignment: EsTreeNode,
  proof: MatcherCollectionProof,
): boolean => {
  let factoryCall = unwrapMatcherExpression(selectedValue);
  let localBinding: EsTreeNode | undefined;
  if (isNodeOfType(factoryCall, "Identifier")) {
    const symbol = proof.context.scopes.symbolFor(factoryCall);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "let" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "Identifier") ||
      findEnclosingFunction(declaration) !== constructorNode ||
      !isNodeOfType(declaration.init, "Identifier") ||
      declaration.init.name !== "undefined" ||
      !proof.context.scopes.isGlobalReference(declaration.init)
    )
      return false;
    localBinding = declaration.id;
    if (!allowSymbolUse(factoryCall, localBinding, proof)) return false;
    const writes = symbol.references.filter((reference) => reference.flag !== "read");
    const [write, extraWrite] = writes;
    const writeParent = write?.identifier.parent;
    if (
      extraWrite ||
      !write ||
      !isNodeOfType(writeParent, "AssignmentExpression") ||
      writeParent.operator !== "=" ||
      writeParent.left !== write.identifier ||
      !isNodeOfType(writeParent.parent, "ExpressionStatement")
    )
      return false;
    const branch = writeParent.parent.parent;
    const condition = branch?.parent;
    if (
      !isNodeOfType(branch, "BlockStatement") ||
      !isNodeOfType(condition, "IfStatement") ||
      condition.consequent !== branch ||
      !isNodeOfType(constructorNode, "FunctionExpression") ||
      !isNodeOfType(constructorNode.body, "BlockStatement") ||
      condition.parent !== constructorNode.body ||
      branch.body.at(FIRST_ARGUMENT_INDEX) !== writeParent.parent ||
      condition.range[SECOND_ARGUMENT_INDEX] > assignment.range[FIRST_ARGUMENT_INDEX] ||
      !collectSupportCheck(condition.test, proof)
    )
      return false;
    proof.symbolUses.get(symbol)?.add(write.identifier);
    factoryCall = unwrapMatcherExpression(writeParent.right);
    for (const reference of symbol.references) {
      if (
        proof.symbolUses.get(symbol)?.has(reference.identifier) ||
        ownShorthandKey(reference.identifier, symbol) ||
        recordedShorthandKey(reference.identifier, symbol, proof)
      )
        continue;
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (
        !isNodeOfType(parent, "CallExpression") ||
        !collectReadonlyReaderCall(parent, proof, localBinding)
      )
        return false;
    }
  }
  if (
    !isNodeOfType(factoryCall, "CallExpression") ||
    factoryCall.optional ||
    findEnclosingFunction(factoryCall) !== constructorNode
  )
    return false;
  const callee = unwrapMatcherExpression(factoryCall.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(unwrapMatcherExpression(callee.object), "ThisExpression")
  )
    return false;
  const name = getMatcherMemberName(callee);
  const factory = name ? proof.resolveMember(name) : null;
  const [query, extraQuery] = factoryCall.arguments;
  if (!factory || !query || extraQuery || !collectRecordProjection(factory, true, proof))
    return false;
  const input = unwrapMatcherExpression(query);
  const [constructorParameter, extraParameter] = isNodeOfType(constructorNode, "FunctionExpression")
    ? constructorNode.params
    : [];
  if (
    extraParameter ||
    !isNodeOfType(constructorParameter, "Identifier") ||
    !isNodeOfType(input, "MemberExpression") ||
    input.computed ||
    input.optional ||
    !isNodeOfType(unwrapMatcherExpression(input.object), "Identifier") ||
    proof.context.scopes.symbolFor(input.object) !==
      proof.context.scopes.symbolFor(constructorParameter) ||
    !getMatcherMemberName(input)
  )
    return false;
  proof.allowedCalls.add(factoryCall);
  return true;
};

const classReferencesAreClosed = (
  stateAssignment: EsTreeNode,
  proof: MatcherCollectionProof,
): boolean => {
  let valid = true;
  const selectedNames = new Set(["state", proof.fieldName]);
  const ownMemberFunctions = new Set<EsTreeNode>();
  for (const member of proof.classBody.body) {
    const name = getMatcherMemberName(member);
    if (name) selectedNames.add(name);
    if (
      (isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
      member.value
    ) {
      ownMemberFunctions.add(member.value);
    }
  }
  const moduleWrites = matcherMemberWritesByAnalysis.get(proof.context.scopes);
  for (const name of selectedNames) {
    if (
      moduleWrites
        ?.get(name)
        ?.some(
          (target) =>
            !isNodeOfType(stateAssignment, "AssignmentExpression") ||
            target !== stateAssignment.left,
        )
    )
      return false;
  }
  const moduleReferences = matcherMemberReferencesByAnalysis.get(proof.context.scopes);
  for (const name of new Set(["state", "setState", proof.fieldName])) {
    for (const reference of moduleReferences?.get(name) ?? []) {
      if (
        !isNodeOfType(reference, "MemberExpression") ||
        findEnclosingClass(reference) !== proof.classBody.parent
      )
        return false;
      if (name === "setState") {
        const root = findTransparentExpressionRoot(reference);
        const call = root.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          !proof.allowedCalls.has(call)
        )
          return false;
      } else if (name === "state") {
        if (!isDirectMatcherThisMember(reference, "state")) return false;
      } else if (!isSelectedMatcherStateRecord(reference, proof.fieldName)) return false;
    }
  }
  walkAst(proof.classBody, (node) => {
    if (!valid) return false;
    if (MATCHER_UNSUPPORTED_RUNTIME_NODE_TYPES.has(node.type)) {
      valid = false;
      return false;
    }
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    ) {
      return false;
    }
    if (isNodeOfType(node, "ThisExpression")) {
      if (findEnclosingClass(node) !== proof.classBody.parent) {
        valid = false;
        return;
      }
      if (proof.allowedThisDestructures.has(node)) return;
      const parent = node.parent;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        parent.computed ||
        parent.optional
      ) {
        valid = false;
        return;
      }
      const owner = findEnclosingFunction(node);
      if (!owner || !ownMemberFunctions.has(owner)) {
        valid = false;
        return;
      }
      const name = getMatcherMemberName(parent);
      if (name === "state" || name === "props") {
        const root = findTransparentExpressionRoot(parent);
        const consumer = root.parent;
        if (name === "state" && consumer === stateAssignment) return;
        if (
          !isNodeOfType(consumer, "MemberExpression") ||
          consumer.object !== root ||
          consumer.computed ||
          consumer.optional ||
          isWithinAssignmentTarget(consumer)
        )
          valid = false;
      } else {
        const root = findTransparentExpressionRoot(parent);
        const consumer = root.parent;
        if (
          !isNodeOfType(consumer, "CallExpression") ||
          consumer.callee !== root ||
          !proof.allowedCalls.has(consumer)
        )
          valid = false;
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      isSelectedMatcherStateRecord(node, proof.fieldName)
    ) {
      const root = findTransparentExpressionRoot(node);
      const consumer = root.parent;
      const booleanTest =
        (isNodeOfType(consumer, "IfStatement") && consumer.test === root) ||
        (isNodeOfType(consumer, "UnaryExpression") &&
          consumer.operator === "!" &&
          isNodeOfType(consumer.parent, "IfStatement") &&
          consumer.parent.test === consumer);
      if (isWithinAssignmentTarget(node) || (!proof.allowedRecordReads.has(node) && !booleanTest))
        valid = false;
    }
  });
  return valid && referencesAreClosed(proof);
};

export const collectStableMatcherCleanedNativeAcquisitions = (
  input: StableMatcherCollectionInput,
): ReadonlySet<EsTreeNode> => {
  const empty = new Set<EsTreeNode>();
  if (
    !hasReactSuperclass(input) ||
    !hasUniqueOwnMembers(input) ||
    !hasClosedMatcherProviders(input.context)
  )
    return empty;
  const constructorNode = input.resolveMember("constructor");
  if (
    !isNodeOfType(constructorNode, "FunctionExpression") ||
    constructorNode.async ||
    constructorNode.generator ||
    !isNodeOfType(constructorNode.body, "BlockStatement")
  )
    return empty;
  const finalStatement = constructorNode.body.body.at(-1);
  if (
    !isNodeOfType(finalStatement, "ExpressionStatement") ||
    !isNodeOfType(finalStatement.expression, "AssignmentExpression") ||
    finalStatement.expression.operator !== "=" ||
    !isDirectMatcherThisMember(finalStatement.expression.left, "state") ||
    !isNodeOfType(finalStatement.expression.right, "ObjectExpression")
  )
    return empty;
  const stateAssignment = finalStatement.expression;
  const stateObject = stateAssignment.right;
  if (!isNodeOfType(stateObject, "ObjectExpression")) return empty;
  const stateKeys = new Set<string>();
  for (const property of stateObject.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    )
      return empty;
    const name = getMatcherMemberName(property);
    if (!name || name === "__proto__" || stateKeys.has(name)) return empty;
    stateKeys.add(name);
  }
  for (const property of stateObject.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const fieldName = getMatcherMemberName(property);
    if (!fieldName || fieldName === "__proto__") continue;
    const proof: MatcherCollectionProof = {
      ...input,
      fieldName,
      allowedCalls: new Set(),
      allowedRecordReads: new Set(),
      allowedThisDestructures: new Set(),
      symbolUses: new Map(),
    };
    const mount = collectMatcherIteration(input.resolveMember("componentDidMount"), false, proof);
    const unmount = collectMatcherIteration(
      input.resolveMember("componentWillUnmount"),
      true,
      proof,
    );
    if (
      !mount ||
      !unmount ||
      mount.handlerName !== unmount.handlerName ||
      !collectConstructorOrigin(constructorNode, property.value, stateAssignment, proof) ||
      !collectStableHandler(mount.handlerName, proof) ||
      !classReferencesAreClosed(stateAssignment, proof)
    )
      continue;
    return new Set([mount.registration]);
  }
  return empty;
};
