import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import {
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
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { isFlashListV2OrNewer } from "./utils/is-flash-list-v2-or-newer.js";
import { resolveImportedRecyclerName } from "./utils/resolve-imported-recycler-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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

const RENDER_ITEM_INPUT_NAMES = new Set(["item", "index"]);

const isSymbolStable = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

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

const mergeRenderedRootShapes = (
  existingShapes: ReadonlyArray<ReadonlyArray<string>>,
  appendedShapes: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<ReadonlyArray<string>> => {
  const mergedShapes: string[][] = [];
  const shapeKeys = new Set<string>();
  for (const existingShape of existingShapes) {
    for (const appendedShape of appendedShapes) {
      const mergedShape = [...existingShape, ...appendedShape];
      const shapeKey = JSON.stringify(mergedShape);
      if (shapeKeys.has(shapeKey)) continue;
      shapeKeys.add(shapeKey);
      mergedShapes.push(mergedShape);
      if (mergedShapes.length > 1) return mergedShapes;
    }
  }
  return mergedShapes;
};

const combineRenderedRootShapeAlternatives = (
  alternatives: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>,
): ReadonlyArray<ReadonlyArray<string>> => {
  const combinedShapes: string[][] = [];
  const shapeKeys = new Set<string>();
  for (const alternativeShapes of alternatives) {
    for (const alternativeShape of alternativeShapes) {
      const shapeKey = JSON.stringify(alternativeShape);
      if (shapeKeys.has(shapeKey)) continue;
      shapeKeys.add(shapeKey);
      combinedShapes.push([...alternativeShape]);
      if (combinedShapes.length > 1) return combinedShapes;
    }
  }
  return combinedShapes;
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

const getStaticRenderedRootShapes = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<ReadonlyArray<string>> | null => {
  const renderedNode = getFinalSequenceExpressionValue(node);
  if (
    isNodeOfType(renderedNode, "JSXElement") &&
    !isJsxFragmentElement(renderedNode.openingElement, scopes)
  ) {
    const elementIdentity = getJsxElementIdentity(renderedNode.openingElement.name, scopes);
    return elementIdentity === null ? null : [[elementIdentity]];
  }
  if (isNodeOfType(renderedNode, "JSXElement") || isNodeOfType(renderedNode, "JSXFragment")) {
    let rootShapes: ReadonlyArray<ReadonlyArray<string>> = [[]];
    for (const child of renderedNode.children) {
      const childRootShapes = getStaticRenderedRootShapes(child, scopes);
      if (childRootShapes === null) return null;
      rootShapes = mergeRenderedRootShapes(rootShapes, childRootShapes);
    }
    return rootShapes;
  }
  if (isNodeOfType(renderedNode, "JSXText")) return renderedNode.value?.trim() ? null : [[]];
  if (isNodeOfType(renderedNode, "JSXExpressionContainer")) {
    return getStaticRenderedRootShapes(renderedNode.expression, scopes);
  }
  if (isStaticallyEmptyJsxChild(renderedNode)) return [[]];
  if (isNodeOfType(renderedNode, "ConditionalExpression")) {
    const staticTestValue = readStaticSelectorTruthiness(renderedNode.test);
    if (staticTestValue !== null) {
      return getStaticRenderedRootShapes(
        staticTestValue ? renderedNode.consequent : renderedNode.alternate,
        scopes,
      );
    }
    const consequentShapes = getStaticRenderedRootShapes(renderedNode.consequent, scopes);
    const alternateShapes = getStaticRenderedRootShapes(renderedNode.alternate, scopes);
    if (consequentShapes === null || alternateShapes === null) return null;
    return combineRenderedRootShapeAlternatives([consequentShapes, alternateShapes]);
  }
  if (isNodeOfType(renderedNode, "LogicalExpression")) {
    const resultShapeAlternatives: Array<ReadonlyArray<ReadonlyArray<string>>> = [];
    for (const resultBranch of getStaticLogicalExpressionResultBranches(renderedNode)) {
      const resultShapes = getStaticRenderedRootShapes(resultBranch, scopes);
      if (resultShapes === null) return null;
      resultShapeAlternatives.push(resultShapes);
    }
    return combineRenderedRootShapeAlternatives(resultShapeAlternatives);
  }
  return null;
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
): ReadonlyArray<EsTreeNodeOfType<"ReturnStatement">> =>
  collectFunctionReturnStatements(functionNode).filter((returnStatement) => {
    let descendant: EsTreeNode = returnStatement;
    let ancestor = returnStatement.parent;
    while (ancestor && ancestor !== functionNode) {
      if (isNodeOfType(ancestor, "BlockStatement")) {
        const descendantIndex = ancestor.body.findIndex((statement) => statement === descendant);
        if (
          descendantIndex > 0 &&
          ancestor.body.slice(0, descendantIndex).some(isUnconditionallyTerminalStatement)
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

const expressionReadsInput = (
  expression: EsTreeNode,
  inputReferences: ReadonlyArray<RendererInputReference>,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const inputExpression = getFinalSequenceExpressionValue(expression);
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
        if (expressionReadsInput(symbol.initializer, inputReferences, scopes, visitedSymbolIds)) {
          didReadInput = true;
          return false;
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
  if (
    isNodeOfType(returnedExpression, "Literal") &&
    (returnedExpression.value === null || typeof returnedExpression.value === "boolean")
  ) {
    return new Set();
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

const readStaticSelectorTruthiness = (expression: EsTreeNode): boolean | null => {
  const selector = getFinalSequenceExpressionValue(expression);
  const staticBoolean = readStaticBoolean(selector);
  if (staticBoolean !== null) return staticBoolean;
  if (isNodeOfType(selector, "UnaryExpression") && selector.operator === "!") {
    const argumentTruthiness = readStaticSelectorTruthiness(selector.argument);
    return argumentTruthiness === null ? null : !argumentTruthiness;
  }
  if (!isNodeOfType(selector, "LogicalExpression")) return null;
  const leftTruthiness = readStaticSelectorTruthiness(selector.left);
  const rightTruthiness = readStaticSelectorTruthiness(selector.right);
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
    let hasProvenInputDependentRootSelection = false;
    let hasUnrelatedSelection = false;
    for (const child of returnedExpression.children) {
      const childAnalysis = analyzeReturnedExpressionSelections(child, inputReferences, scopes);
      hasInputDependentSelection ||= childAnalysis.hasInputDependentSelection;
      hasProvenInputDependentRootSelection ||= childAnalysis.hasProvenInputDependentRootSelection;
      hasUnrelatedSelection ||= childAnalysis.hasUnrelatedSelection;
    }
    return {
      hasInputDependentSelection,
      hasProvenInputDependentRootSelection,
      hasUnrelatedSelection,
    };
  }
  if (isNodeOfType(returnedExpression, "ConditionalExpression")) {
    const staticTestValue = readStaticSelectorTruthiness(returnedExpression.test);
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
    const selectorReadsInput = expressionReadsInput(
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
    const selectorReadsInput = expressionReadsInput(
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
  for (const returnStatement of getReachableFunctionReturnStatements(functionNode)) {
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
    if (returnedRootNames?.size === 0) continue;
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
        if (expressionReadsInput(selector, inputReferences, scopes)) {
          hasInputDependentSelection = true;
          hasProvenInputDependentRootSelection ||=
            returnedRootNames !== null && returnedRootNames.size > 0;
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
  for (const returnStatement of getReachableFunctionReturnStatements(functionNode)) {
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
    const staticTestValue = readStaticSelectorTruthiness(unwrappedExpression.test);
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
    ? getReachableFunctionReturnStatements(renderItemFunction)
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
