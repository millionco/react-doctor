import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { areExpressionsStructurallyEqual } from "./are-expressions-structurally-equal.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "./has-static-property-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { someAst } from "./some-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isSingleGuardCopyOnWriteContainer = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  if (
    symbol?.kind !== "let" ||
    !isNodeOfType(initializer, "MemberExpression") ||
    !isNodeOfType(initializer.object, "Identifier") ||
    findEnclosingFunction(symbol.bindingIdentifier) !== findEnclosingFunction(identifier)
  )
    return false;
  const propertyName = getStaticPropertyName(initializer);
  if (!propertyName || hasPossibleStaticPropertyWrite(initializer.object, propertyName, scopes))
    return false;
  const sourceSymbol = scopes.symbolFor(initializer.object);
  if (
    !sourceSymbol ||
    sourceSymbol.references.some((reference) => {
      if (reference.flag !== "read") return true;
      const parent = findTransparentExpressionRoot(reference.identifier).parent;
      if (isNodeOfType(parent, "ConditionalExpression")) {
        let result: EsTreeNode = parent;
        while (isNodeOfType(result.parent, "ConditionalExpression")) result = result.parent;
        return !isNodeOfType(result.parent, "ReturnStatement");
      }
      if (isNodeOfType(parent, "MemberExpression")) {
        const consumer = findTransparentExpressionRoot(parent).parent;
        return isNodeOfType(consumer, "CallExpression") && consumer.callee === parent;
      }
      return (
        !isNodeOfType(parent, "MemberExpression") &&
        !isNodeOfType(parent, "ReturnStatement") &&
        !(isNodeOfType(parent, "SpreadElement") && isNodeOfType(parent.parent, "ObjectExpression"))
      );
    })
  )
    return false;
  const writes = symbol.references.filter((reference) => reference.flag !== "read");
  if (writes.length !== 1) return false;
  const assignment = findTransparentExpressionRoot(writes[0].identifier).parent;
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
    return false;
  const copy = stripParenExpression(assignment.right);
  if (!isNodeOfType(copy, "ObjectExpression") || copy.properties.length !== 1) return false;
  const spread = copy.properties[0];
  if (
    !isNodeOfType(spread, "SpreadElement") ||
    scopes.symbolFor(stripParenExpression(spread.argument))?.id !== symbol.id
  )
    return false;
  const statement = assignment.parent;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const branch = isNodeOfType(statement.parent, "BlockStatement") ? statement.parent : statement;
  if (
    isNodeOfType(branch, "BlockStatement") &&
    (branch.body.length !== 1 || branch.body[0] !== statement)
  )
    return false;
  const guard = branch.parent;
  if (!isNodeOfType(guard, "IfStatement") || guard.consequent !== branch || guard.alternate)
    return false;
  const block = guard.parent;
  if (!isNodeOfType(block, "BlockStatement")) return false;
  let mutationStatement = identifier;
  while (mutationStatement.parent && mutationStatement.parent !== block)
    mutationStatement = mutationStatement.parent;
  const guardIndex = block.body.findIndex((statement) => statement === guard);
  if (block.body.findIndex((child) => child === mutationStatement) !== guardIndex + 1) return false;
  const test = stripParenExpression(guard.test);
  if (isNodeOfType(test, "BinaryExpression") && test.operator === "===") {
    const left = stripParenExpression(test.left);
    const right = stripParenExpression(test.right);
    let original: EsTreeNode | null = null;
    if (scopes.symbolFor(left)?.id === symbol.id) original = right;
    else if (scopes.symbolFor(right)?.id === symbol.id) original = left;
    return Boolean(
      original &&
      areExpressionsStructurallyEqual(original, initializer, {
        areIdentifiersEqual: (first, second) =>
          Boolean(
            scopes.symbolFor(first) && scopes.symbolFor(first)?.id === scopes.symbolFor(second)?.id,
          ),
      }),
    );
  }
  if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return false;
  const flag = scopes.symbolFor(stripParenExpression(test.argument));
  if (
    flag?.kind !== "let" ||
    flag.scope !== symbol.scope ||
    symbol.bindingIdentifier.range[0] >= block.range[0] ||
    !isNodeOfType(flag.initializer, "Literal") ||
    flag.initializer.value !== false ||
    findEnclosingFunction(flag.bindingIdentifier) !== findEnclosingFunction(identifier)
  )
    return false;
  const flagWrites = flag.references.filter((reference) => reference.flag !== "read");
  if (flagWrites.length !== 1) return false;
  const flagAssignment = findTransparentExpressionRoot(flagWrites[0].identifier).parent;
  return Boolean(
    isNodeOfType(flagAssignment, "AssignmentExpression") &&
    flagAssignment.operator === "=" &&
    isNodeOfType(flagAssignment.right, "Literal") &&
    flagAssignment.right.value === true &&
    isNodeOfType(flagAssignment.parent, "ExpressionStatement") &&
    flagAssignment.parent.parent === block &&
    block.body.findIndex((statement) => statement === flagAssignment.parent) > guardIndex,
  );
};

const mixedCopyReceiversByAnalysis = new WeakMap<
  ScopeAnalysis,
  Map<SymbolDescriptor, ReadonlySet<EsTreeNode>>
>();

const isReturnedObjectValue = (expression: EsTreeNode): boolean => {
  const property = findTransparentExpressionRoot(expression).parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.kind !== "init" ||
    (property.value !== findTransparentExpressionRoot(expression) &&
      !(property.shorthand && !property.computed && property.key === expression)) ||
    property.method ||
    !isNodeOfType(property.parent, "ObjectExpression")
  )
    return false;
  let result = findTransparentExpressionRoot(property.parent);
  while (
    isNodeOfType(result.parent, "ConditionalExpression") &&
    (result.parent.consequent === result || result.parent.alternate === result)
  )
    result = findTransparentExpressionRoot(result.parent);
  return isNodeOfType(result.parent, "ReturnStatement") && result.parent.argument === result;
};

const hasReadOnlyEntryReferences = (
  entry: SymbolDescriptor,
  updaterFunction: EsTreeNode,
  replacementAssignments: ReadonlySet<EsTreeNode>,
): boolean =>
  entry.kind === "const" &&
  entry.references.every((reference) => {
    if (
      reference.flag !== "read" ||
      findEnclosingFunction(reference.identifier) !== updaterFunction
    )
      return false;
    const root = findTransparentExpressionRoot(reference.identifier);
    const parent = root.parent;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!")
      return isNodeOfType(parent.parent, "IfStatement") && parent.parent.test === parent;
    if (isNodeOfType(parent, "SpreadElement") && parent.argument === root) {
      const replacement = parent.parent;
      if (!isNodeOfType(replacement, "ObjectExpression")) return false;
      const assignment = findTransparentExpressionRoot(replacement).parent;
      return Boolean(
        assignment &&
        isNodeOfType(assignment, "AssignmentExpression") &&
        stripParenExpression(assignment.right) === replacement &&
        replacementAssignments.has(assignment),
      );
    }
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== root ||
      parent.optional ||
      getStaticPropertyName(parent) === null
    )
      return false;
    const comparison = findTransparentExpressionRoot(parent).parent;
    return Boolean(
      isNodeOfType(comparison, "BinaryExpression") &&
      (comparison.operator === "===" ||
        comparison.operator === "!==" ||
        comparison.operator === "==" ||
        comparison.operator === "!=" ||
        comparison.operator === "<" ||
        comparison.operator === ">" ||
        comparison.operator === "<=" ||
        comparison.operator === ">="),
    );
  });

const collectMixedCopyWriteReceivers = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): ReadonlySet<EsTreeNode> => {
  const rejected = new Set<EsTreeNode>();
  const initializer = symbol.initializer && stripParenExpression(symbol.initializer);
  const updaterFunction = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    symbol.kind !== "let" ||
    !updaterFunction ||
    !isFunctionLike(updaterFunction) ||
    updaterFunction.async ||
    updaterFunction.generator ||
    !isNodeOfType(initializer, "ConditionalExpression")
  )
    return rejected;
  const test = stripParenExpression(initializer.test);
  const fresh = stripParenExpression(initializer.consequent);
  const borrowed = stripParenExpression(initializer.alternate);
  const flag = isNodeOfType(test, "Identifier") ? scopes.symbolFor(test) : null;
  if (
    flag?.kind !== "let" ||
    flag.scope !== symbol.scope ||
    !flag.initializer ||
    flag.bindingIdentifier.range[0] >= symbol.bindingIdentifier.range[0] ||
    findEnclosingFunction(flag.bindingIdentifier) !== updaterFunction ||
    !isNodeOfType(fresh, "ObjectExpression") ||
    fresh.properties.length !== 0 ||
    !isNodeOfType(borrowed, "MemberExpression") ||
    borrowed.optional ||
    !isNodeOfType(borrowed.object, "Identifier")
  )
    return rejected;
  if (
    someAst(updaterFunction, (node) => {
      if (
        isNodeOfType(node, "WithStatement") ||
        isNodeOfType(node, "AwaitExpression") ||
        isNodeOfType(node, "YieldExpression")
      )
        return true;
      if (!isNodeOfType(node, "CallExpression")) return false;
      const callee = stripParenExpression(node.callee);
      return isNodeOfType(callee, "Identifier") && callee.name === "eval";
    })
  )
    return rejected;
  const propertyName = getStaticPropertyName(borrowed);
  const source = scopes.symbolFor(borrowed.object);
  if (
    !propertyName ||
    !source ||
    hasPossibleStaticPropertyWrite(borrowed.object, propertyName, scopes) ||
    source.references.some((reference) => {
      if (
        reference.flag !== "read" ||
        findEnclosingFunction(reference.identifier) !== updaterFunction
      )
        return true;
      const parent = findTransparentExpressionRoot(reference.identifier).parent;
      if (isNodeOfType(parent, "ConditionalExpression")) {
        let result: EsTreeNode = parent;
        while (isNodeOfType(result.parent, "ConditionalExpression")) result = result.parent;
        return !isNodeOfType(result.parent, "ReturnStatement");
      }
      if (isNodeOfType(parent, "MemberExpression")) {
        if (
          parent.object !== findTransparentExpressionRoot(reference.identifier) ||
          parent.optional
        )
          return true;
        const consumer = findTransparentExpressionRoot(parent).parent;
        return isNodeOfType(consumer, "CallExpression") && consumer.callee === parent;
      }
      return (
        !isNodeOfType(parent, "ReturnStatement") &&
        !(isNodeOfType(parent, "SpreadElement") && isNodeOfType(parent.parent, "ObjectExpression"))
      );
    })
  )
    return rejected;
  const receivers = new Set<EsTreeNode>();
  const replacements = new Set<EsTreeNode>();
  const copies = new Set<EsTreeNode>();
  const copyReads = new Set<EsTreeNode>();
  const commits = new Set<EsTreeNode>();
  const statementIndexesByBlock = new Map<EsTreeNode, ReadonlyMap<EsTreeNode, number>>();
  for (const reference of symbol.references) {
    if (
      findEnclosingFunction(reference.identifier) !== updaterFunction ||
      reference.identifier.range[0] <= symbol.bindingIdentifier.range[0]
    )
      return rejected;
    if (reference.flag !== "read") continue;
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== receiver) continue;
    const assignment = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.left !== findTransparentExpressionRoot(member)
    )
      continue;
    if (assignment.operator !== "=" || member.optional) return rejected;
    const mutation = assignment.parent;
    const block = mutation?.parent;
    if (!isNodeOfType(mutation, "ExpressionStatement") || !isNodeOfType(block, "BlockStatement"))
      return rejected;
    let statementIndexes = statementIndexesByBlock.get(block);
    if (!statementIndexes) {
      statementIndexes = new Map(
        block.body.map((statement, statementIndex) => [statement, statementIndex]),
      );
      statementIndexesByBlock.set(block, statementIndexes);
    }
    const mutationIndex = statementIndexes.get(mutation);
    if (mutationIndex === undefined) return rejected;
    const guard = block.body[mutationIndex - 1];
    const commitStatement = block.body[mutationIndex + 1];
    if (!isNodeOfType(guard, "IfStatement") || guard.alternate) return rejected;
    const guardTest = stripParenExpression(guard.test);
    if (
      !isNodeOfType(guardTest, "UnaryExpression") ||
      guardTest.operator !== "!" ||
      scopes.symbolFor(stripParenExpression(guardTest.argument)) !== flag
    )
      return rejected;
    let copyStatement: EsTreeNode = guard.consequent;
    if (isNodeOfType(copyStatement, "BlockStatement")) {
      if (copyStatement.body.length !== 1) return rejected;
      copyStatement = copyStatement.body[0];
    }
    if (!isNodeOfType(copyStatement, "ExpressionStatement")) return rejected;
    const copyAssignment = copyStatement.expression;
    if (
      !isNodeOfType(copyAssignment, "AssignmentExpression") ||
      copyAssignment.operator !== "=" ||
      !isNodeOfType(copyAssignment.left, "Identifier") ||
      scopes.symbolFor(copyAssignment.left) !== symbol
    )
      return rejected;
    const copy = stripParenExpression(copyAssignment.right);
    if (!isNodeOfType(copy, "ObjectExpression") || copy.properties.length !== 1) return rejected;
    const spread = copy.properties[0];
    if (
      !isNodeOfType(spread, "SpreadElement") ||
      !isNodeOfType(spread.argument, "Identifier") ||
      scopes.symbolFor(spread.argument) !== symbol ||
      !isNodeOfType(commitStatement, "ExpressionStatement")
    )
      return rejected;
    const commit = commitStatement.expression;
    if (
      !isNodeOfType(commit, "AssignmentExpression") ||
      commit.operator !== "=" ||
      !isNodeOfType(commit.left, "Identifier") ||
      scopes.symbolFor(commit.left) !== flag ||
      !isNodeOfType(commit.right, "Literal") ||
      commit.right.value !== true
    )
      return rejected;
    receivers.add(reference.identifier);
    replacements.add(assignment);
    copies.add(copyAssignment.left);
    copyReads.add(spread.argument);
    commits.add(commit.left);
  }
  if (receivers.size === 0) return rejected;
  for (const reference of flag.references) {
    if (
      findEnclosingFunction(reference.identifier) !== updaterFunction ||
      (reference.flag !== "read" && !commits.has(reference.identifier))
    )
      return rejected;
  }
  for (const reference of symbol.references) {
    if (reference.flag !== "read") {
      if (!copies.has(reference.identifier)) return rejected;
      continue;
    }
    if (receivers.has(reference.identifier) || copyReads.has(reference.identifier)) continue;
    const root = findTransparentExpressionRoot(reference.identifier);
    if (isReturnedObjectValue(root)) continue;
    const member = root.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== root || member.optional)
      return rejected;
    const declarator = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !declarator.init ||
      stripParenExpression(declarator.init) !== member ||
      !isNodeOfType(declarator.id, "Identifier")
    )
      return rejected;
    const entry = scopes.symbolFor(declarator.id);
    if (!entry || !hasReadOnlyEntryReferences(entry, updaterFunction, replacements))
      return rejected;
  }
  return receivers;
};

export const isCopyOnWriteContainer = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isSingleGuardCopyOnWriteContainer(identifier, scopes)) return true;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol) return false;
  let receiversBySymbol = mixedCopyReceiversByAnalysis.get(scopes);
  if (!receiversBySymbol) {
    receiversBySymbol = new Map();
    mixedCopyReceiversByAnalysis.set(scopes, receiversBySymbol);
  }
  let receivers = receiversBySymbol.get(symbol);
  if (!receivers) {
    receivers = collectMixedCopyWriteReceivers(symbol, scopes);
    receiversBySymbol.set(symbol, receivers);
  }
  return receivers.has(identifier);
};
