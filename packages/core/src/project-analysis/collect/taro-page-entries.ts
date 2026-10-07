import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";

const TARO_APP_CONFIG_GLOB = "src/app.config.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";
const TARO_PACKAGE_NAMES = ["@tarojs/cli", "@tarojs/react", "@tarojs/runtime"];
const TARO_ARRAY_SELECTION_METHODS = new Set(["filter", "slice", "splice"]);

const getPropertyName = (propertyName: ts.PropertyName): string | undefined => {
  if (
    ts.isIdentifier(propertyName) ||
    ts.isStringLiteral(propertyName) ||
    ts.isNoSubstitutionTemplateLiteral(propertyName)
  ) {
    return propertyName.text;
  }
  return undefined;
};

const unwrapConfigExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapConfigExpression(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    const [configArgument] = expression.arguments;
    return configArgument ? unwrapConfigExpression(configArgument) : expression;
  }
  return expression;
};

const unwrapArrayExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapArrayExpression(expression.expression);
  }
  return expression;
};

const getPropertyInitializer = (
  objectLiteral: ts.ObjectLiteralExpression,
  propertyNames: ReadonlySet<string>,
): ts.Expression | undefined => {
  for (const property of objectLiteral.properties) {
    if (ts.isShorthandPropertyAssignment(property) && propertyNames.has(property.name.text)) {
      return property.name;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = getPropertyName(property.name);
    if (propertyName && propertyNames.has(propertyName)) return property.initializer;
  }
  return undefined;
};

const collectArrayElements = (
  expression: ts.Expression | undefined,
  variableInitializers: ReadonlyMap<string, ts.Expression>,
  pushedElements: ReadonlyMap<string, ReadonlyArray<ts.Expression>>,
  visitedIdentifiers = new Set<string>(),
): ts.Expression[] => {
  if (!expression) return [];
  const unwrappedExpression = unwrapArrayExpression(expression);
  if (ts.isArrayLiteralExpression(unwrappedExpression)) {
    return [...unwrappedExpression.elements];
  }
  if (ts.isConditionalExpression(unwrappedExpression)) {
    return [
      ...collectArrayElements(
        unwrappedExpression.whenTrue,
        variableInitializers,
        pushedElements,
        visitedIdentifiers,
      ),
      ...collectArrayElements(
        unwrappedExpression.whenFalse,
        variableInitializers,
        pushedElements,
        visitedIdentifiers,
      ),
    ];
  }
  if (
    ts.isCallExpression(unwrappedExpression) &&
    ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
    TARO_ARRAY_SELECTION_METHODS.has(unwrappedExpression.expression.name.text)
  ) {
    return collectArrayElements(
      unwrappedExpression.expression.expression,
      variableInitializers,
      pushedElements,
      visitedIdentifiers,
    );
  }
  if (ts.isIdentifier(unwrappedExpression) && !visitedIdentifiers.has(unwrappedExpression.text)) {
    const nextVisitedIdentifiers = new Set(visitedIdentifiers).add(unwrappedExpression.text);
    return [
      ...collectArrayElements(
        variableInitializers.get(unwrappedExpression.text),
        variableInitializers,
        pushedElements,
        nextVisitedIdentifiers,
      ),
      ...(pushedElements.get(unwrappedExpression.text) ?? []),
    ];
  }
  return [];
};

const collectPagePaths = (
  expression: ts.Expression | undefined,
  variableInitializers: ReadonlyMap<string, ts.Expression>,
  pushedElements: ReadonlyMap<string, ReadonlyArray<ts.Expression>>,
): string[] =>
  collectArrayElements(expression, variableInitializers, pushedElements).flatMap((element) =>
    ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)
      ? [element.text]
      : [],
  );

const resolvePageEntries = (configDirectory: string, pagePaths: ReadonlyArray<string>): string[] =>
  pagePaths.flatMap((pagePath) => {
    const resolvedEntry = resolveEntryWithExtensions(resolve(configDirectory, pagePath));
    return resolvedEntry ? [resolvedEntry] : [];
  });

const collectConfigPageEntries = (
  configDirectory: string,
  configObject: ts.ObjectLiteralExpression,
  variableInitializers: ReadonlyMap<string, ts.Expression>,
  pushedElements: ReadonlyMap<string, ReadonlyArray<ts.Expression>>,
): string[] => {
  const entries = resolvePageEntries(
    configDirectory,
    collectPagePaths(
      getPropertyInitializer(configObject, new Set(["pages"])),
      variableInitializers,
      pushedElements,
    ),
  );
  const subPackagesExpression = getPropertyInitializer(
    configObject,
    new Set(["subPackages", "subpackages"]),
  );
  for (const subPackageElement of collectArrayElements(
    subPackagesExpression,
    variableInitializers,
    pushedElements,
  )) {
    if (!ts.isObjectLiteralExpression(subPackageElement)) continue;
    const rootExpression = getPropertyInitializer(subPackageElement, new Set(["root"]));
    if (
      !rootExpression ||
      (!ts.isStringLiteral(rootExpression) && !ts.isNoSubstitutionTemplateLiteral(rootExpression))
    ) {
      continue;
    }
    const subPackagePages = collectPagePaths(
      getPropertyInitializer(subPackageElement, new Set(["pages"])),
      variableInitializers,
      pushedElements,
    ).map((pagePath) => `${rootExpression.text}/${pagePath}`);
    entries.push(...resolvePageEntries(configDirectory, subPackagePages));
  }

  return entries;
};

const collectVariableInitializers = (sourceFile: ts.SourceFile): Map<string, ts.Expression> => {
  const variableInitializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        variableInitializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return variableInitializers;
};

const collectShadowedBindingNames = (
  bindingName: ts.BindingName,
  topLevelVariableNames: ReadonlySet<string>,
): string[] => {
  if (ts.isIdentifier(bindingName)) {
    return topLevelVariableNames.has(bindingName.text) ? [bindingName.text] : [];
  }
  return bindingName.elements.flatMap((bindingElement) =>
    ts.isBindingElement(bindingElement)
      ? collectShadowedBindingNames(bindingElement.name, topLevelVariableNames)
      : [],
  );
};

const collectPushedElements = (
  sourceFile: ts.SourceFile,
  topLevelVariableNames: ReadonlySet<string>,
): Map<string, ReadonlyArray<ts.Expression>> => {
  const pushedElements = new Map<string, ts.Expression[]>();
  const visitNode = (node: ts.Node, shadowedNames: ReadonlySet<string>): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      return;
    }
    let nextShadowedNames = shadowedNames;
    const shadowBindingNames = (bindingNames: ReadonlyArray<ts.BindingName>): void => {
      const newlyShadowedNames = bindingNames.flatMap((bindingName) =>
        collectShadowedBindingNames(bindingName, topLevelVariableNames),
      );
      if (newlyShadowedNames.length > 0) {
        nextShadowedNames = new Set([...nextShadowedNames, ...newlyShadowedNames]);
      }
    };
    if (ts.isBlock(node)) {
      shadowBindingNames(
        node.statements.flatMap((statement) => {
          if (
            !ts.isVariableStatement(statement) ||
            !(statement.declarationList.flags & ts.NodeFlags.BlockScoped)
          ) {
            return [];
          }
          return statement.declarationList.declarations.map((declaration) => declaration.name);
        }),
      );
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      shadowBindingNames([node.variableDeclaration.name]);
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const initializer = node.initializer;
      if (
        initializer &&
        ts.isVariableDeclarationList(initializer) &&
        initializer.flags & ts.NodeFlags.BlockScoped
      ) {
        shadowBindingNames(initializer.declarations.map((declaration) => declaration.name));
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      ts.isIdentifier(node.expression.expression) &&
      topLevelVariableNames.has(node.expression.expression.text) &&
      !nextShadowedNames.has(node.expression.expression.text)
    ) {
      const identifier = node.expression.expression.text;
      const existingElements = pushedElements.get(identifier) ?? [];
      existingElements.push(...node.arguments);
      pushedElements.set(identifier, existingElements);
    }
    ts.forEachChild(node, (childNode) => visitNode(childNode, nextShadowedNames));
  };
  visitNode(sourceFile, new Set());
  return pushedElements;
};

const extractConfigObject = (
  sourceFile: ts.SourceFile,
  variableInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined => {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    let expression = unwrapConfigExpression(statement.expression);
    const visitedIdentifiers = new Set<string>();
    while (ts.isIdentifier(expression) && !visitedIdentifiers.has(expression.text)) {
      visitedIdentifiers.add(expression.text);
      const initializer = variableInitializers.get(expression.text);
      if (!initializer) break;
      expression = unwrapConfigExpression(initializer);
    }
    if (ts.isObjectLiteralExpression(expression)) return expression;
  }
  return undefined;
};

export const extractTaroPageEntries = (
  directory: string,
  dependencies: Readonly<Record<string, string>>,
): string[] => {
  if (!TARO_PACKAGE_NAMES.some((packageName) => packageName in dependencies)) return [];

  const entries = new Set<string>();
  const configPaths = fg.sync(TARO_APP_CONFIG_GLOB, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });
  for (const configPath of configPaths) {
    try {
      const sourceText = readFileSync(configPath, "utf8");
      const sourceFile = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true);
      const variableInitializers = collectVariableInitializers(sourceFile);
      const pushedElements = collectPushedElements(
        sourceFile,
        new Set(variableInitializers.keys()),
      );
      const configObject = extractConfigObject(sourceFile, variableInitializers);
      if (!configObject) continue;
      for (const entry of collectConfigPageEntries(
        dirname(configPath),
        configObject,
        variableInitializers,
        pushedElements,
      )) {
        entries.add(entry);
      }
    } catch {
      continue;
    }
  }
  return [...entries];
};
