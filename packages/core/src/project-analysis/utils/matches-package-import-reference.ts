import ts from "typescript";
import { extractPackageName } from "./package-name.js";

const getStaticModuleSpecifier = (expression: ts.Expression): string | undefined =>
  ts.isStringLiteralLike(expression) ? expression.text : undefined;

export const collectPackageImportNames = (content: string): Set<string> => {
  const sourceFile = ts.createSourceFile(
    "package-reference.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const packageNames = new Set<string>();
  const addSpecifier = (specifier: string): void => {
    const packageName = extractPackageName(specifier);
    if (packageName) packageNames.add(packageName);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addSpecifier(node.moduleSpecifier.text);
      return;
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addSpecifier(node.moduleReference.expression.text);
      return;
    }

    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const specifier = getStaticModuleSpecifier(node.argument.literal);
      if (specifier) {
        addSpecifier(specifier);
        return;
      }
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const specifier = getStaticModuleSpecifier(node.arguments[0]);
      if ((isRequireCall || isDynamicImport) && specifier) {
        addSpecifier(specifier);
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return packageNames;
};

export const matchesPackageImportReference = (content: string, packageName: string): boolean =>
  collectPackageImportNames(content).has(packageName);
