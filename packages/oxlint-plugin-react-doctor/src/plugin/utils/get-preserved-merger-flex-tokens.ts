import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import {
  TAILWIND_MERGER_EXPRESSION_MAX_DEPTH,
  TAILWIND_MERGER_MANIFEST_MAX_DEPTH,
  TAILWIND_MERGER_LITERAL_PACKAGE_SELECTOR_PATTERN,
  TAILWIND_MERGER_VERSION,
  TAILWIND_MERGER_CLSX_VERSION,
  UNCLASSIFIED_LEGACY_FLEX_TOKENS,
} from "../constants/tailwind-merger.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const mergerScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();

const isMergerImport = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string,
  source: string,
  importedName: string,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  const imported = resolveImportedApiReference(candidate, scopes);
  return Boolean(
    imported &&
    !imported.isNamespace &&
    imported.source === source &&
    (imported.importedName === importedName ||
      (source === "clsx" && imported.importedName === "default")) &&
    resolveModulePath(filename, source) === null,
  );
};

const hasOnlyUnrelatedMergerSelectors = (
  value: unknown,
  selectedModules: ReadonlySet<string>,
  depth = 0,
): boolean => {
  if (value === undefined) return true;
  if (
    depth > TAILWIND_MERGER_MANIFEST_MAX_DEPTH ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  )
    return false;
  return Object.entries(value).every(
    ([selector, replacement]) =>
      TAILWIND_MERGER_LITERAL_PACKAGE_SELECTOR_PATTERN.test(selector) &&
      !selectedModules.has(selector) &&
      (typeof replacement === "string" ||
        hasOnlyUnrelatedMergerSelectors(replacement, selectedModules, depth + 1)),
  );
};

const hasMergerVersions = (filename: string, includesClsx: boolean): boolean => {
  const manifest = readNearestPackageManifest(filename);
  if (
    manifest?.dependencies?.["tailwind-merge"] !== TAILWIND_MERGER_VERSION ||
    (includesClsx && manifest.dependencies["clsx"] !== TAILWIND_MERGER_CLSX_VERSION)
  )
    return false;
  const selectedModules = new Set(includesClsx ? ["tailwind-merge", "clsx"] : ["tailwind-merge"]);
  const pnpm = Reflect.get(manifest, "pnpm");
  if (pnpm !== undefined && (typeof pnpm !== "object" || pnpm === null || Array.isArray(pnpm)))
    return false;
  const providerSelectors = [
    Reflect.get(manifest, "overrides"),
    Reflect.get(manifest, "resolutions"),
    Reflect.get(manifest, "patchedDependencies"),
  ];
  if (typeof pnpm === "object" && pnpm !== null)
    providerSelectors.push(
      Reflect.get(pnpm, "overrides"),
      Reflect.get(pnpm, "patchedDependencies"),
    );
  if (
    !providerSelectors.every((selectors) =>
      hasOnlyUnrelatedMergerSelectors(selectors, selectedModules),
    )
  )
    return false;
  return [manifest.devDependencies, manifest.peerDependencies, manifest.optionalDependencies].every(
    (dependencies) =>
      (!dependencies ||
        dependencies["tailwind-merge"] === undefined ||
        dependencies["tailwind-merge"] === TAILWIND_MERGER_VERSION) &&
      (!includesClsx ||
        !dependencies ||
        dependencies["clsx"] === undefined ||
        dependencies["clsx"] === TAILWIND_MERGER_CLSX_VERSION),
  );
};

const getDirectMergerArguments = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string,
): ReadonlyArray<EsTreeNode> | null => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isMergerImport(call.callee, scopes, filename, "tailwind-merge", "twMerge")
  )
    return null;
  const [argument, ...otherArguments] = call.arguments;
  if (
    isNodeOfType(argument, "CallExpression") &&
    !argument.optional &&
    otherArguments.length === 0 &&
    isMergerImport(argument.callee, scopes, filename, "clsx", "clsx")
  ) {
    return hasMergerVersions(filename, true) ? argument.arguments : null;
  }
  return hasMergerVersions(filename, false) ? call.arguments : null;
};

const getWrapperMergerArguments = (
  expression: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<EsTreeNode> | null => {
  const call = stripParenExpression(expression);
  if (
    !context.filename ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return null;
  const symbol = context.scopes.symbolFor(call.callee);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return null;
  const imported = resolveImportedApiReference(call.callee, context.scopes);
  if (
    !imported ||
    imported.isNamespace ||
    !imported.source.startsWith(".") ||
    !imported.importedName ||
    imported.importedName === "default"
  )
    return null;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    imported.source,
    imported.importedName,
  );
  if (
    !resolved ||
    resolved.filePath !== resolveModulePath(context.filename, imported.source) ||
    findNearestPackageDirectory(context.filename) !== findNearestPackageDirectory(resolved.filePath)
  )
    return null;
  const functionNode = resolved.functionNode;
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    (!isNodeOfType(functionNode, "FunctionDeclaration") &&
      !isNodeOfType(functionNode, "ArrowFunctionExpression"))
  )
    return null;
  const declarator = functionNode.parent;
  let bindingIdentifier: EsTreeNode | null = null;
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    bindingIdentifier = functionNode.id;
  } else if (
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.init === functionNode &&
    isNodeOfType(declarator.id, "Identifier") &&
    isNodeOfType(declarator.parent, "VariableDeclaration") &&
    declarator.parent.kind === "const"
  ) {
    bindingIdentifier = declarator.id;
  }
  if (!bindingIdentifier) return null;
  let scopes = mergerScopes.get(resolved.programNode);
  if (!scopes) {
    scopes = analyzeScopes(resolved.programNode);
    mergerScopes.set(resolved.programNode, scopes);
  }
  const binding = scopes.symbolFor(bindingIdentifier);
  if (!binding || binding.references.some((reference) => reference.flag !== "read")) return null;
  if (
    someAst(resolved.programNode, (node) => {
      if (isNodeOfType(node, "CallExpression") && !node.optional) {
        const callee = stripParenExpression(node.callee);
        if (isNodeOfType(callee, "Identifier") && callee.name === "eval") return true;
      }
      let target: EsTreeNode | null = null;
      if (isNodeOfType(node, "AssignmentExpression")) target = node.left;
      else if (isNodeOfType(node, "UpdateExpression")) target = node.argument;
      else if (isNodeOfType(node, "ForOfStatement") || isNodeOfType(node, "ForInStatement")) {
        target = node.left;
      }
      return Boolean(
        target &&
        someAst(
          target,
          (child) => isNodeOfType(child, "Identifier") && child.name === binding.name,
        ),
      );
    })
  )
    return null;
  const [parameter, ...otherParameters] = functionNode.params;
  if (
    !isNodeOfType(parameter, "RestElement") ||
    !isNodeOfType(parameter.argument, "Identifier") ||
    otherParameters.length > 0
  )
    return null;
  const restSymbol = scopes.symbolFor(parameter.argument);
  if (
    !restSymbol ||
    restSymbol.references.length !== 1 ||
    restSymbol.references.some((reference) => reference.flag !== "read")
  )
    return null;
  let returned: EsTreeNode | null = functionNode.body;
  if (isNodeOfType(functionNode.body, "BlockStatement")) {
    const [statement, ...otherStatements] = functionNode.body.body;
    returned =
      isNodeOfType(statement, "ReturnStatement") && otherStatements.length === 0
        ? (statement.argument ?? null)
        : null;
  }
  if (!returned) return null;
  const argumentsToClsx = getDirectMergerArguments(returned, scopes, resolved.filePath);
  const [restArgument, ...otherArguments] = argumentsToClsx ?? [];
  const outerCall = stripParenExpression(returned);
  const [clsxCall] = isNodeOfType(outerCall, "CallExpression") ? outerCall.arguments : [];
  if (
    !isNodeOfType(clsxCall, "CallExpression") ||
    !isMergerImport(clsxCall.callee, scopes, resolved.filePath, "clsx", "clsx") ||
    !isNodeOfType(restArgument, "Identifier") ||
    scopes.symbolFor(restArgument) !== restSymbol ||
    otherArguments.length > 0
  )
    return null;
  return call.arguments;
};

const isClosedMergerCondition = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  depth: number,
): boolean => {
  if (depth > TAILWIND_MERGER_EXPRESSION_MAX_DEPTH) return false;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal"))
    return (
      candidate.value === null || ["string", "boolean", "number"].includes(typeof candidate.value)
    );
  if (isNodeOfType(candidate, "Identifier"))
    return Boolean(scopes.referenceFor(candidate) && scopes.symbolFor(candidate));
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!")
    return isClosedMergerCondition(candidate.argument, scopes, depth + 1);
  if (
    (isNodeOfType(candidate, "BinaryExpression") && ["===", "!=="].includes(candidate.operator)) ||
    (isNodeOfType(candidate, "LogicalExpression") && ["&&", "||"].includes(candidate.operator))
  ) {
    return (
      isClosedMergerCondition(candidate.left, scopes, depth + 1) &&
      isClosedMergerCondition(candidate.right, scopes, depth + 1)
    );
  }
  return false;
};

const getClosedMergerTokens = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  depth: number,
  allowsAlias: boolean,
): ReadonlySet<string> | null => {
  if (depth > TAILWIND_MERGER_EXPRESSION_MAX_DEPTH) return null;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    if (typeof candidate.value === "string")
      return new Set(
        splitTailwindClassName(candidate.value).filter((token) =>
          UNCLASSIFIED_LEGACY_FLEX_TOKENS.has(token),
        ),
      );
    return candidate.value === null || candidate.value === false || candidate.value === 0
      ? new Set()
      : null;
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    if (!isClosedMergerCondition(candidate.test, scopes, depth + 1)) return null;
    const consequent = getClosedMergerTokens(candidate.consequent, scopes, depth + 1, allowsAlias);
    const alternate = getClosedMergerTokens(candidate.alternate, scopes, depth + 1, allowsAlias);
    return consequent && alternate
      ? new Set([...consequent].filter((token) => alternate.has(token)))
      : null;
  }
  if (!allowsAlias || !isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !isNodeOfType(symbol.bindingIdentifier, "Identifier")
  )
    return null;
  const declaration = symbol.declarationNode.parent;
  const owner = findEnclosingFunction(candidate);
  const declarationOwner = findEnclosingFunction(symbol.declarationNode);
  const container = declaration?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !(
      isNodeOfType(container, "Program") ||
      (isNodeOfType(container, "BlockStatement") &&
        isFunctionLike(container.parent) &&
        container.parent === owner)
    ) ||
    (declarationOwner !== null && declarationOwner !== owner) ||
    getNodeEndIndex(symbol.declarationNode) < 0 ||
    symbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        getNodeStartIndex(reference.identifier) < getNodeEndIndex(symbol.declarationNode) ||
        (declarationOwner !== null &&
          findEnclosingFunction(reference.identifier) !== declarationOwner),
    )
  )
    return null;
  return getClosedMergerTokens(symbol.initializer, scopes, depth + 1, false);
};

export const getPreservedMergerFlexTokens = (node: EsTreeNode, context: RuleContext): string[] => {
  if (!context.filename || !isNodeOfType(node, "JSXOpeningElement")) return [];
  const attribute = getAuthoritativeJsxAttribute(node.attributes, "className");
  if (!isNodeOfType(attribute?.value, "JSXExpressionContainer")) return [];
  const argumentsToMerge =
    getDirectMergerArguments(attribute.value.expression, context.scopes, context.filename) ??
    getWrapperMergerArguments(attribute.value.expression, context);
  if (!argumentsToMerge) return [];
  const tokens = new Set<string>();
  for (const argument of argumentsToMerge) {
    const guaranteed = getClosedMergerTokens(argument, context.scopes, 0, true);
    if (!guaranteed) return [];
    for (const token of guaranteed) tokens.add(token);
  }
  return [...tokens];
};
