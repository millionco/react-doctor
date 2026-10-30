import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  NATIVE_FOCUS_CALLBACK_ARGUMENT_COUNT,
  NATIVE_FOCUS_CALLBACK_DEPENDENCIES_INDEX,
  NATIVE_FOCUS_LOOKUP_ARGUMENT_COUNT,
  NATIVE_FOCUS_LOOKUP_DECLARATOR_COUNT,
  NATIVE_FOCUS_SINGLE_STATEMENT_COUNT,
  NATIVE_FOCUS_LOOKUP_STATEMENT_COUNT,
  NATIVE_FOCUS_MAX_PARAMETER_COUNT,
  NATIVE_FOCUS_DOM_CONSTRUCTOR_PATTERN,
  NATIVE_FOCUS_MUTATED_MEMBER_NAMES,
  NATIVE_FOCUS_REFUSED_GLOBAL_NAMES,
  NATIVE_FOCUS_REFUSED_MEMBER_NAMES,
} from "./constants.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getImportedName } from "./get-imported-name.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isNullishExpression } from "./is-nullish-expression.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isReadonlyReactNamespaceJsxReference } from "./is-readonly-react-namespace-jsx-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

// `.click()` is excluded because forwarding activation to a hidden control
// leaves that action unreachable to keyboard users.
const FOCUS_FORWARDING_METHOD_NAMES: ReadonlySet<string> = new Set(["focus", "select"]);
const EVENT_BLOCKER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "stopPropagation",
  "preventDefault",
  "stopImmediatePropagation",
]);

const DOM_LOOKUP_METHOD_NAMES: ReadonlySet<string> = new Set(["getElementById", "querySelector"]);
const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set(["global", "globalThis", "window"]);

interface NativeFocusAnalysis {
  readonly scopes: ScopeAnalysis;
  documentIsUnmodified?: boolean;
  reactProviderIsUnmodified?: boolean;
  readonly callbackProviders: Map<SymbolDescriptor, boolean>;
  readonly callbackBindings: Map<SymbolDescriptor, boolean>;
  readonly lookupBindings: Map<SymbolDescriptor, boolean>;
  readonly ambiguousBindingsByScope: WeakMap<ScopeDescriptor, ReadonlySet<string>>;
  readonly handlerFunctions: WeakMap<EsTreeNode, boolean>;
}

const nativeFocusAnalysisByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, NativeFocusAnalysis>
>();

const getNativeFocusAnalysis = (scopes: ScopeAnalysis): NativeFocusAnalysis => {
  const program = scopes.rootScope.node;
  let analysesByProgram = nativeFocusAnalysisByScopes.get(scopes);
  if (!analysesByProgram) {
    analysesByProgram = new WeakMap();
    nativeFocusAnalysisByScopes.set(scopes, analysesByProgram);
  }
  let analysis = analysesByProgram.get(program);
  if (!analysis) {
    const proofScopes: ScopeAnalysis = { ...scopes };
    analysis = {
      scopes: proofScopes,
      callbackProviders: new Map(),
      callbackBindings: new Map(),
      lookupBindings: new Map(),
      ambiguousBindingsByScope: new WeakMap(),
      handlerFunctions: new WeakMap(),
    };
    analysesByProgram.set(program, analysis);
    nativeFocusAnalysisByScopes.set(proofScopes, new WeakMap([[program, analysis]]));
  }
  return analysis;
};

const isNativeFocusDocument = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    (!isNodeOfType(candidate, "MemberExpression") ||
      (!candidate.computed &&
        (!isNodeOfType(candidate.object, "Identifier") || candidate.object.name !== "global"))) &&
    isGlobalDocumentExpression(candidate, scopes)
  );
};

const isNativeFocusLookup = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== NATIVE_FOCUS_LOOKUP_ARGUMENT_COUNT
  )
    return false;
  const [selector] = call.arguments;
  const callee = stripParenExpression(call.callee);
  return (
    isNodeOfType(selector, "Literal") &&
    typeof selector.value === "string" &&
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    DOM_LOOKUP_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
    isNativeFocusDocument(callee.object, scopes)
  );
};

const isNativeFocusLookupFallback = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const fallback = stripParenExpression(expression);
  return (
    isNodeOfType(fallback, "LogicalExpression") &&
    (fallback.operator === "||" || fallback.operator === "??") &&
    [fallback.left, fallback.right].every((lookupExpression) => {
      const lookup = stripParenExpression(lookupExpression);
      if (!isNodeOfType(lookup, "CallExpression") || lookup.optional) return false;
      const method = stripParenExpression(lookup.callee);
      if (!isNodeOfType(method, "MemberExpression") || method.optional) return false;
      const document = stripParenExpression(method.object);
      return (
        isNodeOfType(document, "Identifier") &&
        document.name === "document" &&
        isNativeFocusLookup(lookup, scopes)
      );
    })
  );
};

const isImmediateNativeFocusUse = (expression: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const member = expressionRoot.parent;
  const memberRoot = member && findTransparentExpressionRoot(member);
  const call = memberRoot?.parent;
  return Boolean(
    isNodeOfType(member, "MemberExpression") &&
    member.object === expressionRoot &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === memberRoot &&
    getNativeFocusReceiver(call) === stripParenExpression(expression),
  );
};

const hasClosedNativeFocusLookupResult = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isImmediateNativeFocusUse(expression)) return true;
  let expressionRoot = findTransparentExpressionRoot(expression);
  const fallback = expressionRoot.parent;
  if (
    isNodeOfType(fallback, "LogicalExpression") &&
    (fallback.left === expressionRoot || fallback.right === expressionRoot) &&
    isNativeFocusLookupFallback(fallback, scopes)
  )
    expressionRoot = findTransparentExpressionRoot(fallback);
  const declaration = expressionRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== expressionRoot ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declaration.parent.declarations.length !== NATIVE_FOCUS_LOOKUP_DECLARATOR_COUNT
  )
    return false;
  const symbol = scopes.symbolFor(declaration.id);
  if (!symbol) return false;
  const analysis = getNativeFocusAnalysis(scopes);
  const cached = analysis.lookupBindings.get(symbol);
  if (cached !== undefined) return cached;
  const allowedIdentifiers = new Set(
    symbol.references
      .filter((reference) => isImmediateNativeFocusUse(reference.identifier))
      .map((reference) => reference.identifier),
  );
  const isClosed =
    !hasSymbolBindingWrites(symbol) &&
    hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers,
      program: scopes.rootScope.node,
      scopes,
    });
  analysis.lookupBindings.set(symbol, isClosed);
  return isClosed;
};

const hasUnmodifiedNativeFocusDocument = (scopes: ScopeAnalysis): boolean => {
  const analysis = getNativeFocusAnalysis(scopes);
  if (analysis.documentIsUnmodified !== undefined) return analysis.documentIsUnmodified;
  let isUnmodified = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isUnmodified) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      if (
        NATIVE_FOCUS_REFUSED_MEMBER_NAMES.has(propertyName ?? "") ||
        (isMemberMutationTarget(node) &&
          (propertyName === null || NATIVE_FOCUS_MUTATED_MEMBER_NAMES.has(propertyName)))
      ) {
        isUnmodified = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSImportEqualsDeclaration")
    ) {
      isUnmodified = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (!scopes.isGlobalReference(node)) return;
    if (
      NATIVE_FOCUS_REFUSED_GLOBAL_NAMES.has(node.name) ||
      NATIVE_FOCUS_DOM_CONSTRUCTOR_PATTERN.test(node.name)
    ) {
      isUnmodified = false;
      return;
    }
    if (node.name !== "document" && !GLOBAL_OBJECT_NAMES.has(node.name)) return;
    let documentRoot = findTransparentExpressionRoot(node);
    if (node.name !== "document") {
      const member = documentRoot.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== documentRoot ||
        member.computed ||
        getStaticPropertyName(member) !== "document"
      ) {
        isUnmodified = false;
        return;
      }
      documentRoot = findTransparentExpressionRoot(member);
    }
    const method = documentRoot.parent;
    const methodRoot = method && findTransparentExpressionRoot(method);
    const call = methodRoot?.parent;
    if (
      !isNodeOfType(method, "MemberExpression") ||
      method.object !== documentRoot ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== methodRoot ||
      !isNativeFocusLookup(call, scopes) ||
      !hasClosedNativeFocusLookupResult(call, scopes)
    )
      isUnmodified = false;
  });
  analysis.documentIsUnmodified = isUnmodified;
  return isUnmodified;
};

const hasReadonlyNativeFocusNamespace = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  getEquivalentSymbols(symbol.bindingIdentifier, scopes).every((alias) => {
    const allowedIdentifiers = new Set<EsTreeNode>();
    for (const reference of alias.references) {
      const identifier = reference.identifier;
      if (isReadonlyReactNamespaceJsxReference(identifier, scopes)) {
        allowedIdentifiers.add(identifier);
        continue;
      }
      const referenceRoot = findTransparentExpressionRoot(identifier);
      const parent = referenceRoot.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const"
      ) {
        allowedIdentifiers.add(identifier);
        continue;
      }
      const memberRoot = parent && findTransparentExpressionRoot(parent);
      const call = memberRoot?.parent;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === referenceRoot &&
        !parent.computed &&
        getStaticPropertyName(parent) === "useCallback" &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === memberRoot &&
        !call.optional
      )
        allowedIdentifiers.add(identifier);
    }
    return hasOnlyAllowedSymbolReads({
      symbol: alias,
      allowedIdentifiers,
      program: scopes.rootScope.node,
      scopes,
    });
  });

const hasUnmodifiedNativeFocusReactProvider = (scopes: ScopeAnalysis): boolean => {
  const analysis = getNativeFocusAnalysis(scopes);
  if (analysis.reactProviderIsUnmodified !== undefined) return analysis.reactProviderIsUnmodified;
  analysis.reactProviderIsUnmodified =
    !hasReactDefaultProviderMutation("useCallback", scopes) &&
    scopes.rootScope.symbols.every((symbol) => {
      if (getValueImportSource(symbol) !== "react") return true;
      if (
        !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
        !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
        getImportedName(symbol.declarationNode) !== "default"
      )
        return true;
      return hasReadonlyNativeFocusNamespace(symbol, scopes);
    });
  return analysis.reactProviderIsUnmodified;
};

const isNativeFocusCallbackCall = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== NATIVE_FOCUS_CALLBACK_ARGUMENT_COUNT ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  const dependencies = stripParenExpression(
    call.arguments[NATIVE_FOCUS_CALLBACK_DEPENDENCIES_INDEX],
  );
  if (
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.some((element) => isNodeOfType(element, "SpreadElement"))
  )
    return false;
  const callee = stripParenExpression(call.callee);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    (callee.computed || callee.optional || getStaticPropertyName(callee) !== "useCallback")
  )
    return false;
  const identifier = getRootIdentifier(callee);
  const symbol = identifier && scopes.symbolFor(identifier);
  if (
    !symbol ||
    getValueImportSource(symbol) !== "react" ||
    (isNodeOfType(callee, "Identifier") &&
      getImportedName(symbol.declarationNode) !== "useCallback")
  )
    return false;
  const analysis = getNativeFocusAnalysis(scopes);
  const cached = analysis.callbackProviders.get(symbol);
  if (cached !== undefined) return cached;
  const allowedIdentifiers = new Set(
    symbol.references
      .filter((reference) => {
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        return (
          isNodeOfType(referenceRoot.parent, "CallExpression") &&
          referenceRoot.parent.callee === referenceRoot
        );
      })
      .map((reference) => reference.identifier),
  );
  const isUnmodified =
    hasUnmodifiedNativeFocusReactProvider(scopes) &&
    isProvenUnmodifiedReactApiCall(call, "useCallback", scopes) &&
    (isNodeOfType(callee, "MemberExpression") ||
      hasOnlyAllowedSymbolReads({
        symbol,
        allowedIdentifiers,
        program: scopes.rootScope.node,
        scopes,
      }));
  analysis.callbackProviders.set(symbol, isUnmodified);
  return isUnmodified;
};

const isNativeFocusHandlerReference = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let referenceRoot = findTransparentExpressionRoot(identifier);
  const parent = referenceRoot.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === referenceRoot &&
    isNodeOfType(parent.id, "Identifier") &&
    isNodeOfType(parent.parent, "VariableDeclaration") &&
    parent.parent.kind === "const"
  )
    return true;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === referenceRoot &&
    isNativeFocusCallbackCall(parent, scopes)
  )
    return true;
  while (
    isNodeOfType(referenceRoot.parent, "ConditionalExpression") &&
    (referenceRoot.parent.consequent === referenceRoot ||
      referenceRoot.parent.alternate === referenceRoot)
  )
    referenceRoot = findTransparentExpressionRoot(referenceRoot.parent);
  const container = referenceRoot.parent;
  const attribute = container?.parent;
  return (
    isNodeOfType(container, "JSXExpressionContainer") &&
    container.expression === referenceRoot &&
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    (attribute.name.name === "onClick" || attribute.name.name === "onClickCapture")
  );
};

const hasReadonlyNativeFocusHandlerBinding = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const analysis = getNativeFocusAnalysis(scopes);
  const cached = analysis.callbackBindings.get(symbol);
  if (cached !== undefined) return cached;
  const aliases = getEquivalentSymbols(symbol.bindingIdentifier, scopes);
  const isReadonly = aliases.every((alias) => {
    if (hasSymbolBindingWrites(alias) || (alias.kind !== "const" && alias.kind !== "function"))
      return false;
    let ambiguousNames = analysis.ambiguousBindingsByScope.get(alias.scope);
    if (!ambiguousNames) {
      const declaredNames = new Set<string>();
      const repeatedNames = new Set<string>();
      for (const declaration of alias.scope.symbols) {
        if (declaredNames.has(declaration.name)) repeatedNames.add(declaration.name);
        declaredNames.add(declaration.name);
      }
      ambiguousNames = repeatedNames;
      analysis.ambiguousBindingsByScope.set(alias.scope, ambiguousNames);
    }
    if (ambiguousNames.has(alias.name)) return false;
    const allowedIdentifiers = new Set(
      alias.references
        .filter((reference) => isNativeFocusHandlerReference(reference.identifier, scopes))
        .map((reference) => reference.identifier),
    );
    return hasOnlyAllowedSymbolReads({
      symbol: alias,
      allowedIdentifiers,
      program: scopes.rootScope.node,
      scopes,
    });
  });
  for (const alias of aliases) analysis.callbackBindings.set(alias, isReadonly);
  return isReadonly;
};

const getNativeFocusReceiver = (expression: EsTreeNode): EsTreeNode | null => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 0) return null;
  const callee = stripParenExpression(call.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    getStaticPropertyName(callee) === "focus"
    ? stripParenExpression(callee.object)
    : null;
};

const hasOnlyNativeFocusStatements = (statements: EsTreeNode[], scopes: ScopeAnalysis): boolean => {
  const [lookupStatement, focusStatement] = statements;
  if (!lookupStatement) return false;
  if (statements.length === NATIVE_FOCUS_SINGLE_STATEMENT_COUNT) {
    if (!isNodeOfType(lookupStatement, "ExpressionStatement")) return false;
    const receiver = getNativeFocusReceiver(lookupStatement.expression);
    return Boolean(receiver && isNativeFocusLookup(receiver, scopes));
  }
  if (
    statements.length !== NATIVE_FOCUS_LOOKUP_STATEMENT_COUNT ||
    !isNodeOfType(lookupStatement, "VariableDeclaration") ||
    lookupStatement.kind !== "const" ||
    lookupStatement.declarations.length !== NATIVE_FOCUS_LOOKUP_DECLARATOR_COUNT ||
    !isNodeOfType(focusStatement, "ExpressionStatement")
  )
    return false;
  const [declaration] = lookupStatement.declarations;
  if (
    !declaration?.init ||
    !isNodeOfType(declaration.id, "Identifier") ||
    (!isNativeFocusLookup(declaration.init, scopes) &&
      !isNativeFocusLookupFallback(declaration.init, scopes))
  )
    return false;
  const symbol = scopes.symbolFor(declaration.id);
  const receiver = getNativeFocusReceiver(focusStatement.expression);
  return Boolean(
    symbol &&
    receiver &&
    isNodeOfType(receiver, "Identifier") &&
    scopes.symbolFor(receiver) === symbol &&
    hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers: new Set([receiver]),
      program: scopes.rootScope.node,
      scopes,
    }),
  );
};

const isNativeFocusClosestGuard = (
  expression: EsTreeNode,
  parameter: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== NATIVE_FOCUS_LOOKUP_ARGUMENT_COUNT
  )
    return false;
  const [selector] = call.arguments;
  const method = stripParenExpression(call.callee);
  const target = isNodeOfType(method, "MemberExpression")
    ? stripParenExpression(method.object)
    : null;
  if (
    !isNodeOfType(selector, "Literal") ||
    typeof selector.value !== "string" ||
    !isNodeOfType(method, "MemberExpression") ||
    method.computed ||
    getStaticPropertyName(method) !== "closest" ||
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    getStaticPropertyName(target) !== "target"
  )
    return false;
  const event = stripParenExpression(target.object);
  const parameterSymbol = scopes.symbolFor(parameter);
  return Boolean(
    parameterSymbol &&
    isNodeOfType(event, "Identifier") &&
    scopes.symbolFor(event) === parameterSymbol &&
    !hasSymbolBindingWrites(parameterSymbol) &&
    hasOnlyAllowedSymbolReads({
      symbol: parameterSymbol,
      allowedIdentifiers: new Set([event]),
      program: scopes.rootScope.node,
      scopes,
    }),
  );
};

const isNativeFocusSelfClickGuard = (
  expression: EsTreeNode,
  parameter: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  const comparison = stripParenExpression(expression);
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(comparison, "BinaryExpression") ||
    comparison.operator !== "==="
  )
    return false;
  const left = stripParenExpression(comparison.left);
  const right = stripParenExpression(comparison.right);
  if (
    !isNodeOfType(left, "MemberExpression") ||
    !isNodeOfType(right, "MemberExpression") ||
    left.computed ||
    right.computed ||
    left.optional ||
    right.optional ||
    !(
      (getStaticPropertyName(left) === "target" &&
        getStaticPropertyName(right) === "currentTarget") ||
      (getStaticPropertyName(left) === "currentTarget" && getStaticPropertyName(right) === "target")
    )
  )
    return false;
  const leftEvent = stripParenExpression(left.object);
  const rightEvent = stripParenExpression(right.object);
  const parameterSymbol = scopes.symbolFor(parameter);
  return Boolean(
    parameterSymbol &&
    isNodeOfType(leftEvent, "Identifier") &&
    isNodeOfType(rightEvent, "Identifier") &&
    scopes.symbolFor(leftEvent) === parameterSymbol &&
    scopes.symbolFor(rightEvent) === parameterSymbol &&
    !hasSymbolBindingWrites(parameterSymbol) &&
    hasOnlyAllowedSymbolReads({
      symbol: parameterSymbol,
      allowedIdentifiers: new Set([leftEvent, rightEvent]),
      program: scopes.rootScope.node,
      scopes,
    }),
  );
};

const isNativeFocusFunction = (handlerFunction: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const analysis = getNativeFocusAnalysis(scopes);
  const cached = analysis.handlerFunctions.get(handlerFunction);
  if (cached !== undefined) return cached;
  let isNative = false;
  if (
    isFunctionLike(handlerFunction) &&
    !handlerFunction.async &&
    !handlerFunction.generator &&
    handlerFunction.params.length <= NATIVE_FOCUS_MAX_PARAMETER_COUNT &&
    handlerFunction.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  ) {
    const body = stripParenExpression(handlerFunction.body);
    if (!isNodeOfType(body, "BlockStatement")) {
      const receiver = getNativeFocusReceiver(body);
      isNative = Boolean(receiver && isNativeFocusLookup(receiver, scopes));
    } else {
      const [firstStatement, ...remainingStatements] = body.body;
      if (isNodeOfType(firstStatement, "IfStatement") && !firstStatement.alternate) {
        const test = stripParenExpression(firstStatement.test);
        const [parameter] = handlerFunction.params;
        if (
          body.body.length === NATIVE_FOCUS_SINGLE_STATEMENT_COUNT &&
          ((isNodeOfType(test, "UnaryExpression") &&
            test.operator === "!" &&
            isNativeFocusClosestGuard(test.argument, parameter, scopes)) ||
            isNativeFocusSelfClickGuard(test, parameter, scopes))
        ) {
          const consequent = firstStatement.consequent;
          isNative = hasOnlyNativeFocusStatements(
            isNodeOfType(consequent, "BlockStatement") ? consequent.body : [consequent],
            scopes,
          );
        } else if (
          isEmptyReturn(firstStatement.consequent) &&
          isNativeFocusClosestGuard(test, parameter, scopes)
        ) {
          isNative = hasOnlyNativeFocusStatements(remainingStatements, scopes);
        }
      } else {
        isNative = hasOnlyNativeFocusStatements(body.body, scopes);
      }
    }
  }
  const result = isNative && hasUnmodifiedNativeFocusDocument(scopes);
  analysis.handlerFunctions.set(handlerFunction, result);
  return result;
};

const getCalledMethodName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const expression = isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const property = callee.property as EsTreeNode;
  return isNodeOfType(property, "Identifier") ? property.name : null;
};

const isAllowedFocusForwardingCall = (
  node: EsTreeNode | null | undefined,
  shouldAllowEventBlocker: boolean,
): boolean => {
  const methodName = getCalledMethodName(node);
  return (
    methodName !== null &&
    (FOCUS_FORWARDING_METHOD_NAMES.has(methodName) ||
      (shouldAllowEventBlocker && EVENT_BLOCKER_METHOD_NAMES.has(methodName)))
  );
};

const isGlobalDocumentExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    return candidate.name === "document" && scopes.isGlobalReference(candidate);
  }
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !isNodeOfType(candidate.object, "Identifier") ||
    !isNodeOfType(candidate.property, "Identifier") ||
    candidate.property.name !== "document"
  ) {
    return false;
  }
  return (
    GLOBAL_OBJECT_NAMES.has(candidate.object.name) && scopes.isGlobalReference(candidate.object)
  );
};

const isStaticSelectorExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "Literal")) return true;
  return (
    isNodeOfType(candidate, "TemplateLiteral") &&
    candidate.expressions.every((innerExpression) =>
      isStaticSelectorExpression(innerExpression as EsTreeNode),
    )
  );
};

const getDomLookupVariableName = (statement: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== 1
  ) {
    return null;
  }
  const declaration = statement.declarations[0];
  if (!declaration || !isNodeOfType(declaration.id, "Identifier") || !declaration.init) return null;
  const initializer = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== 1 ||
    isNodeOfType(initializer.arguments[0], "SpreadElement") ||
    !isStaticSelectorExpression(initializer.arguments[0] as EsTreeNode)
  ) {
    return null;
  }
  const callee = stripParenExpression(initializer.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(callee.property, "Identifier") ||
    !DOM_LOOKUP_METHOD_NAMES.has(callee.property.name) ||
    !isGlobalDocumentExpression(callee.object as EsTreeNode, scopes)
  ) {
    return null;
  }
  return declaration.id.name;
};

const isEmptyReturn = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return node.argument === null;
  if (!isNodeOfType(node, "BlockStatement") || node.body.length !== 1) return false;
  return isEmptyReturn(node.body[0] as EsTreeNode);
};

const isEventTargetClosestReturnGuard = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "IfStatement") || node.alternate || !isEmptyReturn(node.consequent)) {
    return false;
  }
  const test = stripParenExpression(node.test);
  const call = isNodeOfType(test, "ChainExpression") ? test.expression : test;
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 1) return false;
  const callee = stripParenExpression(call.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object as EsTreeNode)
    : null;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "closest" &&
    isNodeOfType(receiver, "MemberExpression") &&
    isNodeOfType(receiver.object, "Identifier") &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "target" &&
    isNodeOfType(call.arguments[0], "Literal") &&
    typeof call.arguments[0].value === "string"
  );
};

const isFocusCallOnVariable = (statement: EsTreeNode, variableName: string): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  if (!isNodeOfType(expression, "CallExpression") || expression.arguments.length !== 0)
    return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === variableName &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "focus"
  );
};

const isAllowedFocusForwardingFunctionBody = (
  body: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  shouldAllowEventBlocker: boolean,
): boolean => {
  if (!body) return false;
  if (isAllowedFocusForwardingCall(body, shouldAllowEventBlocker)) return true;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length === 0) return false;
  const statements = body.body as EsTreeNode[];
  const firstActionIndex = isEventTargetClosestReturnGuard(statements[0] as EsTreeNode) ? 1 : 0;
  const domLookupStatement = statements[firstActionIndex];
  const domLookupVariableName = domLookupStatement
    ? getDomLookupVariableName(domLookupStatement, scopes)
    : null;
  if (domLookupVariableName) {
    return (
      statements.length === firstActionIndex + 2 &&
      isFocusCallOnVariable(statements[firstActionIndex + 1] as EsTreeNode, domLookupVariableName)
    );
  }
  if (firstActionIndex > 0) return false;
  return statements.every(
    (statement) =>
      isNodeOfType(statement, "ExpressionStatement") &&
      isAllowedFocusForwardingCall(statement.expression as EsTreeNode, shouldAllowEventBlocker),
  );
};

const isGlobalNullishExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNullishExpression(expression) &&
  (!isNodeOfType(expression, "Identifier") || scopes.isGlobalReference(expression));

interface ResolvedHandlerFunction {
  handlerFunction: EsTreeNode;
  isConditional: boolean;
  isMemoized: boolean;
  bindings: SymbolDescriptor[];
}

const resolveHandlerFunctionExpression = (
  handlerExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
  bindings: SymbolDescriptor[] = [],
): ResolvedHandlerFunction | null => {
  const expression = stripParenExpression(handlerExpression);
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequent = stripParenExpression(expression.consequent as EsTreeNode);
    const alternate = stripParenExpression(expression.alternate as EsTreeNode);
    let resolvedHandler: ResolvedHandlerFunction | null = null;
    if (isGlobalNullishExpression(consequent, scopes)) {
      resolvedHandler = resolveHandlerFunctionExpression(
        alternate,
        scopes,
        visitedSymbolIds,
        bindings,
      );
    }
    if (isGlobalNullishExpression(alternate, scopes)) {
      resolvedHandler = resolveHandlerFunctionExpression(
        consequent,
        scopes,
        visitedSymbolIds,
        bindings,
      );
    }
    return resolvedHandler ? { ...resolvedHandler, isConditional: true } : null;
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (
      !symbol?.initializer ||
      !["const", "let", "function"].includes(symbol.kind) ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      visitedSymbolIds.has(symbol.id)
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    bindings.push(symbol);
    return resolveHandlerFunctionExpression(symbol.initializer, scopes, visitedSymbolIds, bindings);
  }
  if (isNodeOfType(expression, "CallExpression") && isNativeFocusCallbackCall(expression, scopes)) {
    const [callback] = expression.arguments;
    if (
      !callback ||
      (!isFunctionLike(stripParenExpression(callback)) &&
        !isNodeOfType(stripParenExpression(callback), "Identifier"))
    )
      return null;
    const resolvedHandler = resolveHandlerFunctionExpression(
      callback,
      scopes,
      visitedSymbolIds,
      bindings,
    );
    return resolvedHandler && !resolvedHandler.isConditional && !resolvedHandler.isMemoized
      ? { ...resolvedHandler, isMemoized: true }
      : null;
  }
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration")
  ) {
    return { handlerFunction: expression, isConditional: false, isMemoized: false, bindings };
  }
  return null;
};

export const isFocusForwardingOrBlockingHandlerExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const proofScopes = getNativeFocusAnalysis(scopes).scopes;
  const resolvedHandler = resolveHandlerFunctionExpression(expression, proofScopes);
  if (!resolvedHandler) return false;
  if (resolvedHandler.isMemoized) {
    return (
      resolvedHandler.bindings.every((symbol) =>
        hasReadonlyNativeFocusHandlerBinding(symbol, proofScopes),
      ) && isNativeFocusFunction(resolvedHandler.handlerFunction, proofScopes)
    );
  }
  if (
    isNativeFocusFunction(resolvedHandler.handlerFunction, proofScopes) &&
    resolvedHandler.bindings.every((symbol) =>
      hasReadonlyNativeFocusHandlerBinding(symbol, proofScopes),
    )
  )
    return true;
  return isAllowedFocusForwardingFunctionBody(
    (resolvedHandler.handlerFunction as { body?: EsTreeNode }).body ?? null,
    proofScopes,
    !resolvedHandler.isConditional,
  );
};

export const isFocusForwardingOrBlockingHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  return isFocusForwardingOrBlockingHandlerExpression(
    attribute.value.expression as EsTreeNode,
    scopes,
  );
};
