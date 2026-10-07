import ts from "typescript";
import { getObjectLiteralElementName } from "./get-object-literal-element-name.js";

const KARMA_FRAMEWORK_PACKAGES = new Map<string, ReadonlyArray<string>>([
  ["chai", ["karma-chai"]],
  ["jasmine", ["karma-jasmine"]],
  ["mocha", ["karma-mocha"]],
  ["sinon", ["karma-sinon"]],
  ["sinon-chai", ["karma-chai-plugins"]],
]);

const KARMA_REPORTER_PACKAGES = new Map<string, ReadonlyArray<string>>([
  ["coverage", ["karma-coverage"]],
  ["coveralls", ["karma-coveralls"]],
  ["mocha", ["karma-mocha-reporter"]],
  ["spec", ["karma-spec-reporter"]],
]);

const KARMA_PREPROCESSOR_PACKAGES = new Map<string, ReadonlyArray<string>>([
  ["babel", ["karma-babel-preprocessor"]],
  ["sourcemap", ["karma-sourcemap-loader"]],
  ["webpack", ["karma-webpack"]],
]);

const KARMA_BROWSER_PACKAGES = new Map<string, ReadonlyArray<string>>([
  ["Chrome", ["karma-chrome-launcher"]],
  ["ChromeCanary", ["karma-chrome-launcher"]],
  ["ChromeHeadless", ["karma-chrome-launcher"]],
  ["Edge", ["karma-edge-launcher"]],
  ["Firefox", ["karma-firefox-launcher"]],
  ["IE", ["karma-ie-launcher"]],
  ["jsdom", ["karma-jsdom-launcher"]],
  ["Opera", ["karma-opera-launcher"]],
  ["PhantomJS", ["karma-phantomjs-launcher"]],
  ["Safari", ["karma-safari-launcher"]],
]);

const collectExpressionStrings = (
  expression: ts.Expression,
  identifierStrings: ReadonlyMap<string, ReadonlySet<string>>,
  strings: Set<string>,
): void => {
  if (ts.isStringLiteralLike(expression)) {
    strings.add(expression.text);
    return;
  }
  if (ts.isIdentifier(expression)) {
    for (const value of identifierStrings.get(expression.text) ?? []) strings.add(value);
    return;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        collectExpressionStrings(element.expression, identifierStrings, strings);
      } else {
        collectExpressionStrings(element, identifierStrings, strings);
      }
    }
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    collectExpressionStrings(expression.whenTrue, identifierStrings, strings);
    collectExpressionStrings(expression.whenFalse, identifierStrings, strings);
    return;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property)) {
        collectExpressionStrings(property.initializer, identifierStrings, strings);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        for (const value of identifierStrings.get(property.name.text) ?? []) strings.add(value);
      }
    }
  }
};

const collectIdentifierStrings = (sourceFile: ts.SourceFile): Map<string, Set<string>> => {
  const identifierStrings = new Map<string, Set<string>>();
  const addExpression = (identifierName: string, expression: ts.Expression): void => {
    const strings = identifierStrings.get(identifierName) ?? new Set<string>();
    collectExpressionStrings(expression, identifierStrings, strings);
    identifierStrings.set(identifierName, strings);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      addExpression(node.name.text, node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      addExpression(node.left.text, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifierStrings;
};

const collectPropertyStrings = (
  property: ts.ObjectLiteralElementLike,
  identifierStrings: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> => {
  const strings = new Set<string>();
  if (ts.isPropertyAssignment(property)) {
    collectExpressionStrings(property.initializer, identifierStrings, strings);
  } else if (ts.isShorthandPropertyAssignment(property)) {
    for (const value of identifierStrings.get(property.name.text) ?? []) strings.add(value);
  }
  return strings;
};

export const extractKarmaConfigPackageReferences = (
  content: string,
  declaredPackageNames: ReadonlySet<string>,
): string[] => {
  const sourceFile = ts.createSourceFile(
    "karma.config.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const identifierStrings = collectIdentifierStrings(sourceFile);
  const referencedPackages = new Set<string>();
  const propertyPackageMaps = new Map<string, ReadonlyMap<string, ReadonlyArray<string>>>([
    ["frameworks", KARMA_FRAMEWORK_PACKAGES],
    ["reporters", KARMA_REPORTER_PACKAGES],
    ["preprocessors", KARMA_PREPROCESSOR_PACKAGES],
    ["browsers", KARMA_BROWSER_PACKAGES],
  ]);
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const packageMap = propertyPackageMaps.get(getObjectLiteralElementName(property) ?? "");
        if (!packageMap) continue;
        for (const token of collectPropertyStrings(property, identifierStrings)) {
          for (const packageName of packageMap.get(token) ?? []) {
            if (declaredPackageNames.has(packageName)) referencedPackages.add(packageName);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...referencedPackages];
};
