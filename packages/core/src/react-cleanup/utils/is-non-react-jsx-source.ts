import ts from "typescript";

const NON_REACT_JSX_RUNTIME_PREFIXES = ["solid-js", "@builder.io/qwik"];
const NON_REACT_JSX_RUNTIME_PACKAGES = new Set(["voby", "vidode"]);
const REACT_JSX_RUNTIME_PREFIXES = ["react", "react-dom", "preact"];

const matchesPackagePrefix = (source: string, prefixes: ReadonlyArray<string>): boolean =>
  prefixes.some((prefix) => source === prefix || source.startsWith(`${prefix}/`));

const importDeclarationHasRuntimeValue = (declaration: ts.ImportDeclaration): boolean => {
  const importClause = declaration.importClause;
  if (!importClause) return true;
  if (importClause.isTypeOnly) return false;
  if (importClause.name || !importClause.namedBindings) return true;
  if (ts.isNamespaceImport(importClause.namedBindings)) return true;
  return importClause.namedBindings.elements.some((element) => !element.isTypeOnly);
};

const openingElementHasNonReactMarker = (openingElement: ts.JsxOpeningLikeElement): boolean =>
  openingElement.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return false;
    if (ts.isJsxNamespacedName(attribute.name)) {
      return attribute.name.namespace.text === "class" || attribute.name.namespace.text === "bind";
    }
    if (attribute.name.text !== "classList" || !attribute.initializer) return false;
    return (
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression !== undefined &&
      ts.isObjectLiteralExpression(attribute.initializer.expression)
    );
  });

export const isNonReactJsxSource = (sourceFile: ts.SourceFile): boolean => {
  let hasNonReactRuntime = false;
  let hasReactRuntime = false;
  let hasNonReactMarker = false;
  const visitNode = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && importDeclarationHasRuntimeValue(node)) {
      const source = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
      if (
        NON_REACT_JSX_RUNTIME_PACKAGES.has(source) ||
        matchesPackagePrefix(source, NON_REACT_JSX_RUNTIME_PREFIXES)
      ) {
        hasNonReactRuntime = true;
      }
      if (matchesPackagePrefix(source, REACT_JSX_RUNTIME_PREFIXES)) hasReactRuntime = true;
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      openingElementHasNonReactMarker(node)
    ) {
      hasNonReactMarker = true;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return !hasReactRuntime && (hasNonReactRuntime || hasNonReactMarker);
};
