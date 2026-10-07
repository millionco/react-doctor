import {
  OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
  REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
} from "../constants/mutation-methods.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface MutationEvent {
  readonly node: EsTreeNode;
  readonly owner: EsTreeNode;
  readonly propertyNames: ReadonlySet<string> | null;
  readonly symbolId: number;
}

interface LocalCallEvent {
  readonly argumentCall: EsTreeNodeOfType<"CallExpression">;
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly conditionalExitTargets: readonly EsTreeNode[];
  readonly owner: EsTreeNode;
  readonly targetOwner: EsTreeNode;
  readonly yieldCount: number | null;
}

interface SynchronousCallReplay {
  readonly conditionalSuspensions: readonly EsTreeNode[];
  readonly conditionalStartIndex: number;
  readonly cutoffIndex: number;
}

interface ReplayedSymbolMutation {
  readonly isConditional: boolean;
  readonly node: EsTreeNode;
}

interface SymbolMutationInspector {
  readonly getEventsBefore: (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
  ) => ReplayedSymbolMutation[];
  readonly getOutermostTarget: (node: EsTreeNode) => EsTreeNode;
  readonly isGlobalNamespaceMethod: (
    node: EsTreeNode,
    namespaceName: string,
    methodNames: ReadonlySet<string>,
  ) => boolean;
  readonly isExecutionOrderAmbiguous: (usageNode: EsTreeNode) => boolean;
  readonly isMutationOrderAmbiguous: (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ) => boolean;
  readonly isMutatedBefore: (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ) => boolean;
}

const inspectorCache = new WeakMap<ScopeAnalysis, SymbolMutationInspector>();

const getOutermostTarget = (node: EsTreeNode): EsTreeNode => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent) {
    const parent = current.parent;
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== current) break;
    current = findTransparentExpressionRoot(parent);
  }
  return current;
};

const getExecutionOwner = (node: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current) || isNodeOfType(current, "Program")) return current;
    current = current.parent;
  }
  return node;
};

const isAbruptCompletionStatement = (node: EsTreeNode, includesContinue: boolean): boolean => {
  if (
    isNodeOfType(node, "ReturnStatement") ||
    isNodeOfType(node, "ThrowStatement") ||
    isNodeOfType(node, "BreakStatement") ||
    (includesContinue && isNodeOfType(node, "ContinueStatement"))
  ) {
    return true;
  }
  if (isNodeOfType(node, "BlockStatement")) {
    return node.body.some((statement) => isAbruptCompletionStatement(statement, includesContinue));
  }
  if (!isNodeOfType(node, "IfStatement")) return false;
  if (isNodeOfType(node.test, "Literal")) {
    const reachableBranch = node.test.value ? node.consequent : node.alternate;
    return reachableBranch ? isAbruptCompletionStatement(reachableBranch, includesContinue) : false;
  }
  return Boolean(
    node.alternate &&
    isAbruptCompletionStatement(node.consequent, includesContinue) &&
    isAbruptCompletionStatement(node.alternate, includesContinue),
  );
};

const isTerminalStatement = (node: EsTreeNode): boolean => isAbruptCompletionStatement(node, true);

const isAfterTerminalStatement = (node: EsTreeNode, statements: readonly EsTreeNode[]): boolean => {
  const statementIndex = statements.indexOf(node);
  return statementIndex > 0 && statements.slice(0, statementIndex).some(isTerminalStatement);
};

const isStaticallyUnreachable = (node: EsTreeNode, owner: EsTreeNode): boolean => {
  let current = node;
  while (current.parent && current !== owner) {
    const parent = current.parent;
    if (
      (isNodeOfType(parent, "BlockStatement") || isNodeOfType(parent, "Program")) &&
      isAfterTerminalStatement(current, parent.body)
    ) {
      return true;
    }
    if (
      ((isNodeOfType(parent, "WhileStatement") &&
        isNodeOfType(parent.test, "Literal") &&
        !parent.test.value) ||
        (isNodeOfType(parent, "ForStatement") &&
          parent.test &&
          isNodeOfType(parent.test, "Literal") &&
          !parent.test.value)) &&
      parent.body === current
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "SwitchCase") &&
      isAfterTerminalStatement(current, parent.consequent)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "IfStatement") && isNodeOfType(parent.test, "Literal")) {
      if (parent.test.value === false && parent.consequent === current) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression") && isNodeOfType(parent.test, "Literal")) {
      if (parent.test.value === false && parent.consequent === current) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.right === current &&
      isNodeOfType(parent.left, "Literal")
    ) {
      if (parent.operator === "&&" && !parent.left.value) return true;
      if (parent.operator === "||" && Boolean(parent.left.value)) return true;
    }
    current = parent;
  }
  return false;
};

const isConditionallyExecuted = (node: EsTreeNode, owner: EsTreeNode): boolean => {
  let current = node;
  while (current.parent && current !== owner) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement")) {
      if (!isNodeOfType(parent.test, "Literal")) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
      if (parent.test.value === false && parent.consequent === current) return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (!isNodeOfType(parent.test, "Literal")) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
      if (parent.test.value === false && parent.consequent === current) return true;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      if (!isNodeOfType(parent.left, "Literal")) return true;
      if (parent.operator === "&&" && !parent.left.value) return true;
      if (parent.operator === "||" && Boolean(parent.left.value)) return true;
    }
    if (isNodeOfType(parent, "DoWhileStatement")) {
      const isSingleIterationBody =
        parent.body === current && isNodeOfType(parent.test, "Literal") && !parent.test.value;
      if (!isSingleIterationBody) return true;
    }
    if (
      isNodeOfType(parent, "ForStatement") ||
      isNodeOfType(parent, "ForInStatement") ||
      (isNodeOfType(parent, "ForOfStatement") && parent.right !== current) ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "SwitchCase") ||
      isNodeOfType(parent, "CatchClause")
    ) {
      return true;
    }
    if (isNodeOfType(parent, "TryStatement") && parent.block === current) return true;
    if (
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "MemberExpression")) &&
      parent.optional
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const expressionMayThrow = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return false;
  if (isNodeOfType(expression, "Identifier")) {
    if (
      scopes.isGlobalReference(expression) &&
      (expression.name === "undefined" ||
        expression.name === "NaN" ||
        expression.name === "Infinity")
    ) {
      return false;
    }
    const symbol = scopes.symbolFor(expression);
    if (!symbol) return true;
    if (
      symbol.kind === "var" ||
      symbol.kind === "function" ||
      symbol.kind === "parameter" ||
      symbol.kind === "import"
    ) {
      return false;
    }
    return getNodeStartIndex(symbol.declarationNode) > getNodeStartIndex(expression);
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    return expression.elements.some((element) => {
      if (!element) return false;
      if (isNodeOfType(element, "SpreadElement")) return true;
      return expressionMayThrow(element, scopes);
    });
  }
  if (isNodeOfType(expression, "ObjectExpression")) return expression.properties.length > 0;
  if (isNodeOfType(expression, "TemplateLiteral")) return expression.expressions.length > 0;
  if (isNodeOfType(expression, "UnaryExpression")) {
    const argument = stripParenExpression(expression.argument);
    if (
      expression.operator === "typeof" &&
      isNodeOfType(argument, "Identifier") &&
      !scopes.symbolFor(argument)
    ) {
      return false;
    }
    if (expressionMayThrow(argument, scopes)) return true;
    if (expression.operator === "void" || expression.operator === "typeof") return false;
    if (expression.operator === "!") return false;
    return !(
      isNodeOfType(argument, "Literal") &&
      (typeof argument.value === "number" || typeof argument.value === "string")
    );
  }
  return true;
};

const tryBlockPrefixMayEscape = (
  node: EsTreeNode,
  block: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  let current = node;
  while (current.parent && current.parent !== block) current = current.parent;
  const statementIndex = block.body.findIndex((statement) => statement === current);
  if (current.parent !== block || statementIndex <= 0) return false;
  return block.body.slice(0, statementIndex).some((statement) => {
    if (isNodeOfType(statement, "EmptyStatement")) return false;
    if (isNodeOfType(statement, "ExpressionStatement")) {
      return expressionMayThrow(statement.expression, scopes);
    }
    if (isNodeOfType(statement, "VariableDeclaration")) {
      return statement.declarations.some(
        (declaration) =>
          !isNodeOfType(declaration.id, "Identifier") ||
          Boolean(declaration.init && expressionMayThrow(declaration.init, scopes)),
      );
    }
    return true;
  });
};

const suspensionOperandMayThrow = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "AwaitExpression")) return false;
  return expressionMayThrow(node.argument, scopes);
};

const isPossiblySkippedSuspension = (
  node: EsTreeNode,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let current = node;
  while (current.parent && current !== owner) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement")) {
      if (!isNodeOfType(parent.test, "Literal")) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
      if (parent.test.value === false && parent.consequent === current) return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (!isNodeOfType(parent.test, "Literal")) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
      if (parent.test.value === false && parent.consequent === current) return true;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      if (!isNodeOfType(parent.left, "Literal")) return true;
      if (parent.operator === "&&" && !parent.left.value) return true;
      if (parent.operator === "||" && Boolean(parent.left.value)) return true;
    }
    if (
      (isNodeOfType(parent, "WhileStatement") &&
        (!isNodeOfType(parent.test, "Literal") || !parent.test.value)) ||
      (isNodeOfType(parent, "ForStatement") &&
        parent.test &&
        (!isNodeOfType(parent.test, "Literal") || !parent.test.value)) ||
      isNodeOfType(parent, "ForInStatement") ||
      isNodeOfType(parent, "ForOfStatement") ||
      isNodeOfType(parent, "SwitchCase") ||
      isNodeOfType(parent, "CatchClause")
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "TryStatement") &&
      parent.block === current &&
      isNodeOfType(current, "BlockStatement") &&
      (tryBlockPrefixMayEscape(node, current, scopes) || suspensionOperandMayThrow(node, scopes))
    ) {
      return true;
    }
    if (
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "MemberExpression")) &&
      parent.optional
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const getConditionalExecutionRegion = (node: EsTreeNode, owner: EsTreeNode): EsTreeNode | null => {
  let current = node;
  while (current.parent && current !== owner) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement")) {
      if (!isNodeOfType(parent.test, "Literal")) return current;
      if (parent.test.value === true && parent.alternate === current) return current;
      if (parent.test.value === false && parent.consequent === current) return current;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (!isNodeOfType(parent.test, "Literal")) return current;
      if (parent.test.value === true && parent.alternate === current) return current;
      if (parent.test.value === false && parent.consequent === current) return current;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      if (!isNodeOfType(parent.left, "Literal")) return current;
      if (parent.operator === "&&" && !parent.left.value) return current;
      if (parent.operator === "||" && Boolean(parent.left.value)) return current;
    }
    if (
      isNodeOfType(parent, "ForStatement") ||
      isNodeOfType(parent, "ForInStatement") ||
      isNodeOfType(parent, "ForOfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "SwitchCase") ||
      isNodeOfType(parent, "CatchClause")
    ) {
      return current;
    }
    if (isNodeOfType(parent, "TryStatement") && parent.block === current) return current;
    if (
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "MemberExpression")) &&
      parent.optional
    ) {
      return current;
    }
    current = parent;
  }
  return null;
};

const getSuspensionCutoffIndex = (node: EsTreeNode): number => {
  if (isNodeOfType(node, "AwaitExpression") || isNodeOfType(node, "YieldExpression")) {
    return node.argument ? getNodeEndIndex(node.argument) : getNodeEndIndex(node);
  }
  if (isNodeOfType(node, "ForOfStatement")) return getNodeEndIndex(node.right);
  return getNodeStartIndex(node);
};

const conditionalSuspensionPreventsOperation = (
  suspension: EsTreeNode,
  operationNode: EsTreeNode,
  owner: EsTreeNode,
): boolean => {
  if (getNodeStartIndex(operationNode) < getSuspensionCutoffIndex(suspension)) return false;
  const conditionalRegion = getConditionalExecutionRegion(suspension, owner);
  return Boolean(conditionalRegion && isDescendantOf(operationNode, conditionalRegion));
};

export const getSymbolMutationInspector = (scopes: ScopeAnalysis): SymbolMutationInspector => {
  const cached = inspectorCache.get(scopes);
  if (cached) return cached;

  const isGlobalNamespaceMethod = (
    node: EsTreeNode,
    namespaceName: string,
    methodNames: ReadonlySet<string>,
  ): boolean => {
    const callee = stripParenExpression(node);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const receiver = stripParenExpression(callee.object);
    return Boolean(
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === namespaceName &&
      scopes.isGlobalReference(receiver) &&
      methodNames.has(getStaticPropertyName(callee) ?? ""),
    );
  };

  const getObjectExpressionPropertyNames = (node: EsTreeNode): ReadonlySet<string> | null => {
    const expression = stripParenExpression(node);
    if (!isNodeOfType(expression, "ObjectExpression")) return null;
    const propertyNames = new Set<string>();
    for (const property of expression.properties) {
      if (!isNodeOfType(property, "Property")) return null;
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (propertyName === null) return null;
      propertyNames.add(propertyName);
    }
    return propertyNames;
  };

  const getMutationPropertyNames = (node: EsTreeNode): ReadonlySet<string> | null | undefined => {
    const target = getOutermostTarget(node);
    const parent = target.parent;
    if (!parent) return undefined;
    if (
      (isNodeOfType(parent, "AssignmentExpression") && parent.left === target) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === target) ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete")
    ) {
      if (!isNodeOfType(target, "MemberExpression")) return null;
      const propertyName = getStaticPropertyName(target);
      return propertyName === null ? null : new Set([propertyName]);
    }
    if (!isNodeOfType(parent, "CallExpression") || parent.arguments[0] !== target) return undefined;
    if (isGlobalNamespaceMethod(parent.callee, "Object", OBJECT_PROPERTY_MUTATION_METHOD_NAMES)) {
      const callee = stripParenExpression(parent.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return undefined;
      const methodName = getStaticPropertyName(callee);
      if (methodName === "assign") {
        const assignedProperties = parent.arguments.slice(1).map(getObjectExpressionPropertyNames);
        if (assignedProperties.some((properties) => properties === null)) return null;
        return new Set(assignedProperties.flatMap((properties) => [...(properties ?? [])]));
      }
      if (methodName === "defineProperties") {
        const propertyDescriptors = parent.arguments[1];
        return propertyDescriptors ? getObjectExpressionPropertyNames(propertyDescriptors) : null;
      }
      const propertyKey = parent.arguments[1];
      return propertyKey &&
        isNodeOfType(propertyKey, "Literal") &&
        typeof propertyKey.value === "string"
        ? new Set([propertyKey.value])
        : null;
    }
    if (isGlobalNamespaceMethod(parent.callee, "Reflect", REFLECT_PROPERTY_MUTATION_METHOD_NAMES)) {
      const propertyKey = parent.arguments[1];
      return propertyKey &&
        isNodeOfType(propertyKey, "Literal") &&
        typeof propertyKey.value === "string"
        ? new Set([propertyKey.value])
        : null;
    }
    return undefined;
  };

  const generatorCallStopsAtYield = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
    const callRoot = findTransparentExpressionRoot(call);
    const parent = callRoot.parent;
    if (isNodeOfType(parent, "ForOfStatement") && parent.right === callRoot) {
      return parent.await || isAbruptCompletionStatement(parent.body, false);
    }
    const member = parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== callRoot ||
      getStaticPropertyName(member) !== "next"
    ) {
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    return Boolean(
      isNodeOfType(memberRoot.parent, "CallExpression") && memberRoot.parent.callee === memberRoot,
    );
  };

  const generatorCallIsExhausted = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
    const callRoot = findTransparentExpressionRoot(call);
    const parent = callRoot.parent;
    if (
      isNodeOfType(parent, "ForOfStatement") &&
      !parent.await &&
      parent.right === callRoot &&
      !isAbruptCompletionStatement(parent.body, false)
    ) {
      return true;
    }
    return Boolean(
      isNodeOfType(parent, "SpreadElement") &&
      parent.parent &&
      !isNodeOfType(parent.parent, "ObjectExpression"),
    );
  };

  const getGeneratorConditionalExitTargets = (
    call: EsTreeNodeOfType<"CallExpression">,
  ): readonly EsTreeNode[] => {
    const callRoot = findTransparentExpressionRoot(call);
    const parent = callRoot.parent;
    if (
      !isNodeOfType(parent, "ForOfStatement") ||
      parent.await ||
      parent.right !== callRoot ||
      isAbruptCompletionStatement(parent.body, false)
    ) {
      return [];
    }
    const bodyOwner = getExecutionOwner(parent.body);
    const conditionalExitTargets = new Set<EsTreeNode>();
    walkAst(parent.body, (node) => {
      if (getExecutionOwner(node) !== bodyOwner) return;
      if (!isNodeOfType(node, "BreakStatement")) return;
      let current: EsTreeNode | null | undefined = node;
      if (node.label) {
        while (current?.parent) {
          const currentParent: EsTreeNode = current.parent;
          if (
            isNodeOfType(currentParent, "LabeledStatement") &&
            currentParent.label.name === node.label.name
          ) {
            if (isDescendantOf(parent, currentParent.body)) {
              conditionalExitTargets.add(currentParent);
            }
            return;
          }
          current = currentParent;
        }
        return;
      }
      while (current?.parent) {
        const currentParent: EsTreeNode = current.parent;
        if (
          isNodeOfType(currentParent, "ForStatement") ||
          isNodeOfType(currentParent, "ForInStatement") ||
          isNodeOfType(currentParent, "ForOfStatement") ||
          isNodeOfType(currentParent, "WhileStatement") ||
          isNodeOfType(currentParent, "DoWhileStatement") ||
          isNodeOfType(currentParent, "SwitchStatement")
        ) {
          if (isNodeOfType(currentParent, "ForOfStatement") && currentParent.right === callRoot) {
            conditionalExitTargets.add(currentParent);
          }
          return;
        }
        current = currentParent;
      }
    });
    return [...conditionalExitTargets];
  };

  const getFunctionCallTarget = (call: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
    const callee = stripParenExpression(call.callee);
    let target: EsTreeNode | null = null;
    if (isFunctionLike(callee)) {
      target = callee;
    } else if (isNodeOfType(callee, "Identifier")) {
      const symbol = resolveConstIdentifierAlias(callee, scopes);
      if (symbol?.kind === "function" && isFunctionLike(symbol.declarationNode)) {
        target = symbol.declarationNode;
      } else if (symbol?.kind === "const" && symbol.initializer) {
        const initializer = stripParenExpression(symbol.initializer);
        if (isFunctionLike(initializer)) target = initializer;
      }
    }
    return target && isFunctionLike(target) ? target : null;
  };

  const getLocalCallTarget = (call: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
    const target = getFunctionCallTarget(call);
    if (!target || !isFunctionLike(target)) return null;
    if (!target.generator) return target;
    return generatorCallStopsAtYield(call) || generatorCallIsExhausted(call) ? target : null;
  };

  const calls: LocalCallEvent[] = [];
  const eventsBySymbolId = new Map<number, MutationEvent[]>();
  walkAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "CallExpression")) {
      const owner = getExecutionOwner(node);
      const targetOwner = getLocalCallTarget(node);
      if (targetOwner && !isStaticallyUnreachable(node, owner)) {
        calls.push({
          argumentCall: node,
          call: node,
          conditionalExitTargets:
            isFunctionLike(targetOwner) && targetOwner.generator
              ? getGeneratorConditionalExitTargets(node)
              : [],
          owner,
          targetOwner,
          yieldCount:
            isFunctionLike(targetOwner) && targetOwner.generator
              ? generatorCallStopsAtYield(node)
                ? 1
                : null
              : null,
        });
      }
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const propertyNames = getMutationPropertyNames(node);
    if (propertyNames === undefined) return;
    const symbol = resolveConstIdentifierAlias(node, scopes);
    if (!symbol) return;
    const owner = getExecutionOwner(node);
    if (isStaticallyUnreachable(node, owner)) return;
    const events = eventsBySymbolId.get(symbol.id) ?? [];
    events.push({ node, owner, propertyNames, symbolId: symbol.id });
    eventsBySymbolId.set(symbol.id, events);
  });
  const getInvokedOwnersBefore = (checkpoint: EsTreeNode): Set<EsTreeNode> => {
    const checkpointOwner = getExecutionOwner(checkpoint);
    const checkpointStartIndex = getNodeStartIndex(checkpoint);
    const invokedOwners = new Set<EsTreeNode>();
    const visitOwner = (owner: EsTreeNode, cutoffIndex: number): void => {
      for (const call of calls) {
        if (call.owner !== owner || getNodeStartIndex(call.call) >= cutoffIndex) continue;
        if (invokedOwners.has(call.targetOwner)) continue;
        invokedOwners.add(call.targetOwner);
        visitOwner(call.targetOwner, Number.POSITIVE_INFINITY);
      }
    };
    visitOwner(checkpointOwner, checkpointStartIndex);
    if (!isNodeOfType(checkpointOwner, "Program")) {
      visitOwner(scopes.rootScope.node, Number.POSITIVE_INFINITY);
    }
    return invokedOwners;
  };

  const getProgramCutoffIndex = (usageOwner: EsTreeNode): number => {
    if (isNodeOfType(usageOwner, "Program")) return Number.POSITIVE_INFINITY;
    const directProgramCall = calls.find(
      (call) => isNodeOfType(call.owner, "Program") && call.targetOwner === usageOwner,
    );
    return directProgramCall ? getNodeStartIndex(directProgramCall.call) : Number.POSITIVE_INFINITY;
  };

  const callsByOwner = new Map<EsTreeNode, LocalCallEvent[]>();
  for (const call of calls) {
    const ownerCalls = callsByOwner.get(call.owner) ?? [];
    ownerCalls.push(call);
    callsByOwner.set(call.owner, ownerCalls);
  }
  const ownerReachabilityCache = new WeakMap<EsTreeNode, WeakMap<EsTreeNode, boolean>>();
  const canOwnerReach = (owner: EsTreeNode, targetOwner: EsTreeNode): boolean => {
    const cachedResult = ownerReachabilityCache.get(owner)?.get(targetOwner);
    if (cachedResult !== undefined) return cachedResult;
    const pendingOwners = [owner];
    const visitedOwners = new Set<EsTreeNode>();
    let canReach = false;
    while (pendingOwners.length > 0) {
      const currentOwner = pendingOwners.pop();
      if (!currentOwner || visitedOwners.has(currentOwner)) continue;
      if (currentOwner === targetOwner) {
        canReach = true;
        break;
      }
      visitedOwners.add(currentOwner);
      for (const call of callsByOwner.get(currentOwner) ?? []) {
        pendingOwners.push(call.targetOwner);
      }
    }
    const cachedTargets = ownerReachabilityCache.get(owner) ?? new WeakMap<EsTreeNode, boolean>();
    cachedTargets.set(targetOwner, canReach);
    ownerReachabilityCache.set(owner, cachedTargets);
    return canReach;
  };

  const getRepeatedControlFlowAncestors = (
    node: EsTreeNode,
    owner: EsTreeNode,
  ): Set<EsTreeNode> => {
    const ancestors = new Set<EsTreeNode>();
    let current: EsTreeNode | null | undefined = node;
    while (current?.parent && current !== owner) {
      const parent: EsTreeNode = current.parent;
      const isSingleIterationDoWhile =
        isNodeOfType(parent, "DoWhileStatement") &&
        isNodeOfType(parent.test, "Literal") &&
        !parent.test.value;
      const loopBody =
        isNodeOfType(parent, "ForStatement") ||
        isNodeOfType(parent, "ForInStatement") ||
        isNodeOfType(parent, "ForOfStatement") ||
        isNodeOfType(parent, "WhileStatement") ||
        isNodeOfType(parent, "DoWhileStatement")
          ? parent.body
          : null;
      let bodyStatement: EsTreeNode | null = node;
      while (
        loopBody &&
        isNodeOfType(loopBody, "BlockStatement") &&
        bodyStatement &&
        bodyStatement.parent !== loopBody
      ) {
        bodyStatement = bodyStatement.parent ?? null;
      }
      const bodyStatementIndex =
        loopBody && isNodeOfType(loopBody, "BlockStatement") && bodyStatement
          ? loopBody.body.findIndex((statement) => statement === bodyStatement)
          : -1;
      const hasFollowingLoopExit = Boolean(
        loopBody &&
        isNodeOfType(loopBody, "BlockStatement") &&
        bodyStatementIndex >= 0 &&
        loopBody.body
          .slice(bodyStatementIndex + 1)
          .some((statement) => isAbruptCompletionStatement(statement, false)),
      );
      if (loopBody && !isSingleIterationDoWhile && !hasFollowingLoopExit) {
        ancestors.add(parent);
      }
      current = parent;
    }
    return ancestors;
  };

  const nodesShareRepeatedControlFlow = (
    leftNode: EsTreeNode,
    rightNode: EsTreeNode,
    owner: EsTreeNode,
  ): boolean => {
    const leftAncestors = getRepeatedControlFlowAncestors(leftNode, owner);
    if (leftAncestors.size === 0) return false;
    return [...getRepeatedControlFlowAncestors(rightNode, owner)].some((ancestor) =>
      leftAncestors.has(ancestor),
    );
  };

  const callsReachingOwnerCache = new WeakMap<EsTreeNode, Map<EsTreeNode, LocalCallEvent[]>>();
  const getCallsReachingOwnerByCaller = (
    targetOwner: EsTreeNode,
  ): Map<EsTreeNode, LocalCallEvent[]> => {
    const cachedCalls = callsReachingOwnerCache.get(targetOwner);
    if (cachedCalls) return cachedCalls;
    const reachingCalls = new Map<EsTreeNode, LocalCallEvent[]>();
    for (const call of calls) {
      if (!canOwnerReach(call.targetOwner, targetOwner)) continue;
      const ownerCalls = reachingCalls.get(call.owner) ?? [];
      ownerCalls.push(call);
      reachingCalls.set(call.owner, ownerCalls);
    }
    callsReachingOwnerCache.set(targetOwner, reachingCalls);
    return reachingCalls;
  };

  const canMutationReachUsageAcrossCalls = (
    mutationOwner: EsTreeNode,
    usageOwner: EsTreeNode,
  ): boolean => {
    const mutationCallsByOwner = getCallsReachingOwnerByCaller(mutationOwner);
    const usageCallsByOwner = getCallsReachingOwnerByCaller(usageOwner);
    for (const [owner, mutationCalls] of mutationCallsByOwner) {
      const usageCalls = usageCallsByOwner.get(owner);
      if (!usageCalls) continue;
      for (const mutationCall of mutationCalls) {
        for (const usageCall of usageCalls) {
          if (mutationCall === usageCall) continue;
          if (
            getNodeStartIndex(mutationCall.call) < getNodeStartIndex(usageCall.call) ||
            isFunctionLike(owner) ||
            nodesShareRepeatedControlFlow(mutationCall.call, usageCall.call, owner)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const isExecutionOrderAmbiguous = (usageNode: EsTreeNode): boolean => {
    const usageOwner = getExecutionOwner(usageNode);
    if (isNodeOfType(usageOwner, "Program")) return false;
    const reachingProgramCalls = calls.filter(
      (call) => isNodeOfType(call.owner, "Program") && canOwnerReach(call.targetOwner, usageOwner),
    );
    if (reachingProgramCalls.length === 0) return false;
    return reachingProgramCalls.length !== 1 || reachingProgramCalls[0]?.targetOwner !== usageOwner;
  };

  const mutationEventIsDirectRebind = (event: MutationEvent): boolean => {
    const target = getOutermostTarget(event.node);
    const parent = target.parent;
    return Boolean(
      isNodeOfType(target, "Identifier") &&
      parent &&
      ((isNodeOfType(parent, "AssignmentExpression") && parent.left === target) ||
        (isNodeOfType(parent, "UpdateExpression") && parent.argument === target)),
    );
  };

  const getExpressionActiveCondition = (
    node: EsTreeNode,
    activeSymbolConditions: ReadonlyMap<number, boolean>,
  ): boolean | null => {
    const expression = stripParenExpression(node);
    if (isNodeOfType(expression, "Identifier")) {
      const symbol = resolveConstIdentifierAlias(expression, scopes);
      return symbol && activeSymbolConditions.has(symbol.id)
        ? (activeSymbolConditions.get(symbol.id) ?? false)
        : null;
    }
    if (isNodeOfType(expression, "SequenceExpression")) {
      const finalExpression = expression.expressions.at(-1);
      return finalExpression
        ? getExpressionActiveCondition(finalExpression, activeSymbolConditions)
        : null;
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      const consequentCondition = getExpressionActiveCondition(
        expression.consequent,
        activeSymbolConditions,
      );
      const alternateCondition = getExpressionActiveCondition(
        expression.alternate,
        activeSymbolConditions,
      );
      if (consequentCondition === null && alternateCondition === null) return null;
      if (consequentCondition === null || alternateCondition === null) return true;
      return consequentCondition || alternateCondition;
    }
    if (isNodeOfType(expression, "LogicalExpression")) {
      const leftCondition = getExpressionActiveCondition(expression.left, activeSymbolConditions);
      const rightCondition = getExpressionActiveCondition(expression.right, activeSymbolConditions);
      if (leftCondition !== null) {
        return expression.operator === "&&" ? rightCondition : leftCondition;
      }
      return rightCondition === null ? null : true;
    }
    return null;
  };

  const updateActiveSymbolAfterRebind = (
    event: MutationEvent,
    activeSymbolConditions: Map<number, boolean>,
  ): void => {
    const target = getOutermostTarget(event.node);
    const parent = target.parent;
    if (!parent || !isNodeOfType(parent, "AssignmentExpression")) {
      activeSymbolConditions.delete(event.symbolId);
      return;
    }
    const currentCondition = activeSymbolConditions.get(event.symbolId) ?? false;
    let reboundCondition: boolean | null = null;
    if (parent.operator === "||=" || parent.operator === "??=") {
      reboundCondition = currentCondition;
    } else if (parent.operator === "=" || parent.operator === "&&=") {
      reboundCondition = getExpressionActiveCondition(parent.right, activeSymbolConditions);
    }
    const isConditionalRebind = isConditionallyExecuted(event.node, event.owner);
    if (reboundCondition !== null) {
      activeSymbolConditions.set(
        event.symbolId,
        isConditionalRebind ? currentCondition || reboundCondition : reboundCondition,
      );
    } else if (isConditionalRebind) {
      activeSymbolConditions.set(event.symbolId, true);
    } else {
      activeSymbolConditions.delete(event.symbolId);
    }
  };

  const getCalledActiveSymbolConditions = (
    callEvent: LocalCallEvent,
    activeSymbolConditions: ReadonlyMap<number, boolean>,
  ): ReadonlyMap<number, boolean> => {
    if (!isFunctionLike(callEvent.targetOwner)) return activeSymbolConditions;
    const calledActiveSymbolConditions = new Map(activeSymbolConditions);
    for (const [parameterIndex, parameter] of callEvent.targetOwner.params.entries()) {
      const binding = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
      if (!isNodeOfType(binding, "Identifier")) continue;
      const argument = callEvent.argumentCall.arguments[parameterIndex];
      const unwrappedArgument =
        argument && !isNodeOfType(argument, "SpreadElement")
          ? stripParenExpression(argument)
          : null;
      let argumentExpression: EsTreeNode | null = null;
      const usesDefaultValue = Boolean(
        isNodeOfType(parameter, "AssignmentPattern") &&
        (!unwrappedArgument ||
          (isNodeOfType(unwrappedArgument, "Identifier") &&
            unwrappedArgument.name === "undefined" &&
            scopes.isGlobalReference(unwrappedArgument)) ||
          (isNodeOfType(unwrappedArgument, "UnaryExpression") &&
            unwrappedArgument.operator === "void")),
      );
      if (usesDefaultValue && isNodeOfType(parameter, "AssignmentPattern")) {
        argumentExpression = stripParenExpression(parameter.right);
      } else if (unwrappedArgument) {
        argumentExpression = unwrappedArgument;
      }
      if (!isNodeOfType(argumentExpression, "Identifier")) continue;
      const argumentSymbol = resolveConstIdentifierAlias(argumentExpression, scopes);
      if (!argumentSymbol || !activeSymbolConditions.has(argumentSymbol.id)) continue;
      const parameterSymbol = scopes.symbolFor(binding);
      if (parameterSymbol) {
        calledActiveSymbolConditions.set(
          parameterSymbol.id,
          activeSymbolConditions.get(argumentSymbol.id) ?? false,
        );
      }
    }
    return calledActiveSymbolConditions;
  };

  const getSynchronousCallReplay = (
    callEvent: LocalCallEvent,
    usageNode?: EsTreeNode,
  ): SynchronousCallReplay => {
    if (!isFunctionLike(callEvent.targetOwner)) {
      return {
        conditionalSuspensions: [],
        conditionalStartIndex: Number.POSITIVE_INFINITY,
        cutoffIndex: Number.POSITIVE_INFINITY,
      };
    }
    const suspensionTypes = new Set<string>();
    if (callEvent.targetOwner.async) {
      suspensionTypes.add("AwaitExpression");
      suspensionTypes.add("ForOfStatement");
    }
    const hasReachableConditionalExit = callEvent.conditionalExitTargets.some(
      (target) => !usageNode || !isDescendantOf(usageNode, target),
    );
    if (callEvent.yieldCount !== null || hasReachableConditionalExit) {
      suspensionTypes.add("YieldExpression");
    }
    const conditionalSuspensions: EsTreeNode[] = [];
    let conditionalStartIndex = Number.POSITIVE_INFINITY;
    let cutoffIndex = Number.POSITIVE_INFINITY;
    let encounteredYieldCount = 0;
    walkAst(callEvent.targetOwner.body, (node) => {
      if (
        getExecutionOwner(node) !== callEvent.targetOwner ||
        isStaticallyUnreachable(node, callEvent.targetOwner)
      ) {
        return;
      }
      const isSuspension = Boolean(
        suspensionTypes.has(node.type) && (!isNodeOfType(node, "ForOfStatement") || node.await),
      );
      if (!isSuspension) return;
      const yieldArgument =
        isNodeOfType(node, "YieldExpression") && node.argument
          ? stripParenExpression(node.argument)
          : null;
      if (
        isNodeOfType(node, "YieldExpression") &&
        node.delegate &&
        yieldArgument &&
        ((isNodeOfType(yieldArgument, "ArrayExpression") && yieldArgument.elements.length === 0) ||
          (isNodeOfType(yieldArgument, "Literal") && yieldArgument.value === ""))
      ) {
        return;
      }
      const suspensionIndex = getSuspensionCutoffIndex(node);
      if (isNodeOfType(node, "YieldExpression")) {
        encounteredYieldCount += 1;
        if (hasReachableConditionalExit && encounteredYieldCount >= 1) {
          conditionalStartIndex = Math.min(conditionalStartIndex, suspensionIndex);
          return;
        }
        if (callEvent.yieldCount === null) return;
        if (encounteredYieldCount > callEvent.yieldCount) return;
      }
      if (isPossiblySkippedSuspension(node, callEvent.targetOwner, scopes)) {
        conditionalSuspensions.push(node);
        conditionalStartIndex = Math.min(conditionalStartIndex, suspensionIndex);
      } else {
        cutoffIndex = Math.min(cutoffIndex, suspensionIndex);
      }
    });
    return {
      conditionalSuspensions,
      conditionalStartIndex: Math.min(conditionalStartIndex, cutoffIndex),
      cutoffIndex,
    };
  };

  const callMayMutateActiveSymbol = (
    initialCall: LocalCallEvent,
    initialActiveSymbolConditions: ReadonlyMap<number, boolean>,
    relevantPropertyName: string | null,
  ): boolean => {
    const visitCall = (
      callEvent: LocalCallEvent,
      activeOwners: ReadonlySet<EsTreeNode>,
      activeSymbolConditions: ReadonlyMap<number, boolean>,
    ): boolean => {
      if (activeOwners.has(callEvent.targetOwner)) return false;
      const nextActiveOwners = new Set(activeOwners);
      nextActiveOwners.add(callEvent.targetOwner);
      const currentActiveSymbolConditions = new Map(
        getCalledActiveSymbolConditions(callEvent, activeSymbolConditions),
      );
      const replay = getSynchronousCallReplay(callEvent);
      const operations = [
        ...[...currentActiveSymbolConditions.keys()]
          .flatMap((symbolId) => eventsBySymbolId.get(symbolId) ?? [])
          .filter((event) => event.owner === callEvent.targetOwner)
          .map((event) => ({ event, index: getNodeStartIndex(event.node) })),
        ...calls
          .filter((nestedCall) => nestedCall.owner === callEvent.targetOwner)
          .map((nestedCall) => ({ call: nestedCall, index: getNodeStartIndex(nestedCall.call) })),
      ].sort((left, right) => left.index - right.index);
      for (const operation of operations) {
        if (operation.index >= replay.cutoffIndex) break;
        const operationNode = "event" in operation ? operation.event.node : operation.call.call;
        if (
          replay.conditionalSuspensions.some((suspension) =>
            conditionalSuspensionPreventsOperation(
              suspension,
              operationNode,
              callEvent.targetOwner,
            ),
          )
        ) {
          continue;
        }
        if ("event" in operation) {
          if (!currentActiveSymbolConditions.has(operation.event.symbolId)) continue;
          if (mutationEventIsDirectRebind(operation.event)) {
            updateActiveSymbolAfterRebind(operation.event, currentActiveSymbolConditions);
            continue;
          }
          if (
            relevantPropertyName === null ||
            operation.event.propertyNames === null ||
            operation.event.propertyNames.has(relevantPropertyName)
          ) {
            return true;
          }
          continue;
        }
        if (visitCall(operation.call, nextActiveOwners, currentActiveSymbolConditions)) {
          return true;
        }
      }
      return false;
    };
    return visitCall(initialCall, new Set(), initialActiveSymbolConditions);
  };

  const isMutationOrderAmbiguous = (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ): boolean => {
    const usageOwner = getExecutionOwner(usageNode);
    const usageStartIndex = getNodeStartIndex(usageNode);
    const hasAmbiguousDirectMutation = (eventsBySymbolId.get(symbol.id) ?? []).some((event) => {
      if (
        relevantPropertyName !== null &&
        event.propertyNames !== null &&
        !event.propertyNames.has(relevantPropertyName)
      ) {
        return false;
      }
      if (event.owner === usageOwner) {
        return (
          getNodeStartIndex(event.node) >= usageStartIndex &&
          (isFunctionLike(usageOwner) ||
            nodesShareRepeatedControlFlow(event.node, usageNode, usageOwner))
        );
      }
      if (isNodeOfType(event.owner, "Program")) {
        const usageCalls = getCallsReachingOwnerByCaller(usageOwner).get(event.owner) ?? [];
        return usageCalls.some((usageCall) =>
          nodesShareRepeatedControlFlow(event.node, usageCall.call, event.owner),
        );
      }
      return (
        canOwnerReach(event.owner, usageOwner) ||
        canMutationReachUsageAcrossCalls(event.owner, usageOwner)
      );
    });
    if (hasAmbiguousDirectMutation) return true;
    const activeSymbolConditions = new Map([[symbol.id, false]]);
    return calls.some(
      (call) =>
        call.owner === usageOwner &&
        getNodeStartIndex(call.call) >= usageStartIndex &&
        nodesShareRepeatedControlFlow(call.call, usageNode, usageOwner) &&
        callMayMutateActiveSymbol(call, activeSymbolConditions, relevantPropertyName),
    );
  };

  const getEventsBefore = (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
  ): ReplayedSymbolMutation[] => {
    const mutationEvents: ReplayedSymbolMutation[] = [];
    const visitOwner = (
      owner: EsTreeNode,
      cutoffIndex: number,
      conditionalStartIndex: number,
      conditionalSuspensions: readonly EsTreeNode[],
      activeOwners: ReadonlySet<EsTreeNode>,
      isConditionalPath: boolean,
      activeSymbolConditions: ReadonlyMap<number, boolean>,
    ): void => {
      if (activeOwners.has(owner)) return;
      const nextActiveOwners = new Set(activeOwners);
      nextActiveOwners.add(owner);
      const currentActiveSymbolConditions = new Map(activeSymbolConditions);
      const operations = [
        ...[...currentActiveSymbolConditions.keys()]
          .flatMap((symbolId) => eventsBySymbolId.get(symbolId) ?? [])
          .filter((event) => event.owner === owner)
          .map((event) => ({ event, index: getNodeStartIndex(event.node) })),
        ...calls
          .filter((call) => call.owner === owner)
          .map((call) => ({ call, index: getNodeStartIndex(call.call) })),
      ].sort((left, right) => left.index - right.index);
      for (const operation of operations) {
        if (operation.index >= cutoffIndex) break;
        const operationNode = "event" in operation ? operation.event.node : operation.call.call;
        if (
          conditionalSuspensions.some((suspension) =>
            conditionalSuspensionPreventsOperation(suspension, operationNode, owner),
          )
        ) {
          continue;
        }
        if ("event" in operation) {
          if (!currentActiveSymbolConditions.has(operation.event.symbolId)) continue;
          const isConditionalEvent = Boolean(
            isConditionalPath ||
            currentActiveSymbolConditions.get(operation.event.symbolId) ||
            isConditionallyExecuted(operation.event.node, operation.event.owner) ||
            operation.index > conditionalStartIndex,
          );
          if (mutationEventIsDirectRebind(operation.event)) {
            updateActiveSymbolAfterRebind(operation.event, currentActiveSymbolConditions);
            continue;
          }
          mutationEvents.push({
            isConditional: isConditionalEvent,
            node: operation.event.node,
          });
          continue;
        }
        const replay = getSynchronousCallReplay(operation.call, usageNode);
        visitOwner(
          operation.call.targetOwner,
          replay.cutoffIndex,
          replay.conditionalStartIndex,
          replay.conditionalSuspensions,
          nextActiveOwners,
          isConditionalPath ||
            isConditionallyExecuted(operation.call.call, operation.call.owner) ||
            operation.index > conditionalStartIndex,
          getCalledActiveSymbolConditions(operation.call, currentActiveSymbolConditions),
        );
      }
    };

    const usageOwner = getExecutionOwner(usageNode);
    const initialActiveSymbolConditions = new Map([[symbol.id, false]]);
    if (!isNodeOfType(usageOwner, "Program")) {
      visitOwner(
        scopes.rootScope.node,
        getProgramCutoffIndex(usageOwner),
        Number.POSITIVE_INFINITY,
        [],
        new Set(),
        false,
        initialActiveSymbolConditions,
      );
    }
    visitOwner(
      usageOwner,
      getNodeStartIndex(usageNode),
      Number.POSITIVE_INFINITY,
      [],
      new Set(),
      false,
      initialActiveSymbolConditions,
    );
    return mutationEvents;
  };

  const isMutatedBefore = (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ): boolean => {
    const events = eventsBySymbolId.get(symbol.id);
    if (!events) return false;
    const usageStartIndex = getNodeStartIndex(usageNode);
    const usageOwner = getExecutionOwner(usageNode);
    const invokedOwners = getInvokedOwnersBefore(usageNode);
    return events.some((event) => {
      if (
        relevantPropertyName !== null &&
        event.propertyNames !== null &&
        !event.propertyNames.has(relevantPropertyName)
      ) {
        return false;
      }
      if (event.owner === usageOwner) return getNodeStartIndex(event.node) < usageStartIndex;
      if (isNodeOfType(event.owner, "Program") && !isNodeOfType(usageOwner, "Program")) {
        return getNodeStartIndex(event.node) < getProgramCutoffIndex(usageOwner);
      }
      return invokedOwners.has(event.owner);
    });
  };

  const inspector: SymbolMutationInspector = {
    getEventsBefore,
    getOutermostTarget,
    isGlobalNamespaceMethod,
    isExecutionOrderAmbiguous,
    isMutationOrderAmbiguous,
    isMutatedBefore,
  };
  inspectorCache.set(scopes, inspector);
  return inspector;
};
