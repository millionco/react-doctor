import { canNodeReachNode } from "./can-node-reach-node.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { nodesCanCoExecute } from "./nodes-can-co-execute.js";
import type { RuleContext } from "./rule-context.js";
import { statementAlwaysExits } from "./statement-always-exits.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { resolveConstIdentifierRootSymbol } from "./resolve-const-identifier-root-symbol.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

interface BranchPredicate {
  statement: EsTreeNode;
  symbols: Set<number>;
  isSimple: boolean;
}

const isIncrementingIndexLoop = (
  loop: EsTreeNodeOfType<"ForStatement">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(loop.init, "VariableDeclaration") ||
    loop.init.kind !== "let" ||
    loop.init.declarations.length !== 1 ||
    !isNodeOfType(loop.test, "BinaryExpression") ||
    loop.test.operator !== "<" ||
    !isNodeOfType(loop.test.left, "Identifier") ||
    !isNodeOfType(loop.update, "UpdateExpression") ||
    loop.update.operator !== "++" ||
    !isNodeOfType(loop.update.argument, "Identifier")
  )
    return false;
  const declaration = loop.init.declarations[0];
  if (
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.init, "Literal") ||
    declaration.init.value !== 0
  )
    return false;
  const counter = context.scopes.symbolFor(declaration.id);
  const testCounter = loop.test.left;
  const incrementCounter = loop.update.argument;
  if (
    !counter ||
    context.scopes.symbolFor(testCounter) !== counter ||
    context.scopes.symbolFor(incrementCounter) !== counter ||
    counter.references.some(
      (reference) =>
        (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier)) &&
        reference.identifier !== counter.bindingIdentifier &&
        reference.identifier !== incrementCounter,
    )
  )
    return false;
  const bound = loop.test.right;
  if (isNodeOfType(bound, "MemberExpression")) {
    if (
      bound.computed ||
      bound.optional ||
      !isNodeOfType(bound.object, "Identifier") ||
      !isNodeOfType(bound.property, "Identifier") ||
      bound.property.name !== "length"
    )
      return false;
    const sequence = context.scopes.symbolFor(bound.object);
    if (!sequence || hasSymbolBindingWrites(sequence)) return false;
    const initializer = sequence.initializer ? stripParenExpression(sequence.initializer) : null;
    if (initializer) {
      const root = isNodeOfType(initializer, "MemberExpression")
        ? getRootIdentifier(initializer)
        : null;
      if (!root || context.scopes.symbolFor(root)?.kind !== "parameter") return false;
    } else if (sequence.kind !== "parameter") return false;
    if (
      !sequence.references.every((reference) => {
        const identifier = reference.identifier;
        if (identifier === sequence.bindingIdentifier || identifier === bound.object) return true;
        const parent = identifier.parent;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === identifier &&
          parent.computed
        ) {
          return (
            isNodeOfType(parent.property, "Identifier") &&
            context.scopes.symbolFor(parent.property) === counter
          );
        }
        if (!isNodeOfType(parent, "UnaryExpression") || parent.operator !== "!") return false;
        let guard: EsTreeNode = parent;
        while (isNodeOfType(guard.parent, "LogicalExpression") && guard.parent.operator === "||") {
          guard = guard.parent;
        }
        return (
          isNodeOfType(guard.parent, "IfStatement") &&
          guard.parent.test === guard &&
          statementAlwaysExits(guard.parent.consequent)
        );
      })
    )
      return false;
  }
  if (
    counter.references.some((reference) => {
      const identifier = reference.identifier;
      if (
        identifier === counter.bindingIdentifier ||
        identifier === testCounter ||
        identifier === incrementCounter
      )
        return false;
      const parent = identifier.parent;
      return (
        !isNodeOfType(parent, "MemberExpression") ||
        !parent.computed ||
        parent.property !== identifier ||
        !isNodeOfType(parent.object, "Identifier") ||
        !isNodeOfType(bound, "MemberExpression") ||
        context.scopes.symbolFor(parent.object) !== context.scopes.symbolFor(bound.object)
      );
    })
  )
    return false;
  let hasAbruptCompletion = false;
  walkAst(loop.body, (candidate) => {
    if (isFunctionLike(candidate)) return false;
    if (
      isNodeOfType(candidate, "ReturnStatement") ||
      isNodeOfType(candidate, "ThrowStatement") ||
      isNodeOfType(candidate, "BreakStatement")
    )
      hasAbruptCompletion = true;
  });
  return (
    !hasAbruptCompletion &&
    ((isNodeOfType(bound, "Literal") &&
      typeof bound.value === "number" &&
      Number.isSafeInteger(bound.value) &&
      bound.value > 0) ||
      (isNodeOfType(bound, "MemberExpression") &&
        !bound.computed &&
        !bound.optional &&
        isNodeOfType(bound.object, "Identifier") &&
        isNodeOfType(bound.property, "Identifier") &&
        bound.property.name === "length"))
  );
};

const statementStopsExecution = (statement: EsTreeNode): boolean => {
  if (
    statementAlwaysExits(statement) ||
    isNodeOfType(statement, "ContinueStatement") ||
    isNodeOfType(statement, "BreakStatement")
  )
    return true;
  if (isNodeOfType(statement, "BlockStatement"))
    return statement.body.some(statementStopsExecution);
  if (isNodeOfType(statement, "IfStatement") && isNodeOfType(statement.test, "Literal")) {
    const branch = statement.test.value ? statement.consequent : statement.alternate;
    return Boolean(branch && statementStopsExecution(branch));
  }
  return false;
};

const hasExitingPredecessor = (node: EsTreeNode, owner: EsTreeNode): boolean => {
  let child = node;
  while (child.parent && child !== owner) {
    const parent = child.parent;
    if (isNodeOfType(parent, "BlockStatement")) {
      for (const statement of parent.body) {
        if (statement === child) break;
        if (statementStopsExecution(statement)) return true;
      }
    }
    child = parent;
  }
  return false;
};

const isDirectAwaitStatement = (node: EsTreeNodeOfType<"AwaitExpression">): boolean =>
  (isNodeOfType(node.parent, "ExpressionStatement") && node.parent.expression === node) ||
  (isNodeOfType(node.parent, "VariableDeclarator") && node.parent.init === node);

export const canResumeAfterAwait = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node.parent, "ExpressionStatement") || node.parent.expression !== node)
    return false;
  const owner = context.cfg.enclosingFunction(node);
  if (!owner || !isFunctionLike(owner) || !owner.async || owner.generator) return false;
  const functionCfg = context.cfg.cfgFor(owner);
  if (
    !functionCfg?.blockOf(node) ||
    !isNodeReachableWithinFunction(node, context) ||
    hasExitingPredecessor(node, owner)
  )
    return false;
  const awaits: EsTreeNodeOfType<"AwaitExpression">[] = [];
  const continues: EsTreeNodeOfType<"ContinueStatement">[] = [];
  const predicates: BranchPredicate[] = [];
  let hasUnsupportedControlFlow = false;
  walkOwnFunctionScope(owner, (candidate) => {
    const callee = isNodeOfType(candidate, "CallExpression")
      ? stripParenExpression(candidate.callee)
      : null;
    if (
      isNodeOfType(candidate, "TryStatement") ||
      isNodeOfType(candidate, "SwitchStatement") ||
      isNodeOfType(candidate, "WhileStatement") ||
      isNodeOfType(candidate, "DoWhileStatement") ||
      isNodeOfType(candidate, "ForInStatement") ||
      isNodeOfType(candidate, "ForOfStatement") ||
      isNodeOfType(candidate, "LabeledStatement") ||
      isNodeOfType(candidate, "WithStatement") ||
      (isNodeOfType(callee, "Identifier") && callee.name === "eval") ||
      (isNodeOfType(candidate, "ForStatement") && !isIncrementingIndexLoop(candidate, context))
    )
      hasUnsupportedControlFlow = true;
    if (isNodeOfType(candidate, "IfStatement")) {
      const test = candidate.test;
      const symbols = new Set<number>();
      walkAst(test, (part) => {
        if (!isNodeOfType(part, "Identifier")) return;
        const symbol = resolveConstIdentifierRootSymbol(part, context.scopes);
        if (symbol) symbols.add(symbol.id);
        const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
        if (isNodeOfType(initializer, "Literal")) hasUnsupportedControlFlow = true;
      });
      const isSimple =
        isNodeOfType(test, "Identifier") ||
        (isNodeOfType(test, "Literal") && typeof test.value === "boolean") ||
        (isNodeOfType(test, "UnaryExpression") &&
          test.operator === "!" &&
          isNodeOfType(test.argument, "Identifier"));
      let testedIdentifier: EsTreeNode | null = null;
      if (isNodeOfType(test, "Identifier")) testedIdentifier = test;
      else if (isNodeOfType(test, "UnaryExpression") && isNodeOfType(test.argument, "Identifier")) {
        testedIdentifier = test.argument;
      }
      const testedSymbol = testedIdentifier
        ? resolveConstIdentifierRootSymbol(testedIdentifier, context.scopes)
        : null;
      if (testedSymbol?.initializer) hasUnsupportedControlFlow = true;
      predicates.push({ statement: candidate, symbols, isSimple });
    }
    if (isNodeOfType(candidate, "AwaitExpression") && isDirectAwaitStatement(candidate))
      awaits.push(candidate);
    if (isNodeOfType(candidate, "ContinueStatement")) {
      continues.push(candidate);
      let ancestor = candidate.parent;
      while (ancestor && ancestor !== owner) {
        if (isNodeOfType(ancestor, "IfStatement")) {
          const test = stripParenExpression(ancestor.test);
          const operand =
            isNodeOfType(test, "UnaryExpression") && test.operator === "!"
              ? stripParenExpression(test.argument)
              : test;
          if (
            !isNodeOfType(operand, "Identifier") &&
            !(
              isNodeOfType(operand, "CallExpression") &&
              isNodeOfType(stripParenExpression(operand.callee), "MemberExpression")
            )
          ) {
            hasUnsupportedControlFlow = true;
          }
          walkAst(test, (part) => {
            if (
              isNodeOfType(part, "LogicalExpression") ||
              isNodeOfType(part, "ConditionalExpression") ||
              isNodeOfType(part, "SequenceExpression") ||
              isNodeOfType(part, "AssignmentExpression") ||
              isNodeOfType(part, "AwaitExpression") ||
              isFunctionLike(part)
            ) {
              hasUnsupportedControlFlow = true;
            }
          });
        }
        ancestor = ancestor.parent;
      }
    }
  });
  if (hasUnsupportedControlFlow) return false;
  if (
    continues.length > 0 &&
    predicates.some((predicate) =>
      predicates.some(
        (other) =>
          other !== predicate && [...predicate.symbols].some((symbol) => other.symbols.has(symbol)),
      ),
    )
  ) {
    return false;
  }
  return awaits.some(
    (suspension) =>
      suspension.range !== undefined &&
      node.range !== undefined &&
      suspension.range[0] < node.range[0] &&
      !continues.some(
        (continuation) =>
          !continuation.range ||
          (continuation.range[0] < (suspension.range?.[0] ?? 0) &&
            predicates.some(
              (predicate) =>
                !predicate.statement.range ||
                (predicate.statement.range[0] > (suspension.range?.[0] ?? 0) &&
                  predicate.statement.range[0] < (node.range?.[0] ?? 0)),
            )),
      ) &&
      !isAstDescendant(node, suspension.argument) &&
      !hasExitingPredecessor(suspension, owner) &&
      !predicates.some(
        (predicate) =>
          !predicate.isSimple &&
          (predicate.symbols.size === 0 ||
            isAstDescendant(suspension, predicate.statement) ||
            isAstDescendant(node, predicate.statement) ||
            predicates.some(
              (other) =>
                other !== predicate &&
                [...predicate.symbols].some((symbol) => other.symbols.has(symbol)),
            )),
      ) &&
      isNodeReachableWithinFunction(suspension, context) &&
      nodesCanCoExecute(suspension, node, context) &&
      canNodeReachNode(suspension, node, functionCfg),
  );
};
