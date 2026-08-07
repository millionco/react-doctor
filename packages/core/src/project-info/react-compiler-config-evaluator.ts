import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { ResolverFactory } from "oxc-resolver";
import ts from "typescript";
import { REACT_COMPILER_CONFIG_IMPORT_MAX_DEPTH } from "../constants.js";
import type { PackageJson } from "../types/index.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { unwrapTypescriptExpression } from "../utils/unwrap-typescript-expression.js";
import { isFile, isPlainObject } from "./fs-utils.js";
import { isLocalModuleSpecifier } from "./is-local-module-specifier.js";
import { NEXT_CONFIG_FILENAMES } from "./detect-nextjs-static-export.js";
import { readPackageJson } from "./package-json.js";

const BABEL_CONFIG_FILENAMES = [
  ".babelrc",
  ".babelrc.js",
  ".babelrc.json",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.cts",
  "babel.config.js",
  "babel.config.json",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.cts",
];

const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
  "vitest.config.ts",
  "vitest.config.js",
];

const RSBUILD_CONFIG_FILENAMES = [
  "rsbuild.config.ts",
  "rsbuild.config.js",
  "rsbuild.config.mts",
  "rsbuild.config.mjs",
  "rsbuild.config.cts",
  "rsbuild.config.cjs",
];

const RSPACK_CONFIG_FILENAMES = [
  "rspack.config.ts",
  "rspack.config.js",
  "rspack.config.mts",
  "rspack.config.mjs",
  "rspack.config.cts",
  "rspack.config.cjs",
];

const EXPO_APP_CONFIG_FILENAMES = ["app.json", "app.config.js", "app.config.ts"];

const REACT_COMPILER_CONFIG_FILENAMES = [
  ...NEXT_CONFIG_FILENAMES,
  ...BABEL_CONFIG_FILENAMES,
  ...VITE_CONFIG_FILENAMES,
  ...RSBUILD_CONFIG_FILENAMES,
  ...RSPACK_CONFIG_FILENAMES,
  ...EXPO_APP_CONFIG_FILENAMES,
];

const REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".json",
];

const REACT_COMPILER_CONFIG_RESOLVER = new ResolverFactory({
  conditionNames: ["import", "require", "node", "default"],
  extensions: REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS,
});

const resolveImportedConfigFile = (
  fromFilePath: string,
  moduleSpecifier: string,
): string | null => {
  if (!isLocalModuleSpecifier(moduleSpecifier)) {
    try {
      const resolvedPath = REACT_COMPILER_CONFIG_RESOLVER.resolveFileSync(
        fromFilePath,
        moduleSpecifier,
      ).path;
      if (resolvedPath && isFile(resolvedPath)) return resolvedPath;
    } catch {}
    try {
      const resolvedPath = createRequire(fromFilePath).resolve(moduleSpecifier);
      return isFile(resolvedPath) ? resolvedPath : null;
    } catch {
      return null;
    }
  }

  const unresolvedPath = path.resolve(path.dirname(fromFilePath), moduleSpecifier);
  const extension = path.extname(unresolvedPath);
  const candidatePaths = extension
    ? [
        unresolvedPath,
        ...REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS.map(
          (sourceExtension) => `${unresolvedPath.slice(0, -extension.length)}${sourceExtension}`,
        ),
      ]
    : [
        unresolvedPath,
        ...REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS.map(
          (sourceExtension) => `${unresolvedPath}${sourceExtension}`,
        ),
        ...REACT_COMPILER_CONFIG_SOURCE_EXTENSIONS.map((sourceExtension) =>
          path.join(unresolvedPath, `index${sourceExtension}`),
        ),
      ];
  return candidatePaths.find(isFile) ?? null;
};

const parseConfigSourceFile = (filePath: string, content: string): ts.SourceFile =>
  filePath.endsWith(".json") || path.basename(filePath) === ".babelrc"
    ? ts.parseJsonText(filePath, content)
    : ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

const getStaticPropertyName = (propertyName: ts.PropertyName): string | null =>
  ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)
    ? propertyName.text
    : ts.isComputedPropertyName(propertyName) && ts.isStringLiteralLike(propertyName.expression)
      ? propertyName.expression.text
      : null;

const getAccessedPropertyName = (
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null =>
  ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)
      ? expression.argumentExpression.text
      : null;

const isCommonJsConfigExportAssignment = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  (node.left.getText(sourceFile) === "module.exports" ||
    node.left.getText(sourceFile) === "exports.default");

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

const getRequireModuleSpecifier = (expression: ts.Expression): string | null => {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "require" ||
    expression.arguments.length !== 1
  ) {
    return null;
  }
  const moduleSpecifier = expression.arguments[0];
  return moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier) ? moduleSpecifier.text : null;
};
interface ConfigImportBinding {
  readonly moduleSpecifier: string;
  readonly exportName: string;
  readonly isNamespace: boolean;
}

interface ConfigExpressionReference {
  readonly expression: ts.Expression | null;
  readonly analysis: ConfigExpressionAnalysis;
}

interface ConfigPropertyReference {
  readonly node: ts.Expression | ts.MethodDeclaration;
  readonly analysis: ConfigExpressionAnalysis;
}

interface ConfigExpressionAnalysis {
  readonly filePath: string;
  readonly sourceFile: ts.SourceFile;
  readonly importDepth: number;
  readonly visitedModules: ReadonlySet<string>;
  readonly visitedNodes: Set<string>;
  readonly localBindings: ReadonlyMap<string, ConfigExpressionReference>;
  readonly activeFunctions: ReadonlySet<number>;
}

interface AnalyzeImportedConfigOptions {
  readonly analysis: ConfigExpressionAnalysis;
  readonly moduleSpecifier: string;
  readonly exportName: string;
  readonly allowCompilerTransform: boolean;
  readonly argumentsList?: readonly ts.Expression[];
}

interface ScopedConfigBinding {
  readonly wasFound: boolean;
  readonly initializer: ts.Expression | null;
}

interface CommonJsConfigExportMatch {
  readonly node: ts.Node;
  readonly strategy: "source-order" | "append-mutation" | "replace-mutation";
}

const bindingNameContainsIdentifier = (
  bindingName: ts.BindingName,
  identifierName: string,
): boolean =>
  ts.isIdentifier(bindingName)
    ? bindingName.text === identifierName
    : bindingName.elements.some(
        (element) =>
          !ts.isOmittedExpression(element) &&
          bindingNameContainsIdentifier(element.name, identifierName),
      );

const hasTopLevelValueBinding = (sourceFile: ts.SourceFile, bindingName: string): boolean =>
  sourceFile.statements.some((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const importClause = statement.importClause;
      if (importClause?.name?.text === bindingName) return true;
      const namedBindings = importClause?.namedBindings;
      return namedBindings
        ? ts.isNamespaceImport(namedBindings)
          ? namedBindings.name.text === bindingName
          : namedBindings.elements.some((element) => element.name.text === bindingName)
        : false;
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((declaration) =>
        bindingNameContainsIdentifier(declaration.name, bindingName),
      );
    }
    return (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === bindingName
    );
  });

const getImportBinding = (
  sourceFile: ts.SourceFile,
  bindingName: string,
): ConfigImportBinding | null => {
  const hasShadowedRequire = hasTopLevelValueBinding(sourceFile, "require");
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      if (statement.importClause.name?.text === bindingName) {
        return {
          moduleSpecifier: statement.moduleSpecifier.text,
          exportName: "default",
          isNamespace: false,
        };
      }
      const { namedBindings } = statement.importClause;
      if (
        namedBindings &&
        ts.isNamespaceImport(namedBindings) &&
        namedBindings.name.text === bindingName
      ) {
        return {
          moduleSpecifier: statement.moduleSpecifier.text,
          exportName: "*",
          isNamespace: true,
        };
      }
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        const importSpecifier = namedBindings.elements.find(
          (element) => !element.isTypeOnly && element.name.text === bindingName,
        );
        if (importSpecifier) {
          return {
            moduleSpecifier: statement.moduleSpecifier.text,
            exportName: (importSpecifier.propertyName ?? importSpecifier.name).text,
            isNamespace: false,
          };
        }
      }
    }

    if (!ts.isVariableStatement(statement) || hasShadowedRequire) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      if (ts.isIdentifier(declaration.name) && declaration.name.text === bindingName) {
        const directModuleSpecifier = getRequireModuleSpecifier(declaration.initializer);
        if (directModuleSpecifier) {
          return {
            moduleSpecifier: directModuleSpecifier,
            exportName: "default",
            isNamespace: true,
          };
        }
        if (
          ts.isPropertyAccessExpression(declaration.initializer) &&
          getRequireModuleSpecifier(declaration.initializer.expression) !== null
        ) {
          return {
            moduleSpecifier: getRequireModuleSpecifier(declaration.initializer.expression) ?? "",
            exportName: declaration.initializer.name.text,
            isNamespace: false,
          };
        }
      }
      if (!ts.isObjectBindingPattern(declaration.name)) continue;
      const bindingElement = declaration.name.elements.find(
        (element) => ts.isIdentifier(element.name) && element.name.text === bindingName,
      );
      const moduleSpecifier = getRequireModuleSpecifier(declaration.initializer);
      if (bindingElement && moduleSpecifier) {
        return {
          moduleSpecifier,
          exportName: bindingElement.propertyName
            ? (getStaticPropertyName(bindingElement.propertyName) ??
              bindingElement.propertyName.getText(sourceFile))
            : bindingElement.name.getText(sourceFile),
          isNamespace: false,
        };
      }
    }
  }
  return null;
};

const getTopLevelBinding = (
  sourceFile: ts.SourceFile,
  bindingName: string,
): ts.Expression | ts.FunctionDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === bindingName,
      );
      if (declaration?.initializer) return declaration.initializer;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === bindingName)
      return statement;
  }
  return null;
};

const getFunctionLocalBindings = (
  functionNode: ts.FunctionLikeDeclaration,
  argumentsList: readonly ts.Expression[],
  argumentAnalysis: ConfigExpressionAnalysis,
  functionAnalysis: ConfigExpressionAnalysis,
): Map<string, ConfigExpressionReference> => {
  const localBindings = new Map<string, ConfigExpressionReference>();
  functionNode.parameters.forEach((parameter, parameterIndex) => {
    if (ts.isIdentifier(parameter.name)) {
      const argument = argumentsList[parameterIndex];
      localBindings.set(parameter.name.text, {
        expression: argument ?? parameter.initializer ?? null,
        analysis: argument ? argumentAnalysis : functionAnalysis,
      });
    }
  });
  return localBindings;
};

const getScopedConfigBinding = (identifier: ts.Identifier): ScopedConfigBinding => {
  let childNode: ts.Node = identifier;
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode && !ts.isSourceFile(currentNode)) {
    if (ts.isBlock(currentNode)) {
      for (const statement of currentNode.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (bindingNameContainsIdentifier(declaration.name, identifier.text)) {
              return {
                wasFound: true,
                initializer:
                  statement.pos < childNode.pos && ts.isIdentifier(declaration.name)
                    ? (declaration.initializer ?? null)
                    : null,
              };
            }
          }
        }
        if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name?.text === identifier.text
        ) {
          return { wasFound: true, initializer: null };
        }
      }
    }
    if (
      ts.isCatchClause(currentNode) &&
      currentNode.variableDeclaration &&
      bindingNameContainsIdentifier(currentNode.variableDeclaration.name, identifier.text)
    ) {
      return {
        wasFound: true,
        initializer: ts.isIdentifier(currentNode.variableDeclaration.name)
          ? (currentNode.variableDeclaration.initializer ?? null)
          : null,
      };
    }
    childNode = currentNode;
    currentNode = currentNode.parent;
  }
  return { wasFound: false, initializer: null };
};

const isCompilerTransformModule = (moduleSpecifier: string, exportName: string): boolean =>
  (moduleSpecifier === "babel-plugin-react-compiler" && exportName === "default") ||
  (moduleSpecifier === "@vitejs/plugin-react" && exportName === "reactCompilerPreset");

const NODE_MODULE_SPECIFIERS = new Set(["module", "node:module"]);

const isConstantVariableInitializer = (node: ts.Node): node is ts.Expression =>
  ts.isExpression(node) &&
  ts.isVariableDeclaration(node.parent) &&
  ts.isVariableDeclarationList(node.parent.parent) &&
  Boolean(node.parent.parent.flags & ts.NodeFlags.Const);

type TransparentConfigExpression =
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.TypeAssertion
  | ts.SatisfiesExpression
  | ts.NonNullExpression
  | ts.AwaitExpression;

const isTransparentConfigExpression = (node: ts.Node): node is TransparentConfigExpression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isTypeAssertionExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isAwaitExpression(node);

const isNodeCreateRequireCall = (node: ts.Node, analysis: ConfigExpressionAnalysis): boolean => {
  if (isTransparentConfigExpression(node)) {
    return isNodeCreateRequireCall(node.expression, analysis);
  }
  if (!ts.isCallExpression(node)) return false;
  const target = node.expression;
  if (ts.isIdentifier(target)) {
    if (analysis.localBindings.has(target.text) || getScopedConfigBinding(target).wasFound) {
      return false;
    }
    const importBinding = getImportBinding(analysis.sourceFile, target.text);
    return Boolean(
      importBinding &&
      NODE_MODULE_SPECIFIERS.has(importBinding.moduleSpecifier) &&
      importBinding.exportName === "createRequire",
    );
  }
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) {
    return false;
  }
  const propertyName = getAccessedPropertyName(target);
  if (propertyName !== "createRequire") return false;
  const createRequireReceiver = target.expression;
  if (ts.isCallExpression(createRequireReceiver)) {
    const requiredModuleSpecifier = getRequireModuleSpecifier(createRequireReceiver);
    if (
      requiredModuleSpecifier === null ||
      !NODE_MODULE_SPECIFIERS.has(requiredModuleSpecifier) ||
      !ts.isIdentifier(createRequireReceiver.expression)
    ) {
      return false;
    }
    const requireIdentifier = createRequireReceiver.expression;
    return (
      !analysis.localBindings.has(requireIdentifier.text) &&
      !getScopedConfigBinding(requireIdentifier).wasFound &&
      !hasTopLevelValueBinding(analysis.sourceFile, requireIdentifier.text)
    );
  }
  if (!ts.isIdentifier(createRequireReceiver)) return false;
  if (
    analysis.localBindings.has(createRequireReceiver.text) ||
    getScopedConfigBinding(createRequireReceiver).wasFound
  ) {
    return false;
  }
  const importBinding = getImportBinding(analysis.sourceFile, createRequireReceiver.text);
  return Boolean(
    importBinding?.isNamespace && NODE_MODULE_SPECIFIERS.has(importBinding.moduleSpecifier),
  );
};

const isUnshadowedGlobalRequireIdentifier = (
  identifier: ts.Identifier,
  analysis: ConfigExpressionAnalysis,
): boolean =>
  identifier.text === "require" &&
  !hasTopLevelValueBinding(analysis.sourceFile, identifier.text) &&
  getImportBinding(analysis.sourceFile, identifier.text) === null;

const isNodeRequireResolverIdentifier = (
  identifier: ts.Identifier,
  analysis: ConfigExpressionAnalysis,
): boolean => {
  if (analysis.localBindings.has(identifier.text)) return false;
  const scopedBinding = getScopedConfigBinding(identifier);
  const resolverInitializer = scopedBinding.wasFound
    ? scopedBinding.initializer
    : getTopLevelBinding(analysis.sourceFile, identifier.text);
  if (!scopedBinding.wasFound && resolverInitializer === null) {
    return isUnshadowedGlobalRequireIdentifier(identifier, analysis);
  }
  return Boolean(
    resolverInitializer &&
    isConstantVariableInitializer(resolverInitializer) &&
    isNodeCreateRequireCall(resolverInitializer, analysis),
  );
};

const getNodeRequireResolveModuleSpecifier = (
  callExpression: ts.CallExpression,
  analysis: ConfigExpressionAnalysis,
): string | null => {
  const [moduleSpecifierNode] = callExpression.arguments;
  if (!moduleSpecifierNode || !ts.isStringLiteralLike(moduleSpecifierNode)) return null;
  const target = callExpression.expression;
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return null;
  const propertyName = getAccessedPropertyName(target);
  if (propertyName !== "resolve") return null;
  if (isNodeCreateRequireCall(target.expression, analysis)) return moduleSpecifierNode.text;
  if (!ts.isIdentifier(target.expression)) return null;
  return isNodeRequireResolverIdentifier(target.expression, analysis)
    ? moduleSpecifierNode.text
    : null;
};

interface ReactCompilerFlagState {
  readonly isEnabled: boolean;
}

interface StaticConfigValueState {
  readonly isNullish: boolean;
  readonly isTruthy: boolean;
}

const getAssignedPropertyInitializer = (
  identifier: ts.Identifier,
  propertyName: string,
): ScopedConfigBinding => {
  let bindingScope: ts.Block | ts.SourceFile | null = null;
  let currentNode: ts.Node | undefined = identifier;
  while (currentNode) {
    if (ts.isBlock(currentNode) || ts.isSourceFile(currentNode)) {
      const statementScope = currentNode;
      const hasBinding = statementScope.statements.some((statement) => {
        if (ts.isVariableStatement(statement)) {
          return statement.declarationList.declarations.some((declaration) =>
            bindingNameContainsIdentifier(declaration.name, identifier.text),
          );
        }
        if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name?.text === identifier.text
        ) {
          return true;
        }
        if (!ts.isSourceFile(statementScope) || !ts.isImportDeclaration(statement)) return false;
        const importClause = statement.importClause;
        if (importClause?.name?.text === identifier.text) return true;
        const namedBindings = importClause?.namedBindings;
        return namedBindings
          ? ts.isNamespaceImport(namedBindings)
            ? namedBindings.name.text === identifier.text
            : namedBindings.elements.some((element) => element.name.text === identifier.text)
          : false;
      });
      const isFunctionParameter =
        ts.isBlock(currentNode) &&
        ts.isFunctionLike(currentNode.parent) &&
        currentNode.parent.parameters.some(
          (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text,
        );
      if (hasBinding || isFunctionParameter) {
        bindingScope = currentNode;
        break;
      }
    }
    currentNode = currentNode.parent;
  }
  if (!bindingScope) bindingScope = identifier.getSourceFile();

  let assignedInitializer: ts.Expression | null = null;
  let wasFound = false;
  for (const statement of bindingScope.statements) {
    if (statement.end > identifier.pos) break;
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isBinaryExpression(statement.expression) ||
      statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      continue;
    }
    const { left } = statement.expression;
    const assignedObject =
      ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)
        ? left.expression
        : null;
    const assignedPropertyName = ts.isPropertyAccessExpression(left)
      ? left.name.text
      : ts.isElementAccessExpression(left) &&
          left.argumentExpression &&
          ts.isStringLiteralLike(left.argumentExpression)
        ? left.argumentExpression.text
        : null;
    if (
      assignedObject &&
      ts.isIdentifier(assignedObject) &&
      assignedObject.text === identifier.text &&
      assignedPropertyName === propertyName
    ) {
      wasFound = true;
      assignedInitializer = statement.expression.right;
    }
  }
  return { wasFound, initializer: assignedInitializer };
};

const getStaticConfigValueState = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
  visitedExpressions: ReadonlySet<ts.Expression> = new Set(),
): StaticConfigValueState | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (visitedExpressions.has(unwrappedExpression)) return null;
  const nextVisitedExpressions = new Set(visitedExpressions);
  nextVisitedExpressions.add(unwrappedExpression);

  if (
    unwrappedExpression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(unwrappedExpression) && unwrappedExpression.text === "undefined")
  ) {
    return { isNullish: true, isTruthy: false };
  }
  if (
    unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isStringLiteralLike(unwrappedExpression) && unwrappedExpression.text.length === 0) ||
    (ts.isNumericLiteral(unwrappedExpression) && Number(unwrappedExpression.text) === 0)
  ) {
    return { isNullish: false, isTruthy: false };
  }
  if (
    unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword ||
    (ts.isStringLiteralLike(unwrappedExpression) && unwrappedExpression.text.length > 0) ||
    (ts.isNumericLiteral(unwrappedExpression) && Number(unwrappedExpression.text) !== 0) ||
    ts.isObjectLiteralExpression(unwrappedExpression) ||
    ts.isArrayLiteralExpression(unwrappedExpression) ||
    ts.isArrowFunction(unwrappedExpression) ||
    ts.isFunctionExpression(unwrappedExpression)
  ) {
    return { isNullish: false, isTruthy: true };
  }
  if (ts.isIdentifier(unwrappedExpression)) {
    if (analysis.localBindings.has(unwrappedExpression.text)) {
      const localReference = analysis.localBindings.get(unwrappedExpression.text);
      return localReference?.expression
        ? getStaticConfigValueState(
            localReference.expression,
            localReference.analysis,
            nextVisitedExpressions,
          )
        : null;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, unwrappedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? getStaticConfigValueState(topLevelBinding, analysis, nextVisitedExpressions)
      : null;
  }
  if (ts.isConditionalExpression(unwrappedExpression)) {
    const conditionState = getStaticConfigValueState(
      unwrappedExpression.condition,
      analysis,
      nextVisitedExpressions,
    );
    if (conditionState !== null) {
      return getStaticConfigValueState(
        conditionState.isTruthy ? unwrappedExpression.whenTrue : unwrappedExpression.whenFalse,
        analysis,
        nextVisitedExpressions,
      );
    }
    const whenTrueState = getStaticConfigValueState(
      unwrappedExpression.whenTrue,
      analysis,
      nextVisitedExpressions,
    );
    const whenFalseState = getStaticConfigValueState(
      unwrappedExpression.whenFalse,
      analysis,
      nextVisitedExpressions,
    );
    return whenTrueState !== null &&
      whenFalseState !== null &&
      whenTrueState.isNullish === whenFalseState.isNullish &&
      whenTrueState.isTruthy === whenFalseState.isTruthy
      ? whenTrueState
      : null;
  }
  if (ts.isBinaryExpression(unwrappedExpression)) {
    const leftState = getStaticConfigValueState(
      unwrappedExpression.left,
      analysis,
      nextVisitedExpressions,
    );
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (leftState === null) return null;
      return leftState.isTruthy
        ? getStaticConfigValueState(unwrappedExpression.right, analysis, nextVisitedExpressions)
        : leftState;
    }
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      if (leftState === null) return null;
      return leftState.isTruthy
        ? leftState
        : getStaticConfigValueState(unwrappedExpression.right, analysis, nextVisitedExpressions);
    }
    if (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      if (leftState === null) return null;
      return leftState.isNullish
        ? getStaticConfigValueState(unwrappedExpression.right, analysis, nextVisitedExpressions)
        : leftState;
    }
  }
  return null;
};

const isStaticallyDisabledConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isTruthy === false;

const isStaticallyTruthyConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isTruthy === true;

const isStaticallyNullishConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isNullish === true;

const isStaticallyNonNullishConfigExpression = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
): boolean => getStaticConfigValueState(expression, analysis)?.isNullish === false;

const getReactCompilerFlagState = (
  expression: ts.Expression,
  analysis: ConfigExpressionAnalysis,
  visitedExpressions: ReadonlySet<ts.Expression> = new Set(),
): ReactCompilerFlagState | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (visitedExpressions.has(unwrappedExpression)) return null;
  const nextVisitedExpressions = new Set(visitedExpressions);
  nextVisitedExpressions.add(unwrappedExpression);

  if (ts.isIdentifier(unwrappedExpression)) {
    const assignedBinding = getAssignedPropertyInitializer(unwrappedExpression, "reactCompiler");
    if (assignedBinding.wasFound && assignedBinding.initializer) {
      return {
        isEnabled: !isStaticallyDisabledConfigExpression(assignedBinding.initializer, analysis),
      };
    }
    if (analysis.localBindings.has(unwrappedExpression.text)) {
      const localReference = analysis.localBindings.get(unwrappedExpression.text);
      return localReference?.expression
        ? getReactCompilerFlagState(
            localReference.expression,
            localReference.analysis,
            nextVisitedExpressions,
          )
        : null;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, unwrappedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? getReactCompilerFlagState(topLevelBinding, analysis, nextVisitedExpressions)
      : null;
  }
  if (!ts.isObjectLiteralExpression(unwrappedExpression)) return null;
  for (const property of [...unwrappedExpression.properties].reverse()) {
    if (
      ts.isPropertyAssignment(property) &&
      getStaticPropertyName(property.name) === "reactCompiler"
    ) {
      return { isEnabled: !isStaticallyDisabledConfigExpression(property.initializer, analysis) };
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "reactCompiler") {
      return { isEnabled: !isStaticallyDisabledConfigExpression(property.name, analysis) };
    }
    if (ts.isSpreadAssignment(property)) {
      const spreadState = getReactCompilerFlagState(
        property.expression,
        analysis,
        nextVisitedExpressions,
      );
      if (spreadState) return spreadState;
    }
  }
  return null;
};

const getSelectedIdentifierObjectProperty = (
  identifier: ts.Identifier,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
  visitedExpressions: Set<ts.Expression>,
): ConfigPropertyReference | null => {
  if (analysis.localBindings.has(identifier.text)) {
    const localReference = analysis.localBindings.get(identifier.text);
    return localReference?.expression
      ? getSelectedObjectProperty(
          localReference.expression,
          propertyName,
          localReference.analysis,
          visitedExpressions,
        )
      : null;
  }
  const scopedBinding = getScopedConfigBinding(identifier);
  if (scopedBinding.wasFound) {
    return scopedBinding.initializer
      ? getSelectedObjectProperty(
          scopedBinding.initializer,
          propertyName,
          analysis,
          visitedExpressions,
        )
      : null;
  }
  const topLevelBinding = getTopLevelBinding(analysis.sourceFile, identifier.text);
  return topLevelBinding && ts.isExpression(topLevelBinding)
    ? getSelectedObjectProperty(topLevelBinding, propertyName, analysis, visitedExpressions)
    : null;
};

const getDirectObjectPropertyReference = (
  property: ts.ObjectLiteralElementLike,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
): ConfigPropertyReference | null => {
  if (ts.isPropertyAssignment(property) && getStaticPropertyName(property.name) === propertyName) {
    return { node: property.initializer, analysis };
  }
  if (ts.isMethodDeclaration(property) && getStaticPropertyName(property.name) === propertyName) {
    return { node: property, analysis };
  }
  if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
    return { node: property.name, analysis };
  }
  return null;
};

const getSelectedObjectLiteralProperty = (
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
  visitedExpressions: Set<ts.Expression>,
): ConfigPropertyReference | null => {
  for (const property of [...objectLiteral.properties].reverse()) {
    const directProperty = getDirectObjectPropertyReference(property, propertyName, analysis);
    if (directProperty) return directProperty;
    if (!ts.isSpreadAssignment(property)) continue;
    const spreadProperty = getSelectedObjectProperty(
      property.expression,
      propertyName,
      analysis,
      visitedExpressions,
    );
    if (spreadProperty) return spreadProperty;
  }
  return null;
};

const getSelectedObjectProperty = (
  expression: ts.Expression,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
  visitedExpressions: Set<ts.Expression> = new Set(),
): ConfigPropertyReference | null => {
  const resolvedExpression = unwrapTypescriptExpression(expression);
  if (visitedExpressions.has(resolvedExpression)) return null;
  visitedExpressions.add(resolvedExpression);
  if (ts.isIdentifier(resolvedExpression)) {
    return getSelectedIdentifierObjectProperty(
      resolvedExpression,
      propertyName,
      analysis,
      visitedExpressions,
    );
  }
  return ts.isObjectLiteralExpression(resolvedExpression)
    ? getSelectedObjectLiteralProperty(
        resolvedExpression,
        propertyName,
        analysis,
        visitedExpressions,
      )
    : null;
};

const configExpressionMayDefineProperty = (
  expression: ts.Expression,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
  visitedExpressions: ReadonlySet<ts.Expression> = new Set(),
): boolean => {
  const resolvedExpression = unwrapTypescriptExpression(expression);
  if (visitedExpressions.has(resolvedExpression)) return true;
  const nextVisitedExpressions = new Set(visitedExpressions);
  nextVisitedExpressions.add(resolvedExpression);
  if (ts.isIdentifier(resolvedExpression)) {
    if (analysis.localBindings.has(resolvedExpression.text)) {
      const localReference = analysis.localBindings.get(resolvedExpression.text);
      return localReference?.expression
        ? configExpressionMayDefineProperty(
            localReference.expression,
            propertyName,
            localReference.analysis,
            nextVisitedExpressions,
          )
        : true;
    }
    const scopedBinding = getScopedConfigBinding(resolvedExpression);
    if (scopedBinding.wasFound) {
      return scopedBinding.initializer
        ? configExpressionMayDefineProperty(
            scopedBinding.initializer,
            propertyName,
            analysis,
            nextVisitedExpressions,
          )
        : true;
    }
    const topLevelBinding = getTopLevelBinding(analysis.sourceFile, resolvedExpression.text);
    return topLevelBinding && ts.isExpression(topLevelBinding)
      ? configExpressionMayDefineProperty(
          topLevelBinding,
          propertyName,
          analysis,
          nextVisitedExpressions,
        )
      : true;
  }
  if (ts.isConditionalExpression(resolvedExpression)) {
    if (isStaticallyTruthyConfigExpression(resolvedExpression.condition, analysis)) {
      return configExpressionMayDefineProperty(
        resolvedExpression.whenTrue,
        propertyName,
        analysis,
        nextVisitedExpressions,
      );
    }
    if (isStaticallyDisabledConfigExpression(resolvedExpression.condition, analysis)) {
      return configExpressionMayDefineProperty(
        resolvedExpression.whenFalse,
        propertyName,
        analysis,
        nextVisitedExpressions,
      );
    }
    return (
      configExpressionMayDefineProperty(
        resolvedExpression.whenTrue,
        propertyName,
        analysis,
        nextVisitedExpressions,
      ) ||
      configExpressionMayDefineProperty(
        resolvedExpression.whenFalse,
        propertyName,
        analysis,
        nextVisitedExpressions,
      )
    );
  }
  if (!ts.isObjectLiteralExpression(resolvedExpression)) return true;
  return resolvedExpression.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) {
      return configExpressionMayDefineProperty(
        property.expression,
        propertyName,
        analysis,
        nextVisitedExpressions,
      );
    }
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      const staticPropertyName = getStaticPropertyName(property.name);
      return staticPropertyName === null || staticPropertyName === propertyName;
    }
    return false;
  });
};

const getNamedObjectLiteralExportNode = (
  objectLiteral: ts.ObjectLiteralExpression,
  exportName: string,
): ts.Node | null => {
  for (const property of [...objectLiteral.properties].reverse()) {
    if (ts.isPropertyAssignment(property) && getStaticPropertyName(property.name) === exportName) {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === exportName) {
      return property.name;
    }
  }
  return null;
};

const getCommonJsRootConfigExportMatch = (
  assignment: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  exportName: string,
): CommonJsConfigExportMatch | null => {
  if (!isCommonJsConfigExportAssignment(assignment, sourceFile)) return null;
  if (exportName === "default") {
    return {
      node: assignment.right,
      strategy: "replace-mutation",
    };
  }
  if (!ts.isObjectLiteralExpression(assignment.right)) return null;
  const exportedNode = getNamedObjectLiteralExportNode(assignment.right, exportName);
  return exportedNode ? { node: exportedNode, strategy: "source-order" } : null;
};

const getCommonJsPropertyConfigExportMatch = (
  assignment: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  exportName: string,
): CommonJsConfigExportMatch | null => {
  if (assignment.left.getText(sourceFile) === `exports.${exportName}`) {
    return {
      node: assignment.right,
      strategy: "source-order",
    };
  }
  if (
    exportName !== "default" ||
    (!ts.isPropertyAccessExpression(assignment.left) &&
      !ts.isElementAccessExpression(assignment.left))
  ) {
    return null;
  }

  const assignmentObjectText = assignment.left.expression.getText(sourceFile);
  const assignmentPropertyName = getAccessedPropertyName(assignment.left);
  if (
    !assignmentPropertyName ||
    (assignmentObjectText !== "module.exports" &&
      assignmentObjectText !== "exports" &&
      assignmentObjectText !== "exports.default")
  ) {
    return null;
  }
  return {
    node: assignment,
    strategy: "append-mutation",
  };
};

const getCommonJsConfigExportMatch = (
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  exportName: string,
): CommonJsConfigExportMatch | null => {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isBinaryExpression(statement.expression) ||
    statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return null;
  }
  return (
    getCommonJsRootConfigExportMatch(statement.expression, sourceFile, exportName) ??
    getCommonJsPropertyConfigExportMatch(statement.expression, sourceFile, exportName)
  );
};

const getExportedVariableInitializerNodes = (
  statement: ts.Statement,
  exportName: string,
): ts.Expression[] => {
  if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) return [];
  const exportedNodes: ts.Expression[] = [];
  for (const declaration of statement.declarationList.declarations) {
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === exportName &&
      declaration.initializer
    ) {
      exportedNodes.push(declaration.initializer);
    }
  }
  return exportedNodes;
};

const getLocalNamedExportNodes = (statement: ts.Statement, exportName: string): ts.Node[] => {
  if (
    !ts.isExportDeclaration(statement) ||
    statement.moduleSpecifier ||
    !statement.exportClause ||
    !ts.isNamedExports(statement.exportClause)
  ) {
    return [];
  }
  const exportedNodes: ts.Node[] = [];
  for (const exportSpecifier of statement.exportClause.elements) {
    if (exportSpecifier.name.text === exportName) {
      exportedNodes.push(exportSpecifier.propertyName ?? exportSpecifier.name);
    }
  }
  return exportedNodes;
};

const getDefaultEsmConfigExportNodes = (statement: ts.Statement, exportName: string): ts.Node[] => {
  if (exportName !== "default") return [];
  if (ts.isExportAssignment(statement)) return [statement.expression];
  if (!ts.isFunctionDeclaration(statement) && !ts.isClassDeclaration(statement)) return [];
  if (!hasExportModifier(statement)) return [];
  const isDefaultExport = ts
    .getModifiers(statement)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  return isDefaultExport ? [statement] : [];
};

const getEsmConfigExportNodes = (statement: ts.Statement, exportName: string): ts.Node[] => {
  const exportedNodes = getDefaultEsmConfigExportNodes(statement, exportName);
  exportedNodes.push(...getExportedVariableInitializerNodes(statement, exportName));
  if (
    ts.isFunctionDeclaration(statement) &&
    hasExportModifier(statement) &&
    statement.name?.text === exportName
  ) {
    exportedNodes.push(statement);
  }
  exportedNodes.push(...getLocalNamedExportNodes(statement, exportName));
  return exportedNodes;
};

const getExportedConfigNodes = (sourceFile: ts.SourceFile, exportName: string): ts.Node[] => {
  const isJsonConfig =
    sourceFile.fileName.endsWith(".json") || path.basename(sourceFile.fileName) === ".babelrc";
  if (isJsonConfig && exportName === "default") {
    return sourceFile.statements.flatMap((statement) =>
      ts.isExpressionStatement(statement) ? [statement.expression] : [],
    );
  }

  const exportedNodes: ts.Node[] = [];
  const commonJsExportedNodes: ts.Node[] = [];
  for (const statement of sourceFile.statements) {
    exportedNodes.push(...getEsmConfigExportNodes(statement, exportName));
    const commonJsExportMatch = getCommonJsConfigExportMatch(statement, sourceFile, exportName);
    if (!commonJsExportMatch) continue;
    if (commonJsExportMatch.strategy === "source-order") {
      exportedNodes.push(commonJsExportMatch.node);
      continue;
    }
    if (commonJsExportMatch.strategy === "replace-mutation") {
      commonJsExportedNodes.length = 0;
    }
    commonJsExportedNodes.push(commonJsExportMatch.node);
  }
  return [...exportedNodes, ...commonJsExportedNodes];
};

const getReExportedConfigModules = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ConfigImportBinding[] => {
  const bindings: ConfigImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    if (!statement.exportClause && exportName !== "default") {
      bindings.push({
        moduleSpecifier: statement.moduleSpecifier.text,
        exportName,
        isNamespace: true,
      });
      continue;
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const exportSpecifier of statement.exportClause.elements) {
      if (exportSpecifier.name.text === exportName) {
        bindings.push({
          moduleSpecifier: statement.moduleSpecifier.text,
          exportName: (exportSpecifier.propertyName ?? exportSpecifier.name).text,
          isNamespace: false,
        });
      }
    }
  }
  return bindings;
};

const analyzeConfigModuleExport = (
  filePath: string,
  exportName: string,
  allowCompilerTransform: boolean,
  importDepth: number,
  visitedModules: ReadonlySet<string>,
  argumentsList: readonly ts.Expression[] = [],
  argumentAnalysis?: ConfigExpressionAnalysis,
): boolean => {
  if (!isFile(filePath) || importDepth > REACT_COMPILER_CONFIG_IMPORT_MAX_DEPTH) return false;
  const moduleVisitKey = `${filePath}:${exportName}:${allowCompilerTransform}`;
  if (visitedModules.has(moduleVisitKey)) return false;
  const nextVisitedModules = new Set(visitedModules);
  nextVisitedModules.add(moduleVisitKey);
  let sourceText: string;
  try {
    sourceText = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }
  const sourceFile = parseConfigSourceFile(filePath, sourceText);
  return analyzeConfigSourceFileExport(
    sourceFile,
    filePath,
    exportName,
    allowCompilerTransform,
    importDepth,
    nextVisitedModules,
    argumentsList,
    argumentAnalysis,
  );
};

const analyzeConfigSourceFileExport = (
  sourceFile: ts.SourceFile,
  filePath: string,
  exportName: string,
  allowCompilerTransform: boolean,
  importDepth: number,
  visitedModules: ReadonlySet<string>,
  argumentsList: readonly ts.Expression[] = [],
  argumentAnalysis?: ConfigExpressionAnalysis,
): boolean => {
  const analysis: ConfigExpressionAnalysis = {
    filePath,
    sourceFile,
    importDepth,
    visitedModules,
    visitedNodes: new Set<string>(),
    localBindings: new Map<string, ConfigExpressionReference>(),
    activeFunctions: new Set<number>(),
  };
  const resolvedArgumentAnalysis = argumentAnalysis ?? analysis;
  const exportedConfigNodes = getExportedConfigNodes(sourceFile, exportName);
  return (
    exportedConfigNodes.some((node) => {
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node)
      ) {
        return analyzeConfigFunction(
          node,
          analysis,
          allowCompilerTransform,
          argumentsList,
          resolvedArgumentAnalysis,
        );
      }
      if (argumentsList.length > 0 && ts.isIdentifier(node)) {
        const topLevelBinding = getTopLevelBinding(sourceFile, node.text);
        if (topLevelBinding && ts.isFunctionLike(topLevelBinding)) {
          return analyzeConfigFunction(
            topLevelBinding,
            analysis,
            allowCompilerTransform,
            argumentsList,
            resolvedArgumentAnalysis,
          );
        }
        const importBinding = getImportBinding(sourceFile, node.text);
        if (importBinding) {
          const importedFilePath = resolveImportedConfigFile(
            filePath,
            importBinding.moduleSpecifier,
          );
          return Boolean(
            importedFilePath &&
            analyzeConfigModuleExport(
              importedFilePath,
              importBinding.exportName,
              allowCompilerTransform,
              importDepth + 1,
              visitedModules,
              argumentsList,
              resolvedArgumentAnalysis,
            ),
          );
        }
      }
      return analyzeConfigNode(node, analysis, allowCompilerTransform);
    }) ||
    getReExportedConfigModules(sourceFile, exportName).some((binding) => {
      if (exportedConfigNodes.length > 0 && binding.isNamespace) return false;
      const importedFilePath = resolveImportedConfigFile(filePath, binding.moduleSpecifier);
      return Boolean(
        importedFilePath &&
        analyzeConfigModuleExport(
          importedFilePath,
          binding.exportName,
          allowCompilerTransform,
          importDepth + 1,
          visitedModules,
          argumentsList,
          resolvedArgumentAnalysis,
        ),
      );
    })
  );
};

const analyzeConfigFunction = (
  functionNode: ts.FunctionLikeDeclaration,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
  argumentsList: readonly ts.Expression[] = [],
  argumentAnalysis: ConfigExpressionAnalysis = analysis,
): boolean => {
  if (!functionNode.body) return false;
  if (analysis.activeFunctions.has(functionNode.pos)) return false;
  const activeFunctions = new Set(analysis.activeFunctions);
  activeFunctions.add(functionNode.pos);
  const functionAnalysis: ConfigExpressionAnalysis = {
    ...analysis,
    visitedNodes: new Set<string>(),
    localBindings: getFunctionLocalBindings(
      functionNode,
      argumentsList,
      argumentAnalysis,
      analysis,
    ),
    activeFunctions,
  };
  if (!ts.isBlock(functionNode.body)) {
    return analyzeConfigNode(functionNode.body, functionAnalysis, allowCompilerTransform);
  }
  let hasCompiler = false;
  const visitReturns = (node: ts.Node): void => {
    if (hasCompiler || (node !== functionNode.body && ts.isFunctionLike(node))) return;
    if (ts.isReturnStatement(node) && node.expression) {
      hasCompiler = analyzeConfigNode(node.expression, functionAnalysis, allowCompilerTransform);
      return;
    }
    ts.forEachChild(node, visitReturns);
  };
  visitReturns(functionNode.body);
  return hasCompiler;
};

const analyzeImportedConfig = ({
  analysis,
  moduleSpecifier,
  exportName,
  allowCompilerTransform,
  argumentsList,
}: AnalyzeImportedConfigOptions): boolean | null => {
  const importedFilePath = resolveImportedConfigFile(analysis.filePath, moduleSpecifier);
  if (!importedFilePath) return null;
  return analyzeConfigModuleExport(
    importedFilePath,
    exportName,
    allowCompilerTransform,
    analysis.importDepth + 1,
    analysis.visitedModules,
    argumentsList,
    analysis,
  );
};

const analyzeConfigIdentifier = (
  identifier: ts.Identifier,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
  isCompilerTransformCollection: boolean,
  excludedPropertyNames?: ReadonlySet<string>,
): boolean => {
  const assignedReactCompiler = getAssignedPropertyInitializer(identifier, "reactCompiler");
  if (
    assignedReactCompiler.initializer &&
    !isStaticallyDisabledConfigExpression(assignedReactCompiler.initializer, analysis)
  ) {
    return true;
  }
  const assignedPlugins = getAssignedPropertyInitializer(identifier, "plugins");
  if (
    assignedPlugins.initializer &&
    analyzeConfigNode(assignedPlugins.initializer, analysis, true, true)
  ) {
    return true;
  }
  const assignedPresets = getAssignedPropertyInitializer(identifier, "presets");
  if (
    assignedPresets.initializer &&
    analyzeConfigNode(assignedPresets.initializer, analysis, true, true)
  ) {
    return true;
  }
  const overriddenPropertyNames = new Set(excludedPropertyNames);
  if (assignedReactCompiler.wasFound) overriddenPropertyNames.add("reactCompiler");
  if (assignedPlugins.wasFound) overriddenPropertyNames.add("plugins");
  if (assignedPresets.wasFound) overriddenPropertyNames.add("presets");
  if (analysis.localBindings.has(identifier.text)) {
    const localReference = analysis.localBindings.get(identifier.text);
    return Boolean(
      localReference?.expression &&
      analyzeConfigNode(
        localReference.expression,
        localReference.analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
        overriddenPropertyNames,
      ),
    );
  }
  const scopedBinding = getScopedConfigBinding(identifier);
  if (scopedBinding.wasFound) {
    return Boolean(
      scopedBinding.initializer &&
      analyzeConfigNode(
        scopedBinding.initializer,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
        overriddenPropertyNames,
      ),
    );
  }
  const importBinding = getImportBinding(analysis.sourceFile, identifier.text);
  if (importBinding) {
    if (
      allowCompilerTransform &&
      isCompilerTransformModule(importBinding.moduleSpecifier, importBinding.exportName)
    ) {
      return true;
    }
    return Boolean(
      analyzeImportedConfig({
        analysis,
        moduleSpecifier: importBinding.moduleSpecifier,
        exportName: importBinding.exportName,
        allowCompilerTransform,
      }),
    );
  }
  const topLevelBinding = getTopLevelBinding(analysis.sourceFile, identifier.text);
  return Boolean(
    topLevelBinding &&
    analyzeConfigNode(
      topLevelBinding,
      analysis,
      allowCompilerTransform,
      isCompilerTransformCollection,
      overriddenPropertyNames,
    ),
  );
};

const analyzeConfigCallTarget = (
  callExpression: ts.CallExpression,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
): boolean | null => {
  const target = callExpression.expression;
  const callableRequiredModuleSpecifier = getRequireModuleSpecifier(target);
  if (callableRequiredModuleSpecifier !== null) {
    const isRequireShadowed =
      ts.isCallExpression(target) &&
      ts.isIdentifier(target.expression) &&
      (analysis.localBindings.has(target.expression.text) ||
        getScopedConfigBinding(target.expression).wasFound ||
        hasTopLevelValueBinding(analysis.sourceFile, "require"));
    if (isRequireShadowed) return false;
    if (
      allowCompilerTransform &&
      isCompilerTransformModule(callableRequiredModuleSpecifier, "default")
    ) {
      return true;
    }
    const hasCompilerTransform = analyzeImportedConfig({
      analysis,
      moduleSpecifier: callableRequiredModuleSpecifier,
      exportName: "default",
      allowCompilerTransform,
      argumentsList: callExpression.arguments,
    });
    if (isLocalModuleSpecifier(callableRequiredModuleSpecifier) || hasCompilerTransform !== null) {
      return Boolean(hasCompilerTransform);
    }
    return null;
  }
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return null;
  const propertyName = getAccessedPropertyName(target);
  if (propertyName === null) return null;

  const requiredModuleSpecifier = getRequireModuleSpecifier(target.expression);
  if (requiredModuleSpecifier !== null) {
    const isRequireShadowed =
      ts.isCallExpression(target.expression) &&
      ts.isIdentifier(target.expression.expression) &&
      (analysis.localBindings.has(target.expression.expression.text) ||
        getScopedConfigBinding(target.expression.expression).wasFound ||
        hasTopLevelValueBinding(analysis.sourceFile, "require"));
    if (isRequireShadowed) return false;
    if (
      allowCompilerTransform &&
      isCompilerTransformModule(requiredModuleSpecifier, propertyName)
    ) {
      return true;
    }
    const hasCompilerTransform = analyzeImportedConfig({
      analysis,
      moduleSpecifier: requiredModuleSpecifier,
      exportName: propertyName,
      allowCompilerTransform,
      argumentsList: callExpression.arguments,
    });
    if (isLocalModuleSpecifier(requiredModuleSpecifier) || hasCompilerTransform !== null) {
      return Boolean(hasCompilerTransform);
    }
    return null;
  }

  if (!ts.isIdentifier(target.expression)) return null;
  const isTargetShadowed =
    analysis.localBindings.has(target.expression.text) ||
    getScopedConfigBinding(target.expression).wasFound;
  const importBinding = isTargetShadowed
    ? null
    : getImportBinding(analysis.sourceFile, target.expression.text);
  if (importBinding?.isNamespace) {
    if (
      allowCompilerTransform &&
      isCompilerTransformModule(importBinding.moduleSpecifier, propertyName)
    ) {
      return true;
    }
    const hasCompilerTransform = analyzeImportedConfig({
      analysis,
      moduleSpecifier: importBinding.moduleSpecifier,
      exportName: propertyName,
      allowCompilerTransform,
      argumentsList: callExpression.arguments,
    });
    if (isLocalModuleSpecifier(importBinding.moduleSpecifier) || hasCompilerTransform !== null) {
      return Boolean(hasCompilerTransform);
    }
    return null;
  }

  const selectedProperty = getSelectedObjectProperty(target.expression, propertyName, analysis);
  if (selectedProperty === null) return null;
  return ts.isFunctionLike(selectedProperty.node)
    ? analyzeConfigFunction(
        selectedProperty.node,
        selectedProperty.analysis,
        allowCompilerTransform,
        callExpression.arguments,
        analysis,
      )
    : analyzeConfigNode(selectedProperty.node, selectedProperty.analysis, allowCompilerTransform);
};

const analyzeConfigMemberAccess = (
  expression: ts.Expression,
  propertyName: string,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
): boolean => {
  if (!ts.isIdentifier(expression)) {
    return analyzeConfigNode(expression, analysis, allowCompilerTransform);
  }
  if (analysis.localBindings.has(expression.text) || getScopedConfigBinding(expression).wasFound) {
    const selectedProperty = getSelectedObjectProperty(expression, propertyName, analysis);
    return Boolean(
      selectedProperty &&
      analyzeConfigNode(selectedProperty.node, selectedProperty.analysis, allowCompilerTransform),
    );
  }
  const importBinding = getImportBinding(analysis.sourceFile, expression.text);
  if (importBinding?.isNamespace) {
    if (
      allowCompilerTransform &&
      isCompilerTransformModule(importBinding.moduleSpecifier, propertyName)
    ) {
      return true;
    }
    return Boolean(
      analyzeImportedConfig({
        analysis,
        moduleSpecifier: importBinding.moduleSpecifier,
        exportName: propertyName,
        allowCompilerTransform,
      }),
    );
  }
  const selectedProperty = getSelectedObjectProperty(expression, propertyName, analysis);
  return Boolean(
    selectedProperty &&
    analyzeConfigNode(selectedProperty.node, selectedProperty.analysis, allowCompilerTransform),
  );
};

const analyzeConfigNode = (
  node: ts.Node,
  analysis: ConfigExpressionAnalysis,
  allowCompilerTransform: boolean,
  isCompilerTransformCollection = false,
  excludedPropertyNames?: ReadonlySet<string>,
): boolean => {
  const excludedPropertiesVisitKey = excludedPropertyNames
    ? [...excludedPropertyNames].sort().join(",")
    : "";
  const nodeVisitKey = `${node.pos}:${node.end}:${allowCompilerTransform}:${isCompilerTransformCollection}:${excludedPropertiesVisitKey}`;
  if (analysis.visitedNodes.has(nodeVisitKey)) return false;
  analysis.visitedNodes.add(nodeVisitKey);

  if (ts.isIdentifier(node)) {
    return analyzeConfigIdentifier(
      node,
      analysis,
      allowCompilerTransform,
      isCompilerTransformCollection,
      excludedPropertyNames,
    );
  }
  if (ts.isStringLiteralLike(node)) {
    return (
      allowCompilerTransform &&
      (node.text === "babel-plugin-react-compiler" || node.text === "react-compiler")
    );
  }
  if (isTransparentConfigExpression(node)) {
    return analyzeConfigNode(
      node.expression,
      analysis,
      allowCompilerTransform,
      isCompilerTransformCollection,
      excludedPropertyNames,
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    const reactCompilerFlagState = excludedPropertyNames?.has("reactCompiler")
      ? null
      : getReactCompilerFlagState(node, analysis);
    if (reactCompilerFlagState?.isEnabled) return true;
    for (const [propertyIndex, property] of node.properties.entries()) {
      if (ts.isPropertyAssignment(property)) {
        const propertyName = getStaticPropertyName(property.name);
        if (propertyName && excludedPropertyNames?.has(propertyName)) continue;
        if (propertyName === "reactCompiler") continue;
        if (
          (propertyName === "plugins" || propertyName === "presets") &&
          node.properties
            .slice(propertyIndex + 1)
            .some(
              (laterProperty) =>
                (ts.isSpreadAssignment(laterProperty) &&
                  configExpressionMayDefineProperty(
                    laterProperty.expression,
                    propertyName,
                    analysis,
                  )) ||
                ((ts.isPropertyAssignment(laterProperty) ||
                  ts.isShorthandPropertyAssignment(laterProperty)) &&
                  getStaticPropertyName(laterProperty.name) === propertyName),
            )
        ) {
          continue;
        }
        const propertyAllowsCompilerTransform =
          propertyName === "plugins" || propertyName === "presets";
        if (propertyName === "extends" && ts.isStringLiteralLike(property.initializer)) {
          if (
            analyzeImportedConfig({
              analysis,
              moduleSpecifier: property.initializer.text,
              exportName: "default",
              allowCompilerTransform: false,
            })
          ) {
            return true;
          }
        }
        if (
          analyzeConfigNode(
            property.initializer,
            analysis,
            propertyAllowsCompilerTransform,
            propertyAllowsCompilerTransform,
          )
        )
          return true;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        if (excludedPropertyNames?.has(property.name.text)) continue;
        if (property.name.text === "reactCompiler") continue;
        if (
          (property.name.text === "plugins" || property.name.text === "presets") &&
          node.properties
            .slice(propertyIndex + 1)
            .some(
              (laterProperty) =>
                (ts.isSpreadAssignment(laterProperty) &&
                  configExpressionMayDefineProperty(
                    laterProperty.expression,
                    property.name.text,
                    analysis,
                  )) ||
                ((ts.isPropertyAssignment(laterProperty) ||
                  ts.isShorthandPropertyAssignment(laterProperty)) &&
                  getStaticPropertyName(laterProperty.name) === property.name.text),
            )
        ) {
          continue;
        }
        const propertyAllowsCompilerTransform =
          property.name.text === "plugins" || property.name.text === "presets";
        if (
          analyzeConfigNode(
            property.name,
            analysis,
            propertyAllowsCompilerTransform,
            propertyAllowsCompilerTransform,
          )
        )
          return true;
      } else if (ts.isSpreadAssignment(property)) {
        if (
          reactCompilerFlagState &&
          getReactCompilerFlagState(property.expression, analysis) !== null
        ) {
          continue;
        }
        if (
          node.properties
            .slice(propertyIndex + 1)
            .some(
              (laterProperty) =>
                (ts.isPropertyAssignment(laterProperty) ||
                  ts.isShorthandPropertyAssignment(laterProperty)) &&
                (getStaticPropertyName(laterProperty.name) === "plugins" ||
                  getStaticPropertyName(laterProperty.name) === "presets"),
            )
        ) {
          continue;
        }
        if (
          analyzeConfigNode(
            property.expression,
            analysis,
            allowCompilerTransform,
            false,
            excludedPropertyNames,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (isCompilerTransformCollection) {
      return node.elements.some((element) =>
        analyzeConfigNode(
          ts.isSpreadElement(element) ? element.expression : element,
          analysis,
          allowCompilerTransform,
          ts.isSpreadElement(element),
        ),
      );
    }
    const isTransformTuple =
      allowCompilerTransform &&
      node.elements.length > 1 &&
      ts.isStringLiteralLike(node.elements[0]) &&
      node.elements[0].text !== "babel-plugin-react-compiler" &&
      node.elements[0].text !== "react-compiler";
    return node.elements.some((element, elementIndex) => {
      const expression = ts.isSpreadElement(element) ? element.expression : element;
      return analyzeConfigNode(
        expression,
        analysis,
        allowCompilerTransform && (!isTransformTuple || elementIndex === 0),
      );
    });
  }
  if (ts.isCallExpression(node)) {
    const resolvedModuleSpecifier = getNodeRequireResolveModuleSpecifier(node, analysis);
    if (resolvedModuleSpecifier !== null) {
      return (
        allowCompilerTransform && isCompilerTransformModule(resolvedModuleSpecifier, "default")
      );
    }
    const callTargetResult = analyzeConfigCallTarget(node, analysis, allowCompilerTransform);
    if (callTargetResult !== null) return callTargetResult;
    const directModuleSpecifier = getRequireModuleSpecifier(node);
    const isRequireShadowed =
      analysis.localBindings.has("require") ||
      (ts.isIdentifier(node.expression) && getScopedConfigBinding(node.expression).wasFound) ||
      hasTopLevelValueBinding(analysis.sourceFile, "require");
    if (directModuleSpecifier && isRequireShadowed) {
      return analyzeConfigNode(node.expression, analysis, allowCompilerTransform);
    }
    if (directModuleSpecifier && !isRequireShadowed) {
      if (allowCompilerTransform && isCompilerTransformModule(directModuleSpecifier, "default"))
        return true;
      if (
        analyzeImportedConfig({
          analysis,
          moduleSpecifier: directModuleSpecifier,
          exportName: "default",
          allowCompilerTransform,
        })
      ) {
        return true;
      }
    }
    if (ts.isIdentifier(node.expression)) {
      if (
        !analysis.localBindings.has(node.expression.text) &&
        !getScopedConfigBinding(node.expression).wasFound
      ) {
        const importBinding = getImportBinding(analysis.sourceFile, node.expression.text);
        if (importBinding) {
          if (
            allowCompilerTransform &&
            isCompilerTransformModule(importBinding.moduleSpecifier, importBinding.exportName)
          ) {
            return true;
          }
          if (
            allowCompilerTransform &&
            importBinding.moduleSpecifier === "@rolldown/plugin-babel" &&
            importBinding.exportName === "default" &&
            node.arguments.some((argument) => analyzeConfigNode(argument, analysis, false))
          ) {
            return true;
          }
          const hasCompilerTransform = analyzeImportedConfig({
            analysis,
            moduleSpecifier: importBinding.moduleSpecifier,
            exportName: importBinding.exportName,
            allowCompilerTransform,
            argumentsList: node.arguments,
          });
          if (
            isLocalModuleSpecifier(importBinding.moduleSpecifier) ||
            hasCompilerTransform !== null
          ) {
            return Boolean(hasCompilerTransform);
          }
        }
      }
      const topLevelBinding = getTopLevelBinding(analysis.sourceFile, node.expression.text);
      if (
        topLevelBinding &&
        ts.isFunctionLike(topLevelBinding) &&
        analyzeConfigFunction(topLevelBinding, analysis, allowCompilerTransform, node.arguments)
      ) {
        return true;
      }
    }
    return (
      analyzeConfigNode(node.expression, analysis, allowCompilerTransform) ||
      node.arguments.some((argument) => analyzeConfigNode(argument, analysis, false))
    );
  }
  if (ts.isPropertyAccessExpression(node)) {
    const requiredModuleSpecifier = getRequireModuleSpecifier(node.expression);
    if (requiredModuleSpecifier) {
      const isRequireShadowed =
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        (analysis.localBindings.has(node.expression.expression.text) ||
          getScopedConfigBinding(node.expression.expression).wasFound ||
          hasTopLevelValueBinding(analysis.sourceFile, "require"));
      if (isRequireShadowed) return false;
      if (
        analyzeImportedConfig({
          analysis,
          moduleSpecifier: requiredModuleSpecifier,
          exportName: node.name.text,
          allowCompilerTransform,
        })
      ) {
        return true;
      }
      return (
        allowCompilerTransform && isCompilerTransformModule(requiredModuleSpecifier, node.name.text)
      );
    }
    return analyzeConfigMemberAccess(
      node.expression,
      node.name.text,
      analysis,
      allowCompilerTransform,
    );
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return analyzeConfigMemberAccess(
      node.expression,
      node.argumentExpression.text,
      analysis,
      allowCompilerTransform,
    );
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return (
        !isStaticallyDisabledConfigExpression(node.left, analysis) &&
        analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        )
      );
    }
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const leftText = node.left.getText(analysis.sourceFile);
      const assignedPropertyName = ts.isPropertyAccessExpression(node.left)
        ? node.left.name.text
        : ts.isElementAccessExpression(node.left) &&
            node.left.argumentExpression &&
            ts.isStringLiteralLike(node.left.argumentExpression)
          ? node.left.argumentExpression.text
          : null;
      if (assignedPropertyName === "reactCompiler" || leftText.endsWith(".reactCompiler")) {
        return !isStaticallyDisabledConfigExpression(node.right, analysis);
      }
      if (
        assignedPropertyName === "plugins" ||
        assignedPropertyName === "presets" ||
        leftText.endsWith(".plugins") ||
        leftText.endsWith(".presets")
      ) {
        return analyzeConfigNode(node.right, analysis, true, true);
      }
      return analyzeConfigNode(node.right, analysis, allowCompilerTransform);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      if (isStaticallyTruthyConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      if (isStaticallyDisabledConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      return (
        analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        ) ||
        analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        )
      );
    }
    if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      if (isStaticallyNullishConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      if (isStaticallyNonNullishConfigExpression(node.left, analysis)) {
        return analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        );
      }
      return (
        analyzeConfigNode(
          node.left,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        ) ||
        analyzeConfigNode(
          node.right,
          analysis,
          allowCompilerTransform,
          isCompilerTransformCollection,
        )
      );
    }
  }
  if (ts.isConditionalExpression(node)) {
    if (isStaticallyTruthyConfigExpression(node.condition, analysis)) {
      return analyzeConfigNode(
        node.whenTrue,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      );
    }
    if (isStaticallyDisabledConfigExpression(node.condition, analysis)) {
      return analyzeConfigNode(
        node.whenFalse,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      );
    }
    return (
      analyzeConfigNode(
        node.whenTrue,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      ) ||
      analyzeConfigNode(
        node.whenFalse,
        analysis,
        allowCompilerTransform,
        isCompilerTransformCollection,
      )
    );
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    return analyzeConfigFunction(node, analysis, allowCompilerTransform);
  }
  return false;
};

const hasCompilerInConfigFile = (filePath: string): boolean =>
  analyzeConfigModuleExport(filePath, "default", false, 0, new Set<string>());

const hasCompilerInConfigFiles = (directory: string, filenames: string[]): boolean =>
  filenames.some((filename) => hasCompilerInConfigFile(path.join(directory, filename)));

const hasCompilerInPackageJsonConfig = (directory: string, packageJson: PackageJson): boolean => {
  if (!isPlainObject(packageJson.babel)) return false;
  const packageJsonPath = path.join(directory, "package.json");
  return analyzeConfigSourceFileExport(
    ts.parseJsonText(packageJsonPath, JSON.stringify(packageJson.babel)),
    packageJsonPath,
    "default",
    false,
    0,
    new Set<string>(),
  );
};

export const hasReactCompilerConfiguration = (
  directory: string,
  packageJson: PackageJson,
): boolean =>
  hasCompilerInPackageJsonConfig(directory, packageJson) ||
  hasCompilerInConfigFiles(directory, REACT_COMPILER_CONFIG_FILENAMES);

export const hasReactCompilerConfigurationInAncestors = (directory: string): boolean => {
  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    const ancestorPackageJson = isFile(ancestorPackagePath)
      ? readPackageJson(ancestorPackagePath)
      : {};
    if (
      hasCompilerInPackageJsonConfig(ancestorDirectory, ancestorPackageJson) ||
      hasCompilerInConfigFiles(ancestorDirectory, BABEL_CONFIG_FILENAMES)
    ) {
      return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};
