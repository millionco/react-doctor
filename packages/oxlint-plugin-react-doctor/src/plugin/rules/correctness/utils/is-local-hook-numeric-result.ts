import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { flattenLogicalAndChain } from "../../../utils/flatten-logical-and-chain.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface NumericSetupContext {
  provider: EsTreeNode;
  providerCall: EsTreeNode;
  scopes: ScopeAnalysis;
  callerScopes: ScopeAnalysis;
  countParameter: SymbolDescriptor;
}

interface NumericArgumentEvidence {
  symbols: Set<SymbolDescriptor>;
  references: Set<EsTreeNode>;
}

const NUMERIC_RESULT_SETUP_HOOK_NAMES = new Set(["useState", "useCallback", "useEffect"]);
const NUMERIC_RESULT_COMPARISON_OPERATORS = new Set([">", ">=", "<", "<=", "===", "!=="]);
const NUMERIC_RESULT_GLOBAL_EXPOSURE_NAMES = new Set([
  "require",
  "module",
  "eval",
  "Function",
  "React",
]);
const NUMERIC_RESULT_ERASED_PROVIDER_NAMES = new Set([
  ...NUMERIC_RESULT_GLOBAL_EXPOSURE_NAMES,
  "Array",
  "globalThis",
  "window",
  "self",
  "global",
]);
const closedNumericProgramByRoot = new WeakMap<EsTreeNode, boolean>();

const isReadonlyNumericBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
  );

const isNumericBindingKeyMirror = (identifier: EsTreeNode, symbol: SymbolDescriptor): boolean => {
  const property = identifier.parent;
  return (
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(symbol.declarationNode.id, "ObjectPattern") &&
    isNodeOfType(property, "Property") &&
    property.parent === symbol.declarationNode.id &&
    property.shorthand &&
    !property.computed &&
    property.key === identifier &&
    property.value === symbol.bindingIdentifier
  );
};

const nativeSetupName = (callee: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const candidate = stripParenExpression(callee);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || !isReadonlyNumericBinding(symbol)) return null;
  const declaration = getValueImportDeclaration(symbol);
  if (
    !declaration ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.source.value !== "react"
  )
    return null;
  if (!isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return null;
  const name = getImportedName(symbol.declarationNode);
  return name && NUMERIC_RESULT_SETUP_HOOK_NAMES.has(name) ? name : null;
};

const hasClosedNumericProgram = (scopes: ScopeAnalysis): boolean => {
  const root = scopes.rootScope.node;
  const cached = closedNumericProgramByRoot.get(root);
  if (cached !== undefined) return cached;
  let isClosed = true;
  walkAst(root, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      for (const specifier of node.specifiers) {
        const symbol = scopes.symbolFor(specifier.local);
        if (
          symbol &&
          getImportDeclarationForSymbol(symbol) &&
          !getValueImportDeclaration(symbol) &&
          symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
        )
          isClosed = false;
      }
      if (isTypeOnlyImport(node)) return false;
      if (node.source.value === "module" || node.source.value === "node:module") isClosed = false;
      if (
        node.source.value === "react" &&
        node.specifiers.some(
          (specifier) =>
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier"),
        )
      )
        isClosed = false;
      return false;
    }
    if (
      node.type === "ImportExpression" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSParameterProperty" ||
      node.type === "WithStatement"
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "MemberExpression") &&
        (getStaticPropertyName(node) === "constructor" ||
          getStaticPropertyName(node) === "__proto__")) ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        (getStaticPropertyKeyName(node) === "constructor" ||
          getStaticPropertyKeyName(node) === "__proto__"))
    ) {
      isClosed = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.referenceFor(node)) return;
    if (
      isProvenGlobalObjectReference(node, scopes) ||
      (NUMERIC_RESULT_GLOBAL_EXPOSURE_NAMES.has(node.name) && scopes.isGlobalReference(node))
    ) {
      isClosed = false;
      return false;
    }
    const symbol = scopes.symbolFor(node);
    if (
      symbol &&
      NUMERIC_RESULT_ERASED_PROVIDER_NAMES.has(node.name) &&
      isErasedTypeScriptBinding(symbol) &&
      !hasRuntimeValueBinding(symbol)
    ) {
      isClosed = false;
      return false;
    }
    const imported = symbol ? getValueImportDeclaration(symbol) : null;
    if (isNodeOfType(imported, "ImportDeclaration") && imported.source.value === "react") {
      const parent = node.parent;
      if (
        !nativeSetupName(node, scopes) ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== node ||
        parent.optional
      )
        isClosed = false;
    }
    if (node.name !== "Array" || !scopes.isGlobalReference(node)) return;
    const member = node.parent;
    const call = member?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      member.optional ||
      member.computed ||
      (getStaticPropertyName(member) !== "isArray" && getStaticPropertyName(member) !== "from") ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.optional ||
      isWithinAssignmentTarget(member)
    )
      isClosed = false;
  });
  closedNumericProgramByRoot.set(root, isClosed);
  return isClosed;
};

const isNonCallableStateSeed = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  setup: NumericSetupContext,
  visitedSymbols = new Set<SymbolDescriptor>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return true;
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.every(
      (element) =>
        !element ||
        (!isNodeOfType(element, "SpreadElement") &&
          isNonCallableStateSeed(element, scopes, setup, new Set(visitedSymbols))),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (candidate.name === "undefined" && scopes.isGlobalReference(candidate)) return true;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || !isReadonlyNumericBinding(symbol) || visitedSymbols.has(symbol)) return false;
  if (symbol === setup.countParameter) return true;
  visitedSymbols.add(symbol);
  if (symbol.kind === "const" && symbol.initializer)
    return isNonCallableStateSeed(symbol.initializer, scopes, setup, visitedSymbols);
  if (
    symbol.kind !== "parameter" ||
    scopes !== setup.scopes ||
    !isFunctionLike(setup.provider) ||
    !isNodeOfType(setup.providerCall, "CallExpression")
  )
    return false;
  const parameters = setup.provider.params;
  const argument = setup.providerCall.arguments.find(
    (_, argumentIndex) => parameters[argumentIndex] === symbol.bindingIdentifier,
  );
  return Boolean(
    argument && isNonCallableStateSeed(argument, setup.callerScopes, setup, visitedSymbols),
  );
};

const isInertNumericSetup = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  setup: NumericSetupContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isFunctionLike(candidate) || isNodeOfType(candidate, "Literal")) return true;
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    return Boolean(symbol && isReadonlyNumericBinding(symbol));
  }
  if (isNodeOfType(candidate, "ArrayExpression"))
    return candidate.elements.every(
      (element) =>
        !element ||
        (!isNodeOfType(element, "SpreadElement") && isInertNumericSetup(element, scopes, setup)),
    );
  if (isNodeOfType(candidate, "CallExpression") && !candidate.optional) {
    const name = nativeSetupName(candidate.callee, scopes);
    if (!name || candidate.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")))
      return false;
    const [firstArgument, secondArgument, ...remainingArguments] = candidate.arguments;
    if (!firstArgument || remainingArguments.length) return false;
    if (name === "useState")
      return !secondArgument && isNonCallableStateSeed(firstArgument, scopes, setup);
    return (
      isFunctionLike(firstArgument) &&
      Boolean(
        secondArgument &&
        isNodeOfType(secondArgument, "ArrayExpression") &&
        isInertNumericSetup(secondArgument, scopes, setup),
      )
    );
  }
  return false;
};

const getArrayCountParameter = (
  expression: EsTreeNode,
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "ConditionalExpression")) return null;
  const test = stripParenExpression(candidate.test);
  const consequent = stripParenExpression(candidate.consequent);
  const alternate = stripParenExpression(candidate.alternate);
  if (
    !(isNodeOfType(alternate, "Literal") && alternate.value === null) &&
    !(
      isNodeOfType(alternate, "Identifier") &&
      alternate.name === "undefined" &&
      scopes.isGlobalReference(alternate)
    )
  )
    return null;
  if (
    !isNodeOfType(test, "CallExpression") ||
    test.optional ||
    !isNodeOfType(test.callee, "MemberExpression") ||
    test.callee.computed ||
    test.callee.optional ||
    getStaticPropertyName(test.callee) !== "isArray" ||
    !isNodeOfType(test.callee.object, "Identifier") ||
    test.callee.object.name !== "Array" ||
    !scopes.isGlobalReference(test.callee.object)
  )
    return null;
  const [parameter, ...extraArguments] = test.arguments;
  if (
    !parameter ||
    extraArguments.length ||
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(consequent, "MemberExpression") ||
    consequent.computed ||
    consequent.optional ||
    getStaticPropertyName(consequent) !== "length" ||
    !isNodeOfType(consequent.object, "Identifier")
  )
    return null;
  const symbol = scopes.symbolFor(parameter);
  return symbol &&
    symbol.kind === "parameter" &&
    isReadonlyNumericBinding(symbol) &&
    isFunctionLike(functionNode) &&
    functionNode.params.some((parameterNode) => parameterNode === symbol.bindingIdentifier) &&
    scopes.symbolFor(consequent.object) === symbol
    ? symbol
    : null;
};

const getReadonlyArgumentOrigin = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  evidence: NumericArgumentEvidence,
  visitedSymbols = new Set<SymbolDescriptor>(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return candidate;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || !isReadonlyNumericBinding(symbol) || visitedSymbols.has(symbol)) return null;
  evidence.symbols.add(symbol);
  evidence.references.add(candidate);
  if (symbol.kind === "parameter" || symbol.kind === "import") return candidate;
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  )
    return null;
  visitedSymbols.add(symbol);
  return getReadonlyArgumentOrigin(symbol.initializer, scopes, evidence, visitedSymbols);
};

const collectEmptyArgumentEvidence = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  evidence: NumericArgumentEvidence,
  visited = new Set<EsTreeNode>(),
): boolean => {
  if (visited.has(expression)) return false;
  visited.add(expression);
  const candidate = getReadonlyArgumentOrigin(expression, scopes, evidence);
  if (!candidate) return false;
  if (isNodeOfType(candidate, "ArrayExpression")) return !candidate.elements.length;
  if (isNodeOfType(candidate, "Identifier")) return true;
  if (!isNodeOfType(candidate, "ConditionalExpression")) return false;
  const test = getReadonlyArgumentOrigin(candidate.test, scopes, evidence);
  if (!test) return false;
  if (isNodeOfType(test, "Literal") && !("regex" in test) && !("bigint" in test)) {
    return collectEmptyArgumentEvidence(
      test.value ? candidate.consequent : candidate.alternate,
      scopes,
      evidence,
      visited,
    );
  }
  if (isNodeOfType(test, "ArrayExpression") && !test.elements.length)
    return collectEmptyArgumentEvidence(candidate.consequent, scopes, evidence, visited);
  if (!isNodeOfType(test, "Identifier")) return false;
  const consequent = getReadonlyArgumentOrigin(candidate.consequent, scopes, evidence);
  return Boolean(
    consequent &&
    ((isNodeOfType(consequent, "ArrayExpression") && !consequent.elements.length) ||
      (isNodeOfType(consequent, "Identifier") &&
        scopes.symbolFor(consequent) === scopes.symbolFor(test))),
  );
};

const hasClosedEmptyArgument = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const evidence: NumericArgumentEvidence = { symbols: new Set(), references: new Set() };
  return (
    collectEmptyArgumentEvidence(expression, scopes, evidence) &&
    [...evidence.symbols].every((symbol) =>
      symbol.references.every(
        (reference) =>
          isTypeScriptTypePosition(reference.identifier) ||
          evidence.references.has(reference.identifier),
      ),
    )
  );
};

const hasUnfilteredOwnerCount = (
  selected: SymbolDescriptor,
  owner: EsTreeNode,
  returned: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return false;
  const body = owner.body;
  return selected.references.every((reference) => {
    if (
      isTypeScriptTypePosition(reference.identifier) ||
      isNumericBindingKeyMirror(reference.identifier, selected)
    )
      return true;
    let statement: EsTreeNode | null | undefined = reference.identifier;
    while (statement && statement.parent !== body) statement = statement.parent;
    if (!statement) return false;
    if (statement === returned) {
      if (findEnclosingFunction(reference.identifier) !== owner) return false;
      let guarded: EsTreeNode = reference.identifier;
      while (guarded.parent && guarded.parent !== returned) {
        const parent = guarded.parent;
        if (
          isNodeOfType(parent, "LogicalExpression") &&
          parent.operator === "&&" &&
          parent.right === guarded &&
          flattenLogicalAndChain(parent.left).some((operand) => {
            const value = stripParenExpression(operand);
            return isNodeOfType(value, "Identifier") && scopes.symbolFor(value) === selected;
          })
        )
          return true;
        guarded = parent;
      }
      let current: EsTreeNode | null | undefined = reference.identifier.parent;
      while (current && current !== returned) {
        if (
          isNodeOfType(current, "CallExpression") ||
          isNodeOfType(current, "NewExpression") ||
          isNodeOfType(current, "MemberExpression") ||
          isNodeOfType(current, "TaggedTemplateExpression") ||
          isNodeOfType(current, "ConditionalExpression") ||
          isNodeOfType(current, "AssignmentExpression") ||
          isNodeOfType(current, "UpdateExpression") ||
          isNodeOfType(current, "SequenceExpression") ||
          isNodeOfType(current, "ArrayExpression") ||
          isNodeOfType(current, "ObjectExpression") ||
          isNodeOfType(current, "Property") ||
          isNodeOfType(current, "JSXSpreadAttribute") ||
          (isNodeOfType(current, "UnaryExpression") && current.operator !== "!")
        )
          return false;
        if (isNodeOfType(current, "BinaryExpression")) {
          if (!NUMERIC_RESULT_COMPARISON_OPERATORS.has(current.operator)) return false;
          const left = stripParenExpression(current.left);
          const right = stripParenExpression(current.right);
          const other = left === reference.identifier ? right : left;
          if (!isNodeOfType(other, "Literal") || typeof other.value !== "number") return false;
        }
        current = current.parent;
      }
      return true;
    }
    let comparison = reference.identifier.parent;
    while (comparison && stripParenExpression(comparison) === reference.identifier)
      comparison = comparison.parent;
    if (!isNodeOfType(comparison, "BinaryExpression")) return false;
    if (!NUMERIC_RESULT_COMPARISON_OPERATORS.has(comparison.operator)) return false;
    const other =
      stripParenExpression(comparison.left) === reference.identifier
        ? stripParenExpression(comparison.right)
        : stripParenExpression(comparison.left);
    if (!isNodeOfType(other, "Literal") || typeof other.value !== "number") return false;
    let binding: EsTreeNode = comparison;
    while (binding.parent && stripParenExpression(binding.parent) === comparison)
      binding = binding.parent;
    return (
      isNodeOfType(binding.parent, "VariableDeclarator") &&
      binding.parent.init === binding &&
      isNodeOfType(binding.parent.id, "Identifier") &&
      binding.parent.parent === statement
    );
  });
};

const isNumericProviderCallable = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isFunctionLike(candidate)) return true;
  const symbol = resolveConstIdentifierAlias(candidate, scopes, true);
  if (!symbol) return false;
  if (isFunctionLike(symbol.declarationNode)) return true;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (initializer && isFunctionLike(initializer)) return true;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const hookName = nativeSetupName(initializer.callee, scopes);
  if (hookName === "useCallback") return true;
  return (
    hookName === "useState" &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(symbol.declarationNode.id, "ArrayPattern") &&
    symbol.declarationNode.id.elements[1] === symbol.bindingIdentifier
  );
};

export const isLocalHookNumericResult = (expression: EsTreeNode, context: RuleContext): boolean => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const selected = context.scopes.symbolFor(identifier);
  if (!selected || selected.kind !== "const" || !isReadonlyNumericBinding(selected)) return false;
  const declaration = selected.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !declaration.init ||
    !isNodeOfType(declaration.id, "ObjectPattern")
  )
    return false;
  let selectedName: string | null = null;
  const names = new Set<string>();
  for (const property of declaration.id.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (name === null || names.has(name)) return false;
    names.add(name);
    if (property.value === selected.bindingIdentifier) selectedName = name;
  }
  if (selectedName === null) return false;
  const owner = findEnclosingFunction(declaration);
  if (
    !owner ||
    findEnclosingFunction(identifier) !== owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement")
  )
    return false;
  const [returned] = collectFunctionReturnStatements(owner);
  if (
    !returned ||
    returned.parent !== owner.body ||
    !returned.argument ||
    (!isNodeOfType(stripParenExpression(returned.argument), "JSXElement") &&
      !isNodeOfType(stripParenExpression(returned.argument), "JSXFragment"))
  )
    return false;
  if (collectFunctionReturnStatements(owner).some((statement) => statement !== returned))
    return false;
  if (
    owner.body.body.some(
      (statement) =>
        !isNodeOfType(statement, "VariableDeclaration") &&
        !isNodeOfType(statement, "ExpressionStatement") &&
        !isNodeOfType(statement, "FunctionDeclaration") &&
        !isNodeOfType(statement, "ReturnStatement") &&
        !isNodeOfType(statement, "EmptyStatement"),
    )
  )
    return false;
  let ancestor: EsTreeNode | null | undefined = identifier;
  while (ancestor && ancestor !== returned) {
    if (
      isNodeOfType(ancestor, "ConditionalExpression") ||
      isNodeOfType(ancestor, "IfStatement") ||
      isFunctionLike(ancestor)
    )
      return false;
    ancestor = ancestor.parent;
  }
  if (
    ancestor !== returned ||
    !hasClosedNumericProgram(context.scopes) ||
    !hasUnfilteredOwnerCount(selected, owner, returned, context.scopes)
  )
    return false;
  const call = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const calleeSymbol = context.scopes.symbolFor(callee);
  if (!calleeSymbol || !isReadonlyNumericBinding(calleeSymbol)) return false;
  let provider: EsTreeNode | null = null;
  let scopes = context.scopes;
  const imported = getValueImportDeclaration(calleeSymbol);
  if (isNodeOfType(imported, "ImportDeclaration")) {
    if (
      !context.filename ||
      typeof imported.source.value !== "string" ||
      !imported.source.value.startsWith(".") ||
      !isNodeOfType(calleeSymbol.declarationNode, "ImportSpecifier")
    )
      return false;
    const importedName = getImportedName(calleeSymbol.declarationNode);
    const resolved = importedName
      ? resolveCrossFileFunctionExportWithFilePath(
          context.filename,
          imported.source.value,
          importedName,
        )
      : null;
    if (!resolved) return false;
    provider = resolved.functionNode;
    scopes = analyzeScopes(resolved.programNode);
  } else if (calleeSymbol.kind === "function") provider = calleeSymbol.declarationNode;
  else if (calleeSymbol.kind === "const" && calleeSymbol.initializer)
    provider = stripParenExpression(calleeSymbol.initializer);
  if (
    !provider ||
    !isFunctionLike(provider) ||
    provider.async ||
    provider.generator ||
    !provider.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(provider.body, "BlockStatement") ||
    !hasClosedNumericProgram(scopes) ||
    !getFunctionBindingSymbols(provider, scopes).every(isReadonlyNumericBinding)
  )
    return false;
  const [lastStatement] = [...provider.body.body].reverse();
  const ownReturns = collectFunctionReturnStatements(provider);
  if (
    !isNodeOfType(lastStatement, "ReturnStatement") ||
    !lastStatement.argument ||
    ownReturns.some((statement) => statement !== lastStatement)
  )
    return false;
  const result = stripParenExpression(lastStatement.argument);
  if (!isNodeOfType(result, "ObjectExpression")) return false;
  let fieldValue: EsTreeNode | null = null;
  let fieldKeyMirror: EsTreeNode | null = null;
  const fieldNames = new Set<string>();
  for (const property of result.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || fieldNames.has(name)) return false;
    fieldNames.add(name);
    if (name === selectedName) {
      fieldValue = stripParenExpression(property.value);
      if (property.shorthand && !property.computed) fieldKeyMirror = property.key;
    }
  }
  if (!fieldValue || !isNodeOfType(fieldValue, "Identifier")) return false;
  const count = scopes.symbolFor(fieldValue);
  if (
    !count ||
    count.kind !== "const" ||
    !count.initializer ||
    !isReadonlyNumericBinding(count) ||
    findEnclosingFunction(count.declarationNode) !== provider ||
    count.references.some(
      (reference) =>
        !isTypeScriptTypePosition(reference.identifier) &&
        reference.identifier !== fieldValue &&
        reference.identifier !== fieldKeyMirror,
    )
  )
    return false;
  const countParameter = getArrayCountParameter(count.initializer, provider, scopes);
  const parameters = provider.params;
  const argument = call.arguments.find(
    (_, argumentIndex) => parameters[argumentIndex] === countParameter?.bindingIdentifier,
  );
  if (!countParameter || !argument || !hasClosedEmptyArgument(argument, context.scopes))
    return false;
  const setup: NumericSetupContext = {
    provider,
    providerCall: call,
    scopes,
    callerScopes: context.scopes,
    countParameter,
  };
  if (
    result.properties.some((property) => {
      if (!isNodeOfType(property, "Property")) return true;
      const value = stripParenExpression(property.value);
      return (
        (!isNodeOfType(value, "Identifier") &&
          !isNodeOfType(value, "Literal") &&
          !isFunctionLike(value)) ||
        !isInertNumericSetup(value, scopes, setup)
      );
    })
  )
    return false;
  for (const property of result.properties) {
    if (!isNodeOfType(property, "Property") || !isNumericProviderCallable(property.value, scopes))
      continue;
    const name = getStaticPropertyKeyName(property);
    const binding = declaration.id.properties.find(
      (candidate) =>
        isNodeOfType(candidate, "Property") && getStaticPropertyKeyName(candidate) === name,
    );
    if (!binding) continue;
    if (!isNodeOfType(binding, "Property") || !isNodeOfType(binding.value, "Identifier"))
      return false;
    const symbol = context.scopes.symbolFor(binding.value);
    if (
      !symbol ||
      !isReadonlyNumericBinding(symbol) ||
      symbol.references.some((reference) => {
        if (
          isTypeScriptTypePosition(reference.identifier) ||
          isNumericBindingKeyMirror(reference.identifier, symbol)
        )
          return false;
        const enclosing = findEnclosingFunction(reference.identifier);
        const deferredValue = enclosing === owner ? reference.identifier : enclosing;
        if (!deferredValue) return true;
        const valueRoot = findTransparentExpressionRoot(deferredValue);
        const container = valueRoot.parent;
        return (
          !isNodeOfType(container, "JSXExpressionContainer") ||
          container.expression !== valueRoot ||
          !isNodeOfType(container.parent, "JSXAttribute") ||
          container.parent.value !== container
        );
      })
    )
      return false;
  }
  for (const statement of provider.body.body) {
    if (
      statement === lastStatement ||
      isNodeOfType(statement, "EmptyStatement") ||
      isNodeOfType(statement, "FunctionDeclaration")
    )
      continue;
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isNodeOfType(statement.expression, "CallExpression") &&
      nativeSetupName(statement.expression.callee, scopes) === "useEffect" &&
      isInertNumericSetup(statement.expression, scopes, setup)
    )
      continue;
    if (!isNodeOfType(statement, "VariableDeclaration")) return false;
    for (const binding of statement.declarations) {
      const initializer = binding.init ? stripParenExpression(binding.init) : null;
      if (
        !isNodeOfType(binding.id, "Identifier") &&
        !(
          isNodeOfType(binding.id, "ArrayPattern") &&
          binding.id.elements.length === 2 &&
          binding.id.elements.every((element) => element && isNodeOfType(element, "Identifier")) &&
          initializer &&
          isNodeOfType(initializer, "CallExpression") &&
          nativeSetupName(initializer.callee, scopes) === "useState"
        )
      )
        return false;
      if (binding === count.declarationNode || !binding.init) continue;
      if (!isInertNumericSetup(binding.init, scopes, setup)) return false;
    }
  }
  return true;
};
