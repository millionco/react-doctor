import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import {
  BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH,
  BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH,
} from "../constants.js";
import { parseSourceFile } from "./parse.js";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { extractScriptFileReferences } from "../utils/extract-script-file-references.js";
import { extractPreviewRegistryNamesFromMdx } from "../utils/extract-preview-registry-names-from-mdx.js";
import { areSourceFilesStructurallyEquivalent } from "../utils/are-source-files-structurally-equivalent.js";
import { isPathInsideDirectoryOrEqual } from "../utils/is-path-inside-directory-or-equal.js";
import { toPosixPath } from "../utils/to-posix-path.js";
import { unwrapTypescriptExpression as unwrapExpression } from "../../utils/unwrap-typescript-expression.js";

interface InvokedScriptFile {
  filePath: string;
  workingDirectory: string;
}

export interface ExpandBuildScriptPathsInput {
  projectRoot: string;
  initialPaths: ReadonlyArray<string>;
}

interface ScriptAnalysis {
  scriptFile: InvokedScriptFile;
  sourceFile: ts.SourceFile;
  liveNodes: Set<ts.Node>;
  localFunctions: Map<string, ts.ConciseBody>;
  importedFunctions: Map<string, ImportedFunction>;
}

interface ImportedFunction {
  analysisKey: string;
  exportName: string;
}

interface PendingFunctionBody {
  analysis: ScriptAnalysis;
  body: ts.ConciseBody;
}

interface DirectoryConsumption {
  consumesAllEntries: boolean;
  recursivelyTraverses: boolean;
}

const SOURCE_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const GULP_INVOCATION_PATTERN = /(?:^|[\s;&|])gulp(?:\s|$)/;
const buildScriptAnalysisKey = (scriptFile: InvokedScriptFile): string =>
  `${scriptFile.workingDirectory}\0${scriptFile.filePath}`;

const resolveBuildReference = (
  reference: string,
  workingDirectory: string,
  projectRoot: string,
): string =>
  reference.startsWith("/")
    ? resolve(projectRoot, reference.replace(/^\/+/, ""))
    : resolve(workingDirectory, reference);

const getPropertyName = (expression: ts.Expression): string | undefined => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrappedExpression)) return unwrappedExpression.name.text;
  if (
    ts.isElementAccessExpression(unwrappedExpression) &&
    unwrappedExpression.argumentExpression &&
    ts.isStringLiteralLike(unwrappedExpression.argumentExpression)
  ) {
    return unwrappedExpression.argumentExpression.text;
  }
  return undefined;
};

const resolveImportedScriptPath = (
  specifier: string,
  scriptFile: InvokedScriptFile,
  projectRoot: string,
): string | undefined => {
  const importedPath = specifier.startsWith(".")
    ? resolve(dirname(scriptFile.filePath), specifier)
    : specifier.startsWith("@/registry/")
      ? resolve(scriptFile.workingDirectory, "src/registry", specifier.slice("@/registry/".length))
      : undefined;
  if (!importedPath) return undefined;
  const sourceImportedPath = importedPath.replace(/\.[cm]?js$/, "");
  const resolvedImportedPath =
    existsSync(importedPath) && statSync(importedPath).isDirectory()
      ? resolveEntryWithExtensions(join(importedPath, "index"))
      : (resolveEntryWithExtensions(importedPath) ??
        resolveEntryWithExtensions(sourceImportedPath));
  if (!resolvedImportedPath || !isPathInsideDirectoryOrEqual(resolvedImportedPath, projectRoot)) {
    return undefined;
  }
  return resolvedImportedPath;
};

const collectWebpackEntrySpecifiers = (filePath: string): string[] => {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = new Set<string>();
  const collectStringLiterals = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text.startsWith(".")) {
      specifiers.add(node.text);
      return;
    }
    ts.forEachChild(node, collectStringLiterals);
  };
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === "entry") ||
        (ts.isStringLiteralLike(node.name) && node.name.text === "entry"))
    ) {
      collectStringLiterals(node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "entry"
    ) {
      collectStringLiterals(node.right);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "concat" &&
      node.getText(sourceFile).includes(".entry")
    ) {
      collectStringLiterals(node);
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return [...specifiers];
};

const readJson = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
};

const collectManifestPathPatterns = (value: unknown, patterns: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectManifestPathPatterns(item, patterns);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "path" && typeof nestedValue === "string") {
      patterns.add(nestedValue);
      continue;
    }
    collectManifestPathPatterns(nestedValue, patterns);
  }
};

const expandManifestPaths = (
  manifestPath: string,
  projectRoot: string,
  recursivelyExpandWildcardDirectories = false,
): string[] => {
  const patterns = new Set<string>();
  collectManifestPathPatterns(readJson(manifestPath), patterns);
  const filePaths = new Set<string>();

  for (const pattern of patterns) {
    const isProjectRootPattern = pattern.startsWith("/") || pattern.startsWith("packages/");
    const patternWorkingDirectories = [isProjectRootPattern ? projectRoot : dirname(manifestPath)];
    const normalizedPattern = pattern.replace(/^\/+/, "");
    if (
      normalizedPattern.includes("*") ||
      normalizedPattern.includes("?") ||
      normalizedPattern.includes("[")
    ) {
      let didExpandWildcardDirectory = false;
      if (recursivelyExpandWildcardDirectories && normalizedPattern.includes("*")) {
        for (const patternWorkingDirectory of patternWorkingDirectories) {
          const wildcardDirectory = resolve(
            patternWorkingDirectory,
            normalizedPattern.slice(0, normalizedPattern.indexOf("*")),
          );
          if (
            isPathInsideDirectoryOrEqual(wildcardDirectory, projectRoot) &&
            existsSync(wildcardDirectory) &&
            statSync(wildcardDirectory).isDirectory()
          ) {
            for (const filePath of fg.sync("**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}", {
              cwd: wildcardDirectory,
              absolute: true,
              onlyFiles: true,
              ignore: ["**/node_modules/**"],
              deep: BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH,
            })) {
              filePaths.add(filePath);
            }
            didExpandWildcardDirectory = true;
            break;
          }
        }
      }
      if (didExpandWildcardDirectory) continue;
      for (const patternWorkingDirectory of patternWorkingDirectories) {
        const matchedFileCount = filePaths.size;
        for (const filePath of fg.sync(normalizedPattern, {
          cwd: patternWorkingDirectory,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**"],
          deep: BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH,
        })) {
          if (
            isPathInsideDirectoryOrEqual(filePath, projectRoot) &&
            SOURCE_FILE_EXTENSION_PATTERN.test(filePath)
          ) {
            filePaths.add(filePath);
          }
        }
        if (filePaths.size > matchedFileCount) break;
      }
      continue;
    }

    for (const patternWorkingDirectory of patternWorkingDirectories) {
      const filePath = resolve(patternWorkingDirectory, normalizedPattern);
      if (
        isPathInsideDirectoryOrEqual(filePath, projectRoot) &&
        existsSync(filePath) &&
        statSync(filePath).isFile() &&
        SOURCE_FILE_EXTENSION_PATTERN.test(filePath)
      ) {
        filePaths.add(filePath);
        break;
      }
    }
  }

  return [...filePaths];
};

const collectPackageJsonPaths = (projectRoot: string): string[] =>
  fg.sync(["package.json", "**/package.json"], {
    cwd: projectRoot,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH,
  });

const extractInvokedScriptFiles = (
  projectRoot: string,
  packageJsonPaths: ReadonlyArray<string>,
): InvokedScriptFile[] => {
  const scriptFiles = new Map<string, InvokedScriptFile>();

  for (const packageJsonPath of packageJsonPaths) {
    const workingDirectory = dirname(packageJsonPath);
    const packageJson = readJson(packageJsonPath);
    if (typeof packageJson !== "object" || packageJson === null) continue;
    const scripts = Object.entries(packageJson).find(([key]) => key === "scripts")?.[1];
    if (typeof scripts !== "object" || scripts === null) continue;

    for (const command of Object.values(scripts)) {
      if (typeof command !== "string") continue;
      if (GULP_INVOCATION_PATTERN.test(command)) {
        for (const gulpFilePath of fg.sync("gulpfile.{js,ts,mjs,cjs}", {
          cwd: workingDirectory,
          absolute: true,
          onlyFiles: true,
        })) {
          scriptFiles.set(`${workingDirectory}\0${gulpFilePath}`, {
            filePath: gulpFilePath,
            workingDirectory,
          });
        }
      }
      for (const scriptReference of extractScriptFileReferences(command)) {
        const scriptPath = resolveBuildReference(scriptReference, workingDirectory, projectRoot);
        if (
          isPathInsideDirectoryOrEqual(scriptPath, projectRoot) &&
          existsSync(scriptPath) &&
          statSync(scriptPath).isFile()
        ) {
          scriptFiles.set(`${workingDirectory}\0${scriptPath}`, {
            filePath: scriptPath,
            workingDirectory,
          });
        }
      }
    }
  }

  return [...scriptFiles.values()];
};

const expandInvokedScriptFiles = (
  initialScriptFiles: ReadonlyArray<InvokedScriptFile>,
  projectRoot: string,
): InvokedScriptFile[] => {
  const scriptFiles = new Map(
    initialScriptFiles.map((scriptFile) => [buildScriptAnalysisKey(scriptFile), scriptFile]),
  );
  const pendingScriptFiles = [...initialScriptFiles];

  for (let scriptIndex = 0; scriptIndex < pendingScriptFiles.length; scriptIndex++) {
    const scriptFile = pendingScriptFiles[scriptIndex];
    const parsedScript = parseSourceFile(scriptFile.filePath);
    const staticScriptSpecifiers = parsedScript.imports.flatMap((importInfo) => {
      const hasOnlyTypeBindings =
        importInfo.importedNames.length > 0 &&
        importInfo.importedNames.every((importedName) => importedName.isTypeOnly);
      return importInfo.isTypeOnly || hasOnlyTypeBindings ? [] : [importInfo.specifier];
    });
    const webpackEntrySpecifiers = collectWebpackEntrySpecifiers(scriptFile.filePath);
    for (const scriptSpecifier of [...staticScriptSpecifiers, ...webpackEntrySpecifiers]) {
      let resolvedImportedPath = resolveImportedScriptPath(
        scriptSpecifier,
        scriptFile,
        projectRoot,
      );
      if (!resolvedImportedPath && webpackEntrySpecifiers.includes(scriptSpecifier)) {
        resolvedImportedPath = resolveImportedScriptPath(
          scriptSpecifier,
          {
            filePath: join(scriptFile.workingDirectory, "webpack-entry.js"),
            workingDirectory: scriptFile.workingDirectory,
          },
          projectRoot,
        );
      }
      if (!resolvedImportedPath) continue;
      const importedScriptFile = {
        filePath: resolvedImportedPath,
        workingDirectory: scriptFile.workingDirectory,
      };
      const analysisKey = buildScriptAnalysisKey(importedScriptFile);
      if (scriptFiles.has(analysisKey)) continue;
      scriptFiles.set(analysisKey, importedScriptFile);
      pendingScriptFiles.push(importedScriptFile);
    }
  }

  return [...scriptFiles.values()];
};

const findScriptWorkingDirectory = (filePath: string, projectRoot: string): string => {
  let currentDirectory = dirname(resolve(filePath));
  const absoluteProjectRoot = resolve(projectRoot);
  while (isPathInsideDirectoryOrEqual(currentDirectory, absoluteProjectRoot)) {
    if (existsSync(join(currentDirectory, "package.json"))) return currentDirectory;
    if (currentDirectory === absoluteProjectRoot) break;
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  return absoluteProjectRoot;
};

export const expandBuildScriptPaths = ({
  projectRoot,
  initialPaths,
}: ExpandBuildScriptPathsInput): string[] =>
  expandInvokedScriptFiles(
    initialPaths
      .map((filePath) => resolve(filePath))
      .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile())
      .map((filePath) => ({
        filePath,
        workingDirectory: findScriptWorkingDirectory(filePath, projectRoot),
      })),
    resolve(projectRoot),
  ).map((scriptFile) => toPosixPath(scriptFile.filePath));

const buildScriptAnalyses = (
  invokedScriptFiles: ReadonlyArray<InvokedScriptFile>,
  projectRoot: string,
): Map<string, ScriptAnalysis> => {
  const analyses = new Map<string, ScriptAnalysis>();
  for (const scriptFile of invokedScriptFiles) {
    let content: string;
    try {
      content = readFileSync(scriptFile.filePath, "utf8");
    } catch {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      scriptFile.filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const localFunctions = new Map<string, ts.ConciseBody>();
    const defaultExportExpressions: ts.Expression[] = [];
    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body) {
        if (statement.name) localFunctions.set(statement.name.text, statement.body);
        if (
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
        ) {
          localFunctions.set("default", statement.body);
        }
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
          ) {
            localFunctions.set(declaration.name.text, declaration.initializer.body);
          }
        }
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        defaultExportExpressions.push(statement.expression);
      }
    }
    for (const defaultExportExpression of defaultExportExpressions) {
      const unwrappedDefaultExport = unwrapExpression(defaultExportExpression);
      if (
        ts.isArrowFunction(unwrappedDefaultExport) ||
        ts.isFunctionExpression(unwrappedDefaultExport)
      ) {
        localFunctions.set("default", unwrappedDefaultExport.body);
      } else if (ts.isIdentifier(unwrappedDefaultExport)) {
        const defaultFunctionBody = localFunctions.get(unwrappedDefaultExport.text);
        if (defaultFunctionBody) localFunctions.set("default", defaultFunctionBody);
      }
    }
    analyses.set(buildScriptAnalysisKey(scriptFile), {
      scriptFile,
      sourceFile,
      liveNodes: new Set(),
      localFunctions,
      importedFunctions: new Map(),
    });
  }

  for (const analysis of analyses.values()) {
    for (const statement of analysis.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const importClause = statement.importClause;
      if (!importClause || importClause.isTypeOnly) continue;
      const importedFilePath = resolveImportedScriptPath(
        statement.moduleSpecifier.text,
        analysis.scriptFile,
        projectRoot,
      );
      if (!importedFilePath) continue;
      const importedAnalysisKey = buildScriptAnalysisKey({
        filePath: importedFilePath,
        workingDirectory: analysis.scriptFile.workingDirectory,
      });
      if (!analyses.has(importedAnalysisKey)) continue;
      if (importClause.name) {
        analysis.importedFunctions.set(importClause.name.text, {
          analysisKey: importedAnalysisKey,
          exportName: "default",
        });
      }
      if (!importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) continue;
      for (const element of importClause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        analysis.importedFunctions.set(element.name.text, {
          analysisKey: importedAnalysisKey,
          exportName: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }

  const pendingFunctionBodies: PendingFunctionBody[] = [];
  const queuedFunctionBodies = new Set<ts.ConciseBody>();
  const queueFunctionBody = (analysis: ScriptAnalysis, body: ts.ConciseBody): void => {
    if (queuedFunctionBodies.has(body)) return;
    queuedFunctionBodies.add(body);
    pendingFunctionBodies.push({ analysis, body });
  };
  const visitLiveNode = (analysis: ScriptAnalysis, rootNode: ts.Node): void => {
    const visitNode = (node: ts.Node): void => {
      analysis.liveNodes.add(node);
      if (
        node !== rootNode &&
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node))
      ) {
        return;
      }
      if (ts.isCallExpression(node)) {
        const calledExpression = unwrapExpression(node.expression);
        if (ts.isFunctionExpression(calledExpression) || ts.isArrowFunction(calledExpression)) {
          queueFunctionBody(analysis, calledExpression.body);
        }
        if (ts.isIdentifier(calledExpression)) {
          const localFunctionBody = analysis.localFunctions.get(calledExpression.text);
          if (localFunctionBody) queueFunctionBody(analysis, localFunctionBody);
          const importedFunction = analysis.importedFunctions.get(calledExpression.text);
          const importedAnalysis = importedFunction
            ? analyses.get(importedFunction.analysisKey)
            : undefined;
          const importedFunctionBody = importedFunction
            ? importedAnalysis?.localFunctions.get(importedFunction.exportName)
            : undefined;
          if (importedAnalysis && importedFunctionBody) {
            queueFunctionBody(importedAnalysis, importedFunctionBody);
          }
        }
        for (const argument of node.arguments) {
          const unwrappedArgument = unwrapExpression(argument);
          if (ts.isFunctionExpression(unwrappedArgument) || ts.isArrowFunction(unwrappedArgument)) {
            queueFunctionBody(analysis, unwrappedArgument.body);
          }
        }
      }
      ts.forEachChild(node, visitNode);
    };
    visitNode(rootNode);
  };

  for (const analysis of analyses.values()) visitLiveNode(analysis, analysis.sourceFile);
  for (let pendingIndex = 0; pendingIndex < pendingFunctionBodies.length; pendingIndex++) {
    const pendingFunctionBody = pendingFunctionBodies[pendingIndex];
    visitLiveNode(pendingFunctionBody.analysis, pendingFunctionBody.body);
  }
  return analyses;
};

const collectDirectorySourceFiles = (
  directoryPath: string,
  projectRoot: string,
  consumedFiles: Set<string>,
  recursively: boolean,
): void => {
  if (
    !isPathInsideDirectoryOrEqual(directoryPath, projectRoot) ||
    !existsSync(directoryPath) ||
    !statSync(directoryPath).isDirectory()
  ) {
    return;
  }
  for (const filePath of fg.sync("**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}", {
    cwd: directoryPath,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    deep: recursively ? BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH : 1,
  })) {
    if (isPathInsideDirectoryOrEqual(filePath, projectRoot)) consumedFiles.add(filePath);
  }
};

const findVariableDeclaration = (
  sourceFile: ts.SourceFile,
  identifierName: string,
  usePosition: number,
): ts.VariableDeclaration | undefined => {
  let closestDeclaration: ts.VariableDeclaration | undefined;
  const visitNode = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= usePosition) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === identifierName) closestDeclaration = node;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return closestDeclaration;
};

const evaluatePathExpression = (
  expression: ts.Expression,
  analysis: ScriptAnalysis,
  projectRoot: string,
  seenIdentifiers = new Set<string>(),
): string | undefined => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrappedExpression)) {
    return resolveBuildReference(
      unwrappedExpression.text,
      analysis.scriptFile.workingDirectory,
      projectRoot,
    );
  }
  if (ts.isIdentifier(unwrappedExpression)) {
    if (unwrappedExpression.text === "__dirname") return dirname(analysis.scriptFile.filePath);
    if (seenIdentifiers.has(unwrappedExpression.text)) return undefined;
    const declaration = findVariableDeclaration(
      analysis.sourceFile,
      unwrappedExpression.text,
      unwrappedExpression.getStart(analysis.sourceFile),
    );
    if (!declaration?.initializer) return undefined;
    const nextSeenIdentifiers = new Set(seenIdentifiers);
    nextSeenIdentifiers.add(unwrappedExpression.text);
    return evaluatePathExpression(
      declaration.initializer,
      analysis,
      projectRoot,
      nextSeenIdentifiers,
    );
  }
  if (!ts.isCallExpression(unwrappedExpression)) return undefined;
  if (
    ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
    ts.isIdentifier(unwrappedExpression.expression.expression) &&
    unwrappedExpression.expression.expression.text === "process" &&
    unwrappedExpression.expression.name.text === "cwd"
  ) {
    return analysis.scriptFile.workingDirectory;
  }
  const pathMethodName = getPropertyName(unwrappedExpression.expression);
  if (pathMethodName !== "join" && pathMethodName !== "resolve") return undefined;
  const [baseExpression, ...segmentExpressions] = unwrappedExpression.arguments;
  if (!baseExpression) return undefined;
  const baseDirectory = evaluatePathExpression(
    baseExpression,
    analysis,
    projectRoot,
    seenIdentifiers,
  );
  if (!baseDirectory) return undefined;
  const pathSegments: string[] = [];
  for (const segmentExpression of segmentExpressions) {
    const unwrappedSegment = unwrapExpression(segmentExpression);
    if (!ts.isStringLiteralLike(unwrappedSegment)) return undefined;
    pathSegments.push(unwrappedSegment.text);
  }
  const rootRelativeSegment = pathSegments.find((pathSegment) => pathSegment.startsWith("/"));
  if (rootRelativeSegment) {
    const rootRelativeSegments = pathSegments.slice(pathSegments.indexOf(rootRelativeSegment));
    rootRelativeSegments[0] = rootRelativeSegments[0].replace(/^\/+/, "");
    return resolve(projectRoot, ...rootRelativeSegments);
  }
  return pathMethodName === "join"
    ? join(baseDirectory, ...pathSegments)
    : resolve(baseDirectory, ...pathSegments);
};

const expressionContainsIdentifier = (expression: ts.Node, identifierName: string): boolean => {
  let containsIdentifier = false;
  const visitNode = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === identifierName) {
      containsIdentifier = true;
      return;
    }
    if (!containsIdentifier) ts.forEachChild(node, visitNode);
  };
  visitNode(expression);
  return containsIdentifier;
};

const isConditionallyExecuted = (node: ts.Node, boundary: ts.Node): boolean => {
  for (let ancestor = node.parent; ancestor && ancestor !== boundary; ancestor = ancestor.parent) {
    if (
      ts.isIfStatement(ancestor) ||
      ts.isConditionalExpression(ancestor) ||
      ts.isSwitchStatement(ancestor)
    ) {
      return true;
    }
  }
  return false;
};

const analyzeDirectoryConsumer = (
  body: ts.ConciseBody,
  helperName: string,
  parameterName: string,
): DirectoryConsumption => {
  const directoryEntryCollectionNames = new Set<string>();
  let unconditionallyConsumesEntries = false;
  let recursivelyTraverses = false;

  const isDirectoryRead = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    getPropertyName(node.expression) === "readdirSync" &&
    node.arguments[0] !== undefined &&
    ts.isIdentifier(unwrapExpression(node.arguments[0])) &&
    unwrapExpression(node.arguments[0]).getText() === parameterName;

  const visitNode = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isDirectoryRead(unwrapExpression(node.initializer))
    ) {
      directoryEntryCollectionNames.add(node.name.text);
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const collectionExpression = unwrapExpression(node.expression);
      const iteratesDirectoryEntries =
        isDirectoryRead(collectionExpression) ||
        (ts.isIdentifier(collectionExpression) &&
          directoryEntryCollectionNames.has(collectionExpression.text));
      if (iteratesDirectoryEntries) {
        const loopVariable = node.initializer.declarations[0]?.name;
        if (loopVariable && ts.isIdentifier(loopVariable)) {
          const entryDependentNames = new Set([loopVariable.text]);
          const visitLoop = (loopNode: ts.Node): void => {
            if (
              ts.isVariableDeclaration(loopNode) &&
              ts.isIdentifier(loopNode.name) &&
              loopNode.initializer &&
              [...entryDependentNames].some((identifierName) =>
                expressionContainsIdentifier(loopNode.initializer!, identifierName),
              )
            ) {
              entryDependentNames.add(loopNode.name.text);
            }
            if (ts.isCallExpression(loopNode)) {
              const operationName = getPropertyName(loopNode.expression);
              if (
                operationName?.match(/^(?:copyFile|readFile)(?:Sync)?$/) &&
                loopNode.arguments.some((argument) =>
                  [...entryDependentNames].some((identifierName) =>
                    expressionContainsIdentifier(argument, identifierName),
                  ),
                )
              ) {
                if (!isConditionallyExecuted(loopNode, node.statement)) {
                  unconditionallyConsumesEntries = true;
                }
              }
              const calledExpression = unwrapExpression(loopNode.expression);
              if (
                ts.isIdentifier(calledExpression) &&
                calledExpression.text === helperName &&
                loopNode.arguments.some((argument) =>
                  [...entryDependentNames].some((identifierName) =>
                    expressionContainsIdentifier(argument, identifierName),
                  ),
                )
              ) {
                recursivelyTraverses = true;
              }
            }
            ts.forEachChild(loopNode, visitLoop);
          };
          visitLoop(node.statement);
        }
      }
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(body);
  return {
    consumesAllEntries: unconditionallyConsumesEntries || recursivelyTraverses,
    recursivelyTraverses,
  };
};

const collectRecursiveInputDirectories = (
  analysis: ScriptAnalysis,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const node of analysis.liveNodes) {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(unwrapExpression(node.expression))) continue;
    const helperName = unwrapExpression(node.expression).getText();
    const helperBody = analysis.localFunctions.get(helperName);
    const helperDeclaration = [...analysis.sourceFile.statements].find(
      (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === helperName,
    );
    if (
      !helperBody ||
      !helperDeclaration ||
      !ts.isFunctionDeclaration(helperDeclaration) ||
      !helperDeclaration.parameters[0] ||
      !ts.isIdentifier(helperDeclaration.parameters[0].name)
    ) {
      continue;
    }
    const directoryConsumption = analyzeDirectoryConsumer(
      helperBody,
      helperName,
      helperDeclaration.parameters[0].name.text,
    );
    if (!directoryConsumption.consumesAllEntries) continue;
    const directoryArgument = node.arguments[0];
    if (!directoryArgument) continue;
    const directoryPath = evaluatePathExpression(directoryArgument, analysis, projectRoot);
    if (directoryPath) {
      collectDirectorySourceFiles(
        directoryPath,
        projectRoot,
        consumedFiles,
        directoryConsumption.recursivelyTraverses,
      );
    }
  }
};

const evaluateCopySourceExpression = (
  expression: ts.Expression,
  loopVariableName: string,
  loopVariableValue: string,
): string | undefined => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) {
    return unwrappedExpression.text === loopVariableName ? loopVariableValue : undefined;
  }
  if (ts.isStringLiteralLike(unwrappedExpression)) return unwrappedExpression.text;
  if (ts.isTemplateExpression(unwrappedExpression)) {
    let resolvedTemplate = unwrappedExpression.head.text;
    for (const templateSpan of unwrappedExpression.templateSpans) {
      const resolvedExpression = evaluateCopySourceExpression(
        templateSpan.expression,
        loopVariableName,
        loopVariableValue,
      );
      if (resolvedExpression === undefined) return undefined;
      resolvedTemplate += `${resolvedExpression}${templateSpan.literal.text}`;
    }
    return resolvedTemplate;
  }
  if (
    ts.isBinaryExpression(unwrappedExpression) &&
    unwrappedExpression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const leftValue = evaluateCopySourceExpression(
      unwrappedExpression.left,
      loopVariableName,
      loopVariableValue,
    );
    const rightValue = evaluateCopySourceExpression(
      unwrappedExpression.right,
      loopVariableName,
      loopVariableValue,
    );
    return leftValue === undefined || rightValue === undefined
      ? undefined
      : `${leftValue}${rightValue}`;
  }
  return undefined;
};

const collectCopiedSourceFiles = (
  analysis: ScriptAnalysis,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const node of analysis.liveNodes) {
    if (!ts.isForOfStatement(node) || !analysis.liveNodes.has(node.statement)) continue;
    if (
      !ts.isVariableDeclarationList(node.initializer) ||
      node.initializer.declarations.length !== 1 ||
      !ts.isIdentifier(node.initializer.declarations[0].name) ||
      !ts.isIdentifier(unwrapExpression(node.expression))
    ) {
      continue;
    }
    const loopVariableName = node.initializer.declarations[0].name.text;
    const arrayIdentifier = unwrapExpression(node.expression);
    if (!ts.isIdentifier(arrayIdentifier)) continue;
    const arrayDeclaration = findVariableDeclaration(
      analysis.sourceFile,
      arrayIdentifier.text,
      node.getStart(analysis.sourceFile),
    );
    if (
      !arrayDeclaration?.initializer ||
      !ts.isArrayLiteralExpression(arrayDeclaration.initializer)
    ) {
      continue;
    }
    const values = arrayDeclaration.initializer.elements.flatMap((element) => {
      const unwrappedElement = unwrapExpression(element);
      return ts.isStringLiteralLike(unwrappedElement) ? [unwrappedElement.text] : [];
    });
    const visitLoopBody = (loopNode: ts.Node): void => {
      if (
        ts.isCallExpression(loopNode) &&
        getPropertyName(loopNode.expression)?.match(/^copyFile(?:Sync)?$/) &&
        loopNode.arguments[0]
      ) {
        for (const value of values) {
          const sourceReference = evaluateCopySourceExpression(
            loopNode.arguments[0],
            loopVariableName,
            value,
          );
          if (!sourceReference) continue;
          const sourcePath = resolveBuildReference(
            sourceReference,
            analysis.scriptFile.workingDirectory,
            projectRoot,
          );
          if (
            isPathInsideDirectoryOrEqual(sourcePath, projectRoot) &&
            existsSync(sourcePath) &&
            statSync(sourcePath).isFile() &&
            SOURCE_FILE_EXTENSION_PATTERN.test(sourcePath)
          ) {
            consumedFiles.add(sourcePath);
          }
        }
      }
      ts.forEachChild(loopNode, visitLoopBody);
    };
    visitLoopBody(node.statement);
  }
};

const expressionContainsString = (expression: ts.Expression, value: string): boolean => {
  let containsString = false;
  const visitNode = (node: ts.Node): void => {
    if (containsString) return;
    if (ts.isStringLiteralLike(node) && node.text === value) {
      containsString = true;
      return;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(expression);
  return containsString;
};

const collectObjectPathReferences = (
  expression: ts.Expression,
  fileReferences: Set<string>,
): void => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrappedExpression)) {
    fileReferences.add(unwrappedExpression.text);
    return;
  }
  if (ts.isArrayLiteralExpression(unwrappedExpression)) {
    for (const element of unwrappedExpression.elements) {
      collectObjectPathReferences(element, fileReferences);
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(unwrappedExpression)) return;
  for (const property of unwrappedExpression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName =
      ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        ? property.name.text
        : undefined;
    if (propertyName === "path") collectObjectPathReferences(property.initializer, fileReferences);
  }
};

interface StyleRegistryFanoutSources {
  registryAnalysis: ScriptAnalysis;
  stylesAnalysis: ScriptAnalysis;
}

const findStyleRegistryFanoutSources = (
  analysis: ScriptAnalysis,
  analyses: ReadonlyMap<string, ScriptAnalysis>,
): StyleRegistryFanoutSources | undefined => {
  for (const node of analysis.liveNodes) {
    if (
      !ts.isForOfStatement(node) ||
      !ts.isVariableDeclarationList(node.initializer) ||
      node.initializer.declarations.length !== 1 ||
      !ts.isIdentifier(node.initializer.declarations[0].name) ||
      !ts.isIdentifier(unwrapExpression(node.expression))
    ) {
      continue;
    }
    const styleVariableName = node.initializer.declarations[0].name.text;
    const styleCollectionExpression = unwrapExpression(node.expression);
    if (!ts.isIdentifier(styleCollectionExpression)) continue;
    const stylesImport = analysis.importedFunctions.get(styleCollectionExpression.text);
    const stylesAnalysis = stylesImport ? analyses.get(stylesImport.analysisKey) : undefined;
    if (!stylesAnalysis) continue;

    let registryAnalysis: ScriptAnalysis | undefined;
    const visitStyleLoop = (loopNode: ts.Node): void => {
      if (registryAnalysis || !ts.isForOfStatement(loopNode)) {
        if (!registryAnalysis) ts.forEachChild(loopNode, visitStyleLoop);
        return;
      }
      if (
        !ts.isVariableDeclarationList(loopNode.initializer) ||
        loopNode.initializer.declarations.length !== 1 ||
        !ts.isIdentifier(loopNode.initializer.declarations[0].name) ||
        !ts.isIdentifier(unwrapExpression(loopNode.expression))
      ) {
        ts.forEachChild(loopNode, visitStyleLoop);
        return;
      }
      const registryItemName = loopNode.initializer.declarations[0].name.text;
      const registryCollectionExpression = unwrapExpression(loopNode.expression);
      if (!ts.isIdentifier(registryCollectionExpression)) return;
      const loopBodyText = loopNode.statement.getText(analysis.sourceFile);
      const normalizedLoopBodyText = loopBodyText.replace(/\s/g, "");
      if (
        !normalizedLoopBodyText.includes(`src/registry/\${${styleVariableName}.name}/`) ||
        !normalizedLoopBodyText.includes(`${registryItemName}.files`) ||
        !/\$\{[A-Za-z_$][\w$]*\.path\}/.test(normalizedLoopBodyText)
      ) {
        ts.forEachChild(loopNode, visitStyleLoop);
        return;
      }
      const registryImport = analysis.importedFunctions.get(registryCollectionExpression.text);
      registryAnalysis = registryImport ? analyses.get(registryImport.analysisKey) : undefined;
    };
    visitStyleLoop(node.statement);
    if (registryAnalysis) return { registryAnalysis, stylesAnalysis };
  }
  return undefined;
};

const collectRegistryFileReferences = (
  registryAnalysis: ScriptAnalysis,
  analyses: ReadonlyMap<string, ScriptAnalysis>,
): Set<string> => {
  const registryFileReferences = new Set<string>();
  const collectRegistryModule = (moduleAnalysis: ScriptAnalysis): void => {
    const visitNode = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const propertyName =
          ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
            ? node.name.text
            : undefined;
        if (propertyName === "files") {
          collectObjectPathReferences(node.initializer, registryFileReferences);
        }
      }
      ts.forEachChild(node, visitNode);
    };
    visitNode(moduleAnalysis.sourceFile);
  };
  collectRegistryModule(registryAnalysis);
  for (const importedFunction of registryAnalysis.importedFunctions.values()) {
    const importedAnalysis = analyses.get(importedFunction.analysisKey);
    if (importedAnalysis) collectRegistryModule(importedAnalysis);
  }
  return registryFileReferences;
};

const collectRegistryStyleNames = (stylesAnalysis: ScriptAnalysis): Set<string> => {
  const styleNames = new Set<string>();
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === "name"
    ) {
      const styleNameExpression = unwrapExpression(node.initializer);
      if (ts.isStringLiteralLike(styleNameExpression)) styleNames.add(styleNameExpression.text);
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(stylesAnalysis.sourceFile);
  return styleNames;
};

const collectResolvedRegistryFiles = (
  registryFileReferences: ReadonlySet<string>,
  styleNames: ReadonlySet<string>,
  registryRoot: string,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const styleName of styleNames) {
    for (const registryFileReference of registryFileReferences) {
      const registryFilePath = resolve(registryRoot, styleName, registryFileReference);
      if (
        isPathInsideDirectoryOrEqual(registryFilePath, projectRoot) &&
        existsSync(registryFilePath) &&
        statSync(registryFilePath).isFile()
      ) {
        consumedFiles.add(registryFilePath);
      }
    }
  }
};

const collectRegistryMetadataConsumedFiles = (
  analyses: ReadonlyMap<string, ScriptAnalysis>,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const analysis of analyses.values()) {
    if (!basename(analysis.scriptFile.filePath).includes("registry")) continue;
    const hasDynamicRead = [...analysis.liveNodes].some(
      (node) =>
        ts.isCallExpression(node) &&
        getPropertyName(node.expression)?.match(/^readFile(?:Sync)?$/) &&
        node.arguments[0] !== undefined &&
        expressionContainsString(node.arguments[0], "src/registry"),
    );
    if (!hasDynamicRead) continue;
    const registryImport = analysis.importedFunctions.get("registry");
    const stylesImport = analysis.importedFunctions.get("styles");
    const registryAnalysis = registryImport ? analyses.get(registryImport.analysisKey) : undefined;
    const stylesAnalysis = stylesImport ? analyses.get(stylesImport.analysisKey) : undefined;
    if (!registryAnalysis || !stylesAnalysis) continue;

    collectResolvedRegistryFiles(
      collectRegistryFileReferences(registryAnalysis, analyses),
      collectRegistryStyleNames(stylesAnalysis),
      resolve(analysis.scriptFile.workingDirectory, "src/registry"),
      projectRoot,
      consumedFiles,
    );
  }

  for (const analysis of analyses.values()) {
    const fanoutSources = findStyleRegistryFanoutSources(analysis, analyses);
    if (!fanoutSources) continue;
    collectResolvedRegistryFiles(
      collectRegistryFileReferences(fanoutSources.registryAnalysis, analyses),
      collectRegistryStyleNames(fanoutSources.stylesAnalysis),
      resolve(analysis.scriptFile.workingDirectory, "src/registry"),
      projectRoot,
      consumedFiles,
    );
  }
};

const nodeContainsNode = (rootNode: ts.Node, targetNode: ts.Node): boolean => {
  let containsNode = false;
  const visitNode = (node: ts.Node): void => {
    if (node === targetNode) {
      containsNode = true;
      return;
    }
    if (!containsNode) ts.forEachChild(node, visitNode);
  };
  visitNode(rootNode);
  return containsNode;
};

const findAssignedVariableName = (
  analysis: ScriptAnalysis,
  targetNode: ts.Node,
): string | undefined => {
  let variableName: string | undefined;
  let smallestInitializerWidth = Number.POSITIVE_INFINITY;
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      nodeContainsNode(node.initializer, targetNode) &&
      node.initializer.end - node.initializer.pos < smallestInitializerWidth
    ) {
      variableName = node.name.text;
      smallestInitializerWidth = node.initializer.end - node.initializer.pos;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(analysis.sourceFile);
  return variableName;
};

const recursivelyReadsManifestWildcards = (
  analysis: ScriptAnalysis,
  readCall: ts.CallExpression,
): boolean => {
  const registryVariableName = findAssignedVariableName(analysis, readCall);
  if (!registryVariableName) return false;
  const hasDirectRecursiveRead = [...analysis.liveNodes].some(
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      unwrapExpression(node.expression).getText() === "walk" &&
      node.arguments.length >= 1 &&
      ts.isIdentifier(unwrapExpression(node.arguments[0])) &&
      unwrapExpression(node.arguments[0]).getText() === "sourceBase",
  );
  const sourceBaseDeclaration = findVariableDeclaration(
    analysis.sourceFile,
    "sourceBase",
    analysis.sourceFile.end,
  );
  if (
    hasDirectRecursiveRead &&
    sourceBaseDeclaration?.initializer &&
    sourceBaseDeclaration.initializer.getText(analysis.sourceFile).includes(registryVariableName) &&
    sourceBaseDeclaration.initializer.getText(analysis.sourceFile).includes("split")
  ) {
    return true;
  }
  const collectionNames = new Set([registryVariableName]);
  for (const node of analysis.liveNodes) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(unwrapExpression(node.initializer))
    ) {
      const propertyAccess = unwrapExpression(node.initializer);
      if (
        ts.isPropertyAccessExpression(propertyAccess) &&
        ts.isIdentifier(propertyAccess.expression) &&
        collectionNames.has(propertyAccess.expression.text)
      ) {
        collectionNames.add(node.name.text);
      }
    }
  }
  for (const node of analysis.liveNodes) {
    if (
      !ts.isForOfStatement(node) ||
      !ts.isVariableDeclarationList(node.initializer) ||
      node.initializer.declarations.length !== 1 ||
      !ts.isIdentifier(node.initializer.declarations[0].name) ||
      !ts.isIdentifier(unwrapExpression(node.expression))
    ) {
      continue;
    }
    const collectionExpression = unwrapExpression(node.expression);
    if (!ts.isIdentifier(collectionExpression) || !collectionNames.has(collectionExpression.text)) {
      continue;
    }
    const componentName = node.initializer.declarations[0].name.text;
    let hasRecursiveFileLoop = false;
    const visitOuterLoop = (outerNode: ts.Node): void => {
      if (
        ts.isForOfStatement(outerNode) &&
        ts.isPropertyAccessExpression(unwrapExpression(outerNode.expression))
      ) {
        const filesExpression = unwrapExpression(outerNode.expression);
        if (
          ts.isPropertyAccessExpression(filesExpression) &&
          ts.isIdentifier(filesExpression.expression) &&
          filesExpression.expression.text === componentName &&
          filesExpression.name.text === "files"
        ) {
          const innerLoopText = outerNode.statement.getText(analysis.sourceFile);
          if (
            /\.includes\(\s*["']\*["']\s*\)/.test(innerLoopText) &&
            /\.split\(\s*["']\*["']\s*\)/.test(innerLoopText) &&
            /\bwalk\s*\(\s*sourceBase\s*,\s*sourceBase\s*\)/.test(innerLoopText)
          ) {
            hasRecursiveFileLoop = true;
          }
        }
      }
      if (!hasRecursiveFileLoop) ts.forEachChild(outerNode, visitOuterLoop);
    };
    visitOuterLoop(node.statement);
    if (hasRecursiveFileLoop) return true;
  }
  return false;
};

const collectReferencedManifestFiles = (
  analysis: ScriptAnalysis,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const node of analysis.liveNodes) {
    if (
      !ts.isCallExpression(node) ||
      !getPropertyName(node.expression)?.match(/^readFile(?:Sync)?$/) ||
      !node.arguments[0]
    ) {
      continue;
    }
    const manifestPath = evaluatePathExpression(node.arguments[0], analysis, projectRoot);
    if (!manifestPath || basename(manifestPath) !== "registry.json") continue;
    if (!isPathInsideDirectoryOrEqual(manifestPath, projectRoot)) continue;
    if (!existsSync(manifestPath)) continue;
    for (const filePath of expandManifestPaths(
      manifestPath,
      projectRoot,
      recursivelyReadsManifestWildcards(analysis, node),
    )) {
      consumedFiles.add(filePath);
    }
  }
};

const collectShadcnRegistryFiles = (
  packageJsonPaths: ReadonlyArray<string>,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = readJson(packageJsonPath);
    if (typeof packageJson !== "object" || packageJson === null) continue;
    const scripts = Object.entries(packageJson).find(([key]) => key === "scripts")?.[1];
    if (typeof scripts !== "object" || scripts === null) continue;
    const invokesShadcnBuild = Object.values(scripts).some(
      (command) => typeof command === "string" && /\bshadcn(?:@[^\s]+)?\s+build\b/.test(command),
    );
    if (!invokesShadcnBuild) continue;

    const workingDirectory = dirname(packageJsonPath);
    const manifestPath = resolve(workingDirectory, "registry.json");
    if (!existsSync(manifestPath)) continue;
    for (const filePath of expandManifestPaths(manifestPath, projectRoot)) {
      consumedFiles.add(filePath);
    }

    const referencedRegistryNames = new Set<string>();
    for (const documentationPath of fg.sync("**/*.{md,mdx}", {
      cwd: workingDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "public/**"],
      deep: BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH,
    })) {
      const documentationSource = readFileSync(documentationPath, "utf8");
      for (const registryName of extractPreviewRegistryNamesFromMdx(documentationSource)) {
        referencedRegistryNames.add(registryName);
      }
    }

    for (const registryName of referencedRegistryNames) {
      const publishedRegistryPath = resolve(workingDirectory, "public/r", `${registryName}.json`);
      const publishedRegistry = readJson(publishedRegistryPath);
      if (
        typeof publishedRegistry !== "object" ||
        publishedRegistry === null ||
        Object.entries(publishedRegistry).find(([key]) => key === "name")?.[1] !== registryName ||
        !String(Object.entries(publishedRegistry).find(([key]) => key === "type")?.[1]).startsWith(
          "registry:",
        )
      ) {
        continue;
      }
      const publishedFiles = Object.entries(publishedRegistry).find(
        ([key]) => key === "files",
      )?.[1];
      if (!Array.isArray(publishedFiles)) continue;
      for (const publishedFile of publishedFiles) {
        if (typeof publishedFile !== "object" || publishedFile === null) continue;
        const sourcePath = Object.entries(publishedFile).find(([key]) => key === "path")?.[1];
        const sourceContent = Object.entries(publishedFile).find(([key]) => key === "content")?.[1];
        if (typeof sourcePath !== "string" || typeof sourceContent !== "string") continue;
        const absoluteSourcePath = resolve(workingDirectory, sourcePath);
        if (
          isPathInsideDirectoryOrEqual(absoluteSourcePath, projectRoot) &&
          existsSync(absoluteSourcePath) &&
          statSync(absoluteSourcePath).isFile() &&
          SOURCE_FILE_EXTENSION_PATTERN.test(absoluteSourcePath) &&
          areSourceFilesStructurallyEquivalent(
            absoluteSourcePath,
            readFileSync(absoluteSourcePath, "utf8"),
            sourceContent,
          )
        ) {
          consumedFiles.add(absoluteSourcePath);
        }
      }
    }
  }
};

export const extractInvokedBuildScriptPaths = (projectRoot: string): string[] => {
  const packageJsonPaths = collectPackageJsonPaths(projectRoot);
  return expandInvokedScriptFiles(
    extractInvokedScriptFiles(projectRoot, packageJsonPaths),
    projectRoot,
  ).map((scriptFile) => toPosixPath(scriptFile.filePath));
};

export const extractBuildScriptConsumedFiles = (projectRoot: string): string[] => {
  const consumedFiles = new Set<string>();
  const packageJsonPaths = collectPackageJsonPaths(projectRoot);
  const invokedScriptFiles = expandInvokedScriptFiles(
    extractInvokedScriptFiles(projectRoot, packageJsonPaths),
    projectRoot,
  );
  for (const invokedScriptFile of invokedScriptFiles) {
    consumedFiles.add(invokedScriptFile.filePath);
  }
  const scriptAnalyses = buildScriptAnalyses(invokedScriptFiles, projectRoot);

  for (const analysis of scriptAnalyses.values()) {
    collectRecursiveInputDirectories(analysis, projectRoot, consumedFiles);
    collectReferencedManifestFiles(analysis, projectRoot, consumedFiles);
    collectCopiedSourceFiles(analysis, projectRoot, consumedFiles);
  }

  collectRegistryMetadataConsumedFiles(scriptAnalyses, projectRoot, consumedFiles);
  collectShadcnRegistryFiles(packageJsonPaths, projectRoot, consumedFiles);
  return [...consumedFiles].map(toPosixPath);
};
