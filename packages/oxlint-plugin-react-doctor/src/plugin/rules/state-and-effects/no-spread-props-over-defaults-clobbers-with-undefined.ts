import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findContainingBlock } from "../../utils/find-containing-block.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierRootSymbol } from "../../utils/resolve-const-identifier-root-symbol.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { statementTerminates } from "../../utils/statement-terminates.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Spreading props after defaults can replace a declared default with explicit undefined before that value reaches a computation. Reapply the default with ?? or strip undefined keys before merging.";

const DEFAULTS_NAME_PATTERN =
  /^(?:defaultProps|defaults?(?:[A-Z_].*)?|[A-Z0-9_]*DEFAULTS?[A-Z0-9_]*)$/;

interface RepairWrite {
  readonly isSafe: boolean;
  readonly start: number;
}

const getNodeStart = (node: EsTreeNode): number => node.range?.[0] ?? 0;

const unwrapTypeAnnotation = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  return isNodeOfType(node, "TSTypeAnnotation") ? node.typeAnnotation : node;
};

const expressionIsDefinitelyNonUndefined = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "Identifier")) {
    if (inner.name === "undefined" && context.scopes.isGlobalReference(inner)) return false;
    const symbol = context.scopes.symbolFor(inner);
    if (!symbol || !symbol.initializer || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    return expressionIsDefinitelyNonUndefined(symbol.initializer, context, visitedSymbolIds);
  }
  if (
    isNodeOfType(inner, "Literal") ||
    isNodeOfType(inner, "ArrayExpression") ||
    isNodeOfType(inner, "ObjectExpression") ||
    isNodeOfType(inner, "TemplateLiteral") ||
    isNodeOfType(inner, "NewExpression") ||
    isFunctionLike(inner)
  ) {
    return true;
  }
  if (isNodeOfType(inner, "UnaryExpression")) return inner.operator !== "void";
  if (isNodeOfType(inner, "BinaryExpression")) return true;
  if (
    isNodeOfType(inner, "LogicalExpression") &&
    (inner.operator === "??" || inner.operator === "||")
  ) {
    return expressionIsDefinitelyNonUndefined(inner.right, context, visitedSymbolIds);
  }
  if (isNodeOfType(inner, "ConditionalExpression")) {
    return (
      expressionIsDefinitelyNonUndefined(inner.consequent, context, new Set(visitedSymbolIds)) &&
      expressionIsDefinitelyNonUndefined(inner.alternate, context, new Set(visitedSymbolIds))
    );
  }
  return false;
};

const getVisiblePropertyWrites = (
  source: EsTreeNode,
  context: RuleContext,
  cache: Map<number, ReadonlyMap<string, boolean> | null>,
): ReadonlyMap<string, boolean> | null => {
  const inner = stripParenExpression(source);
  if (!isNodeOfType(inner, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(inner);
  if (!symbol) return null;
  const cached = cache.get(symbol.id);
  if (cached !== undefined) return cached;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "ObjectExpression")) {
    cache.set(symbol.id, null);
    return null;
  }
  const propertyWrites = new Map<string, boolean>();
  for (const property of initializer.properties) {
    if (!isNodeOfType(property, "Property")) {
      cache.set(symbol.id, null);
      return null;
    }
    const keyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!keyName) {
      cache.set(symbol.id, null);
      return null;
    }
    propertyWrites.set(keyName, expressionIsDefinitelyNonUndefined(property.value, context));
  }
  cache.set(symbol.id, propertyWrites);
  return propertyWrites;
};

const isDefaultsSource = (source: EsTreeNode): boolean => {
  const inner = stripParenExpression(source);
  if (isNodeOfType(inner, "Identifier")) return DEFAULTS_NAME_PATTERN.test(inner.name);
  return isNodeOfType(inner, "MemberExpression") && getStaticPropertyName(inner) === "defaultProps";
};

const typeIncludesUndefined = (typeNode: EsTreeNode): boolean => {
  const inner = unwrapTypeAnnotation(typeNode);
  if (!inner) return false;
  if (isNodeOfType(inner, "TSUndefinedKeyword")) return true;
  return isNodeOfType(inner, "TSUnionType") && inner.types.some(typeIncludesUndefined);
};

const getTypeMemberKeyName = (member: EsTreeNode): string | null => {
  if (!isNodeOfType(member, "TSPropertySignature") || member.computed) return null;
  if (isNodeOfType(member.key, "Identifier")) return member.key.name;
  if (isNodeOfType(member.key, "Literal") && typeof member.key.value === "string") {
    return member.key.value;
  }
  return null;
};

const resolveTypeSymbol = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): SymbolDescriptor | null => {
  const directlyResolved = context.scopes.symbolFor(identifier);
  if (directlyResolved) return directlyResolved;
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(identifier);
  while (scope) {
    const symbol = scope.symbolsByName.get(identifier.name);
    if (symbol) return symbol;
    scope = scope.parent;
  }
  return null;
};

const getTypeProperty = (
  typeNode: EsTreeNode,
  keyName: string,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  const inner = unwrapTypeAnnotation(typeNode);
  if (!inner) return null;
  if (isNodeOfType(inner, "Identifier")) {
    const symbol = resolveTypeSymbol(inner, context);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    return getTypeProperty(symbol.declarationNode, keyName, context, visitedSymbolIds);
  }
  if (isNodeOfType(inner, "TSTypeReference") && isNodeOfType(inner.typeName, "Identifier")) {
    if (inner.typeName.name === "Partial" || inner.typeName.name === "Readonly") {
      const argument = inner.typeArguments?.params[0];
      return argument ? getTypeProperty(argument, keyName, context, visitedSymbolIds) : null;
    }
    const symbol = resolveTypeSymbol(inner.typeName, context);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    return getTypeProperty(symbol.declarationNode, keyName, context, visitedSymbolIds);
  }
  if (isNodeOfType(inner, "TSTypeAliasDeclaration")) {
    return getTypeProperty(inner.typeAnnotation, keyName, context, visitedSymbolIds);
  }
  const members = isNodeOfType(inner, "TSTypeLiteral")
    ? inner.members
    : isNodeOfType(inner, "TSInterfaceDeclaration")
      ? inner.body.body
      : null;
  if (members) {
    const ownProperty =
      members.find(
        (member) =>
          isNodeOfType(member, "TSPropertySignature") && getTypeMemberKeyName(member) === keyName,
      ) ?? null;
    if (ownProperty) return ownProperty;
    if (isNodeOfType(inner, "TSInterfaceDeclaration")) {
      for (const heritage of inner.extends ?? []) {
        if (!isNodeOfType(heritage.expression, "Identifier")) continue;
        const inheritedProperty = getTypeProperty(
          heritage.expression,
          keyName,
          context,
          new Set(visitedSymbolIds),
        );
        if (inheritedProperty) return inheritedProperty;
      }
    }
    return null;
  }
  if (isNodeOfType(inner, "TSIntersectionType") || isNodeOfType(inner, "TSUnionType")) {
    for (const nestedType of inner.types) {
      const property = getTypeProperty(nestedType, keyName, context, new Set(visitedSymbolIds));
      if (property) return property;
    }
  }
  return null;
};

const typeAllowsUndefinedForKey = (
  typeNode: EsTreeNode | null,
  keyName: string,
  context: RuleContext,
  visitedTypeSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!typeNode) return false;
  const inner = unwrapTypeAnnotation(typeNode);
  if (!inner) return true;
  if (isNodeOfType(inner, "TSTypeAliasDeclaration")) {
    return typeAllowsUndefinedForKey(inner.typeAnnotation, keyName, context, visitedTypeSymbolIds);
  }
  if (isNodeOfType(inner, "TSTypeReference") && isNodeOfType(inner.typeName, "Identifier")) {
    if (inner.typeName.name === "Readonly") {
      const argument = inner.typeArguments?.params[0];
      return Boolean(
        argument && typeAllowsUndefinedForKey(argument, keyName, context, visitedTypeSymbolIds),
      );
    }
    if (inner.typeName.name === "Partial") {
      const argument = inner.typeArguments?.params[0];
      return Boolean(argument && getTypeProperty(argument, keyName, context, new Set()));
    }
    const typeSymbol = resolveTypeSymbol(inner.typeName, context);
    if (!typeSymbol || typeSymbol.kind === "import" || visitedTypeSymbolIds.has(typeSymbol.id)) {
      return false;
    }
    const nextVisitedTypeSymbolIds = new Set(visitedTypeSymbolIds);
    nextVisitedTypeSymbolIds.add(typeSymbol.id);
    return typeAllowsUndefinedForKey(
      typeSymbol.declarationNode,
      keyName,
      context,
      nextVisitedTypeSymbolIds,
    );
  }
  if (isNodeOfType(inner, "TSUnionType")) {
    return inner.types.some((nestedType) =>
      typeAllowsUndefinedForKey(nestedType, keyName, context, new Set(visitedTypeSymbolIds)),
    );
  }
  if (isNodeOfType(inner, "TSIntersectionType")) {
    const relevantTypes = inner.types.filter((nestedType) =>
      getTypeProperty(nestedType, keyName, context, new Set()),
    );
    return (
      relevantTypes.length > 0 &&
      relevantTypes.every((nestedType) =>
        typeAllowsUndefinedForKey(nestedType, keyName, context, new Set(visitedTypeSymbolIds)),
      )
    );
  }
  const property = getTypeProperty(inner, keyName, context, new Set());
  if (!property || !isNodeOfType(property, "TSPropertySignature")) return false;
  return (
    Boolean(property.optional) ||
    Boolean(property.typeAnnotation && typeIncludesUndefined(property.typeAnnotation))
  );
};

const getFunctionParameterType = (
  functionNode: EsTreeNode,
  parameterSymbolId: number,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  for (const parameter of functionNode.params) {
    const pattern = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
    const patternType = unwrapTypeAnnotation(
      "typeAnnotation" in pattern ? pattern.typeAnnotation : null,
    );
    if (isNodeOfType(pattern, "Identifier")) {
      if (context.scopes.symbolFor(pattern)?.id === parameterSymbolId) return patternType;
      continue;
    }
    if (!isNodeOfType(pattern, "ObjectPattern")) continue;
    for (const property of pattern.properties) {
      if (
        isNodeOfType(property, "RestElement") &&
        isNodeOfType(property.argument, "Identifier") &&
        context.scopes.symbolFor(property.argument)?.id === parameterSymbolId
      ) {
        return patternType;
      }
    }
  }
  return null;
};

const resolveParameterSourceSymbol = (
  identifier: EsTreeNode,
  context: RuleContext,
): number | null => {
  let current = identifier;
  const visitedSymbolIds = new Set<number>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
    if (symbol.kind === "parameter") return symbol.id;
    if (symbol.kind !== "const" || !symbol.initializer) return null;
    visitedSymbolIds.add(symbol.id);
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) return null;
    current = initializer;
  }
  return null;
};

const unwrapSafeFallback = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (
    current.parent &&
    (isNodeOfType(current.parent, "ChainExpression") ||
      isNodeOfType(current.parent, "TSNonNullExpression"))
  ) {
    current = current.parent;
  }
  return current;
};

const referenceFeedsComputation = (reference: EsTreeNode, context: RuleContext): boolean => {
  let current = unwrapSafeFallback(reference);
  let parent = current.parent;
  while (
    parent &&
    ((isNodeOfType(parent, "MemberExpression") && parent.object === current) ||
      isNodeOfType(parent, "ChainExpression") ||
      isNodeOfType(parent, "TSNonNullExpression"))
  ) {
    current = parent;
    parent = current.parent;
  }
  if (
    parent &&
    isNodeOfType(parent, "LogicalExpression") &&
    (parent.operator === "??" || parent.operator === "||") &&
    parent.left === current
  ) {
    if (expressionIsDefinitelyNonUndefined(parent.right, context)) return false;
    current = parent;
    parent = current.parent;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "BinaryExpression")) {
    if (["===", "!==", "==", "!="].includes(parent.operator)) {
      const hasGlobalUndefined = [parent.left, parent.right].some((operand) => {
        const unwrappedOperand = stripParenExpression(operand);
        return (
          isNodeOfType(unwrappedOperand, "Identifier") &&
          unwrappedOperand.name === "undefined" &&
          context.scopes.isGlobalReference(unwrappedOperand)
        );
      });
      const hasLooseNull =
        (parent.operator === "==" || parent.operator === "!=") &&
        [parent.left, parent.right].some((operand) => {
          const unwrappedOperand = stripParenExpression(operand);
          return isNodeOfType(unwrappedOperand, "Literal") && unwrappedOperand.value === null;
        });
      if (hasGlobalUndefined || hasLooseNull) return false;
    }
    return true;
  }
  if (isNodeOfType(parent, "TemplateLiteral")) {
    return true;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === current &&
    parent.operator !== "="
  ) {
    return true;
  }
  if (isNodeOfType(parent, "UnaryExpression")) {
    return parent.operator === "+" || parent.operator === "-" || parent.operator === "~";
  }
  if (
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    (parent.arguments.some((argument) => argument === current) || parent.callee === current)
  ) {
    const callee = stripParenExpression(parent.callee);
    if (isNodeOfType(callee, "Identifier") && /^(?:is)?undefined$/i.test(callee.name)) {
      return false;
    }
    return true;
  }
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === current) return true;
  return false;
};

const expressionMatchesMember = (
  expression: EsTreeNode,
  symbol: SymbolDescriptor,
  keyName: string,
  context: RuleContext,
): boolean => {
  const member = stripParenExpression(expression);
  if (!isNodeOfType(member, "MemberExpression") || getStaticPropertyName(member) !== keyName) {
    return false;
  }
  const object = stripParenExpression(member.object);
  return Boolean(
    isNodeOfType(object, "Identifier") &&
    resolveConstIdentifierRootSymbol(object, context.scopes)?.id === symbol.id,
  );
};

const nullishComparisonPolarity = (
  testExpression: EsTreeNode,
  symbol: SymbolDescriptor,
  keyName: string,
  context: RuleContext,
): "defined" | "undefined" | null => {
  const test = stripParenExpression(testExpression);
  if (!isNodeOfType(test, "BinaryExpression")) return null;
  if (!["===", "!==", "==", "!="].includes(test.operator)) return null;
  const pairs = [
    { member: test.left, nullish: test.right },
    { member: test.right, nullish: test.left },
  ];
  for (const pair of pairs) {
    if (!expressionMatchesMember(pair.member, symbol, keyName, context)) continue;
    const nullish = stripParenExpression(pair.nullish);
    const isNull = isNodeOfType(nullish, "Literal") && nullish.value === null;
    const isUndefined =
      isNodeOfType(nullish, "Identifier") &&
      nullish.name === "undefined" &&
      context.scopes.isGlobalReference(nullish);
    if (!isNull && !isUndefined) continue;
    if (isNull && (test.operator === "===" || test.operator === "!==")) continue;
    return test.operator === "!==" || test.operator === "!=" ? "defined" : "undefined";
  }
  return null;
};

const branchGuaranteesMemberDefined = (
  testExpression: EsTreeNode,
  isTruthyBranch: boolean,
  symbol: SymbolDescriptor,
  keyName: string,
  context: RuleContext,
): boolean => {
  const nullishPolarity = nullishComparisonPolarity(testExpression, symbol, keyName, context);
  if (nullishPolarity) {
    return isTruthyBranch ? nullishPolarity === "defined" : nullishPolarity === "undefined";
  }
  const test = stripParenExpression(testExpression);
  if (expressionMatchesMember(test, symbol, keyName, context)) return isTruthyBranch;
  return Boolean(
    isNodeOfType(test, "UnaryExpression") &&
    test.operator === "!" &&
    expressionMatchesMember(test.argument, symbol, keyName, context) &&
    !isTruthyBranch,
  );
};

const statementRepairsMember = (
  statement: EsTreeNode,
  symbol: SymbolDescriptor,
  keyName: string,
  context: RuleContext,
): boolean => {
  const candidateStatement = isNodeOfType(statement, "BlockStatement")
    ? statement.body[0]
    : statement;
  if (!isNodeOfType(candidateStatement, "ExpressionStatement")) return false;
  const assignment = stripParenExpression(candidateStatement.expression);
  return Boolean(
    isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.operator === "=" &&
    expressionMatchesMember(assignment.left, symbol, keyName, context) &&
    expressionIsDefinitelyNonUndefined(assignment.right, context),
  );
};

const precedingIfRepairsMember = (
  statement: EsTreeNodeOfType<"IfStatement">,
  symbol: SymbolDescriptor,
  keyName: string,
  context: RuleContext,
): boolean =>
  !statement.alternate &&
  nullishComparisonPolarity(statement.test, symbol, keyName, context) === "undefined" &&
  statementRepairsMember(statement.consequent, symbol, keyName, context);

const memberUseIsGuarded = (
  member: EsTreeNodeOfType<"MemberExpression">,
  symbol: SymbolDescriptor,
  keyName: string,
  context: RuleContext,
  priorWrite: RepairWrite | null,
): boolean => {
  let current: EsTreeNode | null | undefined = member;
  while (current) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (parent && isNodeOfType(parent, "ConditionalExpression")) {
      const guardPrecedesUnsafeWrite =
        !priorWrite || priorWrite.isSafe || priorWrite.start < getNodeStart(parent.test);
      if (
        guardPrecedesUnsafeWrite &&
        ((branchGuaranteesMemberDefined(parent.test, true, symbol, keyName, context) &&
          isAstDescendant(member, parent.consequent)) ||
          (branchGuaranteesMemberDefined(parent.test, false, symbol, keyName, context) &&
            isAstDescendant(member, parent.alternate)))
      ) {
        return true;
      }
    }
    if (parent && isNodeOfType(parent, "IfStatement")) {
      const guardPrecedesUnsafeWrite =
        !priorWrite || priorWrite.isSafe || priorWrite.start < getNodeStart(parent.test);
      if (
        guardPrecedesUnsafeWrite &&
        ((branchGuaranteesMemberDefined(parent.test, true, symbol, keyName, context) &&
          isAstDescendant(member, parent.consequent)) ||
          (branchGuaranteesMemberDefined(parent.test, false, symbol, keyName, context) &&
            parent.alternate &&
            isAstDescendant(member, parent.alternate)))
      ) {
        return true;
      }
    }
    current = parent;
  }
  const block = findContainingBlock(member);
  if (!block || !isNodeOfType(block, "BlockStatement")) return false;
  let containingStatement: EsTreeNode = member;
  while (containingStatement.parent && containingStatement.parent !== block) {
    containingStatement = containingStatement.parent;
  }
  for (const statement of block.body) {
    if (statement === containingStatement) break;
    if (
      isNodeOfType(statement, "IfStatement") &&
      precedingIfRepairsMember(statement, symbol, keyName, context) &&
      (!priorWrite || priorWrite.isSafe || priorWrite.start < getNodeStart(statement.test))
    ) {
      return true;
    }
    if (!isNodeOfType(statement, "IfStatement") || !statementTerminates(statement.consequent)) {
      continue;
    }
    const guardPrecedesUnsafeWrite =
      !priorWrite || priorWrite.isSafe || priorWrite.start < getNodeStart(statement.test);
    if (
      guardPrecedesUnsafeWrite &&
      branchGuaranteesMemberDefined(statement.test, false, symbol, keyName, context)
    ) {
      return true;
    }
  }
  return false;
};

const getMemberPriorWrite = (
  member: EsTreeNodeOfType<"MemberExpression">,
  symbol: SymbolDescriptor,
  context: RuleContext,
  repairStartsBySymbolAndBlock: Map<number, WeakMap<EsTreeNode, Map<string, RepairWrite[]>>>,
): RepairWrite | null => {
  const keyName = getStaticPropertyName(member);
  const useBlock = findContainingBlock(member);
  if (!keyName || !useBlock) return null;
  let repairStartsByBlock = repairStartsBySymbolAndBlock.get(symbol.id);
  if (!repairStartsByBlock) {
    repairStartsByBlock = new WeakMap();
    repairStartsBySymbolAndBlock.set(symbol.id, repairStartsByBlock);
    for (const reference of symbol.references) {
      const repairMember = reference.identifier.parent;
      if (
        !isNodeOfType(repairMember, "MemberExpression") ||
        repairMember.object !== reference.identifier
      ) {
        continue;
      }
      const repairKeyName = getStaticPropertyName(repairMember);
      const assignment = repairMember.parent;
      if (
        !repairKeyName ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.left !== repairMember ||
        !isNodeOfType(assignment.parent, "ExpressionStatement") ||
        (assignment.operator !== "??=" &&
          assignment.operator !== "||=" &&
          assignment.operator !== "=")
      ) {
        continue;
      }
      const isSafe = expressionIsDefinitelyNonUndefined(assignment.right, context);
      if (isSafe && !context.cfg.isUnconditionalFromEntry(assignment)) continue;
      const repairBlock = findContainingBlock(assignment);
      if (!repairBlock) continue;
      const repairStartsByKey = repairStartsByBlock.get(repairBlock) ?? new Map();
      const repairWrites = repairStartsByKey.get(repairKeyName) ?? [];
      repairWrites.push({
        isSafe,
        start: getNodeStart(assignment),
      });
      repairStartsByKey.set(repairKeyName, repairWrites);
      repairStartsByBlock.set(repairBlock, repairStartsByKey);
    }
  }
  const repairWrites = repairStartsByBlock.get(useBlock)?.get(keyName) ?? [];
  let lastWrite: RepairWrite | null = null;
  for (const repairWrite of repairWrites) {
    if (repairWrite.start >= getNodeStart(member)) continue;
    if (!lastWrite || repairWrite.start > lastWrite.start) lastWrite = repairWrite;
  }
  return lastWrite;
};

const scalarSymbolFeedsComputation = (
  symbolId: number,
  context: RuleContext,
  symbolById: ReadonlyMap<number, SymbolDescriptor>,
  visitedSymbolIds: Set<number>,
  lowerBoundStart = Number.NEGATIVE_INFINITY,
  upperBoundStart = Number.POSITIVE_INFINITY,
): boolean => {
  if (visitedSymbolIds.has(symbolId)) return false;
  visitedSymbolIds.add(symbolId);
  const resolvedSymbol = symbolById.get(symbolId) ?? null;
  if (!resolvedSymbol) return false;
  let nextWriteStart = upperBoundStart;
  for (const reference of resolvedSymbol.references) {
    const referenceStart = getNodeStart(reference.identifier);
    if (
      reference.flag !== "read" &&
      referenceStart > lowerBoundStart &&
      referenceStart < nextWriteStart &&
      context.cfg.isUnconditionalFromEntry(reference.identifier)
    ) {
      nextWriteStart = referenceStart;
    }
  }
  for (const reference of resolvedSymbol.references) {
    const identifier = reference.identifier;
    const referenceStart = getNodeStart(identifier);
    if (referenceStart <= lowerBoundStart || referenceStart >= nextWriteStart) continue;
    if (referenceFeedsComputation(identifier, context)) return true;
    const expressionRoot = findTransparentExpressionRoot(identifier);
    const parent = expressionRoot.parent;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === expressionRoot &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const aliasSymbol = context.scopes.symbolFor(parent.id);
      if (
        aliasSymbol &&
        scalarSymbolFeedsComputation(
          aliasSymbol.id,
          context,
          symbolById,
          new Set(visitedSymbolIds),
          getNodeStart(parent),
        )
      ) {
        return true;
      }
      continue;
    }
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      parent.right === expressionRoot &&
      isNodeOfType(stripParenExpression(parent.left), "Identifier")
    ) {
      const aliasSymbol = context.scopes.symbolFor(stripParenExpression(parent.left));
      if (
        aliasSymbol &&
        scalarSymbolFeedsComputation(
          aliasSymbol.id,
          context,
          symbolById,
          new Set(visitedSymbolIds),
          getNodeStart(parent),
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

const objectSymbolFeedsComputation = (
  symbolId: number,
  candidateKeys: ReadonlySet<string> | null,
  parameterType: EsTreeNode | null,
  context: RuleContext,
  symbolById: ReadonlyMap<number, SymbolDescriptor>,
  repairStartsBySymbolAndBlock: Map<number, WeakMap<EsTreeNode, Map<string, RepairWrite[]>>>,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (visitedSymbolIds.has(symbolId)) return false;
  visitedSymbolIds.add(symbolId);
  const symbol = symbolById.get(symbolId) ?? null;
  if (!symbol) return false;
  for (const reference of symbol.references) {
    const identifier = reference.identifier;
    const parent = identifier.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === identifier) {
      const keyName = getStaticPropertyName(parent);
      const priorWrite = getMemberPriorWrite(parent, symbol, context, repairStartsBySymbolAndBlock);
      if (
        keyName &&
        (candidateKeys === null || candidateKeys.has(keyName)) &&
        typeAllowsUndefinedForKey(parameterType, keyName, context) &&
        !priorWrite?.isSafe &&
        !memberUseIsGuarded(parent, symbol, keyName, context, priorWrite) &&
        referenceFeedsComputation(parent, context)
      ) {
        return true;
      }
      if (
        keyName &&
        (candidateKeys === null || candidateKeys.has(keyName)) &&
        typeAllowsUndefinedForKey(parameterType, keyName, context) &&
        !priorWrite?.isSafe &&
        !memberUseIsGuarded(parent, symbol, keyName, context, priorWrite)
      ) {
        const memberRoot = findTransparentExpressionRoot(parent);
        const declarator = memberRoot.parent;
        if (
          isNodeOfType(declarator, "VariableDeclarator") &&
          declarator.init === memberRoot &&
          isNodeOfType(declarator.id, "Identifier")
        ) {
          const scalarSymbol = context.scopes.symbolFor(declarator.id);
          if (
            scalarSymbol &&
            scalarSymbolFeedsComputation(
              scalarSymbol.id,
              context,
              symbolById,
              new Set(visitedSymbolIds),
            )
          ) {
            return true;
          }
        }
      }
      continue;
    }
    if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== identifier) continue;
    if (isNodeOfType(parent.id, "Identifier")) {
      const aliasSymbol = context.scopes.symbolFor(parent.id);
      if (
        aliasSymbol &&
        objectSymbolFeedsComputation(
          aliasSymbol.id,
          candidateKeys,
          parameterType,
          context,
          symbolById,
          repairStartsBySymbolAndBlock,
          visitedSymbolIds,
        )
      ) {
        return true;
      }
      continue;
    }
    if (!isNodeOfType(parent.id, "ObjectPattern")) continue;
    for (const property of parent.id.properties) {
      if (!isNodeOfType(property, "Property")) continue;
      const keyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (
        !keyName ||
        (candidateKeys !== null && !candidateKeys.has(keyName)) ||
        !typeAllowsUndefinedForKey(parameterType, keyName, context) ||
        isNodeOfType(property.value, "AssignmentPattern")
      ) {
        continue;
      }
      if (isNodeOfType(property.value, "Identifier")) {
        const bindingSymbol = context.scopes.symbolFor(property.value);
        if (
          bindingSymbol &&
          scalarSymbolFeedsComputation(
            bindingSymbol.id,
            context,
            symbolById,
            new Set(visitedSymbolIds),
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

const objectExpressionFeedsComputation = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  candidateKeys: ReadonlySet<string> | null,
  parameterType: EsTreeNode | null,
  context: RuleContext,
  symbolById: ReadonlyMap<number, SymbolDescriptor>,
  repairStartsBySymbolAndBlock: Map<number, WeakMap<EsTreeNode, Map<string, RepairWrite[]>>>,
): boolean => {
  const parent = objectExpression.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === objectExpression) {
    const keyName = getStaticPropertyName(parent);
    return Boolean(
      keyName &&
      (candidateKeys === null || candidateKeys.has(keyName)) &&
      typeAllowsUndefinedForKey(parameterType, keyName, context) &&
      referenceFeedsComputation(parent, context),
    );
  }
  if (!isNodeOfType(parent, "VariableDeclarator")) return false;
  if (isNodeOfType(parent.id, "Identifier")) {
    const symbol = context.scopes.symbolFor(parent.id);
    return Boolean(
      symbol &&
      objectSymbolFeedsComputation(
        symbol.id,
        candidateKeys,
        parameterType,
        context,
        symbolById,
        repairStartsBySymbolAndBlock,
        new Set(),
      ),
    );
  }
  if (!isNodeOfType(parent.id, "ObjectPattern")) return false;
  for (const property of parent.id.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const keyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (
      !keyName ||
      (candidateKeys !== null && !candidateKeys.has(keyName)) ||
      !typeAllowsUndefinedForKey(parameterType, keyName, context) ||
      isNodeOfType(property.value, "AssignmentPattern") ||
      !isNodeOfType(property.value, "Identifier")
    ) {
      continue;
    }
    const symbol = context.scopes.symbolFor(property.value);
    if (symbol && scalarSymbolFeedsComputation(symbol.id, context, symbolById, new Set())) {
      return true;
    }
  }
  return false;
};

export const noSpreadPropsOverDefaultsClobbersWithUndefined = defineRule({
  id: "no-spread-props-over-defaults-clobbers-with-undefined",
  title: "Spread props over defaults can clobber with undefined",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "An explicit undefined prop can overwrite a default. Reapply defaults with ?? at the merge or use site, or remove undefined keys before spreading props.",
  create: (context: RuleContext) => {
    const propertyWriteCache = new Map<number, ReadonlyMap<string, boolean> | null>();
    const repairStartsBySymbolAndBlock = new Map<
      number,
      WeakMap<EsTreeNode, Map<string, RepairWrite[]>>
    >();
    const symbolById = new Map<number, SymbolDescriptor>();
    const pendingScopes = [context.scopes.rootScope];
    while (pendingScopes.length > 0) {
      const scope = pendingScopes.pop();
      if (!scope) break;
      for (const symbol of scope.symbols) symbolById.set(symbol.id, symbol);
      pendingScopes.push(...scope.children);
    }
    return {
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        const spreadProperties = node.properties.filter((property) =>
          isNodeOfType(property, "SpreadElement"),
        );
        if (spreadProperties.length < 2) return;
        const enclosingFunction = findEnclosingFunction(node);
        if (!enclosingFunction || !componentOrHookDisplayNameForFunction(enclosingFunction)) return;
        for (let propsIndex = 1; propsIndex < spreadProperties.length; propsIndex += 1) {
          const propsSpread = spreadProperties[propsIndex];
          if (!propsSpread) continue;
          const propsSource = stripParenExpression(propsSpread.argument);
          if (!isNodeOfType(propsSource, "Identifier")) continue;
          const parameterSymbolId = resolveParameterSourceSymbol(propsSource, context);
          if (parameterSymbolId === null) continue;
          const defaultedKeys = new Set<string>();
          for (const possibleDefaultsSpread of spreadProperties.slice(0, propsIndex)) {
            const defaultsSource = stripParenExpression(possibleDefaultsSpread.argument);
            if (!isDefaultsSource(defaultsSource)) continue;
            const visiblePropertyWrites = getVisiblePropertyWrites(
              defaultsSource,
              context,
              propertyWriteCache,
            );
            if (!visiblePropertyWrites) continue;
            for (const [keyName, isSafe] of visiblePropertyWrites) {
              if (isSafe) defaultedKeys.add(keyName);
            }
          }
          if (defaultedKeys.size === 0) continue;
          const lastExplicitWriteByKey = new Map<string, boolean>();
          const propsSpreadStart = getNodeStart(propsSpread);
          for (const property of node.properties) {
            if (getNodeStart(property) <= propsSpreadStart) continue;
            if (isNodeOfType(property, "Property")) {
              const keyName = getStaticPropertyKeyName(property, { allowComputedString: true });
              if (keyName) {
                lastExplicitWriteByKey.set(
                  keyName,
                  expressionIsDefinitelyNonUndefined(property.value, context),
                );
              }
              continue;
            }
            if (!isNodeOfType(property, "SpreadElement")) continue;
            const spreadSource = stripParenExpression(property.argument);
            const visiblePropertyWrites = getVisiblePropertyWrites(
              spreadSource,
              context,
              propertyWriteCache,
            );
            if (!visiblePropertyWrites) {
              for (const keyName of defaultedKeys) lastExplicitWriteByKey.set(keyName, false);
              continue;
            }
            for (const [keyName, isSafe] of visiblePropertyWrites) {
              if (defaultedKeys.has(keyName)) lastExplicitWriteByKey.set(keyName, isSafe);
            }
          }
          const candidateKeys = new Set(
            [...defaultedKeys].filter((keyName) => lastExplicitWriteByKey.get(keyName) !== true),
          );
          if (candidateKeys.size === 0) continue;
          const parameterType = getFunctionParameterType(
            enclosingFunction,
            parameterSymbolId,
            context,
          );
          if (
            objectExpressionFeedsComputation(
              node,
              candidateKeys,
              parameterType,
              context,
              symbolById,
              repairStartsBySymbolAndBlock,
            )
          ) {
            context.report({ node, message: MESSAGE });
            return;
          }
        }
      },
    };
  },
});
