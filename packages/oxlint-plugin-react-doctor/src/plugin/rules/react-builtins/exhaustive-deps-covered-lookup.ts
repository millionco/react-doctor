import { closureCaptures } from "../../semantic/closure-captures.js";
import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { walkAst } from "../../utils/walk-ast.js";
import { unwrapExpression } from "./exhaustive-deps-low-level.js";

type IsCoveredLookupCall = (call: EsTreeNodeOfType<"CallExpression">) => boolean;

const isPureDerivedExpression = (
  expression: EsTreeNode,
  isCoveredLookupCall?: IsCoveredLookupCall,
): boolean => {
  const candidate = unwrapExpression(expression);
  if (isNodeOfType(candidate, "CallExpression")) return isCoveredLookupCall?.(candidate) === true;
  if (isNodeOfType(candidate, "Literal") || isNodeOfType(candidate, "Identifier")) return true;
  if (isNodeOfType(candidate, "MemberExpression")) {
    return (
      isPureDerivedExpression(candidate.object, isCoveredLookupCall) &&
      (!candidate.computed || isPureDerivedExpression(candidate.property, isCoveredLookupCall))
    );
  }
  if (isNodeOfType(candidate, "BinaryExpression") || isNodeOfType(candidate, "LogicalExpression")) {
    return (
      isPureDerivedExpression(candidate.left, isCoveredLookupCall) &&
      isPureDerivedExpression(candidate.right, isCoveredLookupCall)
    );
  }
  if (isNodeOfType(candidate, "UnaryExpression")) {
    return (
      candidate.operator !== "delete" &&
      isPureDerivedExpression(candidate.argument, isCoveredLookupCall)
    );
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      isPureDerivedExpression(candidate.test, isCoveredLookupCall) &&
      isPureDerivedExpression(candidate.consequent, isCoveredLookupCall) &&
      isPureDerivedExpression(candidate.alternate, isCoveredLookupCall)
    );
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return candidate.expressions.every((nestedExpression) =>
      isPureDerivedExpression(nestedExpression, isCoveredLookupCall),
    );
  }
  return false;
};

const isPureDerivedStatement = (
  statement: EsTreeNode,
  isCoveredLookupCall?: IsCoveredLookupCall,
): boolean => {
  if (isNodeOfType(statement, "BlockStatement")) {
    return statement.body.every((nestedStatement) =>
      isPureDerivedStatement(nestedStatement, isCoveredLookupCall),
    );
  }
  if (isNodeOfType(statement, "ReturnStatement")) {
    return !statement.argument || isPureDerivedExpression(statement.argument, isCoveredLookupCall);
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return (
      isPureDerivedExpression(statement.test, isCoveredLookupCall) &&
      isPureDerivedStatement(statement.consequent, isCoveredLookupCall) &&
      (!statement.alternate || isPureDerivedStatement(statement.alternate, isCoveredLookupCall))
    );
  }
  return false;
};

export const isPureDerivedFunction = (
  functionNode: EsTreeNode,
  isCoveredLookupCall?: IsCoveredLookupCall,
): boolean => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return false;
  }
  if (functionNode.async || functionNode.generator) return false;
  return isNodeOfType(functionNode.body, "BlockStatement")
    ? isPureDerivedStatement(functionNode.body, isCoveredLookupCall)
    : isPureDerivedExpression(functionNode.body, isCoveredLookupCall);
};

export interface CoveredLookupEffect {
  readonly callback: EsTreeNodeOfType<"ArrowFunctionExpression">;
  readonly receiver: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly owner: EsTreeNode;
  readonly statement: EsTreeNode;
}

const isDirectReactHookImportCall = (
  call: EsTreeNode,
  hook: "useEffect" | "useState",
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(call.callee);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  return (
    symbol?.kind === "import" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "react" &&
    getImportedName(specifier) === hook
  );
};

const verifiedRuntimeByScope = new WeakMap<ScopeAnalysis, boolean>();

const isDirectAmbientProvider = (
  node: EsTreeNode,
  names: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "Identifier") && names.has(node.name) && scopes.isGlobalReference(node);

const AMBIENT_RUNTIME_OBJECTS = new Set(["window", "globalThis", "self", "global"]);
const CJS_MODULE_OWNER = new Set(["module"]);

const isReactPath = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === "react";

const hasClosedVisibleLookupRuntime = (scopes: ScopeAnalysis): boolean => {
  const cached = verifiedRuntimeByScope.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed) return false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      isReactPath(node.source) &&
      node.importKind !== "type" &&
      node.specifiers.some(
        (specifier) =>
          !isNodeOfType(specifier, "ImportSpecifier") ||
          (specifier.importKind !== "type" && getImportedName(specifier) === "default"),
      )
    ) {
      closed = false;
      return false;
    }
    if (isNodeOfType(node, "ImportExpression") && isReactPath(node.source)) {
      closed = false;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = unwrapExpression(node.callee);
    const [argument] = node.arguments;
    if (
      (isNodeOfType(callee, "Identifier") &&
        (callee.name === "eval" ||
          (callee.name === "require" &&
            scopes.isGlobalReference(callee) &&
            isReactPath(argument)))) ||
      (isNodeOfType(callee, "MemberExpression") &&
        ((getStaticPropertyName(callee) === "eval" &&
          isDirectAmbientProvider(callee.object, AMBIENT_RUNTIME_OBJECTS, scopes)) ||
          (getStaticPropertyName(callee) === "require" &&
            isDirectAmbientProvider(callee.object, CJS_MODULE_OWNER, scopes) &&
            isReactPath(argument))))
    ) {
      closed = false;
      return false;
    }
  });
  verifiedRuntimeByScope.set(scopes, closed);
  return closed;
};

const isUnchangedBinding = (symbol: SymbolDescriptor): boolean =>
  isSymbolReadOnly(symbol) &&
  symbol.references.every((reference) => !isWithinAssignmentTarget(reference.identifier));

const getStockStateSetter = (
  call: EsTreeNodeOfType<"CallExpression">,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (call.optional || !isNodeOfType(call.callee, "Identifier")) return null;
  const setter = scopes.symbolFor(call.callee);
  const declaration = setter?.declarationNode;
  return setter?.kind === "const" &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ArrayPattern") &&
    declaration.id.elements.length === 2 &&
    declaration.id.elements[1] === setter.bindingIdentifier &&
    declaration.init &&
    findEnclosingFunction(declaration) === owner &&
    isDirectReactHookImportCall(declaration.init, "useState", scopes) &&
    isUnchangedBinding(setter)
    ? setter
    : null;
};

export const getCoveredLookupEffect = (
  call: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  deps: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): CoveredLookupEffect | undefined => {
  const [dependency] = deps.elements;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback !== call.arguments[0] ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1 ||
    deps.elements.length !== 1 ||
    !isNodeOfType(dependency, "Identifier") ||
    !isDirectReactHookImportCall(call, "useEffect", scopes)
  )
    return undefined;
  const statement = call.parent;
  const owner = findEnclosingFunction(call);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.parent !== owner.body
  )
    return undefined;
  const receiver = scopes.symbolFor(dependency);
  const setterStatement = callback.body.body[0];
  if (
    !receiver ||
    (receiver.kind !== "const" && receiver.kind !== "parameter") ||
    findEnclosingFunction(receiver.bindingIdentifier) !== owner ||
    !isUnchangedBinding(receiver) ||
    !isNodeOfType(setterStatement, "ExpressionStatement") ||
    !isNodeOfType(setterStatement.expression, "CallExpression")
  )
    return undefined;
  const setter = getStockStateSetter(setterStatement.expression, owner, scopes);
  return setter ? { callback, receiver, setter, owner, statement } : undefined;
};

const getSingleArrowParameter = (node: EsTreeNode | null | undefined) => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") || node.async || node.params.length !== 1)
    return null;
  const [parameter] = node.params;
  return isNodeOfType(parameter, "Identifier") ? parameter : null;
};

const isDirectLookupInStateUpdater = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  effect: CoveredLookupEffect,
): boolean => {
  const iterationCallback = findEnclosingFunction(call);
  const item = getSingleArrowParameter(iterationCallback);
  const iterationBinding = item && scopes.symbolFor(item);
  const iterationCall = iterationCallback?.parent;
  if (
    !iterationBinding ||
    !isNodeOfType(iterationCall, "CallExpression") ||
    iterationCall.optional ||
    iterationCall.arguments.length !== 1 ||
    iterationCall.arguments[0] !== iterationCallback ||
    !isNodeOfType(iterationCall.callee, "MemberExpression") ||
    iterationCall.callee.computed ||
    iterationCall.callee.optional ||
    getStaticPropertyName(iterationCall.callee) !== "forEach" ||
    !isNodeOfType(iterationCall.callee.object, "Identifier") ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.arguments[0], "Identifier") ||
    scopes.symbolFor(call.arguments[0]) !== iterationBinding
  )
    return false;
  const updater = findEnclosingFunction(iterationCall);
  const priorState = getSingleArrowParameter(updater);
  const previousStateBinding = priorState && scopes.symbolFor(priorState);
  const setterCall = updater?.parent;
  return Boolean(
    previousStateBinding &&
    scopes.symbolFor(iterationCall.callee.object) === previousStateBinding &&
    isNodeOfType(setterCall, "CallExpression") &&
    setterCall.arguments.length === 1 &&
    setterCall.arguments[0] === updater &&
    isNodeOfType(setterCall.callee, "Identifier") &&
    scopes.symbolFor(setterCall.callee) === effect.setter &&
    findEnclosingFunction(setterCall) === effect.callback,
  );
};

// Direct lookup calls use the same receiver whenever this effect runs with
// the same declared dependency. This also covers map-like records, whose
// get method is read at invocation rather than captured during render.
export const resolveCoveredLookupSourceKeys = (
  reference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  effect: CoveredLookupEffect,
): Set<string> | null => {
  const call = reference.identifier.parent;
  const helper = getDirectConstInitializer(symbol);
  const parameter = getSingleArrowParameter(helper);
  const formalBinding = parameter && scopes.symbolFor(parameter);
  const declaration = symbol.declarationNode.parent;
  if (
    !formalBinding ||
    !helper ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== reference.identifier ||
    !isDirectLookupInStateUpdater(call, scopes, effect) ||
    !isFunctionLike(effect.owner) ||
    !isNodeOfType(effect.owner.body, "BlockStatement") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.parent !== effect.owner.body ||
    effect.owner.body.body.findIndex((statement) => statement === declaration) >=
      effect.owner.body.body.findIndex((statement) => statement === effect.statement) ||
    !isUnchangedBinding(symbol) ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  )
    return null;
  for (const use of symbol.references) {
    const consumer = use.identifier.parent;
    if (
      !isNodeOfType(consumer, "CallExpression") ||
      consumer.callee !== use.identifier ||
      consumer.optional ||
      consumer.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return null;
  }
  const captures = closureCaptures(helper, scopes);
  if (
    captures.length === 0 ||
    captures.some(
      (capture) => capture.resolvedSymbol !== effect.receiver || capture.flag !== "read",
    )
  )
    return null;
  let hasUnsupportedReference = false;
  walkAst(helper, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "arguments" ||
        (scopes.referenceFor(node) && scopes.isGlobalReference(node) && node.name !== "Map"))
    ) {
      hasUnsupportedReference = true;
      return false;
    }
  });
  if (hasUnsupportedReference) return null;

  let didReadLookup = false;
  const isCoveredLookupCall: IsCoveredLookupCall = (lookup) => {
    const callee = lookup.callee;
    const [argument] = lookup.arguments;
    if (
      lookup.optional ||
      lookup.arguments.length !== 1 ||
      !isNodeOfType(callee, "MemberExpression") ||
      callee.optional ||
      callee.computed ||
      getStaticPropertyName(callee) !== "get" ||
      !isNodeOfType(callee.object, "Identifier") ||
      scopes.symbolFor(callee.object) !== effect.receiver ||
      !isNodeOfType(argument, "Identifier") ||
      scopes.symbolFor(argument) !== formalBinding
    )
      return false;
    didReadLookup = true;
    return true;
  };
  return isPureDerivedFunction(helper, isCoveredLookupCall) &&
    didReadLookup &&
    hasClosedVisibleLookupRuntime(scopes)
    ? new Set([effect.receiver.name])
    : null;
};
