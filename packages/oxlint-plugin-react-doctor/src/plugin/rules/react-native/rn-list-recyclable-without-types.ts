import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import {
  MAX_RENDERED_ROOT_SHAPE_ALTERNATIVE_COUNT,
  RECYCLABLE_LIST_PACKAGE_SOURCES,
  SHOPIFY_FLASH_LIST_COMPONENTS,
} from "../../constants/react-native.js";
import { canExpressionOverrideJsxAttribute } from "../../utils/can-expression-override-jsx-attribute.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import { getFinalSequenceExpressionValue } from "../../utils/get-final-sequence-expression-value.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticLogicalExpressionResultBranches } from "../../utils/get-static-logical-expression-result-branches.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImportedFromReact, isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactNamespaceImport } from "../../utils/is-react-api-call.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { isFlashListV2OrNewer } from "./utils/is-flash-list-v2-or-newer.js";
import { resolveImportedRecyclerName } from "./utils/resolve-imported-recycler-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import { unwrapProvenReactHocFunction } from "../../utils/unwrap-proven-react-hoc-function.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface RendererInputReference {
  readonly inputName: string;
  readonly isStable: boolean;
  readonly propertyName: string | null;
  readonly symbolId: number;
}

interface RenderedRootAnalysis {
  readonly canFollowLocalRenderer: boolean;
  readonly inputReferences: ReadonlyArray<RendererInputReference>;
  readonly visitedFunctionNodes: Set<EsTreeNode>;
  readonly visitedSymbolIds: Set<number>;
}

interface ForwardedInput {
  readonly inputNames: ReadonlySet<string>;
  readonly isWholeContainer: boolean;
}

interface InputSelectionAnalysis {
  readonly hasInputDependentSelection: boolean;
  readonly hasProvenInputDependentRootSelection: boolean;
  readonly hasUnrelatedSelection: boolean;
}

interface StaticSelectorIdentity {
  readonly isInverted: boolean;
  readonly key: string;
}

interface RenderedRootSelectorFact {
  readonly outcome: boolean;
  readonly selector: EsTreeNode;
}

interface RenderedRootShapeAlternative {
  readonly facts: ReadonlyMap<string, RenderedRootSelectorFact>;
  readonly roots: ReadonlyArray<string>;
}

const RENDER_ITEM_INPUT_NAMES = new Set(["item", "index"]);
const EMPTY_RENDERED_ROOT_NAME = "empty";

const isSymbolStable = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const getSymbolVariableDeclarator = (
  symbol: SymbolDescriptor,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let declaration: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declaration && !isNodeOfType(declaration, "VariableDeclarator")) {
    declaration = declaration.parent;
  }
  return declaration && isNodeOfType(declaration, "VariableDeclarator") ? declaration : null;
};

const getConstInitializerExpressions = (symbol: SymbolDescriptor): ReadonlyArray<EsTreeNode> => {
  if (symbol.kind !== "const" || !symbol.initializer) return [];
  const declarationInitializer = getSymbolVariableDeclarator(symbol)?.init;
  return declarationInitializer && declarationInitializer !== symbol.initializer
    ? [declarationInitializer, symbol.initializer]
    : [symbol.initializer];
};

const getSymbolIdentity = (symbol: SymbolDescriptor): string => {
  if (symbol.kind !== "import") return `symbol:${symbol.id}`;
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  const source = importDeclaration?.source.value;
  if (typeof source !== "string") return `symbol:${symbol.id}`;
  if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) {
    return `import:${source}:default`;
  }
  if (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) {
    return `import:${source}:*`;
  }
  return `import:${source}:${getImportedName(symbol.declarationNode) ?? symbol.name}`;
};

const appendComponentMemberIdentity = (
  receiverIdentity: string | null,
  propertyName: string,
): string | null => {
  if (
    !receiverIdentity ||
    (!receiverIdentity.startsWith("import:") && !receiverIdentity.startsWith("global:"))
  ) {
    return null;
  }
  if (receiverIdentity.endsWith(":*")) {
    return `${receiverIdentity.slice(0, -1)}${propertyName}`;
  }
  return `${receiverIdentity}.${propertyName}`;
};

const getComponentReferenceIdentity = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const componentReference = stripParenExpression(expression);
  if (
    isNodeOfType(componentReference, "Identifier") ||
    isNodeOfType(componentReference, "JSXIdentifier")
  ) {
    const symbol = scopes.symbolFor(componentReference);
    if (!symbol) return `global:${componentReference.name}`;
    if (visitedSymbolIds.has(symbol.id) || !isSymbolStable(symbol)) return null;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind === "import" || symbol.kind === "function" || symbol.kind === "class") {
      return getSymbolIdentity(symbol);
    }
    if (symbol.kind !== "const" || !symbol.initializer) return null;
    const initializer = stripParenExpression(symbol.initializer);
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    if (destructuredPropertyName) {
      return appendComponentMemberIdentity(
        getComponentReferenceIdentity(initializer, scopes, visitedSymbolIds),
        destructuredPropertyName,
      );
    }
    const isProvenReactHocCall =
      isNodeOfType(initializer, "CallExpression") &&
      (isReactApiCall(initializer, "memo", scopes, { resolveNamedAliases: true }) ||
        isReactApiCall(initializer, "forwardRef", scopes, { resolveNamedAliases: true })) &&
      initializer.arguments[0] !== undefined &&
      !isNodeOfType(initializer.arguments[0], "SpreadElement");
    if (
      isFunctionLike(initializer) ||
      isNodeOfType(initializer, "ClassExpression") ||
      isProvenReactHocCall
    ) {
      return getSymbolIdentity(symbol);
    }
    if (
      !isNodeOfType(initializer, "Identifier") &&
      !isNodeOfType(initializer, "MemberExpression")
    ) {
      return null;
    }
    return getComponentReferenceIdentity(initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(componentReference, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(componentReference);
  if (propertyName === null) return null;
  const receiverIdentity = getComponentReferenceIdentity(
    componentReference.object,
    scopes,
    visitedSymbolIds,
  );
  return appendComponentMemberIdentity(receiverIdentity, propertyName);
};

const getJsxElementIdentity = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (isNodeOfType(node, "JSXIdentifier")) {
    const identity = getComponentReferenceIdentity(node, scopes);
    if (identity !== `global:${node.name}`) return identity;
    return /^[a-z]/u.test(node.name) ? `intrinsic:${node.name}` : identity;
  }
  if (!isNodeOfType(node, "JSXMemberExpression")) return null;
  const objectIdentity = getJsxElementIdentity(node.object, scopes);
  if (!isNodeOfType(node.property, "JSXIdentifier")) return null;
  return appendComponentMemberIdentity(objectIdentity, node.property.name);
};

const isStaticallyEmptyJsxChild = (node: EsTreeNode): boolean => {
  const expression = getFinalSequenceExpressionValue(node);
  if (isNodeOfType(expression, "JSXEmptyExpression")) return true;
  if (
    isNodeOfType(expression, "Literal") &&
    (expression.value === null || typeof expression.value === "boolean")
  ) {
    return true;
  }
  if (isNodeOfType(expression, "UnaryExpression")) {
    return expression.operator === "!" || expression.operator === "void";
  }
  if (!isNodeOfType(expression, "BinaryExpression")) return false;
  switch (expression.operator) {
    case "==":
    case "!=":
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "in":
    case "instanceof":
      return true;
    default:
      return false;
  }
};

const getStaticSelectorBindingPath = (
  pattern: EsTreeNode,
  bindingIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null => {
  if (pattern === bindingIdentifier) return [];
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return readStaticSelectorTruthiness(pattern.right, scopes) === false
      ? getStaticSelectorBindingPath(pattern.left, bindingIdentifier, scopes)
      : null;
  }
  if (isNodeOfType(pattern, "RestElement")) return null;
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const [elementIndex, element] of pattern.elements.entries()) {
      if (!element) continue;
      const nestedPath = getStaticSelectorBindingPath(element, bindingIdentifier, scopes);
      if (nestedPath !== null) return [String(elementIndex), ...nestedPath];
    }
    return null;
  }
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const nestedPath = getStaticSelectorBindingPath(property.value, bindingIdentifier, scopes);
    if (nestedPath === null) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName === null ? null : [propertyName, ...nestedPath];
  }
  return null;
};

const getStaticSelectorPropertyName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): string | null =>
  getStaticPropertyName(memberExpression) ??
  getStaticPropertyKeyName(memberExpression, {
    allowComputedString: true,
    stringifyNonStringLiterals: true,
  });

const getSelectorReferenceKey = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const selector = stripParenExpression(expression);
  if (isNodeOfType(selector, "Identifier")) {
    const reference = scopes.referenceFor(selector);
    const symbol = reference?.resolvedSymbol;
    if (!symbol || !isSymbolStable(symbol) || visitedSymbolIds.has(symbol.id)) return null;
    if (symbol.kind === "const" && symbol.initializer) {
      visitedSymbolIds.add(symbol.id);
      const declaration = getSymbolVariableDeclarator(symbol);
      if (declaration?.id === symbol.bindingIdentifier) {
        return (
          getSelectorReferenceKey(symbol.initializer, scopes, visitedSymbolIds) ??
          JSON.stringify(["symbol", symbol.id])
        );
      }
      if (declaration?.init) {
        const bindingPath = getStaticSelectorBindingPath(
          declaration.id,
          symbol.bindingIdentifier,
          scopes,
        );
        let receiverKey = getSelectorReferenceKey(declaration.init, scopes, visitedSymbolIds);
        if (bindingPath !== null && receiverKey !== null) {
          for (const propertyName of bindingPath) {
            receiverKey = JSON.stringify(["member", receiverKey, propertyName]);
          }
          return receiverKey;
        }
      }
      return JSON.stringify(["symbol", symbol.id]);
    }
    return JSON.stringify(["symbol", symbol.id]);
  }
  if (!isNodeOfType(selector, "MemberExpression")) return null;
  const propertyName = getStaticSelectorPropertyName(selector);
  if (propertyName === null) return null;
  const receiverKey = getSelectorReferenceKey(selector.object, scopes, visitedSymbolIds);
  return receiverKey === null ? null : JSON.stringify(["member", receiverKey, propertyName]);
};

const getStaticComparisonOperandKey = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const operand = stripParenExpression(expression);
  if (isNodeOfType(operand, "Identifier")) {
    const symbol = scopes.referenceFor(operand)?.resolvedSymbol;
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      isSymbolStable(symbol) &&
      getSymbolVariableDeclarator(symbol)?.id === symbol.bindingIdentifier &&
      !visitedSymbolIds.has(symbol.id)
    ) {
      visitedSymbolIds.add(symbol.id);
      return (
        getStaticComparisonOperandKey(symbol.initializer, scopes, visitedSymbolIds) ??
        JSON.stringify(["symbol", symbol.id])
      );
    }
  }
  if (isNodeOfType(operand, "UnaryExpression") && operand.operator === "typeof") {
    const argumentKey = getSelectorReferenceKey(operand.argument, scopes, visitedSymbolIds);
    return argumentKey === null ? null : JSON.stringify(["typeof", argumentKey]);
  }
  return getSelectorReferenceKey(operand, scopes, visitedSymbolIds);
};

const getStaticPrimitiveLiteralKey = (expression: EsTreeNode): string | null => {
  const literal = stripParenExpression(expression);
  if (
    isNodeOfType(literal, "UnaryExpression") &&
    (literal.operator === "-" || literal.operator === "+")
  ) {
    const argument = stripParenExpression(literal.argument);
    if (isNodeOfType(argument, "Literal") && typeof argument.value === "number") {
      const numericValue = literal.operator === "-" ? -argument.value : argument.value;
      return `number:${String(numericValue)}`;
    }
  }
  if (!isNodeOfType(literal, "Literal")) return null;
  if (literal.value === null) return "null";
  if (typeof literal.value === "string") return `string:${JSON.stringify(literal.value)}`;
  if (typeof literal.value === "number") return `number:${String(literal.value)}`;
  if (typeof literal.value === "boolean") return `boolean:${String(literal.value)}`;
  if (typeof literal.value === "bigint") return `bigint:${String(literal.value)}`;
  return null;
};

const getImportedStaticReferenceKey = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const reference = stripParenExpression(expression);
  if (isNodeOfType(reference, "Identifier")) {
    const symbol = scopes.referenceFor(reference)?.resolvedSymbol;
    return symbol?.kind === "import" ? getSymbolIdentity(symbol) : null;
  }
  if (!isNodeOfType(reference, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(reference);
  if (propertyName === null) return null;
  const receiverKey = getImportedStaticReferenceKey(reference.object, scopes);
  return receiverKey === null ? null : JSON.stringify(["member", receiverKey, propertyName]);
};

const getStaticComparisonConstantKey = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null =>
  getStaticPrimitiveLiteralKey(expression) ?? getImportedStaticReferenceKey(expression, scopes);

const getStaticSelectorIdentity = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): StaticSelectorIdentity | null => {
  const selector = getFinalSequenceExpressionValue(expression);
  if (isNodeOfType(selector, "Identifier")) {
    const symbol = scopes.referenceFor(selector)?.resolvedSymbol;
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      isSymbolStable(symbol) &&
      getSymbolVariableDeclarator(symbol)?.id === symbol.bindingIdentifier &&
      !visitedSymbolIds.has(symbol.id)
    ) {
      visitedSymbolIds.add(symbol.id);
      const initializerIdentity = getStaticSelectorIdentity(
        symbol.initializer,
        scopes,
        visitedSymbolIds,
      );
      if (initializerIdentity) return initializerIdentity;
    }
  }
  if (isNodeOfType(selector, "UnaryExpression") && selector.operator === "!") {
    const argumentIdentity = getStaticSelectorIdentity(selector.argument, scopes, visitedSymbolIds);
    return argumentIdentity
      ? { isInverted: !argumentIdentity.isInverted, key: argumentIdentity.key }
      : null;
  }
  if (
    isNodeOfType(selector, "BinaryExpression") &&
    ["==", "!=", "===", "!=="].includes(selector.operator)
  ) {
    const operandPairs = [
      { literal: selector.right, selectorOperand: selector.left },
      { literal: selector.left, selectorOperand: selector.right },
    ];
    for (const operandPair of operandPairs) {
      const constantKey = getStaticComparisonConstantKey(operandPair.literal, scopes);
      if (constantKey === null) continue;
      const operandKey = getStaticComparisonOperandKey(operandPair.selectorOperand, scopes);
      if (operandKey === null) continue;
      const isInequality = selector.operator === "!=" || selector.operator === "!==";
      return {
        isInverted: isInequality,
        key: JSON.stringify([
          "comparison",
          selector.operator.length === 3 ? "strict" : "loose",
          operandKey,
          constantKey,
        ]),
      };
    }
    return null;
  }
  if (
    isNodeOfType(selector, "BinaryExpression") &&
    ["<", "<=", ">", ">=", "in", "instanceof"].includes(selector.operator)
  ) {
    const leftKey =
      getStaticPrimitiveLiteralKey(selector.left) ??
      getStaticComparisonOperandKey(selector.left, scopes);
    const rightKey =
      getStaticPrimitiveLiteralKey(selector.right) ??
      getStaticComparisonOperandKey(selector.right, scopes);
    if (leftKey !== null && rightKey !== null) {
      return {
        isInverted: false,
        key: JSON.stringify(["binary-comparison", selector.operator, leftKey, rightKey]),
      };
    }
  }
  const key = getSelectorReferenceKey(selector, scopes);
  return key === null ? null : { isInverted: false, key };
};

const getRenderedRootShapeAlternativeKey = (alternative: RenderedRootShapeAlternative): string =>
  JSON.stringify({
    facts: [...alternative.facts]
      .map(([key, fact]) => ({ key, outcome: fact.outcome }))
      .sort((firstFact, secondFact) => firstFact.key.localeCompare(secondFact.key)),
    roots: alternative.roots,
  });

const getRenderedRootFactStateKey = (alternative: RenderedRootShapeAlternative): string =>
  JSON.stringify(
    [...alternative.facts]
      .map(([key, fact]) => ({ key, outcome: fact.outcome }))
      .sort((firstFact, secondFact) => firstFact.key.localeCompare(secondFact.key)),
  );

const deduplicateRenderedRootShapeAlternatives = (
  alternatives: ReadonlyArray<RenderedRootShapeAlternative>,
): ReadonlyArray<RenderedRootShapeAlternative> | null => {
  const deduplicatedAlternatives: RenderedRootShapeAlternative[] = [];
  const alternativeKeys = new Set<string>();
  const alternativeCountsByFactState = new Map<string, number>();
  for (const alternative of alternatives) {
    const alternativeKey = getRenderedRootShapeAlternativeKey(alternative);
    if (alternativeKeys.has(alternativeKey)) continue;
    const factStateKey = getRenderedRootFactStateKey(alternative);
    const factStateAlternativeCount = alternativeCountsByFactState.get(factStateKey) ?? 0;
    if (factStateAlternativeCount > 1) continue;
    alternativeKeys.add(alternativeKey);
    alternativeCountsByFactState.set(factStateKey, factStateAlternativeCount + 1);
    deduplicatedAlternatives.push(alternative);
    if (deduplicatedAlternatives.length > MAX_RENDERED_ROOT_SHAPE_ALTERNATIVE_COUNT) return null;
  }
  return deduplicatedAlternatives;
};

const addRenderedRootSelectorFact = (
  alternatives: ReadonlyArray<RenderedRootShapeAlternative>,
  identity: StaticSelectorIdentity,
  expressionOutcome: boolean,
  selector: EsTreeNode,
): ReadonlyArray<RenderedRootShapeAlternative> => {
  const outcome = identity.isInverted ? !expressionOutcome : expressionOutcome;
  const constrainedAlternatives: RenderedRootShapeAlternative[] = [];
  for (const alternative of alternatives) {
    const existingFact = alternative.facts.get(identity.key);
    if (existingFact && existingFact.outcome !== outcome) continue;
    constrainedAlternatives.push({
      facts: new Map(alternative.facts).set(identity.key, { outcome, selector }),
      roots: alternative.roots,
    });
  }
  return constrainedAlternatives;
};

const mergeRenderedRootShapeAlternatives = (
  existingAlternatives: ReadonlyArray<RenderedRootShapeAlternative>,
  appendedAlternatives: ReadonlyArray<RenderedRootShapeAlternative>,
): ReadonlyArray<RenderedRootShapeAlternative> | null => {
  const mergedAlternatives: RenderedRootShapeAlternative[] = [];
  for (const existingAlternative of existingAlternatives) {
    for (const appendedAlternative of appendedAlternatives) {
      const mergedFacts = new Map(existingAlternative.facts);
      let hasContradictoryFact = false;
      for (const [key, appendedFact] of appendedAlternative.facts) {
        const existingFact = mergedFacts.get(key);
        if (existingFact && existingFact.outcome !== appendedFact.outcome) {
          hasContradictoryFact = true;
          break;
        }
        mergedFacts.set(key, appendedFact);
      }
      if (hasContradictoryFact) continue;
      mergedAlternatives.push({
        facts: mergedFacts,
        roots: [...existingAlternative.roots, ...appendedAlternative.roots],
      });
    }
  }
  return deduplicateRenderedRootShapeAlternatives(mergedAlternatives);
};

const combineRenderedRootShapeAlternativeBranches = (
  branches: ReadonlyArray<ReadonlyArray<RenderedRootShapeAlternative>>,
): ReadonlyArray<RenderedRootShapeAlternative> | null =>
  deduplicateRenderedRootShapeAlternatives(branches.flat());

const getStaticRenderedRootAlternatives = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<RenderedRootShapeAlternative> | null => {
  const renderedNode = getFinalSequenceExpressionValue(node);
  if (
    isNodeOfType(renderedNode, "JSXElement") &&
    !isJsxFragmentElement(renderedNode.openingElement, scopes)
  ) {
    const elementIdentity = getJsxElementIdentity(renderedNode.openingElement.name, scopes);
    return elementIdentity === null ? null : [{ facts: new Map(), roots: [elementIdentity] }];
  }
  if (isNodeOfType(renderedNode, "JSXElement") || isNodeOfType(renderedNode, "JSXFragment")) {
    let alternatives: ReadonlyArray<RenderedRootShapeAlternative> = [
      { facts: new Map(), roots: [] },
    ];
    for (const child of renderedNode.children) {
      const childAlternatives = getStaticRenderedRootAlternatives(child, scopes);
      if (childAlternatives === null) return null;
      const mergedAlternatives = mergeRenderedRootShapeAlternatives(
        alternatives,
        childAlternatives,
      );
      if (mergedAlternatives === null) return null;
      alternatives = mergedAlternatives;
    }
    return alternatives;
  }
  if (isNodeOfType(renderedNode, "JSXText")) {
    return renderedNode.value?.trim() ? null : [{ facts: new Map(), roots: [] }];
  }
  if (isNodeOfType(renderedNode, "JSXExpressionContainer")) {
    return getStaticRenderedRootAlternatives(renderedNode.expression, scopes);
  }
  if (isStaticallyEmptyJsxChild(renderedNode)) return [{ facts: new Map(), roots: [] }];
  if (isNodeOfType(renderedNode, "ConditionalExpression")) {
    const staticTestValue = readStaticSelectorTruthiness(renderedNode.test, scopes);
    if (staticTestValue !== null) {
      return getStaticRenderedRootAlternatives(
        staticTestValue ? renderedNode.consequent : renderedNode.alternate,
        scopes,
      );
    }
    const consequentAlternatives = getStaticRenderedRootAlternatives(
      renderedNode.consequent,
      scopes,
    );
    const alternateAlternatives = getStaticRenderedRootAlternatives(renderedNode.alternate, scopes);
    if (consequentAlternatives === null || alternateAlternatives === null) return null;
    const selectorIdentity = getStaticSelectorIdentity(renderedNode.test, scopes);
    return combineRenderedRootShapeAlternativeBranches([
      selectorIdentity
        ? addRenderedRootSelectorFact(
            consequentAlternatives,
            selectorIdentity,
            true,
            renderedNode.test,
          )
        : consequentAlternatives,
      selectorIdentity
        ? addRenderedRootSelectorFact(
            alternateAlternatives,
            selectorIdentity,
            false,
            renderedNode.test,
          )
        : alternateAlternatives,
    ]);
  }
  if (isNodeOfType(renderedNode, "LogicalExpression")) {
    const selectorIdentity =
      (renderedNode.operator === "&&" || renderedNode.operator === "||") &&
      isStaticallyEmptyJsxChild(renderedNode.left)
        ? getStaticSelectorIdentity(renderedNode.left, scopes)
        : null;
    if (selectorIdentity) {
      const rightAlternatives = getStaticRenderedRootAlternatives(renderedNode.right, scopes);
      if (rightAlternatives === null) return null;
      const emptyAlternatives: ReadonlyArray<RenderedRootShapeAlternative> = [
        { facts: new Map(), roots: [] },
      ];
      return combineRenderedRootShapeAlternativeBranches([
        addRenderedRootSelectorFact(
          renderedNode.operator === "&&" ? rightAlternatives : emptyAlternatives,
          selectorIdentity,
          true,
          renderedNode.left,
        ),
        addRenderedRootSelectorFact(
          renderedNode.operator === "&&" ? emptyAlternatives : rightAlternatives,
          selectorIdentity,
          false,
          renderedNode.left,
        ),
      ]);
    }
    const resultAlternatives: Array<ReadonlyArray<RenderedRootShapeAlternative>> = [];
    for (const resultBranch of getStaticLogicalExpressionResultBranches(renderedNode)) {
      const branchAlternatives = getStaticRenderedRootAlternatives(resultBranch, scopes);
      if (branchAlternatives === null) return null;
      resultAlternatives.push(branchAlternatives);
    }
    return combineRenderedRootShapeAlternativeBranches(resultAlternatives);
  }
  return null;
};

const getFlattenedFragmentChildren = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<EsTreeNode> | null => {
  const flattenChild = (child: EsTreeNode): ReadonlyArray<EsTreeNode> => {
    const renderedChild = getFinalSequenceExpressionValue(child);
    if (isNodeOfType(renderedChild, "JSXExpressionContainer")) {
      return flattenChild(renderedChild.expression);
    }
    if (
      !isNodeOfType(renderedChild, "JSXFragment") &&
      (!isNodeOfType(renderedChild, "JSXElement") ||
        !isJsxFragmentElement(renderedChild.openingElement, scopes))
    ) {
      return [child];
    }
    return renderedChild.children.flatMap(flattenChild);
  };

  const renderedNode = getFinalSequenceExpressionValue(node);
  if (
    !isNodeOfType(renderedNode, "JSXFragment") &&
    (!isNodeOfType(renderedNode, "JSXElement") ||
      !isJsxFragmentElement(renderedNode.openingElement, scopes))
  ) {
    return null;
  }
  return renderedNode.children.flatMap(flattenChild);
};

const forgetFinalizedRenderedRootFacts = (
  alternatives: ReadonlyArray<RenderedRootShapeAlternative>,
  futureFactKeyCounts: ReadonlyMap<string, number>,
): ReadonlyArray<RenderedRootShapeAlternative> | null =>
  deduplicateRenderedRootShapeAlternatives(
    alternatives.map((alternative) => ({
      facts: new Map(
        [...alternative.facts].filter(([key]) => (futureFactKeyCounts.get(key) ?? 0) > 0),
      ),
      roots: alternative.roots,
    })),
  );

const getStaticRenderedRootShapes = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<ReadonlyArray<string>> | null => {
  let alternatives = getStaticRenderedRootAlternatives(node, scopes);
  if (alternatives === null) {
    const fragmentChildren = getFlattenedFragmentChildren(node, scopes);
    if (fragmentChildren === null) return null;
    const childAlternatives: Array<ReadonlyArray<RenderedRootShapeAlternative>> = [];
    for (const child of fragmentChildren) {
      const staticChildAlternatives = getStaticRenderedRootAlternatives(child, scopes);
      if (staticChildAlternatives === null) return null;
      childAlternatives.push(staticChildAlternatives);
    }
    const futureFactKeyCounts = new Map<string, number>();
    for (const staticChildAlternatives of childAlternatives) {
      const childFactKeys = new Set<string>();
      for (const alternative of staticChildAlternatives) {
        for (const key of alternative.facts.keys()) childFactKeys.add(key);
      }
      for (const key of childFactKeys) {
        futureFactKeyCounts.set(key, (futureFactKeyCounts.get(key) ?? 0) + 1);
      }
    }
    let prefixAlternatives: ReadonlyArray<RenderedRootShapeAlternative> = [
      { facts: new Map(), roots: [] },
    ];
    let witnessAlternatives: ReadonlyArray<RenderedRootShapeAlternative> | null = null;
    for (const staticChildAlternatives of childAlternatives) {
      const currentFactKeys = new Set<string>();
      for (const alternative of staticChildAlternatives) {
        for (const key of alternative.facts.keys()) currentFactKeys.add(key);
      }
      for (const key of currentFactKeys) {
        futureFactKeyCounts.set(key, (futureFactKeyCounts.get(key) ?? 1) - 1);
      }
      const mergedAlternatives = mergeRenderedRootShapeAlternatives(
        prefixAlternatives,
        staticChildAlternatives,
      );
      if (mergedAlternatives === null) break;
      prefixAlternatives = mergedAlternatives;
      for (
        let firstAlternativeIndex = 0;
        firstAlternativeIndex < prefixAlternatives.length;
        firstAlternativeIndex += 1
      ) {
        const firstAlternative = prefixAlternatives[firstAlternativeIndex]!;
        for (
          let secondAlternativeIndex = firstAlternativeIndex + 1;
          secondAlternativeIndex < prefixAlternatives.length;
          secondAlternativeIndex += 1
        ) {
          const secondAlternative = prefixAlternatives[secondAlternativeIndex]!;
          if (JSON.stringify(firstAlternative.roots) === JSON.stringify(secondAlternative.roots)) {
            continue;
          }
          const hasFinalizedOppositeFact = [...firstAlternative.facts].some(([key, firstFact]) => {
            const secondFact = secondAlternative.facts.get(key);
            return (
              futureFactKeyCounts.get(key) === 0 &&
              secondFact !== undefined &&
              secondFact.outcome !== firstFact.outcome
            );
          });
          if (hasFinalizedOppositeFact) {
            witnessAlternatives = [firstAlternative, secondAlternative];
            break;
          }
        }
        if (witnessAlternatives) break;
      }
      if (witnessAlternatives) break;
      const remainingAlternatives = forgetFinalizedRenderedRootFacts(
        prefixAlternatives,
        futureFactKeyCounts,
      );
      if (remainingAlternatives === null) break;
      prefixAlternatives = remainingAlternatives;
    }
    if (witnessAlternatives === null) return null;
    alternatives = witnessAlternatives;
  }
  const rootShapes: string[][] = [];
  const rootShapeKeys = new Set<string>();
  for (const alternative of alternatives) {
    const rootShapeKey = JSON.stringify(alternative.roots);
    if (rootShapeKeys.has(rootShapeKey)) continue;
    rootShapeKeys.add(rootShapeKey);
    rootShapes.push([...alternative.roots]);
  }
  return rootShapes;
};

const getRenderedRootNames = (
  root: EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment">,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null => {
  const renderedRootShapes = getStaticRenderedRootShapes(root, scopes);
  if (renderedRootShapes === null) return null;
  return renderedRootShapes.map((rootShape) => {
    const onlyRootName = rootShape[0];
    return rootShape.length === 1 && onlyRootName
      ? onlyRootName
      : `fragment:${JSON.stringify(rootShape)}`;
  });
};

const getPatternBindingIdentifier = (pattern: EsTreeNode): EsTreeNode | null => {
  const unwrappedPattern = stripParenExpression(pattern);
  if (isNodeOfType(unwrappedPattern, "Identifier")) return unwrappedPattern;
  if (isNodeOfType(unwrappedPattern, "AssignmentPattern")) {
    return getPatternBindingIdentifier(unwrappedPattern.left);
  }
  return null;
};

const getObjectPatternPropertyBinding = (
  pattern: EsTreeNode,
  propertyName: string,
): EsTreeNode | null => {
  const unwrappedPattern = stripParenExpression(pattern);
  if (!isNodeOfType(unwrappedPattern, "ObjectPattern")) return null;
  for (const property of unwrappedPattern.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== propertyName
    ) {
      continue;
    }
    return getPatternBindingIdentifier(property.value);
  }
  return null;
};

const isUnconditionallyTerminalStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    return statement.body.some(isUnconditionallyTerminalStatement);
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return Boolean(
      statement.alternate &&
      isUnconditionallyTerminalStatement(statement.consequent) &&
      isUnconditionallyTerminalStatement(statement.alternate),
    );
  }
  if (isNodeOfType(statement, "SwitchStatement")) {
    return (
      statement.cases.some((switchCase) => switchCase.test === null) &&
      statement.cases.every((switchCase) =>
        switchCase.consequent.some(isUnconditionallyTerminalStatement),
      )
    );
  }
  return false;
};

const getReachableFunctionReturnStatements = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<EsTreeNodeOfType<"ReturnStatement">> =>
  collectFunctionReturnStatements(functionNode).filter((returnStatement) => {
    let descendant: EsTreeNode = returnStatement;
    let ancestor = returnStatement.parent;
    while (ancestor && ancestor !== functionNode) {
      if (isNodeOfType(ancestor, "IfStatement")) {
        const staticTestValue = readStaticSelectorTruthiness(ancestor.test, scopes);
        if (
          staticTestValue !== null &&
          ((staticTestValue && ancestor.alternate === descendant) ||
            (!staticTestValue && ancestor.consequent === descendant))
        ) {
          return false;
        }
      }
      if (isNodeOfType(ancestor, "BlockStatement")) {
        const descendantIndex = ancestor.body.findIndex((statement) => statement === descendant);
        if (
          descendantIndex > 0 &&
          ancestor.body.slice(0, descendantIndex).some((statement) => {
            if (isNodeOfType(statement, "IfStatement")) {
              const staticTestValue = readStaticSelectorTruthiness(statement.test, scopes);
              if (staticTestValue === true) {
                return isUnconditionallyTerminalStatement(statement.consequent);
              }
              if (staticTestValue === false) {
                return Boolean(
                  statement.alternate && isUnconditionallyTerminalStatement(statement.alternate),
                );
              }
            }
            return isUnconditionallyTerminalStatement(statement);
          })
        ) {
          return false;
        }
      }
      descendant = ancestor;
      ancestor = ancestor.parent;
    }
    return true;
  });

const getRenderItemInputReferences = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<RendererInputReference> => {
  if (!isFunctionLike(functionNode)) return [];
  const parameter = functionNode.params[0];
  if (!parameter) return [];
  const unwrappedParameter = stripParenExpression(parameter);
  if (isNodeOfType(unwrappedParameter, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedParameter);
    if (!symbol) return [];
    return [...RENDER_ITEM_INPUT_NAMES].map((inputName) => ({
      inputName,
      isStable: isSymbolStable(symbol),
      propertyName: inputName,
      symbolId: symbol.id,
    }));
  }
  if (!isNodeOfType(unwrappedParameter, "ObjectPattern")) return [];
  const references: RendererInputReference[] = [];
  for (const inputName of RENDER_ITEM_INPUT_NAMES) {
    const bindingIdentifier = getObjectPatternPropertyBinding(unwrappedParameter, inputName);
    const symbol = bindingIdentifier ? scopes.symbolFor(bindingIdentifier) : null;
    if (symbol) {
      references.push({
        inputName,
        isStable: isSymbolStable(symbol),
        propertyName: null,
        symbolId: symbol.id,
      });
    }
  }
  return references;
};

const isStaticallyTruthyContainer = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrayExpression") ||
  isNodeOfType(node, "ObjectExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ClassExpression") ||
  isNodeOfType(node, "NewExpression") ||
  isNodeOfType(node, "JSXElement") ||
  isNodeOfType(node, "JSXFragment");

const expressionReadsInput = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const inputExpression = getFinalSequenceExpressionValue(expression);
  if (isStaticallyTruthyContainer(inputExpression)) return false;
  let didReadInput = false;
  walkAst(inputExpression, (node) => {
    if (didReadInput) return false;
    if (
      node !== inputExpression &&
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const reference = scopes.referenceFor(node);
      if (
        reference &&
        reference.flag !== "write" &&
        inputReferences.some(
          (inputReference) =>
            inputReference.isStable &&
            inputReference.propertyName === null &&
            inputReference.symbolId === reference.resolvedSymbol?.id,
        )
      ) {
        didReadInput = true;
        return false;
      }
      const symbol = reference?.resolvedSymbol;
      if (
        symbol?.kind === "const" &&
        symbol.initializer &&
        isSymbolStable(symbol) &&
        !visitedSymbolIds.has(symbol.id)
      ) {
        visitedSymbolIds.add(symbol.id);
        for (const initializer of getConstInitializerExpressions(symbol)) {
          if (expressionReadsInput(initializer, inputReferences, scopes, visitedSymbolIds)) {
            didReadInput = true;
            return false;
          }
        }
      }
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const propertyName = getStaticPropertyName(node);
    const receiver = stripParenExpression(node.object);
    if (propertyName === null || !isNodeOfType(receiver, "Identifier")) return;
    const receiverReference = scopes.referenceFor(receiver);
    if (
      receiverReference &&
      receiverReference.flag !== "write" &&
      inputReferences.some(
        (inputReference) =>
          inputReference.isStable &&
          inputReference.propertyName === propertyName &&
          inputReference.symbolId === receiverReference.resolvedSymbol?.id,
      )
    ) {
      didReadInput = true;
      return false;
    }
  });
  return didReadInput;
};

const climbTransparentExpressionWrappers = (node: EsTreeNode): EsTreeNode => {
  let expression = node;
  while (
    expression.parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(expression.parent.type) &&
    "expression" in expression.parent &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }
  return expression;
};

const isProvenStaticCallableReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const reference = stripParenExpression(expression);
  if (isNodeOfType(reference, "MemberExpression")) {
    return getImportedStaticReferenceKey(reference, scopes) !== null;
  }
  if (!isNodeOfType(reference, "Identifier")) return false;
  const symbol = scopes.referenceFor(reference)?.resolvedSymbol;
  if (!symbol) return scopes.isGlobalReference(reference);
  if (!isSymbolStable(symbol) || visitedSymbolIds.has(symbol.id)) return false;
  if (symbol.kind === "import" || symbol.kind === "function") return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  visitedSymbolIds.add(symbol.id);
  const initializer = stripParenExpression(symbol.initializer);
  if (isFunctionLike(initializer)) return true;
  return isNodeOfType(initializer, "Identifier") || isNodeOfType(initializer, "MemberExpression")
    ? isProvenStaticCallableReference(initializer, scopes, visitedSymbolIds)
    : false;
};

const isProvenStaticCallCallee = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let callee = climbTransparentExpressionWrappers(identifier);
  while (isNodeOfType(callee.parent, "MemberExpression") && callee.parent.object === callee) {
    callee = climbTransparentExpressionWrappers(callee.parent);
  }
  return (
    isNodeOfType(callee.parent, "CallExpression") &&
    callee.parent.callee === callee &&
    isProvenStaticCallableReference(callee, scopes)
  );
};

const isInsideComparisonOperand = (identifier: EsTreeNode): boolean => {
  let descendant = climbTransparentExpressionWrappers(identifier);
  let ancestor = descendant.parent;
  while (
    isNodeOfType(ancestor, "MemberExpression") &&
    (ancestor.object === descendant || ancestor.property === descendant)
  ) {
    descendant = climbTransparentExpressionWrappers(ancestor);
    ancestor = descendant.parent;
  }
  return (
    isNodeOfType(ancestor, "BinaryExpression") &&
    ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof"].includes(ancestor.operator)
  );
};

const expressionReadsOnlyInput = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!expressionReadsInput(expression, inputReferences, scopes)) return false;
  const selector = getFinalSequenceExpressionValue(expression);
  let hasUnrelatedRead = false;
  const visitedSymbolIds = new Set<number>();
  const inspectExpression = (candidate: EsTreeNode): void => {
    walkAst(candidate, (node) => {
      if (hasUnrelatedRead) return false;
      if (
        node !== candidate &&
        (isFunctionLike(node) ||
          isNodeOfType(node, "ClassDeclaration") ||
          isNodeOfType(node, "ClassExpression"))
      ) {
        return false;
      }
      if (!isNodeOfType(node, "Identifier")) return;
      const parent = node.parent;
      if (
        (isNodeOfType(parent, "MemberExpression") &&
          parent.property === node &&
          !parent.computed) ||
        (isNodeOfType(parent, "Property") && parent.key === node && !parent.computed) ||
        isProvenStaticCallCallee(node, scopes)
      ) {
        return;
      }
      const reference = scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      const isDirectInput = inputReferences.some(
        (inputReference) =>
          inputReference.isStable &&
          inputReference.propertyName === null &&
          inputReference.symbolId === symbol?.id,
      );
      const isInputContainer =
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === node &&
        inputReferences.some(
          (inputReference) =>
            inputReference.isStable &&
            inputReference.propertyName === getStaticPropertyName(parent) &&
            inputReference.symbolId === symbol?.id,
        );
      if (isDirectInput || isInputContainer) return;
      if (symbol?.kind === "import" && isInsideComparisonOperand(node)) return;
      if (
        symbol?.kind === "const" &&
        symbol.initializer &&
        isSymbolStable(symbol) &&
        visitedSymbolIds.has(symbol.id)
      ) {
        return;
      }
      if (
        symbol?.kind === "const" &&
        symbol.initializer &&
        isSymbolStable(symbol) &&
        !visitedSymbolIds.has(symbol.id)
      ) {
        visitedSymbolIds.add(symbol.id);
        const initializers = getConstInitializerExpressions(symbol);
        if (
          !initializers.some((initializer) =>
            expressionReadsInput(initializer, inputReferences, scopes),
          ) &&
          initializers.some(
            (initializer) => readStaticSelectorTruthiness(initializer, scopes) === null,
          )
        ) {
          hasUnrelatedRead = true;
          return false;
        }
        for (const initializer of initializers) inspectExpression(initializer);
        return;
      }
      hasUnrelatedRead = true;
      return false;
    });
  };
  inspectExpression(selector);
  return !hasUnrelatedRead;
};

const hasInputDependentRenderedRootDifference = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): boolean => {
  const alternativesHaveInputDependentDifference = (
    alternatives: ReadonlyArray<RenderedRootShapeAlternative>,
    eligibleFactKeys?: ReadonlySet<string>,
  ): boolean => {
    for (
      let firstAlternativeIndex = 0;
      firstAlternativeIndex < alternatives.length;
      firstAlternativeIndex += 1
    ) {
      const firstAlternative = alternatives[firstAlternativeIndex]!;
      for (
        let secondAlternativeIndex = firstAlternativeIndex + 1;
        secondAlternativeIndex < alternatives.length;
        secondAlternativeIndex += 1
      ) {
        const secondAlternative = alternatives[secondAlternativeIndex]!;
        if (JSON.stringify(firstAlternative.roots) === JSON.stringify(secondAlternative.roots)) {
          continue;
        }
        let hasInputDependentDifference = false;
        let hasAmbientConflict = false;
        for (const [key, firstFact] of firstAlternative.facts) {
          const secondFact = secondAlternative.facts.get(key);
          if (!secondFact || firstFact.outcome === secondFact.outcome) continue;
          if (
            (!eligibleFactKeys || eligibleFactKeys.has(key)) &&
            expressionReadsOnlyInput(firstFact.selector, inputReferences, scopes) &&
            expressionReadsOnlyInput(secondFact.selector, inputReferences, scopes)
          ) {
            hasInputDependentDifference = true;
          } else {
            hasAmbientConflict = true;
          }
        }
        if (hasInputDependentDifference && !hasAmbientConflict) return true;
      }
    }
    return false;
  };

  const renderedExpression = getFinalSequenceExpressionValue(expression);
  const fragmentChildren = getFlattenedFragmentChildren(renderedExpression, scopes);
  if (fragmentChildren !== null) {
    const childAlternatives: Array<ReadonlyArray<RenderedRootShapeAlternative>> = [];
    for (const child of fragmentChildren) {
      const alternatives = getStaticRenderedRootAlternatives(child, scopes);
      if (alternatives === null) return false;
      childAlternatives.push(alternatives);
    }
    const futureFactKeyCounts = new Map<string, number>();
    for (const alternatives of childAlternatives) {
      const childFactKeys = new Set<string>();
      for (const alternative of alternatives) {
        for (const key of alternative.facts.keys()) childFactKeys.add(key);
      }
      for (const key of childFactKeys) {
        futureFactKeyCounts.set(key, (futureFactKeyCounts.get(key) ?? 0) + 1);
      }
    }
    let prefixAlternatives: ReadonlyArray<RenderedRootShapeAlternative> = [
      { facts: new Map(), roots: [] },
    ];
    for (const alternatives of childAlternatives) {
      const currentFactKeys = new Set<string>();
      for (const alternative of alternatives) {
        for (const key of alternative.facts.keys()) currentFactKeys.add(key);
      }
      for (const key of currentFactKeys) {
        futureFactKeyCounts.set(key, (futureFactKeyCounts.get(key) ?? 1) - 1);
      }
      const mergedAlternatives = mergeRenderedRootShapeAlternatives(
        prefixAlternatives,
        alternatives,
      );
      if (mergedAlternatives === null) return false;
      prefixAlternatives = mergedAlternatives;
      const finalFactKeys = new Set<string>();
      for (const alternative of prefixAlternatives) {
        for (const key of alternative.facts.keys()) {
          if (futureFactKeyCounts.get(key) === 0) finalFactKeys.add(key);
        }
      }
      if (
        finalFactKeys.size > 0 &&
        alternativesHaveInputDependentDifference(prefixAlternatives, finalFactKeys)
      ) {
        return true;
      }
      const remainingAlternatives = forgetFinalizedRenderedRootFacts(
        prefixAlternatives,
        futureFactKeyCounts,
      );
      if (remainingAlternatives === null) return false;
      prefixAlternatives = remainingAlternatives;
    }
    return false;
  }

  const alternatives = getStaticRenderedRootAlternatives(renderedExpression, scopes);
  return alternatives !== null && alternativesHaveInputDependentDifference(alternatives);
};

const getKnownReturnedRootNames = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<string> | null => {
  const returnedExpression = getFinalSequenceExpressionValue(expression);
  if (
    isNodeOfType(returnedExpression, "JSXElement") ||
    isNodeOfType(returnedExpression, "JSXFragment")
  ) {
    const rootNames = getRenderedRootNames(returnedExpression, scopes);
    return rootNames === null ? null : new Set(rootNames);
  }
  if (isStaticallyEmptyJsxChild(returnedExpression)) {
    return new Set([EMPTY_RENDERED_ROOT_NAME]);
  }
  let branches: ReadonlyArray<EsTreeNode>;
  if (isNodeOfType(returnedExpression, "ConditionalExpression")) {
    branches = [returnedExpression.consequent, returnedExpression.alternate];
  } else if (isNodeOfType(returnedExpression, "LogicalExpression")) {
    branches = getStaticLogicalExpressionResultBranches(returnedExpression);
  } else {
    return null;
  }
  const rootNames = new Set<string>();
  for (const branch of branches) {
    const branchRootNames = getKnownReturnedRootNames(branch, scopes);
    if (branchRootNames === null) return null;
    for (const rootName of branchRootNames) rootNames.add(rootName);
  }
  return rootNames;
};

const collectKnownStatementRootNames = (
  statement: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<string> | null => {
  const rootNames = new Set<string>();
  let hasUnknownRoot = false;
  walkAst(statement, (node) => {
    if (hasUnknownRoot) return false;
    if (
      node !== statement &&
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (!isNodeOfType(node, "ReturnStatement")) return;
    const returnedRootNames = node.argument
      ? getKnownReturnedRootNames(node.argument, scopes)
      : new Set([EMPTY_RENDERED_ROOT_NAME]);
    if (returnedRootNames === null) {
      hasUnknownRoot = true;
      return false;
    }
    for (const rootName of returnedRootNames) rootNames.add(rootName);
    return false;
  });
  return hasUnknownRoot || rootNames.size === 0 ? null : rootNames;
};

const collectKnownContinuationRootNames = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
  scopes: ScopeAnalysis,
): ReadonlySet<string> | null => {
  const parent = ifStatement.parent;
  if (!parent || !isNodeOfType(parent, "BlockStatement")) return null;
  const statementIndex = parent.body.findIndex((statement) => statement === ifStatement);
  if (statementIndex < 0) return null;
  const rootNames = new Set<string>();
  for (const statement of parent.body.slice(statementIndex + 1)) {
    const statementRootNames = collectKnownStatementRootNames(statement, scopes);
    if (statementRootNames) {
      for (const rootName of statementRootNames) rootNames.add(rootName);
    }
    if (isUnconditionallyTerminalStatement(statement)) break;
  }
  return rootNames.size === 0 ? null : rootNames;
};

const getDirectStatementRootAlternatives = (
  statement: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<RenderedRootShapeAlternative> | null => {
  if (isNodeOfType(statement, "ReturnStatement")) {
    return statement.argument
      ? getStaticRenderedRootAlternatives(statement.argument, scopes)
      : [{ facts: new Map(), roots: [] }];
  }
  if (isNodeOfType(statement, "BlockStatement") && statement.body.length === 1) {
    return getDirectStatementRootAlternatives(statement.body[0]!, scopes);
  }
  return null;
};

const getContinuationRootAlternatives = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
  scopes: ScopeAnalysis,
): ReadonlyArray<RenderedRootShapeAlternative> | null => {
  const parent = ifStatement.parent;
  if (!parent || !isNodeOfType(parent, "BlockStatement")) return null;
  const statementIndex = parent.body.findIndex((statement) => statement === ifStatement);
  if (statementIndex < 0) return null;
  for (const statement of parent.body.slice(statementIndex + 1)) {
    const alternatives = getDirectStatementRootAlternatives(statement, scopes);
    if (alternatives !== null) return alternatives;
    if (isUnconditionallyTerminalStatement(statement)) return null;
  }
  return null;
};

const renderedRootFactsAreCompatible = (
  firstFacts: ReadonlyMap<string, RenderedRootSelectorFact>,
  secondFacts: ReadonlyMap<string, RenderedRootSelectorFact>,
): boolean => {
  for (const [key, firstFact] of firstFacts) {
    const secondFact = secondFacts.get(key);
    if (secondFact && secondFact.outcome !== firstFact.outcome) return false;
  }
  return true;
};

const hasDistinctKnownIfRootOutcomes = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isUnconditionallyTerminalStatement(ifStatement.consequent)) return false;
  const consequentAlternatives = getDirectStatementRootAlternatives(ifStatement.consequent, scopes);
  const alternateAlternatives = ifStatement.alternate
    ? isUnconditionallyTerminalStatement(ifStatement.alternate)
      ? getDirectStatementRootAlternatives(ifStatement.alternate, scopes)
      : null
    : getContinuationRootAlternatives(ifStatement, scopes);
  if (consequentAlternatives && alternateAlternatives) {
    return consequentAlternatives.some((consequentAlternative) =>
      alternateAlternatives.some(
        (alternateAlternative) =>
          renderedRootFactsAreCompatible(consequentAlternative.facts, alternateAlternative.facts) &&
          JSON.stringify(consequentAlternative.roots) !==
            JSON.stringify(alternateAlternative.roots),
      ),
    );
  }
  const consequentRootNames = collectKnownStatementRootNames(ifStatement.consequent, scopes);
  const alternateRootNames = ifStatement.alternate
    ? isUnconditionallyTerminalStatement(ifStatement.alternate)
      ? collectKnownStatementRootNames(ifStatement.alternate, scopes)
      : null
    : collectKnownContinuationRootNames(ifStatement, scopes);
  if (!consequentRootNames || !alternateRootNames) return false;
  return (
    [...consequentRootNames].some((rootName) => !alternateRootNames.has(rootName)) ||
    [...alternateRootNames].some((rootName) => !consequentRootNames.has(rootName))
  );
};

const hasDistinctKnownSwitchRootOutcomes = (
  switchStatement: EsTreeNodeOfType<"SwitchStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !switchStatement.cases.some((switchCase) => switchCase.test === null) ||
    !switchStatement.cases.every((switchCase) =>
      switchCase.consequent.some(isUnconditionallyTerminalStatement),
    )
  ) {
    return false;
  }
  const caseRootNames: Array<ReadonlySet<string>> = [];
  for (const switchCase of switchStatement.cases) {
    const rootNames = collectKnownStatementRootNames(switchCase, scopes);
    if (!rootNames) return false;
    caseRootNames.push(rootNames);
  }
  for (let firstCaseIndex = 0; firstCaseIndex < caseRootNames.length; firstCaseIndex += 1) {
    const firstRootNames = caseRootNames[firstCaseIndex]!;
    for (
      let secondCaseIndex = firstCaseIndex + 1;
      secondCaseIndex < caseRootNames.length;
      secondCaseIndex += 1
    ) {
      const secondRootNames = caseRootNames[secondCaseIndex]!;
      if ([...firstRootNames].every((rootName) => !secondRootNames.has(rootName))) return true;
    }
  }
  return false;
};

const readStaticSelectorTruthiness = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean | null => {
  const selector = getFinalSequenceExpressionValue(expression);
  if (isStaticallyTruthyContainer(selector)) return true;
  if (isNodeOfType(selector, "Literal")) return Boolean(selector.value);
  if (isNodeOfType(selector, "Identifier")) {
    const symbol = scopes.symbolFor(selector);
    if (
      symbol &&
      (symbol.kind === "function" || symbol.kind === "class") &&
      isSymbolStable(symbol)
    ) {
      return true;
    }
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      isSymbolStable(symbol) &&
      getSymbolVariableDeclarator(symbol)?.id === symbol.bindingIdentifier &&
      !visitedSymbolIds.has(symbol.id)
    ) {
      visitedSymbolIds.add(symbol.id);
      return readStaticSelectorTruthiness(symbol.initializer, scopes, visitedSymbolIds);
    }
  }
  if (isNodeOfType(selector, "UnaryExpression") && selector.operator === "!") {
    const argumentTruthiness = readStaticSelectorTruthiness(
      selector.argument,
      scopes,
      visitedSymbolIds,
    );
    return argumentTruthiness === null ? null : !argumentTruthiness;
  }
  if (!isNodeOfType(selector, "LogicalExpression")) return null;
  const leftTruthiness = readStaticSelectorTruthiness(
    selector.left,
    scopes,
    new Set(visitedSymbolIds),
  );
  const rightTruthiness = readStaticSelectorTruthiness(
    selector.right,
    scopes,
    new Set(visitedSymbolIds),
  );
  if (selector.operator === "&&") {
    if (leftTruthiness === false || rightTruthiness === false) return false;
    return leftTruthiness === true ? rightTruthiness : null;
  }
  if (selector.operator === "||") {
    if (leftTruthiness === true || rightTruthiness === true) return true;
    return leftTruthiness === false ? rightTruthiness : null;
  }
  return leftTruthiness;
};

const analyzeReturnedExpressionSelections = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): InputSelectionAnalysis => {
  const returnedExpression = getFinalSequenceExpressionValue(expression);
  if (isNodeOfType(returnedExpression, "JSXExpressionContainer")) {
    return analyzeReturnedExpressionSelections(
      returnedExpression.expression,
      inputReferences,
      scopes,
    );
  }
  if (
    isNodeOfType(returnedExpression, "JSXFragment") ||
    (isNodeOfType(returnedExpression, "JSXElement") &&
      isJsxFragmentElement(returnedExpression.openingElement, scopes))
  ) {
    let hasInputDependentSelection = false;
    let hasUnrelatedSelection = false;
    for (const child of returnedExpression.children) {
      const childAnalysis = analyzeReturnedExpressionSelections(child, inputReferences, scopes);
      hasInputDependentSelection ||= childAnalysis.hasInputDependentSelection;
      hasUnrelatedSelection ||= childAnalysis.hasUnrelatedSelection;
    }
    return {
      hasInputDependentSelection,
      hasProvenInputDependentRootSelection: hasInputDependentRenderedRootDifference(
        returnedExpression,
        inputReferences,
        scopes,
      ),
      hasUnrelatedSelection,
    };
  }
  if (isNodeOfType(returnedExpression, "ConditionalExpression")) {
    const staticTestValue = readStaticSelectorTruthiness(returnedExpression.test, scopes);
    if (staticTestValue !== null) {
      return analyzeReturnedExpressionSelections(
        staticTestValue ? returnedExpression.consequent : returnedExpression.alternate,
        inputReferences,
        scopes,
      );
    }
    const consequentAnalysis = analyzeReturnedExpressionSelections(
      returnedExpression.consequent,
      inputReferences,
      scopes,
    );
    const alternateAnalysis = analyzeReturnedExpressionSelections(
      returnedExpression.alternate,
      inputReferences,
      scopes,
    );
    const selectorReadsInput = expressionReadsOnlyInput(
      returnedExpression.test,
      inputReferences,
      scopes,
    );
    const selectedRootNames = getKnownReturnedRootNames(returnedExpression, scopes);
    return {
      hasInputDependentSelection:
        selectorReadsInput ||
        consequentAnalysis.hasInputDependentSelection ||
        alternateAnalysis.hasInputDependentSelection,
      hasProvenInputDependentRootSelection:
        (selectorReadsInput && selectedRootNames !== null && selectedRootNames.size > 1) ||
        consequentAnalysis.hasProvenInputDependentRootSelection ||
        alternateAnalysis.hasProvenInputDependentRootSelection,
      hasUnrelatedSelection:
        (!selectorReadsInput && (selectedRootNames === null || selectedRootNames.size > 1)) ||
        consequentAnalysis.hasUnrelatedSelection ||
        alternateAnalysis.hasUnrelatedSelection,
    };
  }
  if (isNodeOfType(returnedExpression, "LogicalExpression")) {
    const resultBranches = getStaticLogicalExpressionResultBranches(returnedExpression);
    if (resultBranches.length < 2) {
      const onlyResult = resultBranches[0];
      return onlyResult
        ? analyzeReturnedExpressionSelections(onlyResult, inputReferences, scopes)
        : {
            hasInputDependentSelection: false,
            hasProvenInputDependentRootSelection: false,
            hasUnrelatedSelection: false,
          };
    }
    const leftAnalysis = analyzeReturnedExpressionSelections(
      returnedExpression.left,
      inputReferences,
      scopes,
    );
    const rightAnalysis = analyzeReturnedExpressionSelections(
      returnedExpression.right,
      inputReferences,
      scopes,
    );
    const selectorReadsInput = expressionReadsOnlyInput(
      returnedExpression.left,
      inputReferences,
      scopes,
    );
    const selectedRootNames = getKnownReturnedRootNames(returnedExpression, scopes);
    return {
      hasInputDependentSelection:
        selectorReadsInput ||
        leftAnalysis.hasInputDependentSelection ||
        rightAnalysis.hasInputDependentSelection,
      hasProvenInputDependentRootSelection:
        (selectorReadsInput && selectedRootNames !== null && selectedRootNames.size > 1) ||
        leftAnalysis.hasProvenInputDependentRootSelection ||
        rightAnalysis.hasProvenInputDependentRootSelection,
      hasUnrelatedSelection:
        (!selectorReadsInput && (selectedRootNames === null || selectedRootNames.size > 1)) ||
        leftAnalysis.hasUnrelatedSelection ||
        rightAnalysis.hasUnrelatedSelection,
    };
  }
  if (
    isNodeOfType(returnedExpression, "CallExpression") &&
    isReactApiCall(returnedExpression, "createElement", scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    const componentArgument = returnedExpression.arguments[0];
    if (componentArgument && !isNodeOfType(componentArgument, "SpreadElement")) {
      return analyzeReturnedExpressionSelections(componentArgument, inputReferences, scopes);
    }
  }
  return {
    hasInputDependentSelection: false,
    hasProvenInputDependentRootSelection: false,
    hasUnrelatedSelection: false,
  };
};

const analyzeFunctionInputSelections = (
  functionNode: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): InputSelectionAnalysis => {
  if (!isFunctionLike(functionNode)) {
    return {
      hasInputDependentSelection: false,
      hasProvenInputDependentRootSelection: false,
      hasUnrelatedSelection: false,
    };
  }
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return analyzeReturnedExpressionSelections(functionNode.body, inputReferences, scopes);
  }
  let hasInputDependentSelection = false;
  let hasProvenInputDependentRootSelection = false;
  let hasUnrelatedSelection = false;
  const analyzedAncestors = new Set<EsTreeNode>();
  for (const returnStatement of getReachableFunctionReturnStatements(functionNode, scopes)) {
    const returnedRootNames = returnStatement.argument
      ? getKnownReturnedRootNames(returnStatement.argument, scopes)
      : new Set<string>();
    if (returnStatement.argument) {
      const returnAnalysis = analyzeReturnedExpressionSelections(
        returnStatement.argument,
        inputReferences,
        scopes,
      );
      hasInputDependentSelection ||= returnAnalysis.hasInputDependentSelection;
      hasProvenInputDependentRootSelection ||= returnAnalysis.hasProvenInputDependentRootSelection;
      hasUnrelatedSelection ||= returnAnalysis.hasUnrelatedSelection;
    }
    if (
      returnedRootNames &&
      [...returnedRootNames].every((rootName) => rootName === EMPTY_RENDERED_ROOT_NAME)
    ) {
      continue;
    }
    let ancestor = returnStatement.parent;
    while (ancestor && ancestor !== functionNode) {
      if (analyzedAncestors.has(ancestor)) break;
      analyzedAncestors.add(ancestor);
      let selector: EsTreeNode | null = null;
      if (isNodeOfType(ancestor, "IfStatement")) selector = ancestor.test;
      else if (isNodeOfType(ancestor, "SwitchStatement")) selector = ancestor.discriminant;
      else if (
        isNodeOfType(ancestor, "TryStatement") ||
        isNodeOfType(ancestor, "ForStatement") ||
        isNodeOfType(ancestor, "ForInStatement") ||
        isNodeOfType(ancestor, "ForOfStatement") ||
        isNodeOfType(ancestor, "WhileStatement") ||
        isNodeOfType(ancestor, "DoWhileStatement")
      ) {
        hasUnrelatedSelection = true;
      }
      if (selector) {
        if (expressionReadsOnlyInput(selector, inputReferences, scopes)) {
          hasInputDependentSelection = true;
          if (
            (isNodeOfType(ancestor, "IfStatement") &&
              hasDistinctKnownIfRootOutcomes(ancestor, scopes)) ||
            (isNodeOfType(ancestor, "SwitchStatement") &&
              hasDistinctKnownSwitchRootOutcomes(ancestor, scopes))
          ) {
            hasProvenInputDependentRootSelection = true;
          }
        } else {
          hasUnrelatedSelection = true;
        }
      }
      ancestor = ancestor.parent;
    }
  }
  return {
    hasInputDependentSelection,
    hasProvenInputDependentRootSelection,
    hasUnrelatedSelection,
  };
};

const expressionHasOnlyInputDependentSelections = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): boolean => {
  const selectionAnalysis = analyzeReturnedExpressionSelections(
    expression,
    inputReferences,
    scopes,
  );
  return selectionAnalysis.hasInputDependentSelection && !selectionAnalysis.hasUnrelatedSelection;
};

const functionHasOnlyInputDependentSelections = (
  functionNode: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): boolean => {
  const selectionAnalysis = analyzeFunctionInputSelections(functionNode, inputReferences, scopes);
  return selectionAnalysis.hasInputDependentSelection && !selectionAnalysis.hasUnrelatedSelection;
};

const getComponentExpressionIdentity = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const componentExpression = stripParenExpression(expression);
  if (isNodeOfType(componentExpression, "Literal")) {
    return typeof componentExpression.value === "string"
      ? `intrinsic:${componentExpression.value}`
      : null;
  }
  if (isNodeOfType(componentExpression, "Identifier")) {
    return getComponentReferenceIdentity(componentExpression, scopes);
  }
  if (!isNodeOfType(componentExpression, "MemberExpression")) return null;
  return getComponentReferenceIdentity(componentExpression, scopes);
};

const collectStaticComponentIdentities = (
  expression: EsTreeNode,
  identities: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const componentExpression = getFinalSequenceExpressionValue(expression);
  if (isNodeOfType(componentExpression, "ConditionalExpression")) {
    return (
      collectStaticComponentIdentities(componentExpression.consequent, identities, scopes) &&
      collectStaticComponentIdentities(componentExpression.alternate, identities, scopes)
    );
  }
  if (isNodeOfType(componentExpression, "LogicalExpression")) {
    const resultBranches = getStaticLogicalExpressionResultBranches(componentExpression);
    return resultBranches.every((resultBranch) =>
      collectStaticComponentIdentities(resultBranch, identities, scopes),
    );
  }
  const identity = getComponentExpressionIdentity(componentExpression, scopes);
  if (identity === null) return false;
  identities.add(identity);
  return true;
};

const isReactFragmentReference = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const fragmentExpression = stripParenExpression(expression);
  const componentIdentity = getComponentReferenceIdentity(fragmentExpression, scopes);
  if (
    componentIdentity === "import:react:Fragment" ||
    componentIdentity === "import:react:default.Fragment"
  ) {
    return true;
  }
  if (isNodeOfType(fragmentExpression, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(fragmentExpression, scopes);
    return Boolean(
      symbol &&
      isImportedFromReact(symbol) &&
      getImportedName(symbol.declarationNode) === "Fragment",
    );
  }
  if (
    !isNodeOfType(fragmentExpression, "MemberExpression") ||
    getStaticPropertyName(fragmentExpression) !== "Fragment"
  ) {
    return false;
  }
  const receiver = stripParenExpression(fragmentExpression.object);
  return Boolean(
    isNodeOfType(receiver, "Identifier") &&
    (isReactNamespaceImport(receiver, scopes) ||
      (receiver.name === "React" && scopes.isGlobalReference(receiver))),
  );
};

const getForwardedInput = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): ForwardedInput | null => {
  const forwardedExpression = stripParenExpression(expression);
  if (isNodeOfType(forwardedExpression, "Identifier")) {
    const reference = scopes.referenceFor(forwardedExpression);
    if (!reference?.resolvedSymbol) return null;
    const directInput = inputReferences.find(
      (inputReference) =>
        inputReference.isStable &&
        inputReference.propertyName === null &&
        inputReference.symbolId === reference.resolvedSymbol?.id,
    );
    if (directInput) {
      return { inputNames: new Set([directInput.inputName]), isWholeContainer: false };
    }
    const containedInputNames = new Set<string>();
    for (const inputReference of inputReferences) {
      if (
        inputReference.isStable &&
        inputReference.propertyName !== null &&
        inputReference.symbolId === reference.resolvedSymbol.id
      ) {
        containedInputNames.add(inputReference.inputName);
      }
    }
    return containedInputNames.size > 0
      ? { inputNames: containedInputNames, isWholeContainer: true }
      : null;
  }
  if (!isNodeOfType(forwardedExpression, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(forwardedExpression);
  const receiver = stripParenExpression(forwardedExpression.object);
  if (propertyName === null || !isNodeOfType(receiver, "Identifier")) return null;
  const receiverReference = scopes.referenceFor(receiver);
  const matchedInput = inputReferences.find(
    (inputReference) =>
      inputReference.isStable &&
      inputReference.propertyName === propertyName &&
      inputReference.symbolId === receiverReference?.resolvedSymbol?.id,
  );
  return matchedInput
    ? { inputNames: new Set([matchedInput.inputName]), isWholeContainer: false }
    : null;
};

const getParameterInputReferences = (
  parameter: EsTreeNode,
  forwardedInput: ForwardedInput,
  scopes: ScopeAnalysis,
): ReadonlyArray<RendererInputReference> => {
  const unwrappedParameter = stripParenExpression(parameter);
  if (isNodeOfType(unwrappedParameter, "Identifier")) {
    if (forwardedInput.isWholeContainer) return [];
    const symbol = scopes.symbolFor(unwrappedParameter);
    const inputName = [...forwardedInput.inputNames][0];
    return symbol && inputName
      ? [
          {
            inputName,
            isStable: isSymbolStable(symbol),
            propertyName: null,
            symbolId: symbol.id,
          },
        ]
      : [];
  }
  if (!isNodeOfType(unwrappedParameter, "ObjectPattern")) return [];
  const references: RendererInputReference[] = [];
  for (const property of unwrappedParameter.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (
      propertyName === null ||
      (forwardedInput.isWholeContainer && !forwardedInput.inputNames.has(propertyName))
    ) {
      continue;
    }
    const bindingIdentifier = getPatternBindingIdentifier(property.value);
    const symbol = bindingIdentifier ? scopes.symbolFor(bindingIdentifier) : null;
    if (symbol)
      references.push({
        inputName: propertyName,
        isStable: isSymbolStable(symbol),
        propertyName: null,
        symbolId: symbol.id,
      });
  }
  return references;
};

const getComponentPropInputReferences = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  componentFunction: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
): ReadonlyArray<RendererInputReference> => {
  if (!isFunctionLike(componentFunction)) return [];
  const parameter = componentFunction.params[0];
  if (!parameter) return [];
  const references: RendererInputReference[] = [];
  for (const attribute of openingElement.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      !isNodeOfType(attribute.value, "JSXExpressionContainer")
    ) {
      continue;
    }
    const attributeName = attribute.name.name;
    if (getAuthoritativeJsxAttribute(openingElement.attributes, attributeName) !== attribute) {
      continue;
    }
    const forwardedInput = getForwardedInput(attribute.value.expression, inputReferences, scopes);
    if (!forwardedInput || forwardedInput.isWholeContainer) continue;
    const unwrappedParameter = stripParenExpression(parameter);
    if (isNodeOfType(unwrappedParameter, "Identifier")) {
      const symbol = scopes.symbolFor(unwrappedParameter);
      if (symbol) {
        references.push({
          inputName: attributeName,
          isStable: isSymbolStable(symbol),
          propertyName: attributeName,
          symbolId: symbol.id,
        });
      }
      continue;
    }
    const bindingIdentifier = getObjectPatternPropertyBinding(unwrappedParameter, attributeName);
    const symbol = bindingIdentifier ? scopes.symbolFor(bindingIdentifier) : null;
    if (symbol) {
      references.push({
        inputName: attributeName,
        isStable: isSymbolStable(symbol),
        propertyName: null,
        symbolId: symbol.id,
      });
    }
  }
  return references;
};

const resolveLocalComponentFunction = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return null;
  const symbol = resolveConstIdentifierAlias(openingElement.name, scopes);
  if (
    !symbol ||
    symbol.kind === "import" ||
    !symbol.initializer ||
    !isSymbolStable(symbol) ||
    hasSymbolWriteBefore(symbol, openingElement.name, scopes)
  ) {
    return null;
  }
  return unwrapProvenReactHocFunction(symbol.initializer, scopes);
};

const collectFunctionRenderedRootNames = (
  functionNode: EsTreeNode,
  names: Set<string>,
  scopes: ScopeAnalysis,
  analysis: RenderedRootAnalysis,
): void => {
  if (!isFunctionLike(functionNode) || analysis.visitedFunctionNodes.has(functionNode)) return;
  analysis.visitedFunctionNodes.add(functionNode);
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    collectReturnedJsxRootNames(functionNode.body, names, scopes, analysis);
    return;
  }
  for (const returnStatement of getReachableFunctionReturnStatements(functionNode, scopes)) {
    if (returnStatement.argument) {
      collectReturnedJsxRootNames(returnStatement.argument, names, scopes, analysis);
    }
  }
};

const collectLocalComponentRenderedRootNames = (
  element: EsTreeNodeOfType<"JSXElement">,
  names: Set<string>,
  scopes: ScopeAnalysis,
  analysis: RenderedRootAnalysis,
): boolean => {
  if (!analysis.canFollowLocalRenderer) return false;
  const componentFunction = resolveLocalComponentFunction(element.openingElement, scopes);
  if (!componentFunction) return false;
  if (analysis.visitedFunctionNodes.has(componentFunction)) return true;
  const componentInputReferences = getComponentPropInputReferences(
    element.openingElement,
    componentFunction,
    analysis.inputReferences,
    scopes,
  );
  if (
    componentInputReferences.length === 0 ||
    !functionHasOnlyInputDependentSelections(componentFunction, componentInputReferences, scopes)
  ) {
    return false;
  }
  const componentRootNames = new Set<string>();
  collectFunctionRenderedRootNames(componentFunction, componentRootNames, scopes, {
    canFollowLocalRenderer: false,
    inputReferences: componentInputReferences,
    visitedFunctionNodes: analysis.visitedFunctionNodes,
    visitedSymbolIds: analysis.visitedSymbolIds,
  });
  if (componentRootNames.size === 0) return false;
  for (const componentRootName of componentRootNames) names.add(componentRootName);
  return true;
};

const collectItemSelectedComponentRootNames = (
  element: EsTreeNodeOfType<"JSXElement">,
  names: Set<string>,
  scopes: ScopeAnalysis,
  analysis: RenderedRootAnalysis,
): boolean => {
  const componentName = element.openingElement.name;
  if (!isNodeOfType(componentName, "JSXIdentifier")) return false;
  const symbol = resolveConstIdentifierAlias(componentName, scopes);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    analysis.visitedSymbolIds.has(symbol.id) ||
    hasSymbolWriteBefore(symbol, componentName, scopes) ||
    !expressionHasOnlyInputDependentSelections(symbol.initializer, analysis.inputReferences, scopes)
  ) {
    return false;
  }
  analysis.visitedSymbolIds.add(symbol.id);
  const componentIdentities = new Set<string>();
  const didResolveEveryComponent = collectStaticComponentIdentities(
    symbol.initializer,
    componentIdentities,
    scopes,
  );
  analysis.visitedSymbolIds.delete(symbol.id);
  if (!didResolveEveryComponent || componentIdentities.size === 0) return false;
  for (const componentIdentity of componentIdentities) names.add(componentIdentity);
  return true;
};

const collectReactCreateElementRootNames = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  names: Set<string>,
  scopes: ScopeAnalysis,
  analysis: RenderedRootAnalysis,
): boolean => {
  if (
    !isReactApiCall(callExpression, "createElement", scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    return false;
  }
  const componentArgument = callExpression.arguments[0];
  if (
    !componentArgument ||
    isNodeOfType(componentArgument, "SpreadElement") ||
    isReactFragmentReference(componentArgument, scopes)
  ) {
    return false;
  }
  const componentIdentities = new Set<string>();
  if (!collectStaticComponentIdentities(componentArgument, componentIdentities, scopes)) {
    return false;
  }
  if (
    componentIdentities.size > 1 &&
    !expressionHasOnlyInputDependentSelections(componentArgument, analysis.inputReferences, scopes)
  ) {
    return false;
  }
  for (const componentIdentity of componentIdentities) names.add(componentIdentity);
  return componentIdentities.size > 0;
};

const collectLocalHelperRenderedRootNames = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  names: Set<string>,
  scopes: ScopeAnalysis,
  analysis: RenderedRootAnalysis,
): boolean => {
  if (!analysis.canFollowLocalRenderer) return false;
  const helperCallee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(helperCallee, "Identifier")) return false;
  const helperFunction = resolveStaticLocalCallFunction(callExpression, scopes);
  if (
    !helperFunction ||
    !isFunctionLike(helperFunction) ||
    helperFunction.async ||
    helperFunction.generator ||
    analysis.visitedFunctionNodes.has(helperFunction)
  ) {
    return false;
  }
  const helperSymbol = scopes.symbolFor(helperCallee);
  const functionSymbol =
    isNodeOfType(helperFunction, "FunctionDeclaration") && helperFunction.id
      ? scopes.symbolFor(helperFunction.id)
      : null;
  if (
    (helperSymbol && !isSymbolStable(helperSymbol)) ||
    (functionSymbol && !isSymbolStable(functionSymbol))
  ) {
    return false;
  }
  const helperInputReferences: RendererInputReference[] = [];
  for (let argumentIndex = 0; argumentIndex < callExpression.arguments.length; argumentIndex += 1) {
    const argument = callExpression.arguments[argumentIndex];
    const parameter = helperFunction.params[argumentIndex];
    if (!argument || isNodeOfType(argument, "SpreadElement") || !parameter) continue;
    const forwardedInput = getForwardedInput(argument, analysis.inputReferences, scopes);
    if (!forwardedInput) continue;
    helperInputReferences.push(...getParameterInputReferences(parameter, forwardedInput, scopes));
  }
  if (
    helperInputReferences.length === 0 ||
    !functionHasOnlyInputDependentSelections(helperFunction, helperInputReferences, scopes)
  ) {
    return false;
  }
  const helperRootNames = new Set<string>();
  collectFunctionRenderedRootNames(helperFunction, helperRootNames, scopes, {
    canFollowLocalRenderer: false,
    inputReferences: helperInputReferences,
    visitedFunctionNodes: analysis.visitedFunctionNodes,
    visitedSymbolIds: analysis.visitedSymbolIds,
  });
  if (helperRootNames.size === 0) return false;
  for (const helperRootName of helperRootNames) names.add(helperRootName);
  return true;
};

const collectReturnedJsxRootNames = (
  expression: EsTreeNode,
  names: Set<string>,
  scopes: ScopeAnalysis,
  analysis: RenderedRootAnalysis,
): void => {
  const unwrappedExpression = getFinalSequenceExpressionValue(expression);
  if (isNodeOfType(unwrappedExpression, "JSXElement")) {
    if (
      collectItemSelectedComponentRootNames(unwrappedExpression, names, scopes, analysis) ||
      collectLocalComponentRenderedRootNames(unwrappedExpression, names, scopes, analysis)
    ) {
      return;
    }
    const rootNames = getRenderedRootNames(unwrappedExpression, scopes);
    if (rootNames) {
      for (const rootName of rootNames) names.add(rootName);
    }
    return;
  }
  if (isNodeOfType(unwrappedExpression, "JSXFragment")) {
    const rootNames = getRenderedRootNames(unwrappedExpression, scopes);
    if (rootNames) {
      for (const rootName of rootNames) names.add(rootName);
    }
    return;
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    if (
      collectReactCreateElementRootNames(unwrappedExpression, names, scopes, analysis) ||
      collectLocalHelperRenderedRootNames(unwrappedExpression, names, scopes, analysis)
    ) {
      return;
    }
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(unwrappedExpression, scopes);
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      !analysis.visitedSymbolIds.has(symbol.id) &&
      !hasSymbolWriteBefore(symbol, unwrappedExpression, scopes) &&
      expressionHasOnlyInputDependentSelections(
        symbol.initializer,
        analysis.inputReferences,
        scopes,
      )
    ) {
      analysis.visitedSymbolIds.add(symbol.id);
      collectReturnedJsxRootNames(symbol.initializer, names, scopes, analysis);
      analysis.visitedSymbolIds.delete(symbol.id);
      return;
    }
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    const staticTestValue = readStaticSelectorTruthiness(unwrappedExpression.test, scopes);
    if (staticTestValue !== null) {
      collectReturnedJsxRootNames(
        staticTestValue ? unwrappedExpression.consequent : unwrappedExpression.alternate,
        names,
        scopes,
        analysis,
      );
      return;
    }
    collectReturnedJsxRootNames(unwrappedExpression.consequent, names, scopes, analysis);
    collectReturnedJsxRootNames(unwrappedExpression.alternate, names, scopes, analysis);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    for (const resultBranch of getStaticLogicalExpressionResultBranches(unwrappedExpression)) {
      collectReturnedJsxRootNames(resultBranch, names, scopes, analysis);
    }
    return;
  }
};

const resolveFunctionFromInitializer = (
  initializer: EsTreeNode,
  resultSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const expression = stripParenExpression(initializer);
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration")
  ) {
    return expression;
  }
  const callbackArgument = getTransparentReactCallbackWrapperArgument(
    expression,
    resultSymbol,
    scopes,
  );
  if (
    callbackArgument &&
    (isNodeOfType(callbackArgument, "ArrowFunctionExpression") ||
      isNodeOfType(callbackArgument, "FunctionExpression"))
  ) {
    return callbackArgument;
  }
  return null;
};

const resolveRenderItemFunction = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  const directFunction = resolveFunctionFromInitializer(expression, null, scopes);
  if (directFunction) return directFunction;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const localFunction = resolveExactLocalFunction(expression, scopes);
  if (localFunction) return localFunction;
  const symbol = scopes.symbolFor(expression);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  return resolveFunctionFromInitializer(symbol.initializer, symbol, scopes);
};

const renderItemHasHeterogeneousRootTypes = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
  resultCache: WeakMap<EsTreeNode, boolean>,
): boolean => {
  const renderItemFunction = resolveRenderItemFunction(attribute, scopes);
  if (
    !renderItemFunction ||
    (!isNodeOfType(renderItemFunction, "ArrowFunctionExpression") &&
      !isNodeOfType(renderItemFunction, "FunctionExpression") &&
      !isNodeOfType(renderItemFunction, "FunctionDeclaration"))
  ) {
    return false;
  }
  const cachedResult = resultCache.get(renderItemFunction);
  if (cachedResult !== undefined) return cachedResult;
  const returnedRootNames = new Set<string>();
  const inputReferences = getRenderItemInputReferences(renderItemFunction, scopes);
  const selectionAnalysis = analyzeFunctionInputSelections(
    renderItemFunction,
    inputReferences,
    scopes,
  );
  const returnStatements = isNodeOfType(renderItemFunction.body, "BlockStatement")
    ? getReachableFunctionReturnStatements(renderItemFunction, scopes)
    : [];
  if (
    (selectionAnalysis.hasUnrelatedSelection &&
      !selectionAnalysis.hasProvenInputDependentRootSelection) ||
    (returnStatements.length > 1 && !selectionAnalysis.hasInputDependentSelection)
  ) {
    resultCache.set(renderItemFunction, false);
    return false;
  }
  collectFunctionRenderedRootNames(renderItemFunction, returnedRootNames, scopes, {
    canFollowLocalRenderer: true,
    inputReferences,
    visitedFunctionNodes: new Set(),
    visitedSymbolIds: new Set(),
  });
  const hasHeterogeneousRootTypes = returnedRootNames.size > 1;
  resultCache.set(renderItemFunction, hasHeterogeneousRootTypes);
  return hasHeterogeneousRootTypes;
};

export const rnListRecyclableWithoutTypes = defineRule({
  id: "rn-list-recyclable-without-types",
  title: "Recyclable list missing getItemType",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "When rows have different shapes, reused cells can show the wrong layout. Add `getItemType` that returns a stable type for each row shape so FlashList keeps separate recycling pools.",
  create: (context: RuleContext) => {
    let fileImportsRecycler = false;
    const renderItemResultCache = new WeakMap<EsTreeNode, boolean>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileImportsRecycler = hasImportFromModules(node, RECYCLABLE_LIST_PACKAGE_SOURCES);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!fileImportsRecycler) return;
        const elementName = resolveJsxElementName(node);
        if (!elementName) return;
        // Resolve the LOCAL JSX name back to a recycler that was really imported
        // from `@shopify/flash-list` / `@legendapp/list` — named, aliased, or
        // namespace member access. A name-only match on a homegrown `FlashList`
        // (`const FlashList = MyOwnList`) isn't a recycler.
        const canonicalRecyclerName = resolveImportedRecyclerName(node, context.scopes, {
          allowNamespaceMemberAccess: true,
        });
        if (canonicalRecyclerName === null) return;

        let hasRecycleItemsEnabled =
          SHOPIFY_FLASH_LIST_COMPONENTS.has(canonicalRecyclerName) && isFlashListV2OrNewer(context);
        const recycleItemsAttribute = getAuthoritativeJsxAttribute(node.attributes, "recycleItems");
        if (recycleItemsAttribute) {
          if (!recycleItemsAttribute.value) {
            hasRecycleItemsEnabled = true;
          } else if (
            isNodeOfType(recycleItemsAttribute.value, "JSXExpressionContainer") &&
            isNodeOfType(recycleItemsAttribute.value.expression, "Literal")
          ) {
            hasRecycleItemsEnabled = recycleItemsAttribute.value.expression.value === true;
          } else {
            hasRecycleItemsEnabled = true;
          }
        } else if (
          node.attributes.some(
            (attribute) =>
              isNodeOfType(attribute, "JSXSpreadAttribute") &&
              canExpressionOverrideJsxAttribute(
                attribute.argument,
                "recycleItems",
                true,
                context.scopes,
              ),
          )
        ) {
          hasRecycleItemsEnabled = false;
        }
        const hasPossibleSpreadGetItemType = node.attributes.some(
          (attribute) =>
            isNodeOfType(attribute, "JSXSpreadAttribute") &&
            canExpressionOverrideJsxAttribute(
              attribute.argument,
              "getItemType",
              true,
              context.scopes,
            ),
        );
        const hasGetItemType =
          getAuthoritativeJsxAttribute(node.attributes, "getItemType") !== null ||
          hasPossibleSpreadGetItemType;
        const renderItemAttribute = getAuthoritativeJsxAttribute(node.attributes, "renderItem");

        if (
          hasRecycleItemsEnabled &&
          !hasGetItemType &&
          renderItemAttribute &&
          renderItemHasHeterogeneousRootTypes(
            renderItemAttribute,
            context.scopes,
            renderItemResultCache,
          )
        ) {
          context.report({
            node,
            message: `Your users see rows of different shapes reuse the wrong cells when <${elementName}> recycles them without \`getItemType\`.`,
          });
        }
      },
    };
  },
});
