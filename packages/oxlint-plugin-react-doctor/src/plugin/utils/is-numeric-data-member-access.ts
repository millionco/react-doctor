import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { resolveRuntimeValueBinding } from "./resolve-runtime-value-binding.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface NumericDataProgramFacts {
  hasNumberWrite: boolean | null;
  exportedBindings: Set<SymbolDescriptor>;
  readonlyBindings: Map<SymbolDescriptor, boolean>;
  directCalls: Map<SymbolDescriptor, EsTreeNodeOfType<"CallExpression">[] | null>;
  earliestCalls: Map<SymbolDescriptor, number>;
}

const programFacts = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, NumericDataProgramFacts>>();

export const isNumericDataMemberAccess = (member: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(member, "MemberExpression") || !member.computed || member.optional)
    return false;
  const program = findProgramRoot(member);
  if (!program) return false;
  let scopeFacts = programFacts.get(scopes);
  if (!scopeFacts) {
    scopeFacts = new WeakMap();
    programFacts.set(scopes, scopeFacts);
  }
  let facts = scopeFacts.get(program);
  if (!facts) {
    facts = {
      hasNumberWrite: null,
      exportedBindings: new Set(),
      readonlyBindings: new Map(),
      directCalls: new Map(),
      earliestCalls: new Map(),
    };
    scopeFacts.set(program, facts);
  }
  if (facts.hasNumberWrite === null) {
    facts.hasNumberWrite = false;
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "Number" &&
        scopes.isGlobalReference(node) &&
        isBindingAssignmentTarget(node)
      )
        facts.hasNumberWrite = true;
      if (isNodeOfType(node, "ExportNamedDeclaration") && !node.source) {
        for (const specifier of node.specifiers) {
          if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
          const localName = specifier.local.name;
          const binding = localName && resolveRuntimeValueBinding(scopes.rootScope, localName);
          if (binding) facts.exportedBindings.add(binding);
        }
      }
      if (isNodeOfType(node, "ExportDefaultDeclaration")) {
        const exportedValue = stripParenExpression(node.declaration);
        const binding =
          isNodeOfType(exportedValue, "Identifier") &&
          resolveRuntimeValueBinding(scopes.rootScope, exportedValue.name);
        if (binding) facts.exportedBindings.add(binding);
      }
    });
  }
  if (facts.hasNumberWrite) return false;
  const isReadonlyBinding = (symbol: SymbolDescriptor): boolean => {
    const cached = facts.readonlyBindings.get(symbol);
    if (cached !== undefined) return cached;
    const isReadonly =
      hasCompleteSymbolReferences(symbol, program, scopes) &&
      symbol.references.every(
        (reference) =>
          reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
      );
    facts.readonlyBindings.set(symbol, isReadonly);
    return isReadonly;
  };
  const getDirectFunction = (
    symbol: SymbolDescriptor,
  ): EsTreeNodeOfType<
    "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
  > | null => {
    const initializer = getDirectConstInitializer(symbol);
    const candidate = initializer ? stripParenExpression(initializer) : symbol.declarationNode;
    return isFunctionLike(candidate) &&
      !candidate.async &&
      !candidate.generator &&
      (symbol.kind === "const" || symbol.kind === "function") &&
      isReadonlyBinding(symbol)
      ? candidate
      : null;
  };
  const getDirectCalls = (
    symbol: SymbolDescriptor,
  ): EsTreeNodeOfType<"CallExpression">[] | null => {
    if (facts.directCalls.has(symbol)) return facts.directCalls.get(symbol) ?? null;
    facts.directCalls.set(symbol, null);
    if (!isReadonlyBinding(symbol) || symbol.references.length === 0) return null;
    const declaration = symbol.declarationNode;
    const statement = isNodeOfType(declaration, "VariableDeclarator")
      ? declaration.parent
      : declaration;
    if (
      isNodeOfType(statement?.parent, "ExportNamedDeclaration") ||
      isNodeOfType(statement?.parent, "ExportDefaultDeclaration")
    )
      return null;
    if (facts.exportedBindings.has(symbol)) return null;
    const initializer = getDirectConstInitializer(symbol);
    const calls: EsTreeNodeOfType<"CallExpression">[] = [];
    let earliestCallPosition = program.range[1];
    for (const reference of symbol.references) {
      const root = findTransparentExpressionRoot(reference.identifier);
      const invocation = root.parent;
      if (
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.callee !== root ||
        invocation.optional ||
        invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        return null;
      if (initializer && invocation.range[0] < initializer.range[1]) return null;
      calls.push(invocation);
      earliestCallPosition = Math.min(earliestCallPosition, invocation.range[0]);
    }
    facts.earliestCalls.set(symbol, earliestCallPosition);
    facts.directCalls.set(symbol, calls);
    return calls;
  };
  const isNumericKey = (
    expression: EsTreeNode,
    visiting: ReadonlySet<SymbolDescriptor>,
    evaluationPosition = expression.range[0],
  ): boolean => {
    const candidate = stripParenExpression(expression);
    if (isNodeOfType(candidate, "Literal")) return typeof candidate.value === "number";
    if (isNodeOfType(candidate, "UnaryExpression"))
      return candidate.operator === "+" || candidate.operator === "-" || candidate.operator === "~";
    if (isNodeOfType(candidate, "BinaryExpression"))
      return ["-", "*", "/", "%", "**", "<<", ">>", ">>>", "&", "|", "^"].includes(
        candidate.operator,
      );
    if (isNodeOfType(candidate, "CallExpression")) {
      if (
        candidate.optional ||
        candidate.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        return false;
      const callee = stripParenExpression(candidate.callee);
      if (!isNodeOfType(callee, "Identifier")) return false;
      if (callee.name === "Number" && scopes.isGlobalReference(callee)) return true;
      const symbol = scopes.symbolFor(callee);
      if (!symbol || visiting.has(symbol)) return false;
      const owner = getDirectFunction(symbol);
      const calls = owner && getDirectCalls(symbol);
      if (!owner || !calls) return false;
      const earliestCall = Math.min(
        evaluationPosition,
        facts.earliestCalls.get(symbol) ?? evaluationPosition,
      );
      const nextVisiting = new Set(visiting).add(symbol);
      if (!isNodeOfType(owner.body, "BlockStatement"))
        return isNumericKey(owner.body, nextVisiting, earliestCall);
      const [statement, ...remainingStatements] = owner.body.body;
      return (
        remainingStatements.length === 0 &&
        isNodeOfType(statement, "ReturnStatement") &&
        Boolean(statement.argument && isNumericKey(statement.argument, nextVisiting, earliestCall))
      );
    }
    if (!isNodeOfType(candidate, "Identifier")) return false;
    const symbol = scopes.symbolFor(candidate);
    if (!symbol || visiting.has(symbol) || !isReadonlyBinding(symbol)) return false;
    const nextVisiting = new Set(visiting).add(symbol);
    const initializer = getDirectConstInitializer(symbol);
    if (initializer)
      return (
        initializer.range[1] <= evaluationPosition &&
        isNumericKey(initializer, nextVisiting, initializer.range[0])
      );
    if (symbol.kind !== "parameter") return false;
    const owner = symbol.scope.node;
    if (!isFunctionLike(owner) || owner.async || owner.generator) return false;
    const position = owner.params.findIndex((parameter) => parameter === symbol.bindingIdentifier);
    if (position < 0) return false;
    const bindings = getFunctionBindingSymbols(owner, scopes);
    if (bindings.length === 0) return false;
    return bindings.every((binding) => {
      if (getDirectFunction(binding) !== owner) return false;
      const calls = getDirectCalls(binding);
      return Boolean(
        calls &&
        calls.every(
          (call) =>
            isNodeOfType(call, "CallExpression") &&
            call.arguments[position] &&
            isNumericKey(call.arguments[position], nextVisiting, call.range[0]),
        ),
      );
    });
  };
  const getFreshArray = (expression: EsTreeNode): SymbolDescriptor | null => {
    const candidate = stripParenExpression(expression);
    if (!isNodeOfType(candidate, "Identifier")) return null;
    const symbol = scopes.symbolFor(candidate);
    const initializer = symbol && getDirectConstInitializer(symbol);
    return symbol &&
      initializer &&
      isNodeOfType(stripParenExpression(initializer), "ArrayExpression") &&
      isReadonlyBinding(symbol)
      ? symbol
      : null;
  };
  const isNativeIndexOfArgument = (expression: EsTreeNode): boolean => {
    const invocation = expression.parent;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.optional ||
      invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return false;
    const [argument, ...remainingArguments] = invocation.arguments;
    if (argument !== expression || remainingArguments.length !== 0) return false;
    const callee = stripParenExpression(invocation.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      getStaticPropertyName(callee) !== "indexOf"
    )
      return false;
    const array = getFreshArray(callee.object);
    if (!array) return false;
    const owner = findEnclosingFunction(invocation);
    for (
      let ancestor = invocation.parent;
      ancestor && ancestor !== owner;
      ancestor = ancestor.parent
    ) {
      if (
        [
          "ForStatement",
          "ForInStatement",
          "ForOfStatement",
          "WhileStatement",
          "DoWhileStatement",
        ].includes(ancestor.type)
      )
        return false;
    }
    return array.references.every((reference) => {
      if (findEnclosingFunction(reference.identifier) !== owner) return false;
      const root = findTransparentExpressionRoot(reference.identifier);
      if (root.range[0] >= invocation.range[0]) return true;
      const access = root.parent;
      if (!isNodeOfType(access, "MemberExpression") || access.object !== root || access.optional)
        return false;
      if (access.computed) return isNumericKey(access.property, new Set());
      const accessRoot = findTransparentExpressionRoot(access);
      const operation = accessRoot.parent;
      return (
        isNodeOfType(operation, "CallExpression") &&
        operation.callee === accessRoot &&
        !operation.optional &&
        operation.arguments.length === 0 &&
        getStaticPropertyName(access) === "reverse"
      );
    });
  };
  const isDataUse = (expression: EsTreeNode, visiting: ReadonlySet<SymbolDescriptor>): boolean => {
    const root = findTransparentExpressionRoot(expression);
    const parent = root.parent;
    if (isNodeOfType(parent, "BinaryExpression"))
      return parent.operator !== "in" && parent.operator !== "instanceof";
    if (isNodeOfType(parent, "UnaryExpression")) return parent.operator !== "delete";
    if (isNativeIndexOfArgument(root)) return true;
    if (
      !isNodeOfType(parent, "VariableDeclarator") ||
      parent.init !== root ||
      !isNodeOfType(parent.id, "Identifier")
    )
      return false;
    const symbol = scopes.symbolFor(parent.id);
    if (
      !symbol ||
      visiting.has(symbol) ||
      getDirectConstInitializer(symbol) !== root ||
      !isReadonlyBinding(symbol) ||
      symbol.references.length === 0
    )
      return false;
    const nextVisiting = new Set(visiting).add(symbol);
    return symbol.references.every((reference) => isDataUse(reference.identifier, nextVisiting));
  };
  if (!isNumericKey(member.property, new Set())) return false;
  if (!isMemberMutationTarget(member)) return isDataUse(member, new Set());
  const root = findTransparentExpressionRoot(member);
  const assignment = root.parent;
  return (
    isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.left === root &&
    assignment.operator === "=" &&
    Boolean(getFreshArray(member.object))
  );
};
