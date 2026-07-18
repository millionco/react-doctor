import fs from "node:fs";
import path from "node:path";
import { listSourceFiles } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import ts from "typescript";

interface CreateDiagnosticEvidenceReaderOptions {
  readonly resolveForwardedHandlers?: boolean;
}

interface SourceRecord {
  readonly absolutePath: string;
  readonly filePath: string;
  readonly sourceFile: ts.SourceFile;
  readonly sourceText: string;
}

interface ComponentDeclaration {
  readonly isDefaultExport: boolean;
  readonly name: string;
  readonly node: ts.FunctionLikeDeclaration;
  readonly record: SourceRecord;
}

interface BindingCandidate {
  readonly declaration: ts.Node;
  readonly scope: ts.Node;
}

interface DiagnosticEvidenceReaderState {
  readonly aliasesByComponent: Map<string, ReadonlyMap<string, string>>;
  readonly recordByFilePath: Map<string, SourceRecord | null>;
  sourceRecords: ReadonlyArray<SourceRecord> | null;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
const COMPONENT_WRAPPER_NAMES = new Set(["memo", "forwardRef"]);

// Core's equivalent AST helpers compile against TypeScript 6 while this package supports
// TypeScript 5, so these adapters stay local to avoid crossing incompatible node types.
const getScriptKind = (filePath: string): ts.ScriptKind => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

const resolveSafeSourcePath = (rootDirectory: string, filePath: string): string | null => {
  try {
    const resolvedRootDirectory = fs.realpathSync(rootDirectory);
    const absolutePath = path.resolve(resolvedRootDirectory, filePath);
    const relativePath = path.relative(resolvedRootDirectory, absolutePath);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return null;
    }
    const stats = fs.lstatSync(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    const realPath = fs.realpathSync(absolutePath);
    const realRelativePath = path.relative(resolvedRootDirectory, realPath);
    return realRelativePath !== ".." &&
      !realRelativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(realRelativePath)
      ? realPath
      : null;
  } catch {
    return null;
  }
};

const readSourceRecord = (
  rootDirectory: string,
  filePath: string,
  state: DiagnosticEvidenceReaderState,
): SourceRecord | null => {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  if (state.recordByFilePath.has(normalizedFilePath)) {
    return state.recordByFilePath.get(normalizedFilePath) ?? null;
  }
  const absolutePath = resolveSafeSourcePath(rootDirectory, normalizedFilePath);
  if (absolutePath === null) {
    state.recordByFilePath.set(normalizedFilePath, null);
    return null;
  }
  try {
    const sourceText = fs.readFileSync(absolutePath, "utf-8");
    const record = {
      absolutePath,
      filePath: normalizedFilePath,
      sourceFile: ts.createSourceFile(
        absolutePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        getScriptKind(absolutePath),
      ),
      sourceText,
    } satisfies SourceRecord;
    state.recordByFilePath.set(normalizedFilePath, record);
    return record;
  } catch {
    state.recordByFilePath.set(normalizedFilePath, null);
    return null;
  }
};

const listSourceRecords = (
  rootDirectory: string,
  state: DiagnosticEvidenceReaderState,
): ReadonlyArray<SourceRecord> => {
  if (state.sourceRecords !== null) return state.sourceRecords;
  state.sourceRecords = listSourceFiles(rootDirectory).flatMap((filePath) => {
    const record = readSourceRecord(rootDirectory, filePath, state);
    return record === null ? [] : [record];
  });
  return state.sourceRecords;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let currentExpression = expression;
  while (
    ts.isParenthesizedExpression(currentExpression) ||
    ts.isAsExpression(currentExpression) ||
    ts.isTypeAssertionExpression(currentExpression) ||
    ts.isNonNullExpression(currentExpression) ||
    ts.isSatisfiesExpression(currentExpression)
  ) {
    currentExpression = currentExpression.expression;
  }
  return currentExpression;
};

const getCalleeName = (expression: ts.Expression): string | null => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) return unwrappedExpression.text;
  if (ts.isPropertyAccessExpression(unwrappedExpression)) return unwrappedExpression.name.text;
  return null;
};

const isComponentWrapperCall = (node: ts.CallExpression): boolean => {
  const wrapperName = getCalleeName(node.expression);
  return wrapperName !== null && COMPONENT_WRAPPER_NAMES.has(wrapperName);
};

const getFunctionName = (node: ts.FunctionLikeDeclaration): string | null => {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) return node.name.text;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    let componentExpression: ts.Expression = node;
    while (true) {
      const parent = componentExpression.parent;
      if (
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent)
      ) {
        componentExpression = parent;
        continue;
      }
      if (
        ts.isCallExpression(parent) &&
        parent.arguments[0] === componentExpression &&
        isComponentWrapperCall(parent)
      ) {
        componentExpression = parent;
        continue;
      }
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      return node.name?.text ?? null;
    }
  }
  return null;
};

const isComponentFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

const isDefaultExportedComponent = (
  record: SourceRecord,
  node: ts.FunctionLikeDeclaration,
  componentName: string,
): boolean => {
  if (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  ) {
    return true;
  }
  return record.sourceFile.statements.some(
    (statement) =>
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression) &&
      statement.expression.text === componentName,
  );
};

const findEnclosingComponent = (
  record: SourceRecord,
  diagnostic: Diagnostic,
): ComponentDeclaration | null => {
  if (!Number.isInteger(diagnostic.line) || diagnostic.line < 1) return null;
  const lineIndex = diagnostic.line - 1;
  const lineStarts = record.sourceFile.getLineStarts();
  const lineStart = lineStarts[lineIndex];
  if (lineStart === undefined) return null;
  const nextLineStart = lineStarts[lineIndex + 1] ?? record.sourceFile.end;
  const lineEnd = Math.max(lineStart, nextLineStart - 1);
  const columnIndex = Number.isInteger(diagnostic.column) ? Math.max(0, diagnostic.column - 1) : 0;
  const diagnosticPosition = Math.min(lineStart + columnIndex, lineEnd);
  let component: ComponentDeclaration | null = null;
  let componentWidth = Number.POSITIVE_INFINITY;
  const visit = (node: ts.Node): void => {
    if (diagnosticPosition < node.getStart(record.sourceFile) || diagnosticPosition > node.end) {
      return;
    }
    if (isComponentFunction(node)) {
      const name = getFunctionName(node);
      const width = node.end - node.getStart(record.sourceFile);
      if (name !== null && /^[A-Z]/.test(name) && width < componentWidth) {
        component = {
          isDefaultExport: isDefaultExportedComponent(record, node, name),
          name,
          node,
          record,
        };
        componentWidth = width;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(record.sourceFile);
  return component;
};

const moduleSpecifierTargetsComponent = (
  callerRecord: SourceRecord,
  moduleSpecifier: string,
  componentRecord: SourceRecord,
): boolean => {
  if (!moduleSpecifier.startsWith(".")) return false;
  const unresolvedPath = path.resolve(path.dirname(callerRecord.absolutePath), moduleSpecifier);
  const specifiedExtension = path.extname(unresolvedPath).toLowerCase();
  const sourcePathWithoutExtension = SOURCE_EXTENSIONS.includes(specifiedExtension)
    ? unresolvedPath.slice(0, -specifiedExtension.length)
    : unresolvedPath;
  const candidatePaths = [
    unresolvedPath,
    ...SOURCE_EXTENSIONS.map((extension) => `${sourcePathWithoutExtension}${extension}`),
    ...(sourcePathWithoutExtension === unresolvedPath
      ? SOURCE_EXTENSIONS.map((extension) => path.join(unresolvedPath, `index${extension}`))
      : []),
  ];
  return candidatePaths.includes(componentRecord.absolutePath);
};

const getComponentTagNames = (
  record: SourceRecord,
  component: ComponentDeclaration,
): ReadonlySet<string> => {
  if (record.absolutePath === component.record.absolutePath) return new Set([component.name]);
  const tagNames = new Set<string>();
  for (const statement of record.sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !moduleSpecifierTargetsComponent(record, statement.moduleSpecifier.text, component.record)
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (component.isDefaultExport && importClause?.name !== undefined) {
      tagNames.add(importClause.name.text);
    }
    const namedBindings = importClause?.namedBindings;
    if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === component.name) {
          tagNames.add(element.name.text);
        }
      }
    }
  }
  return tagNames;
};

const getTransparentCall = (functionNode: ts.FunctionLikeDeclaration): ts.CallExpression | null => {
  if (functionNode.body === undefined) return null;
  if (!ts.isBlock(functionNode.body)) {
    const expression = unwrapExpression(functionNode.body);
    return ts.isCallExpression(expression) ? expression : null;
  }
  if (functionNode.body.statements.length !== 1) return null;
  const statement = functionNode.body.statements[0];
  if (statement === undefined) return null;
  const expression =
    ts.isExpressionStatement(statement) || ts.isReturnStatement(statement)
      ? statement.expression
      : undefined;
  if (expression === undefined) return null;
  const unwrappedExpression = unwrapExpression(expression);
  return ts.isCallExpression(unwrappedExpression) ? unwrappedExpression : null;
};

const resolveTransparentTarget = (functionNode: ts.FunctionLikeDeclaration): string | null => {
  const call = getTransparentCall(functionNode);
  if (call === null) return null;
  const target = unwrapExpression(call.expression);
  if (!ts.isIdentifier(target) || call.arguments.length !== functionNode.parameters.length) {
    return null;
  }
  for (const [parameterIndex, parameter] of functionNode.parameters.entries()) {
    const argument = call.arguments[parameterIndex];
    const unwrappedArgument = argument === undefined ? null : unwrapExpression(argument);
    if (
      !ts.isIdentifier(parameter.name) ||
      unwrappedArgument === null ||
      !ts.isIdentifier(unwrappedArgument) ||
      unwrappedArgument.text !== parameter.name.text
    ) {
      return null;
    }
  }
  return target.text;
};

const getForwardingFunction = (declaration: ts.Declaration): ts.FunctionLikeDeclaration | null => {
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return null;
  const initializer = unwrapExpression(declaration.initializer);
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer;
  if (ts.isCallExpression(initializer) && getCalleeName(initializer.expression) === "useCallback") {
    const callback = initializer.arguments[0];
    if (
      callback !== undefined &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ) {
      return callback;
    }
  }
  return null;
};

const getDeclaredBindingName = (node: ts.Node): string | null => {
  if (
    (ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  if (ts.isImportClause(node)) return node.name?.text ?? null;
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) return node.name.text;
  return null;
};

const findBindingScope = (node: ts.Node): ts.Node => {
  let currentNode: ts.Node | undefined = node;
  while (currentNode !== undefined) {
    if (ts.isParameter(currentNode) && ts.isFunctionLike(currentNode.parent)) {
      return currentNode.parent;
    }
    if (ts.isBlock(currentNode) || ts.isModuleBlock(currentNode) || ts.isSourceFile(currentNode)) {
      return currentNode;
    }
    currentNode = currentNode.parent;
  }
  return node.getSourceFile();
};

const findBindingDeclaration = (
  record: SourceRecord,
  binding: ts.Identifier,
): ts.Declaration | null => {
  const usagePosition = binding.getStart(record.sourceFile);
  const candidates: BindingCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (getDeclaredBindingName(node) === binding.text) {
      const scope = findBindingScope(node);
      const isVisibleScope =
        usagePosition >= scope.getStart(record.sourceFile) && usagePosition <= scope.end;
      const isVisibleDeclaration =
        ts.isFunctionDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node) ||
        node.getStart(record.sourceFile) < usagePosition;
      if (isVisibleScope && isVisibleDeclaration) {
        candidates.push({ declaration: node, scope });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(record.sourceFile);
  let nearestCandidate: BindingCandidate | null = null;
  let nearestScopeWidth = Number.POSITIVE_INFINITY;
  let isNearestScopeAmbiguous = false;
  for (const candidate of candidates) {
    const scopeWidth = candidate.scope.end - candidate.scope.getStart(record.sourceFile);
    if (scopeWidth < nearestScopeWidth) {
      nearestCandidate = candidate;
      nearestScopeWidth = scopeWidth;
      isNearestScopeAmbiguous = false;
    } else if (scopeWidth === nearestScopeWidth) {
      isNearestScopeAmbiguous = true;
    }
  }
  if (isNearestScopeAmbiguous) return null;
  const declaration = nearestCandidate?.declaration;
  return declaration !== undefined &&
    (ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration))
    ? declaration
    : null;
};

const resolveHandlerBinding = (record: SourceRecord, binding: ts.Identifier): string => {
  const declaration = findBindingDeclaration(record, binding);
  if (declaration === null) return binding.text;
  const forwardingFunction = getForwardingFunction(declaration);
  const target = forwardingFunction === null ? null : resolveTransparentTarget(forwardingFunction);
  return target === null || target === binding.text ? binding.text : target;
};

const getJsxTagName = (node: ts.JsxOpeningLikeElement): string | null =>
  ts.isIdentifier(node.tagName) ? node.tagName.text : null;

const getHandlerBinding = (
  node: ts.JsxOpeningLikeElement,
  propName: string,
): ts.Identifier | null => {
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== propName) continue;
    const initializer = property.initializer;
    if (initializer === undefined || !ts.isJsxExpression(initializer)) return null;
    if (initializer.expression === undefined) return null;
    const expression = unwrapExpression(initializer.expression);
    return ts.isIdentifier(expression) ? expression : null;
  }
  return null;
};

const getForwardedHandlerAliases = (
  rootDirectory: string,
  component: ComponentDeclaration,
  propNames: ReadonlySet<string>,
  state: DiagnosticEvidenceReaderState,
): ReadonlyMap<string, string> => {
  const cacheKey = `${component.record.filePath}\0${component.name}\0${[...propNames].sort().join("\0")}`;
  const cachedAliases = state.aliasesByComponent.get(cacheKey);
  if (cachedAliases !== undefined) return cachedAliases;

  const bindingsByPropName = new Map<string, Set<string>>();
  const unresolvedPropNames = new Set<string>();
  let callsiteCount = 0;
  for (const record of listSourceRecords(rootDirectory, state)) {
    const tagNames = getComponentTagNames(record, component);
    if (tagNames.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (record === component.record && node === component.node) return;
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = getJsxTagName(node);
        if (tagName !== null && tagNames.has(tagName)) {
          callsiteCount += 1;
          for (const propName of propNames) {
            const binding = getHandlerBinding(node, propName);
            if (binding === null) {
              unresolvedPropNames.add(propName);
              continue;
            }
            const bindings = bindingsByPropName.get(propName) ?? new Set<string>();
            bindings.add(resolveHandlerBinding(record, binding));
            bindingsByPropName.set(propName, bindings);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(record.sourceFile);
  }

  const aliases = new Map<string, string>();
  if (callsiteCount > 0) {
    for (const [propName, bindings] of bindingsByPropName) {
      if (bindings.size !== 1 || unresolvedPropNames.has(propName)) continue;
      const [bindingName] = bindings;
      if (bindingName !== undefined) aliases.set(propName, bindingName);
    }
  }
  state.aliasesByComponent.set(cacheKey, aliases);
  return aliases;
};

const normalizeForwardedHandlers = (
  evidence: string,
  aliases: ReadonlyMap<string, string>,
): string => {
  let normalizedEvidence = evidence;
  for (const [propName, bindingName] of aliases) {
    normalizedEvidence = normalizedEvidence
      .replace(new RegExp(`\\{\\s*${propName}\\s*\\}`, "g"), `{${bindingName}}`)
      .replace(new RegExp(`=>\\s*${propName}\\s*\\(`, "g"), `=> ${bindingName}(`);
  }
  return normalizedEvidence;
};

export const createDiagnosticEvidenceReader = (
  rootDirectory: string,
  options: CreateDiagnosticEvidenceReaderOptions = {},
): ((diagnostic: Diagnostic) => string | null) => {
  const state: DiagnosticEvidenceReaderState = {
    aliasesByComponent: new Map(),
    recordByFilePath: new Map(),
    sourceRecords: null,
  };

  return (diagnostic) => {
    const record = readSourceRecord(rootDirectory, diagnostic.filePath, state);
    if (record === null || !Number.isInteger(diagnostic.line)) return null;
    const sourceLines = record.sourceText.split(/\r?\n/);
    const startLineIndex = Math.max(0, diagnostic.line - 1);
    const endLineIndex = Math.max(startLineIndex, (diagnostic.endLine ?? diagnostic.line) - 1);
    const evidence = sourceLines.slice(startLineIndex, endLineIndex + 1).join("\n");
    if (!options.resolveForwardedHandlers) return evidence;
    const propNames = new Set(evidence.match(/\bon[A-Z]\w*\b/g) ?? []);
    if (propNames.size === 0) return evidence;
    const component = findEnclosingComponent(record, diagnostic);
    if (component === null) return evidence;
    return normalizeForwardedHandlers(
      evidence,
      getForwardedHandlerAliases(rootDirectory, component, propNames, state),
    );
  };
};
