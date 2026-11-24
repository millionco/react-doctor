import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../utils/get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

// Only plain slot reads and native Map access may observe the state record.
const readMethods = new Set(["get", "has"]);
const unsafeRuntimeNames = new Set([
  "globalThis",
  "document",
  "window",
  "self",
  "global",
  "require",
  "eval",
  "Function",
  "Reflect",
]);
const unsafeRuntimeMembers = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "setPrototypeOf",
  "defineProperty",
  "defineProperties",
  "require",
  "createRequire",
  "eval",
]);
const hostRealmMembers = new Set([
  "contentDocument",
  "contentWindow",
  "defaultView",
  "frameElement",
  "frames",
  "opener",
  "ownerDocument",
  "parent",
  "top",
]);
const plainObjectHelpers = new Set(["entries", "hasOwn", "is", "keys", "values"]);
const stockRuntimeCache = new WeakMap<ScopeAnalysis, boolean>();
const MAX_RECORD_EXPRESSION_DEPTH = 8;

const matchesSymbol = (
  node: EsTreeNode | null | undefined,
  expected: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => Boolean(node && scopes.symbolFor(stripParenExpression(node)) === expected);

const isLexicallyReadOnly = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );

const isComparison = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "BinaryExpression") && (node.operator === "===" || node.operator === "!==");

const isUnmodifiedMapConstruction = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "Map" &&
  isProvenUnmodifiedGlobalNamespaceReference(node.callee, "Map", scopes, undefined, true);

const canBeLocalMap = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const node = stripParenExpression(expression);
  if (isUnmodifiedMapConstruction(node, scopes)) return true;
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(node, scopes) ?? scopes.symbolFor(node);
  if (!symbol) return false;
  if (
    symbol.initializer &&
    isUnmodifiedMapConstruction(stripParenExpression(symbol.initializer), scopes)
  )
    return true;
  return symbol.references.some(({ identifier, flag }) => {
    const parent = findTransparentExpressionRoot(identifier).parent;
    return (
      flag !== "read" &&
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      matchesSymbol(parent.left, symbol, scopes) &&
      isUnmodifiedMapConstruction(stripParenExpression(parent.right), scopes)
    );
  });
};

const hasStockRuntimeBindings = (scopes: ScopeAnalysis): boolean => {
  const cached = stockRuntimeCache.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed) return false;
    if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      if (node.name === "Map") {
        closed = isNodeOfType(node.parent, "NewExpression") && node.parent.callee === node;
      } else if (node.name === "Object") {
        const member = node.parent;
        const call = member?.parent;
        closed =
          isNodeOfType(member, "MemberExpression") &&
          member.object === node &&
          !member.computed &&
          !member.optional &&
          plainObjectHelpers.has(getStaticPropertyName(member) ?? "") &&
          isNodeOfType(call, "CallExpression") &&
          !call.optional &&
          call.callee === member;
      } else if (unsafeRuntimeNames.has(node.name) || hostRealmMembers.has(node.name)) {
        closed = false;
      }
    } else if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "WithStatement")
    ) {
      closed = false;
    } else if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === "react" &&
      node.importKind !== "type"
    ) {
      closed =
        node.specifiers.length > 0 &&
        node.specifiers.every(
          (specifier) =>
            isNodeOfType(specifier, "ImportSpecifier") &&
            (specifier.importKind === "type" || getImportedName(specifier) !== "default"),
        );
    } else if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, scopes);
      closed =
        property !== "Map" &&
        !hostRealmMembers.has(property ?? "") &&
        !unsafeRuntimeMembers.has(property ?? "") &&
        !(
          node.computed &&
          property === null &&
          (isNodeOfType(node, "Property") || canBeLocalMap(node.object, scopes))
        );
    }
    if (!closed) return false;
  });
  stockRuntimeCache.set(scopes, closed);
  return closed;
};

const isPlainStateSlotRead = (
  node: EsTreeNode,
  copy: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const member = findTransparentExpressionRoot(node).parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    stripParenExpression(member.object) !== node ||
    member.computed ||
    !getStaticPropertyName(member) ||
    isWithinAssignmentTarget(member)
  )
    return false;
  const value = findTransparentExpressionRoot(member);
  const use = value.parent;
  if (isComparison(use)) return true;
  if (isNodeOfType(use, "NewExpression")) {
    return (
      use.arguments.length === 1 &&
      use.arguments[0] === value &&
      isUnmodifiedMapConstruction(use, scopes)
    );
  }
  if (isNodeOfType(use, "MemberExpression") && use.object === value && !use.computed) {
    const property = getStaticPropertyName(use);
    const call = findTransparentExpressionRoot(use).parent;
    return (
      property === "size" ||
      (readMethods.has(property ?? "") &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === use)
    );
  }
  return (
    isNodeOfType(use, "VariableDeclarator") &&
    use.init === value &&
    use.id === copy.bindingIdentifier
  );
};

const isReturnedRecordBranch = (record: EsTreeNode): boolean => {
  let value = findTransparentExpressionRoot(record);
  while (isNodeOfType(value.parent, "ConditionalExpression") && value.parent.test !== value) {
    value = findTransparentExpressionRoot(value.parent);
  }
  return (
    (isNodeOfType(value.parent, "ReturnStatement") && value.parent.argument === value) ||
    (isNodeOfType(value.parent, "ArrowFunctionExpression") && value.parent.body === value)
  );
};

const provePrivateStateRecord = (
  updater: EsTreeNode,
  base: SymbolDescriptor,
  copy: SymbolDescriptor,
  property: string,
  scopes: ScopeAnalysis,
): boolean => {
  const setterCall = updater.parent;
  if (!isNodeOfType(setterCall, "CallExpression") || !isNodeOfType(setterCall.callee, "Identifier"))
    return false;
  const pair = resolveReactUseStatePair(setterCall.callee, scopes);
  const stateCall = pair?.declarator.init;
  if (
    !pair?.stateSymbol ||
    pair.setterSymbol !== scopes.symbolFor(setterCall.callee) ||
    pair.stateSymbol.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    !isNodeOfType(stateCall, "CallExpression") ||
    stateCall.optional ||
    stateCall.arguments.length !== 1 ||
    !isNodeOfType(stateCall.callee, "Identifier")
  )
    return false;
  const hook = scopes.symbolFor(stateCall.callee);
  const importSpecifier = hook?.declarationNode;
  const importDeclaration = importSpecifier?.parent;
  const [initializer] = stateCall.arguments;
  if (
    !hook ||
    !isLexicallyReadOnly(hook) ||
    !isNodeOfType(importSpecifier, "ImportSpecifier") ||
    importSpecifier.importKind === "type" ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    importDeclaration.importKind === "type" ||
    importDeclaration.source.value !== "react" ||
    getImportedName(importSpecifier) !== "useState" ||
    !isNodeOfType(initializer, "ArrowFunctionExpression") ||
    initializer.async ||
    initializer.params.length !== 0 ||
    !isLexicallyReadOnly(pair.setterSymbol) ||
    !hasCompleteSymbolReferences(pair.setterSymbol, scopes.rootScope.node, scopes)
  )
    return false;

  const provenRecords = new Set<SymbolDescriptor>([pair.stateSymbol]);
  const recordAliases = new Set<SymbolDescriptor>();
  const recordOutputs = new Set<EsTreeNode>();
  const writers = new Set<EsTreeNode>();
  const updaterParameters = new Map<EsTreeNode, SymbolDescriptor>();
  for (const reference of pair.setterSymbol.references) {
    const call = reference.identifier.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== reference.identifier ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.arguments[0], "ArrowFunctionExpression")
    )
      return false;
    const writer = call.arguments[0];
    const [parameter] = writer.params;
    if (writer.async || writer.params.length !== 1 || !isNodeOfType(parameter, "Identifier"))
      return false;
    const previous = scopes.symbolFor(parameter);
    if (!previous) return false;
    writers.add(writer);
    updaterParameters.set(writer, previous);
  }
  if (!writers.has(updater)) return false;

  const isRecord = (
    expression: EsTreeNode,
    previous: SymbolDescriptor | null,
    depth = 0,
  ): boolean => {
    if (depth >= MAX_RECORD_EXPRESSION_DEPTH) return false;
    const node = stripParenExpression(expression);
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (!symbol) return false;
      if (symbol === previous) return true;
      const init = getDirectConstInitializer(symbol);
      if (
        !init ||
        findEnclosingFunction(init) !== findEnclosingFunction(node) ||
        !isRecord(init, previous, depth + 1)
      )
        return false;
      provenRecords.add(symbol);
      recordAliases.add(symbol);
      return true;
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      return (
        isRecord(node.consequent, previous, depth + 1) &&
        isRecord(node.alternate, previous, depth + 1)
      );
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      !node.optional &&
      isNodeOfType(node.callee, "Identifier")
    ) {
      const factory = scopes.symbolFor(node.callee);
      const fn = factory && (getDirectConstInitializer(factory) ?? factory.declarationNode);
      const declaration = factory?.declarationNode;
      const privateModuleBinding =
        (isNodeOfType(declaration, "FunctionDeclaration") &&
          isNodeOfType(declaration.parent, "Program")) ||
        (isNodeOfType(declaration, "VariableDeclarator") &&
          isNodeOfType(declaration.parent?.parent, "Program"));
      if (
        !factory ||
        !privateModuleBinding ||
        !isFunctionLike(fn) ||
        fn.async ||
        fn.generator ||
        fn.params.some((param) => !isNodeOfType(param, "Identifier")) ||
        node.arguments.some((arg) => isNodeOfType(arg, "SpreadElement")) ||
        !isLexicallyReadOnly(factory) ||
        factory.references.some(
          ({ identifier }) =>
            !isNodeOfType(identifier.parent, "CallExpression") ||
            identifier.parent.callee !== identifier,
        )
      )
        return false;
      const returned = getSingleReturnExpression(fn);
      return Boolean(
        returned &&
        isNodeOfType(stripParenExpression(returned), "ObjectExpression") &&
        isRecord(returned, null, depth + 1),
      );
    }
    if (!isNodeOfType(node, "ObjectExpression")) return false;
    let hasOwnSlot = false;
    const names = new Set<string>();
    for (const [index, entry] of node.properties.entries()) {
      if (isNodeOfType(entry, "SpreadElement")) {
        if (index !== 0 || !previous || !isRecord(entry.argument, previous, depth + 1))
          return false;
        hasOwnSlot = true;
        continue;
      }
      if (
        !isNodeOfType(entry, "Property") ||
        entry.computed ||
        entry.kind !== "init" ||
        entry.method
      )
        return false;
      const name = getResolvedStaticPropertyName(entry, scopes);
      if (!name || names.has(name) || unsafeRuntimeMembers.has(name)) return false;
      names.add(name);
      if (name !== property) continue;
      const value = stripParenExpression(entry.value);
      const valueSymbol = isNodeOfType(value, "Identifier") ? scopes.symbolFor(value) : null;
      const allocation = valueSymbol ? getDirectConstInitializer(valueSymbol) : value;
      if (
        valueSymbol !== copy &&
        (!allocation || !isUnmodifiedMapConstruction(stripParenExpression(allocation), scopes))
      )
        return false;
      hasOwnSlot = true;
    }
    if (hasOwnSlot) recordOutputs.add(node);
    return hasOwnSlot;
  };

  const lazyValue = getSingleReturnExpression(initializer);
  if (!lazyValue || !isRecord(lazyValue, null)) return false;
  for (const [writer, previous] of updaterParameters) {
    if (!isNodeOfType(writer, "ArrowFunctionExpression")) return false;
    provenRecords.add(previous);
    if (!isNodeOfType(writer.body, "BlockStatement")) {
      if (!isRecord(writer.body, previous)) return false;
      continue;
    }
    if (!isNodeOfType(writer.body.body.at(-1), "ReturnStatement")) return false;
    if (
      !collectFunctionReturnStatements(writer).every(
        (statement) => statement.argument && isRecord(statement.argument, previous),
      )
    )
      return false;
  }
  // A producer may read a fresh-or-previous base without returning that base directly.
  const owningPrevious = updaterParameters.get(updater);
  if (!owningPrevious) return false;
  if (base !== owningPrevious) {
    const baseInitializer = getDirectConstInitializer(base);
    if (!baseInitializer || !isRecord(baseInitializer, owningPrevious)) return false;
    provenRecords.add(base);
    recordAliases.add(base);
  }

  const visitNullableRenderAlias = (node: EsTreeNode, symbol: SymbolDescriptor): boolean => {
    const expr = stripParenExpression(node);
    return (
      matchesSymbol(expr, symbol, scopes) ||
      (isNodeOfType(expr, "Literal") && expr.value === null) ||
      (isNodeOfType(expr, "ConditionalExpression") &&
        visitNullableRenderAlias(expr.consequent, symbol) &&
        visitNullableRenderAlias(expr.alternate, symbol))
    );
  };
  for (const record of provenRecords) {
    if (!hasCompleteSymbolReferences(record, scopes.rootScope.node, scopes)) return false;
    const owner = findEnclosingFunction(record.bindingIdentifier);
    const isWriterRecord = owner !== null && writers.has(owner);
    for (const { identifier, flag } of record.references) {
      const value = findTransparentExpressionRoot(identifier);
      const parent = value.parent;
      if (flag !== "read" || (isWriterRecord && findEnclosingFunction(identifier) !== owner))
        return false;
      if (
        isComparison(parent) ||
        isPlainStateSlotRead(identifier, copy, scopes) ||
        (isNodeOfType(parent, "UnaryExpression") &&
          parent.operator === "!" &&
          parent.argument === value)
      )
        continue;
      if (isWriterRecord && isReturnedRecordBranch(value)) continue;
      if (
        isNodeOfType(parent, "SpreadElement") &&
        parent.argument === value &&
        parent.parent &&
        recordOutputs.has(parent.parent)
      )
        continue;

      let aliasExpression = value;
      while (
        isNodeOfType(aliasExpression.parent, "ConditionalExpression") &&
        aliasExpression.parent.test !== aliasExpression
      )
        aliasExpression = aliasExpression.parent;
      const declaration = aliasExpression.parent;
      if (
        !isNodeOfType(declaration, "VariableDeclarator") ||
        declaration.init !== aliasExpression ||
        !isNodeOfType(declaration.id, "Identifier")
      )
        return false;
      const alias = scopes.symbolFor(declaration.id);
      if (!alias || getDirectConstInitializer(alias) !== aliasExpression) return false;
      if (recordAliases.has(alias)) continue;
      if (isWriterRecord || !visitNullableRenderAlias(aliasExpression, record)) return false;
      recordAliases.add(alias);
      provenRecords.add(alias);
    }
  }
  return true;
};

export const isOwnedStateMapCopyWrite = (
  call: EsTreeNode,
  updater: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 2 ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    getStaticPropertyName(call.callee) !== "set" ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    findEnclosingFunction(call) !== updater
  )
    return false;
  const local = scopes.symbolFor(call.callee.object);
  const init = local?.initializer && stripParenExpression(local.initializer);
  if (
    !local ||
    local.kind !== "let" ||
    !isNodeOfType(local.declarationNode, "VariableDeclarator") ||
    local.declarationNode.id !== local.bindingIdentifier ||
    findEnclosingFunction(local.bindingIdentifier) !== updater ||
    !isNodeOfType(init, "MemberExpression") ||
    init.computed ||
    !isNodeOfType(init.object, "Identifier")
  )
    return false;
  const base = scopes.symbolFor(init.object);
  const property = getStaticPropertyName(init);
  const statement = call.parent;
  const block = statement?.parent;
  if (
    !base ||
    !property ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement")
  )
    return false;
  const position = block.body.findIndex((child) => child === statement);
  const guard = block.body[position - 1];
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "BinaryExpression") ||
    guard.test.operator !== "==="
  )
    return false;
  const { left, right } = guard.test;
  const field = matchesSymbol(left, local, scopes)
    ? right
    : matchesSymbol(right, local, scopes)
      ? left
      : null;
  if (
    !isNodeOfType(field, "MemberExpression") ||
    field.computed ||
    !matchesSymbol(field.object, base, scopes) ||
    getStaticPropertyName(field) !== property
  )
    return false;
  const branch = guard.consequent;
  const copyStatement =
    isNodeOfType(branch, "BlockStatement") && branch.body.length === 1 ? branch.body[0] : branch;
  const write = isNodeOfType(copyStatement, "ExpressionStatement")
    ? copyStatement.expression
    : null;
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    !matchesSymbol(write.left, local, scopes) ||
    !isNodeOfType(write.right, "NewExpression") ||
    write.right.arguments.length !== 1 ||
    !isUnmodifiedMapConstruction(write.right, scopes)
  )
    return false;
  const copySource = stripParenExpression(write.right.arguments[0]);
  if (
    !matchesSymbol(copySource, local, scopes) &&
    (!isNodeOfType(copySource, "MemberExpression") ||
      copySource.optional ||
      copySource.computed ||
      !matchesSymbol(copySource.object, base, scopes) ||
      getStaticPropertyName(copySource) !== property)
  )
    return false;

  // The only write to this alias replaces the borrowed Map. An adjacent
  // identity guard makes the set safe once the owning slot is proved stable.
  const receiver = call.callee.object;
  if (
    !hasCompleteSymbolReferences(local, scopes.rootScope.node, scopes) ||
    !local.references.every(({ identifier, flag }) => {
      if (findEnclosingFunction(identifier) !== updater) return false;
      if (identifier === write.left) return true;
      if (flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
      if (identifier === copySource || identifier === receiver || isComparison(identifier.parent))
        return true;
      const parent = identifier.parent;
      if (
        isNodeOfType(parent, "Property") &&
        (parent.value === identifier ||
          (parent.shorthand &&
            parent.key === identifier &&
            matchesSymbol(parent.value, local, scopes))) &&
        getResolvedStaticPropertyName(parent, scopes) === property &&
        isNodeOfType(parent.parent, "ObjectExpression") &&
        isReturnedRecordBranch(parent.parent)
      )
        return true;
      return (
        isNodeOfType(parent, "MemberExpression") &&
        !parent.computed &&
        readMethods.has(getStaticPropertyName(parent) ?? "") &&
        isNodeOfType(parent.parent, "CallExpression") &&
        parent.parent.callee === parent
      );
    })
  )
    return false;
  return (
    hasStockRuntimeBindings(scopes) &&
    provePrivateStateRecord(updater, base, local, property, scopes)
  );
};
