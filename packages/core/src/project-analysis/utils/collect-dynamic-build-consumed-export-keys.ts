import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { extractScriptFileReferences } from "./extract-script-file-references.js";
import { toPosixPath } from "./to-posix-path.js";
import { buildExportKey } from "./build-export-key.js";
import { findNearestPackageDirectory } from "./find-nearest-package-directory.js";
import { getFileIdentityKey } from "./get-file-identity-key.js";

interface DynamicBuildFileCollection {
  excludedPathSubstrings: ReadonlyArray<string>;
  globPattern: string;
}

interface DynamicBuildImports {
  buildSymbols: ReadonlySet<ts.Symbol>;
  globNamespaceSymbols: ReadonlySet<ts.Symbol>;
  pathNamespaceSymbols: ReadonlySet<ts.Symbol>;
}

interface DynamicBuildInvocation {
  end: number;
  outputEntryName: string;
}

const hasMatchingSymbol = (
  node: ts.Node,
  symbols: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): boolean => {
  const symbol = typeChecker.getSymbolAtLocation(node);
  return symbol !== undefined && symbols.has(symbol);
};

const collectDynamicBuildImports = (
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): DynamicBuildImports => {
  const buildSymbols = new Set<ts.Symbol>();
  const globNamespaceSymbols = new Set<ts.Symbol>();
  const pathNamespaceSymbols = new Set<ts.Symbol>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const namedBindings = statement.importClause.namedBindings;
    if (moduleName === "glob" && namedBindings && ts.isNamespaceImport(namedBindings)) {
      const globNamespaceSymbol = typeChecker.getSymbolAtLocation(namedBindings.name);
      if (globNamespaceSymbol) globNamespaceSymbols.add(globNamespaceSymbol);
    }
    if (moduleName === "path" && namedBindings && ts.isNamespaceImport(namedBindings)) {
      const pathNamespaceSymbol = typeChecker.getSymbolAtLocation(namedBindings.name);
      if (pathNamespaceSymbol) pathNamespaceSymbols.add(pathNamespaceSymbol);
    }
    if (moduleName !== "tsup" || !namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const importSpecifier of namedBindings.elements) {
      if ((importSpecifier.propertyName ?? importSpecifier.name).text === "build") {
        const buildSymbol = typeChecker.getSymbolAtLocation(importSpecifier.name);
        if (buildSymbol) buildSymbols.add(buildSymbol);
      }
    }
  }

  return { buildSymbols, globNamespaceSymbols, pathNamespaceSymbols };
};

const extractGlobPattern = (
  expression: ts.Expression,
  imports: DynamicBuildImports,
  scriptDirectory: string,
  typeChecker: ts.TypeChecker,
): string | undefined => {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "sync" ||
    !ts.isIdentifier(expression.expression.expression) ||
    !hasMatchingSymbol(
      expression.expression.expression,
      imports.globNamespaceSymbols,
      typeChecker,
    ) ||
    expression.arguments.length !== 1
  ) {
    return undefined;
  }
  const patternExpression = expression.arguments[0];
  if (
    !ts.isCallExpression(patternExpression) ||
    !ts.isPropertyAccessExpression(patternExpression.expression) ||
    patternExpression.expression.name.text !== "join" ||
    !ts.isIdentifier(patternExpression.expression.expression) ||
    !hasMatchingSymbol(
      patternExpression.expression.expression,
      imports.pathNamespaceSymbols,
      typeChecker,
    ) ||
    patternExpression.arguments.length !== 2 ||
    !ts.isIdentifier(patternExpression.arguments[0]) ||
    patternExpression.arguments[0].text !== "__dirname" ||
    (!ts.isStringLiteral(patternExpression.arguments[1]) &&
      !ts.isNoSubstitutionTemplateLiteral(patternExpression.arguments[1]))
  ) {
    return undefined;
  }
  const relativeGlobPattern = patternExpression.arguments[1].text;
  if (!relativeGlobPattern.includes("*")) return undefined;
  return toPosixPath(resolve(scriptDirectory, relativeGlobPattern));
};

const extractExcludedPathSubstring = (
  callback: ts.ArrowFunction | ts.FunctionExpression,
): string | undefined => {
  if (callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) {
    return undefined;
  }
  const filePathName = callback.parameters[0].name.text;
  const returnedExpression = ts.isBlock(callback.body)
    ? callback.body.statements.length === 1 && ts.isReturnStatement(callback.body.statements[0])
      ? callback.body.statements[0].expression
      : undefined
    : callback.body;
  if (
    !returnedExpression ||
    !ts.isPrefixUnaryExpression(returnedExpression) ||
    returnedExpression.operator !== ts.SyntaxKind.ExclamationToken ||
    !ts.isCallExpression(returnedExpression.operand) ||
    !ts.isPropertyAccessExpression(returnedExpression.operand.expression) ||
    returnedExpression.operand.expression.name.text !== "includes" ||
    !ts.isIdentifier(returnedExpression.operand.expression.expression) ||
    returnedExpression.operand.expression.expression.text !== filePathName ||
    returnedExpression.operand.arguments.length !== 1 ||
    (!ts.isStringLiteral(returnedExpression.operand.arguments[0]) &&
      !ts.isNoSubstitutionTemplateLiteral(returnedExpression.operand.arguments[0]))
  ) {
    return undefined;
  }
  return toPosixPath(returnedExpression.operand.arguments[0].text);
};

const extractFileCollection = (
  initializer: ts.Expression,
  imports: DynamicBuildImports,
  scriptDirectory: string,
  typeChecker: ts.TypeChecker,
): DynamicBuildFileCollection | undefined => {
  const directGlobPattern = extractGlobPattern(initializer, imports, scriptDirectory, typeChecker);
  if (directGlobPattern) return { excludedPathSubstrings: [], globPattern: directGlobPattern };
  if (
    !ts.isCallExpression(initializer) ||
    !ts.isPropertyAccessExpression(initializer.expression) ||
    initializer.expression.name.text !== "filter" ||
    initializer.arguments.length !== 1 ||
    (!ts.isArrowFunction(initializer.arguments[0]) &&
      !ts.isFunctionExpression(initializer.arguments[0]))
  ) {
    return undefined;
  }
  const globPattern = extractGlobPattern(
    initializer.expression.expression,
    imports,
    scriptDirectory,
    typeChecker,
  );
  const excludedPathSubstring = extractExcludedPathSubstring(initializer.arguments[0]);
  if (!globPattern || excludedPathSubstring === undefined) return undefined;
  return { excludedPathSubstrings: [excludedPathSubstring], globPattern };
};

const isPathNamespaceCall = (
  expression: ts.Expression,
  methodName: string,
  imports: DynamicBuildImports,
  typeChecker: ts.TypeChecker,
): expression is ts.CallExpression =>
  ts.isCallExpression(expression) &&
  ts.isPropertyAccessExpression(expression.expression) &&
  expression.expression.name.text === methodName &&
  ts.isIdentifier(expression.expression.expression) &&
  hasMatchingSymbol(expression.expression.expression, imports.pathNamespaceSymbols, typeChecker);

const hasMatchingOutputEntryPath = (
  callback: ts.ArrowFunction | ts.FunctionExpression,
  filePathName: string,
  outputEntryName: string,
  imports: DynamicBuildImports,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (!ts.isBlock(callback.body)) return false;
  const initializersByName = new Map<string, ts.Expression>();
  for (const statement of callback.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        initializersByName.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  const outputEntryInitializer = initializersByName.get(outputEntryName);
  if (
    !outputEntryInitializer ||
    !isPathNamespaceCall(outputEntryInitializer, "join", imports, typeChecker)
  ) {
    return false;
  }
  const outputFilenameExpression = outputEntryInitializer.arguments.at(-1);
  if (
    !outputFilenameExpression ||
    !ts.isBinaryExpression(outputFilenameExpression) ||
    outputFilenameExpression.operatorToken.kind !== ts.SyntaxKind.PlusToken ||
    !ts.isStringLiteralLike(outputFilenameExpression.right) ||
    outputFilenameExpression.right.text !== ".js" ||
    !isPathNamespaceCall(outputFilenameExpression.left, "basename", imports, typeChecker) ||
    outputFilenameExpression.left.arguments.length !== 2 ||
    !ts.isIdentifier(outputFilenameExpression.left.arguments[0]) ||
    !ts.isStringLiteralLike(outputFilenameExpression.left.arguments[1]) ||
    outputFilenameExpression.left.arguments[1].text !== ".tsx"
  ) {
    return false;
  }
  const basenameSourceName = outputFilenameExpression.left.arguments[0].text;
  if (basenameSourceName === filePathName) return true;
  const basenameSourceInitializer = initializersByName.get(basenameSourceName);
  return Boolean(
    basenameSourceInitializer &&
    isPathNamespaceCall(basenameSourceInitializer, "relative", imports, typeChecker) &&
    basenameSourceInitializer.arguments.length === 2 &&
    ts.isIdentifier(basenameSourceInitializer.arguments[1]) &&
    basenameSourceInitializer.arguments[1].text === filePathName,
  );
};

const findBuildInvocation = (
  callback: ts.ArrowFunction | ts.FunctionExpression,
  filePathName: string,
  imports: DynamicBuildImports,
  typeChecker: ts.TypeChecker,
): DynamicBuildInvocation | undefined => {
  let buildInvocation: DynamicBuildInvocation | undefined;
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isAwaitExpression(node.parent) &&
      ts.isIdentifier(node.expression) &&
      hasMatchingSymbol(node.expression, imports.buildSymbols, typeChecker) &&
      node.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const hasMatchingEntry = node.arguments[0].properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ((ts.isIdentifier(property.name) && property.name.text === "entry") ||
            (ts.isStringLiteral(property.name) && property.name.text === "entry")) &&
          ts.isArrayLiteralExpression(property.initializer) &&
          property.initializer.elements.length === 1 &&
          ts.isIdentifier(property.initializer.elements[0]) &&
          property.initializer.elements[0].text === filePathName,
      );
      const outDirectoryProperty = node.arguments[0].properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ((ts.isIdentifier(property.name) && property.name.text === "outDir") ||
            (ts.isStringLiteral(property.name) && property.name.text === "outDir")),
      );
      const hasCommonJsFormat = node.arguments[0].properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ((ts.isIdentifier(property.name) && property.name.text === "format") ||
            (ts.isStringLiteral(property.name) && property.name.text === "format")) &&
          ts.isStringLiteralLike(property.initializer) &&
          property.initializer.text === "cjs",
      );
      if (
        hasMatchingEntry &&
        hasCommonJsFormat &&
        outDirectoryProperty &&
        ts.isPropertyAssignment(outDirectoryProperty) &&
        ts.isCallExpression(outDirectoryProperty.initializer) &&
        ts.isPropertyAccessExpression(outDirectoryProperty.initializer.expression) &&
        outDirectoryProperty.initializer.expression.name.text === "dirname" &&
        ts.isIdentifier(outDirectoryProperty.initializer.expression.expression) &&
        hasMatchingSymbol(
          outDirectoryProperty.initializer.expression.expression,
          imports.pathNamespaceSymbols,
          typeChecker,
        ) &&
        outDirectoryProperty.initializer.arguments.length === 1 &&
        ts.isIdentifier(outDirectoryProperty.initializer.arguments[0]) &&
        hasMatchingOutputEntryPath(
          callback,
          filePathName,
          outDirectoryProperty.initializer.arguments[0].text,
          imports,
          typeChecker,
        )
      ) {
        buildInvocation = {
          end: node.parent.end,
          outputEntryName: outDirectoryProperty.initializer.arguments[0].text,
        };
      }
    }
    if (!buildInvocation) ts.forEachChild(node, visitNode);
  };
  visitNode(callback.body);
  return buildInvocation;
};

const collectImportedNamespaceExportNames = (
  callback: ts.ArrowFunction | ts.FunctionExpression,
  buildInvocation: DynamicBuildInvocation,
  typeChecker: ts.TypeChecker,
): Set<string> => {
  const importedNamespaceDeclarationEndBySymbol = new Map<ts.Symbol, number>();
  const exportNames = new Set<string>();
  const collectNamespaceNames = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isAwaitExpression(node.initializer) &&
      node.initializer.pos >= buildInvocation.end &&
      ts.isCallExpression(node.initializer.expression) &&
      node.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.initializer.expression.arguments.length === 1 &&
      ts.isIdentifier(node.initializer.expression.arguments[0]) &&
      node.initializer.expression.arguments[0].text === buildInvocation.outputEntryName
    ) {
      const namespaceSymbol = typeChecker.getSymbolAtLocation(node.name);
      if (namespaceSymbol) importedNamespaceDeclarationEndBySymbol.set(namespaceSymbol, node.end);
    }
    ts.forEachChild(node, collectNamespaceNames);
  };
  collectNamespaceNames(callback.body);
  const collectExportNames = (node: ts.Node): void => {
    const namespaceSymbol =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression)
        ? typeChecker.getSymbolAtLocation(node.expression)
        : undefined;
    const namespaceDeclarationEnd = namespaceSymbol
      ? importedNamespaceDeclarationEndBySymbol.get(namespaceSymbol)
      : undefined;
    if (
      ts.isPropertyAccessExpression(node) &&
      namespaceDeclarationEnd !== undefined &&
      node.pos >= namespaceDeclarationEnd
    ) {
      exportNames.add(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      namespaceDeclarationEnd !== undefined &&
      node.pos >= namespaceDeclarationEnd &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      exportNames.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, collectExportNames);
  };
  collectExportNames(callback.body);
  return exportNames;
};

const collectScriptConsumedExportKeys = (
  scriptPath: string,
  packageDirectory: string,
): Set<string> => {
  let source: string;
  try {
    source = readFileSync(scriptPath, "utf8");
  } catch {
    return new Set();
  }
  const compilerOptions: ts.CompilerOptions = { noLib: true, noResolve: true };
  const sourceFile = ts.createSourceFile(scriptPath, source, ts.ScriptTarget.Latest, true);
  const compilerHost = ts.createCompilerHost(compilerOptions);
  const scriptIdentity = getFileIdentityKey(scriptPath);
  const isScriptPath = (candidatePath: string): boolean =>
    getFileIdentityKey(candidatePath) === scriptIdentity;
  compilerHost.fileExists = isScriptPath;
  compilerHost.getSourceFile = (candidatePath) =>
    isScriptPath(candidatePath) ? sourceFile : undefined;
  compilerHost.readFile = (candidatePath) => (isScriptPath(candidatePath) ? source : undefined);
  const program = ts.createProgram({
    rootNames: [scriptPath],
    options: compilerOptions,
    host: compilerHost,
  });
  const boundSourceFile = program.getSourceFile(scriptPath);
  if (!boundSourceFile) return new Set();
  const typeChecker = program.getTypeChecker();
  const imports = collectDynamicBuildImports(boundSourceFile, typeChecker);
  if (
    imports.buildSymbols.size === 0 ||
    imports.globNamespaceSymbols.size === 0 ||
    imports.pathNamespaceSymbols.size === 0
  ) {
    return new Set();
  }
  const collectionsBySymbol = new Map<ts.Symbol, DynamicBuildFileCollection>();
  const visitCollection = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const collection = extractFileCollection(
        node.initializer,
        imports,
        dirname(scriptPath),
        typeChecker,
      );
      const collectionSymbol = typeChecker.getSymbolAtLocation(node.name);
      if (collection && collectionSymbol) collectionsBySymbol.set(collectionSymbol, collection);
    }
    ts.forEachChild(node, visitCollection);
  };
  visitCollection(boundSourceFile);

  const consumedExportKeys = new Set<string>();
  const packageManifestIdentity = getFileIdentityKey(resolve(packageDirectory, "package.json"));
  const visitMapCall = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map" &&
      ts.isIdentifier(node.expression.expression) &&
      node.arguments.length === 1 &&
      (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))
    ) {
      const collectionSymbol = typeChecker.getSymbolAtLocation(node.expression.expression);
      const collection = collectionSymbol ? collectionsBySymbol.get(collectionSymbol) : undefined;
      const callback = node.arguments[0];
      if (
        collection &&
        callback.parameters.length === 1 &&
        ts.isIdentifier(callback.parameters[0].name)
      ) {
        const buildInvocation = findBuildInvocation(
          callback,
          callback.parameters[0].name.text,
          imports,
          typeChecker,
        );
        if (!buildInvocation) return;
        const exportNames = collectImportedNamespaceExportNames(
          callback,
          buildInvocation,
          typeChecker,
        );
        if (exportNames.size > 0) {
          const matchedFilePaths = fg.sync(collection.globPattern, {
            absolute: true,
            onlyFiles: true,
          });
          for (const matchedFilePath of matchedFilePaths) {
            const resolvedFilePath = resolve(matchedFilePath);
            const normalizedFilePath = toPosixPath(resolvedFilePath);
            const owningPackageDirectory = findNearestPackageDirectory(resolvedFilePath);
            if (
              owningPackageDirectory === undefined ||
              getFileIdentityKey(resolve(owningPackageDirectory, "package.json")) !==
                packageManifestIdentity ||
              collection.excludedPathSubstrings.some((excludedPathSubstring) =>
                normalizedFilePath.includes(excludedPathSubstring),
              )
            ) {
              continue;
            }
            for (const exportName of exportNames) {
              consumedExportKeys.add(
                buildExportKey(getFileIdentityKey(resolvedFilePath), exportName),
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, visitMapCall);
  };
  visitMapCall(boundSourceFile);
  return consumedExportKeys;
};

export const collectDynamicBuildConsumedExportKeys = (
  packageDirectory: string,
  scripts: ReadonlyArray<string>,
): Set<string> => {
  const consumedExportKeys = new Set<string>();
  const packageManifestIdentity = getFileIdentityKey(resolve(packageDirectory, "package.json"));
  for (const script of scripts) {
    for (const scriptFileReference of extractScriptFileReferences(script)) {
      const scriptPath = resolve(packageDirectory, scriptFileReference);
      const scriptPackageDirectory = findNearestPackageDirectory(scriptPath);
      if (
        !existsSync(scriptPath) ||
        scriptPackageDirectory === undefined ||
        getFileIdentityKey(resolve(scriptPackageDirectory, "package.json")) !==
          packageManifestIdentity
      ) {
        continue;
      }
      for (const consumedExportKey of collectScriptConsumedExportKeys(
        scriptPath,
        packageDirectory,
      )) {
        consumedExportKeys.add(consumedExportKey);
      }
    }
  }
  return consumedExportKeys;
};
