import * as path from "node:path";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { findExportedValue } from "./find-exported-value.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { resolveUniqueDirectModulePath } from "./resolve-module-path.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface BrowserGuardContext {
  readonly scopes: ScopeAnalysis;
  readonly importFilename?: string;
  readonly importRootDirectory?: string;
}

const BROWSER_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "matchMedia",
]);

const getTypeofBrowserGlobalName = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "UnaryExpression") ||
    unwrappedExpression.operator !== "typeof"
  ) {
    return null;
  }
  const argument = stripParenExpression(unwrappedExpression.argument);
  if (isNodeOfType(argument, "Identifier")) {
    return BROWSER_GLOBAL_NAMES.has(argument.name) && scopes.isGlobalReference(argument)
      ? argument.name
      : null;
  }
  if (
    !isNodeOfType(argument, "MemberExpression") ||
    argument.computed ||
    !isNodeOfType(argument.object, "Identifier") ||
    argument.object.name !== "globalThis" ||
    !scopes.isGlobalReference(argument.object) ||
    !isNodeOfType(argument.property, "Identifier") ||
    !BROWSER_GLOBAL_NAMES.has(argument.property.name)
  ) {
    return null;
  }
  return argument.property.name;
};

const browserGuardCoversGlobal = (guardName: string, browserGlobalName: string): boolean =>
  guardName === browserGlobalName || guardName === "window" || guardName === "document";

const mergeAvailability = (
  leftAvailability: boolean | null,
  rightAvailability: boolean | null,
): boolean | null => {
  if (leftAvailability === null) return rightAvailability;
  if (rightAvailability === null) return leftAvailability;
  return leftAvailability === rightAvailability ? leftAvailability : null;
};

const hasSymbolWrite = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some((reference) => reference.flag !== "read");

const readBrowserGlobalComparison = (
  comparison: EsTreeNodeOfType<"BinaryExpression">,
  browserGlobalName: string,
  scopes: ScopeAnalysis,
  predicateResult: boolean,
): boolean | null => {
  const leftTypeofName = getTypeofBrowserGlobalName(comparison.left, scopes);
  const rightTypeofName = getTypeofBrowserGlobalName(comparison.right, scopes);
  const leftComparedType =
    isNodeOfType(comparison.left, "Literal") && typeof comparison.left.value === "string"
      ? comparison.left.value
      : null;
  const rightComparedType =
    isNodeOfType(comparison.right, "Literal") && typeof comparison.right.value === "string"
      ? comparison.right.value
      : null;
  const guardName =
    leftTypeofName && rightComparedType
      ? leftTypeofName
      : rightTypeofName && leftComparedType
        ? rightTypeofName
        : null;
  const comparedType =
    leftTypeofName && rightComparedType
      ? rightComparedType
      : rightTypeofName && leftComparedType
        ? leftComparedType
        : null;
  if (!guardName || !browserGuardCoversGlobal(guardName, browserGlobalName)) return null;
  if (!comparedType) return null;
  const isEquality = comparison.operator === "===" || comparison.operator === "==";
  const isInequality = comparison.operator === "!==" || comparison.operator === "!=";
  if (!isEquality && !isInequality) return null;
  const browserType = guardName === "matchMedia" ? "function" : "object";
  const browserResult = isEquality ? browserType === comparedType : browserType !== comparedType;
  const serverResult = isEquality ? comparedType === "undefined" : comparedType !== "undefined";
  if (browserResult === serverResult) return null;
  return predicateResult === browserResult;
};

const importedGuardScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();

const readImportedBrowserGlobalAvailability = (
  callee: EsTreeNodeOfType<"Identifier">,
  browserGlobalName: string,
  context: BrowserGuardContext,
  predicateResult: boolean,
): boolean | null => {
  if (!context.importFilename) return null;
  const imported = resolveImportedApiReference(callee, context.scopes);
  if (!imported?.importedName) return null;
  if (
    !context.importRootDirectory ||
    path.resolve(context.importRootDirectory) !==
      findNearestPackageDirectory(path.resolve(context.importFilename))
  ) {
    return null;
  }
  const importedFile = resolveUniqueDirectModulePath(context.importFilename, imported.source);
  if (!importedFile) return null;
  const program = parseSourceFile(importedFile);
  if (!program) return null;
  const functionNode = findExportedValue(program, imported.importedName);
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length > 0
  ) {
    return null;
  }
  const declarator = functionNode.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    declarator.id.name !== imported.importedName ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(declarator.parent.parent, "ExportNamedDeclaration")
  ) {
    return null;
  }
  const returned = getSingleReturnExpression(functionNode);
  const comparison = returned && stripParenExpression(returned);
  if (!isNodeOfType(comparison, "BinaryExpression")) return null;

  let scopes = importedGuardScopes.get(program);
  if (!scopes) {
    scopes = analyzeScopes(program);
    importedGuardScopes.set(program, scopes);
  }
  const symbol = scopes.symbolFor(declarator.id);
  if (!symbol || hasSymbolWrite(symbol)) return null;
  return readBrowserGlobalComparison(comparison, browserGlobalName, scopes, predicateResult);
};

const readBrowserGlobalAvailabilityInternal = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: BrowserGuardContext,
  predicateResult: boolean,
  visitedSymbolIds: ReadonlySet<number>,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return readBrowserGlobalAvailabilityInternal(
      unwrappedExpression.argument,
      browserGlobalName,
      context,
      !predicateResult,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    if (unwrappedExpression.operator === "&&" && predicateResult) {
      return mergeAvailability(
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.left,
          browserGlobalName,
          context,
          true,
          new Set(visitedSymbolIds),
        ),
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.right,
          browserGlobalName,
          context,
          true,
          new Set(visitedSymbolIds),
        ),
      );
    }
    if (unwrappedExpression.operator === "||" && !predicateResult) {
      return mergeAvailability(
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.left,
          browserGlobalName,
          context,
          false,
          new Set(visitedSymbolIds),
        ),
        readBrowserGlobalAvailabilityInternal(
          unwrappedExpression.right,
          browserGlobalName,
          context,
          false,
          new Set(visitedSymbolIds),
        ),
      );
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWrite(symbol)
    ) {
      return null;
    }
    return readBrowserGlobalAvailabilityInternal(
      symbol.initializer,
      browserGlobalName,
      context,
      predicateResult,
      new Set([...visitedSymbolIds, symbol.id]),
    );
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callee = stripParenExpression(unwrappedExpression.callee);
    if (!isNodeOfType(callee, "Identifier") || unwrappedExpression.arguments.length > 0) {
      return null;
    }
    const symbol = context.scopes.symbolFor(callee);
    if (!symbol || visitedSymbolIds.has(symbol.id) || hasSymbolWrite(symbol)) return null;
    if (symbol.kind === "import") {
      return readImportedBrowserGlobalAvailability(
        callee,
        browserGlobalName,
        context,
        predicateResult,
      );
    }
    const functionNode =
      symbol.kind === "function"
        ? symbol.declarationNode
        : symbol.kind === "const" && symbol.initializer
          ? stripParenExpression(symbol.initializer)
          : null;
    if (
      !functionNode ||
      !isFunctionLike(functionNode) ||
      functionNode.async ||
      functionNode.generator ||
      functionNode.params.length > 0
    ) {
      return null;
    }
    const returnedExpression = getSingleReturnExpression(functionNode);
    if (!returnedExpression) return null;
    return readBrowserGlobalAvailabilityInternal(
      returnedExpression,
      browserGlobalName,
      context,
      predicateResult,
      new Set([...visitedSymbolIds, symbol.id]),
    );
  }
  if (!isNodeOfType(unwrappedExpression, "BinaryExpression")) return null;
  return readBrowserGlobalComparison(
    unwrappedExpression,
    browserGlobalName,
    context.scopes,
    predicateResult,
  );
};

export const readBrowserGlobalAvailability = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
  predicateResult: boolean,
): boolean | null =>
  readBrowserGlobalAvailabilityInternal(
    expression,
    browserGlobalName,
    { scopes: context.scopes },
    predicateResult,
    new Set(),
  );

export const readRenderBrowserGlobalAvailability = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
  predicateResult: boolean,
): boolean | null =>
  readBrowserGlobalAvailabilityInternal(
    expression,
    browserGlobalName,
    {
      scopes: context.scopes,
      importFilename: context.filename,
      importRootDirectory:
        getReactDoctorStringSetting(context.settings, "framework") === "nextjs"
          ? (getReactDoctorStringSetting(context.settings, "rootDirectory") ?? undefined)
          : undefined,
    },
    predicateResult,
    new Set(),
  );
