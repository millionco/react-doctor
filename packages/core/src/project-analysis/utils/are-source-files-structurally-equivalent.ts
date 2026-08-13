import ts from "typescript";

const buildSourceStructure = (filePath: string, sourceText: string): string => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const structure: string[] = [];

  const visitNode = (node: ts.Node, normalizeClassNames = false): void => {
    structure.push(String(node.kind));
    if (ts.isIdentifier(node)) {
      structure.push(node.text);
    } else if (ts.isStringLiteralLike(node)) {
      structure.push(
        normalizeClassNames ? node.text.trim().split(/\s+/).sort().join(" ") : node.text,
      );
    } else if (ts.isNumericLiteral(node)) {
      structure.push(node.text);
    } else if (
      ts.isTemplateLiteralToken(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isBigIntLiteral(node)
    ) {
      structure.push(node.text);
    } else if (ts.isJsxText(node)) {
      structure.push(node.text.replace(/\s+/g, " ").trim());
    }

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "className" &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      visitNode(node.name);
      visitNode(node.initializer, true);
      return;
    }
    ts.forEachChild(node, (childNode) => visitNode(childNode));
  };

  visitNode(sourceFile);
  return structure.join("\0");
};

export const areSourceFilesStructurallyEquivalent = (
  filePath: string,
  firstSourceText: string,
  secondSourceText: string,
): boolean =>
  buildSourceStructure(filePath, firstSourceText) ===
  buildSourceStructure(filePath, secondSourceText);
