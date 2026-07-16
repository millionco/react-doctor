import { KATEX_CROSS_FILE_PROOF_MAX_DEPTH } from "../../../constants/thresholds.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { statementAlwaysExits } from "../../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  getModuleNamespaceSymbol,
  getNamedImportSymbol,
  isKatexNamedRenderer,
  isKatexNamespace,
  isUnprovenKatexShapedRenderer,
} from "./get-katex-renderer-provenance.js";
import { getKatexOptionsProof, setKatexParameterOptionsProofs } from "./get-katex-options-proof.js";
import type { KatexOptionsProof } from "./get-katex-options-proof.js";

export interface KatexHtmlProof {
  readonly containsKatex: boolean;
  readonly isConclusive: boolean;
  readonly isSafe: boolean;
  readonly isSafeInAttributeContext: boolean;
}

interface OrderedObjectPropertyValue {
  readonly isKnown: boolean;
  readonly value: EsTreeNode | null;
}

const SAFE_STATIC_HTML_PROOF: KatexHtmlProof = {
  containsKatex: false,
  isConclusive: true,
  isSafe: true,
  isSafeInAttributeContext: true,
};
const SAFE_HTML_FRAGMENT_PROOF: KatexHtmlProof = {
  containsKatex: false,
  isConclusive: true,
  isSafe: true,
  isSafeInAttributeContext: false,
};
const UNKNOWN_HTML_PROOF: KatexHtmlProof = {
  containsKatex: false,
  isConclusive: false,
  isSafe: false,
  isSafeInAttributeContext: false,
};
const UNSUPPORTED_KATEX_PROOF: KatexHtmlProof = {
  containsKatex: true,
  isConclusive: false,
  isSafe: false,
  isSafeInAttributeContext: false,
};
const UNSAFE_KATEX_PROOF: KatexHtmlProof = {
  containsKatex: true,
  isConclusive: true,
  isSafe: false,
  isSafeInAttributeContext: false,
};

const sourceFilenameByScopes = new WeakMap<ScopeAnalysis, string>();
const crossFileDepthByScopes = new WeakMap<ScopeAnalysis, number>();

export const registerKatexProofSource = (
  scopes: ScopeAnalysis,
  filename: string,
  depth: number,
): void => {
  sourceFilenameByScopes.set(scopes, filename);
  crossFileDepthByScopes.set(scopes, depth);
};

const combineHtmlProofs = (proofs: KatexHtmlProof[]): KatexHtmlProof => ({
  containsKatex: proofs.some((proof) => proof.containsKatex),
  isConclusive: proofs.every((proof) => proof.isSafe)
    ? proofs.filter((proof) => proof.containsKatex).every((proof) => proof.isConclusive)
    : proofs.some((proof) => proof.containsKatex && proof.isConclusive && !proof.isSafe) ||
      (proofs.some((proof) => proof.containsKatex && proof.isConclusive) &&
        proofs.some((proof) => !proof.containsKatex && !proof.isSafe)),
  isSafe: proofs.every((proof) => proof.isSafe),
  isSafeInAttributeContext: proofs.every((proof) => proof.isSafeInAttributeContext),
});

const getOrderedObjectPropertyValue = (
  node: EsTreeNode,
  propertyName: string,
): OrderedObjectPropertyValue => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) {
    return { isKnown: false, value: null };
  }
  let isKnown = true;
  let propertyValue: EsTreeNode | null = null;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) {
      isKnown = false;
      propertyValue = null;
      continue;
    }
    const currentPropertyName = getStaticPropertyKeyName(property, {
      allowComputedString: true,
    });
    if (currentPropertyName === null) {
      isKnown = false;
      propertyValue = null;
    } else if (currentPropertyName === propertyName) {
      isKnown = true;
      propertyValue = property.value;
    }
  }
  return { isKnown, value: propertyValue };
};

const isReactUseMemo = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(expression, scopes);
    return Boolean(
      symbol &&
      symbol.kind === "import" &&
      getImportDeclarationForSymbol(symbol)?.source.value === "react" &&
      getImportedName(symbol.declarationNode) === "useMemo",
    );
  }
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    getStaticPropertyName(expression) !== "useMemo"
  ) {
    return false;
  }
  const symbol = resolveConstIdentifierAlias(stripParenExpression(expression.object), scopes);
  return Boolean(
    symbol &&
    symbol.kind === "import" &&
    getImportDeclarationForSymbol(symbol)?.source.value === "react" &&
    (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
      getImportedName(symbol.declarationNode) === "default"),
  );
};

const isAllOpeningAngleBracketsEscaped = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let current = stripParenExpression(node);
  let didEscapeEveryOpeningAngleBracket = false;
  while (isNodeOfType(current, "CallExpression")) {
    const callee = stripParenExpression(current.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const methodName = getStaticPropertyName(callee);
    if (methodName !== "replace" && methodName !== "replaceAll") return false;
    const searchValue = current.arguments[0];
    const replacementValue = current.arguments[1];
    if (
      !searchValue ||
      !replacementValue ||
      !isNodeOfType(replacementValue, "Literal") ||
      typeof replacementValue.value !== "string" ||
      replacementValue.value.includes("<") ||
      replacementValue.value.includes("$")
    ) {
      return false;
    }
    if (isNodeOfType(searchValue, "Literal")) {
      const regularExpression = "regex" in searchValue ? searchValue.regex : undefined;
      const replacesLiteralOpeningAngleBracket =
        methodName === "replaceAll" && searchValue.value === "<";
      const replacesGlobalOpeningAngleBracketPattern =
        regularExpression?.pattern === "<" && regularExpression.flags.includes("g");
      if (replacesLiteralOpeningAngleBracket || replacesGlobalOpeningAngleBracketPattern) {
        didEscapeEveryOpeningAngleBracket = true;
      }
    }
    current = stripParenExpression(callee.object);
  }
  if (!didEscapeEveryOpeningAngleBracket || !isNodeOfType(current, "Identifier")) return false;
  return scopes.referenceFor(current)?.resolvedSymbol?.kind === "parameter";
};

const getSanitizerProof = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): KatexHtmlProof | null => {
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "sanitize") {
    if (
      getModuleNamespaceSymbol(callee.object, "dompurify", "sanitize", node, scopes) ||
      getModuleNamespaceSymbol(callee.object, "isomorphic-dompurify", "sanitize", node, scopes)
    ) {
      return SAFE_HTML_FRAGMENT_PROOF;
    }
  }
  if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "escape") {
    if (getModuleNamespaceSymbol(callee.object, "html-escaper", "escape", node, scopes)) {
      return SAFE_STATIC_HTML_PROOF;
    }
  }
  if (getNamedImportSymbol(callee, "html-escaper", "escape", node, scopes)) {
    return SAFE_STATIC_HTML_PROOF;
  }
  if (
    getNamedImportSymbol(callee, "dompurify", "sanitize", node, scopes) ||
    getNamedImportSymbol(callee, "isomorphic-dompurify", "sanitize", node, scopes)
  ) {
    return SAFE_HTML_FRAGMENT_PROOF;
  }
  return null;
};

const getSafePostTransformProof = (
  node: EsTreeNodeOfType<"CallExpression">,
  receiverProof: KatexHtmlProof,
): KatexHtmlProof | null => {
  if (!receiverProof.isSafe) return null;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (
    (methodName === "trim" || methodName === "trimEnd" || methodName === "trimStart") &&
    node.arguments.length === 0
  ) {
    return receiverProof;
  }
  if (methodName !== "replace" && methodName !== "replaceAll") return null;
  const replacement = node.arguments[1];
  if (
    !replacement ||
    !isNodeOfType(replacement, "Literal") ||
    typeof replacement.value !== "string" ||
    replacement.value.includes("<")
  ) {
    return null;
  }
  return {
    containsKatex: receiverProof.containsKatex,
    isConclusive: receiverProof.isConclusive,
    isSafe: true,
    isSafeInAttributeContext:
      receiverProof.isSafeInAttributeContext && !/[&>"']/.test(replacement.value),
  };
};

const getTemplateInterpolationContext = (
  staticPrefix: string,
): "attribute" | "raw-text" | "text" | "unsafe-tag" => {
  const lowerPrefix = staticPrefix.toLowerCase();
  for (const tagName of ["script", "style", "textarea", "title"]) {
    if (lowerPrefix.lastIndexOf(`<${tagName}`) > lowerPrefix.lastIndexOf(`</${tagName}`)) {
      return "raw-text";
    }
  }
  const lastOpeningAngleIndex = staticPrefix.lastIndexOf("<");
  const lastClosingAngleIndex = staticPrefix.lastIndexOf(">");
  if (lastOpeningAngleIndex <= lastClosingAngleIndex) return "text";
  const currentTagText = staticPrefix.slice(lastOpeningAngleIndex + 1);
  let openQuote: string | null = null;
  for (let index = 0; index < currentTagText.length; index += 1) {
    const character = currentTagText[index];
    if ((character === '"' || character === "'") && currentTagText[index - 1] !== "\\") {
      if (openQuote === character) openQuote = null;
      else if (openQuote === null) openQuote = character;
    }
  }
  return openQuote === null ? "unsafe-tag" : "attribute";
};

const getTemplateLiteralProof = (
  node: EsTreeNodeOfType<"TemplateLiteral">,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  parameterProofs: ReadonlyMap<number, KatexHtmlProof>,
): KatexHtmlProof => {
  const expressionProofs = node.expressions.map((expression) =>
    getKatexHtmlProof(expression, scopes, new Set(visitedSymbolIds), parameterProofs),
  );
  let staticPrefix = "";
  let isSafe = true;
  for (let expressionIndex = 0; expressionIndex < expressionProofs.length; expressionIndex += 1) {
    staticPrefix += node.quasis[expressionIndex]?.value.raw ?? "";
    const context = getTemplateInterpolationContext(staticPrefix);
    const proof = expressionProofs[expressionIndex] ?? UNKNOWN_HTML_PROOF;
    if (context === "text") isSafe &&= proof.isSafe;
    else if (context === "attribute") isSafe &&= proof.isSafeInAttributeContext;
    else isSafe = false;
  }
  return {
    containsKatex: expressionProofs.some((proof) => proof.containsKatex),
    isConclusive: isSafe
      ? expressionProofs.filter((proof) => proof.containsKatex).every((proof) => proof.isConclusive)
      : expressionProofs.some(
          (proof) => proof.containsKatex && proof.isConclusive && !proof.isSafe,
        ) ||
        (expressionProofs.some((proof) => proof.containsKatex && proof.isConclusive) &&
          expressionProofs.some((proof) => !proof.containsKatex && !proof.isSafe)),
    isSafe,
    isSafeInAttributeContext: false,
  };
};

const isReturnStatementStaticallyUnreachable = (
  returnStatement: EsTreeNodeOfType<"ReturnStatement">,
  functionBody: EsTreeNodeOfType<"BlockStatement">,
): boolean => {
  let current: EsTreeNode = returnStatement;
  while (current.parent && current !== functionBody) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "BlockStatement")) {
      const statementIndex = parent.body.findIndex((statement) => statement === current);
      if (
        statementIndex > 0 &&
        parent.body.slice(0, statementIndex).some((statement) => statementAlwaysExits(statement))
      ) {
        return true;
      }
    }
    if (isNodeOfType(parent, "SwitchCase")) {
      const statementIndex = parent.consequent.findIndex((statement) => statement === current);
      if (
        statementIndex > 0 &&
        parent.consequent
          .slice(0, statementIndex)
          .some((statement) => statementAlwaysExits(statement))
      ) {
        return true;
      }
    }
    if (isNodeOfType(parent, "IfStatement") && isNodeOfType(parent.test, "Literal")) {
      const ifStatementAlternate: EsTreeNode | null = parent.alternate;
      const ifStatementConsequent: EsTreeNode = parent.consequent;
      const ifStatementTest: EsTreeNodeOfType<"Literal"> = parent.test;
      const isTruthyTest = Boolean(ifStatementTest.value);
      if (!isTruthyTest && ifStatementConsequent === current) return true;
      if (isTruthyTest && ifStatementAlternate === current) return true;
    }
    if (isNodeOfType(parent, "WhileStatement") && parent.body === current) {
      const whileStatementTest: EsTreeNode = parent.test;
      if (isNodeOfType(whileStatementTest, "Literal") && !whileStatementTest.value) return true;
    }
    if (isNodeOfType(parent, "ForStatement") && parent.body === current) {
      const forStatementTest: EsTreeNode | null = parent.test;
      if (
        forStatementTest &&
        isNodeOfType(forStatementTest, "Literal") &&
        !forStatementTest.value
      ) {
        return true;
      }
    }
    current = parent;
  }
  return false;
};

const getFunctionHtmlProof = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  parameterProofs: ReadonlyMap<number, KatexHtmlProof> = new Map(),
): KatexHtmlProof => {
  if (!isFunctionLike(functionNode)) return UNKNOWN_HTML_PROOF;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return getKatexHtmlProof(functionNode.body, scopes, visitedSymbolIds, parameterProofs);
  }

  const functionBody = functionNode.body;
  const returnProofs: KatexHtmlProof[] = [];
  walkAst(functionBody, (child) => {
    if (child !== functionBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (isReturnStatementStaticallyUnreachable(child, functionBody)) return false;
    returnProofs.push(
      child.argument
        ? getKatexHtmlProof(child.argument, scopes, new Set(visitedSymbolIds), parameterProofs)
        : SAFE_STATIC_HTML_PROOF,
    );
    return false;
  });
  return returnProofs.length === 0 ? SAFE_STATIC_HTML_PROOF : combineHtmlProofs(returnProofs);
};

const getLocalFunctionNode = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): { functionNode: EsTreeNode; symbol: SymbolDescriptor } | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, scopes);
  if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
  if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode)) {
    return { functionNode: symbol.declarationNode, symbol };
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isFunctionLike(initializer) ? { functionNode: initializer, symbol } : null;
};

const getCrossFileFunctionProof = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): KatexHtmlProof | null => {
  const expression = stripParenExpression(call.callee);
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, scopes);
  if (!symbol || symbol.kind !== "import") return null;
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  const importedName = getImportedName(symbol.declarationNode);
  const sourceFilename = sourceFilenameByScopes.get(scopes);
  const source = importDeclaration?.source.value;
  const currentDepth = crossFileDepthByScopes.get(scopes) ?? 0;
  if (
    !sourceFilename ||
    typeof source !== "string" ||
    !importedName ||
    currentDepth >= KATEX_CROSS_FILE_PROOF_MAX_DEPTH
  ) {
    return null;
  }
  const resolved = resolveCrossFileFunctionExportWithFilePath(sourceFilename, source, importedName);
  if (!resolved || !isFunctionLike(resolved.functionNode)) return null;
  const resolvedScopes = analyzeScopes(resolved.programNode);
  registerKatexProofSource(resolvedScopes, resolved.filePath, currentDepth + 1);
  const optionsProofs = new Map<number, KatexOptionsProof>();
  for (const [parameterIndex, parameter] of resolved.functionNode.params.entries()) {
    if (!isNodeOfType(parameter, "ObjectPattern")) continue;
    const argument = call.arguments[parameterIndex];
    if (!argument) continue;
    for (const property of parameter.properties) {
      if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier")) {
        continue;
      }
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (propertyName === null) continue;
      const argumentProperty = getOrderedObjectPropertyValue(argument, propertyName);
      const parameterSymbol = resolvedScopes.symbolFor(property.value);
      if (
        !argumentProperty.isKnown ||
        !parameterSymbol ||
        parameterSymbol.references.some((reference) => reference.flag !== "read")
      ) {
        continue;
      }
      if (argumentProperty.value === null) {
        optionsProofs.set(parameterSymbol.id, { isConclusive: true, isSafe: true });
        continue;
      }
      optionsProofs.set(
        parameterSymbol.id,
        getKatexOptionsProof(argumentProperty.value, call, scopes, new Set()),
      );
    }
  }
  setKatexParameterOptionsProofs(resolvedScopes, optionsProofs);
  return getFunctionHtmlProof(resolved.functionNode, resolvedScopes, new Set());
};

const getKatexCallProof = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  parameterProofs: ReadonlyMap<number, KatexHtmlProof>,
): KatexHtmlProof => {
  if (!isNodeOfType(node, "CallExpression")) return UNKNOWN_HTML_PROOF;
  const callee = stripParenExpression(node.callee);
  const isRealKatexRenderer =
    (isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "renderToString" &&
      isKatexNamespace(callee.object, node, scopes)) ||
    isKatexNamedRenderer(callee, node, scopes);
  if (isRealKatexRenderer) {
    const optionsProof = getKatexOptionsProof(node.arguments[1], node, scopes, new Set());
    return {
      containsKatex: true,
      isConclusive: optionsProof.isConclusive,
      isSafe: optionsProof.isSafe,
      isSafeInAttributeContext: false,
    };
  }
  const crossFileFunctionProof = getCrossFileFunctionProof(node, scopes);
  if (crossFileFunctionProof?.containsKatex) return crossFileFunctionProof;
  const localFunction = getLocalFunctionNode(callee, scopes);
  if (localFunction && !visitedSymbolIds.has(localFunction.symbol.id)) {
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(localFunction.symbol.id);
    const argumentProofs = node.arguments.map((argument) => {
      const argumentNode = stripParenExpression(argument);
      return isFunctionLike(argumentNode)
        ? getFunctionHtmlProof(argumentNode, scopes, new Set(visitedSymbolIds), parameterProofs)
        : getKatexHtmlProof(argumentNode, scopes, new Set(visitedSymbolIds), parameterProofs);
    });
    const localParameterProofs = new Map<number, KatexHtmlProof>();
    let hasWrittenKatexParameter = false;
    if (isFunctionLike(localFunction.functionNode)) {
      for (const [parameterIndex, parameter] of localFunction.functionNode.params.entries()) {
        if (!isNodeOfType(parameter, "Identifier")) continue;
        const parameterSymbol = scopes.symbolFor(parameter);
        const argumentProof = argumentProofs[parameterIndex];
        const isParameterReadOnly = parameterSymbol?.references.every(
          (reference) => reference.flag === "read",
        );
        if (parameterSymbol && argumentProof && isParameterReadOnly) {
          localParameterProofs.set(parameterSymbol.id, argumentProof);
        }
        if (argumentProof?.containsKatex && parameterSymbol && !isParameterReadOnly) {
          hasWrittenKatexParameter = true;
        }
      }
    }
    const localFunctionProof = getFunctionHtmlProof(
      localFunction.functionNode,
      scopes,
      nextVisitedSymbolIds,
      localParameterProofs,
    );
    const containsKatexArgument = argumentProofs.some((proof) => proof.containsKatex);
    if (!containsKatexArgument || localFunctionProof.containsKatex) return localFunctionProof;
    return hasWrittenKatexParameter ? UNSUPPORTED_KATEX_PROOF : UNSAFE_KATEX_PROOF;
  }
  if (isUnprovenKatexShapedRenderer(callee, scopes)) {
    return {
      containsKatex: true,
      isConclusive: true,
      isSafe: false,
      isSafeInAttributeContext: false,
    };
  }
  if (isNodeOfType(callee, "MemberExpression")) {
    const receiverProof = getKatexHtmlProof(
      callee.object,
      scopes,
      new Set(visitedSymbolIds),
      parameterProofs,
    );
    if (receiverProof.containsKatex) {
      const safeTransformProof = getSafePostTransformProof(node, receiverProof);
      if (safeTransformProof) return safeTransformProof;
      return receiverProof.isConclusive
        ? {
            containsKatex: true,
            isConclusive: true,
            isSafe: false,
            isSafeInAttributeContext: false,
          }
        : UNSUPPORTED_KATEX_PROOF;
    }
  }
  const sanitizerProof = getSanitizerProof(node, scopes);
  if (sanitizerProof) return sanitizerProof;
  if (isAllOpeningAngleBracketsEscaped(node, scopes)) return SAFE_HTML_FRAGMENT_PROOF;

  if (isReactUseMemo(callee, scopes)) {
    const callback = node.arguments[0];
    if (!callback) return UNKNOWN_HTML_PROOF;
    const callbackNode = stripParenExpression(callback);
    if (isFunctionLike(callbackNode)) {
      return getFunctionHtmlProof(callbackNode, scopes, new Set(visitedSymbolIds), parameterProofs);
    }
    const localCallback = getLocalFunctionNode(callbackNode, scopes);
    if (!localCallback || visitedSymbolIds.has(localCallback.symbol.id)) return UNKNOWN_HTML_PROOF;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(localCallback.symbol.id);
    return getFunctionHtmlProof(
      localCallback.functionNode,
      scopes,
      nextVisitedSymbolIds,
      parameterProofs,
    );
  }

  const containsKatexArgument = node.arguments.some((argument) => {
    const argumentNode = stripParenExpression(argument);
    return (
      isFunctionLike(argumentNode)
        ? getFunctionHtmlProof(argumentNode, scopes, new Set(visitedSymbolIds), parameterProofs)
        : getKatexHtmlProof(argumentNode, scopes, new Set(visitedSymbolIds), parameterProofs)
    ).containsKatex;
  });
  return containsKatexArgument ? UNSUPPORTED_KATEX_PROOF : UNKNOWN_HTML_PROOF;
};

export const getKatexHtmlProof = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  parameterProofs: ReadonlyMap<number, KatexHtmlProof> = new Map(),
): KatexHtmlProof => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "Literal")) return SAFE_STATIC_HTML_PROOF;
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "void") {
    return SAFE_STATIC_HTML_PROOF;
  }
  if (isNodeOfType(node, "Identifier")) {
    if ((node.name === "undefined" || node.name === "NaN") && scopes.isGlobalReference(node)) {
      return SAFE_STATIC_HTML_PROOF;
    }
    const symbol = scopes.referenceFor(node)?.resolvedSymbol;
    const parameterProof = symbol ? parameterProofs.get(symbol.id) : undefined;
    if (parameterProof) return parameterProof;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id)
    ) {
      return UNKNOWN_HTML_PROOF;
    }
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return getKatexHtmlProof(symbol.initializer, scopes, nextVisitedSymbolIds, parameterProofs);
  }
  if (isNodeOfType(node, "CallExpression")) {
    return getKatexCallProof(node, scopes, visitedSymbolIds, parameterProofs);
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return getTemplateLiteralProof(node, scopes, visitedSymbolIds, parameterProofs);
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return combineHtmlProofs([
      getKatexHtmlProof(node.consequent, scopes, new Set(visitedSymbolIds), parameterProofs),
      getKatexHtmlProof(node.alternate, scopes, new Set(visitedSymbolIds), parameterProofs),
    ]);
  }
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&") {
    return getKatexHtmlProof(node.right, scopes, visitedSymbolIds, parameterProofs);
  }
  if (
    (isNodeOfType(node, "BinaryExpression") && node.operator === "+") ||
    isNodeOfType(node, "LogicalExpression")
  ) {
    return combineHtmlProofs([
      getKatexHtmlProof(node.left, scopes, new Set(visitedSymbolIds), parameterProofs),
      getKatexHtmlProof(node.right, scopes, new Set(visitedSymbolIds), parameterProofs),
    ]);
  }
  if (isNodeOfType(node, "SequenceExpression")) {
    const resultExpression = node.expressions.at(-1);
    return resultExpression
      ? getKatexHtmlProof(resultExpression, scopes, visitedSymbolIds, parameterProofs)
      : UNKNOWN_HTML_PROOF;
  }
  return UNKNOWN_HTML_PROOF;
};
