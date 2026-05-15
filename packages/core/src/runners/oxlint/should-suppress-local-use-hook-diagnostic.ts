import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

interface OxlintSpan {
  offset: number;
}

interface OxlintLabel {
  span: OxlintSpan;
}

interface OxlintDiagnosticCandidate {
  code: string;
  message: string;
  filename: string;
  labels: OxlintLabel[];
}

const RULES_OF_HOOKS_CODE = "react-hooks(rules-of-hooks)";
const REACT_HOOK_USE_MESSAGE_PREFIX = 'React Hook "use"';

const isFunctionLikeWithParameters = (
  node: ts.Node,
): node is ts.FunctionLikeDeclarationBase & { parameters: ts.NodeArray<ts.ParameterDeclaration> } =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const collectBindingNames = (node: ts.Node, names: Set<string>): void => {
  if (ts.isIdentifier(node)) {
    names.add(node.text);
    return;
  }

  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    for (const element of node.elements) {
      if (ts.isOmittedExpression(element)) continue;
      collectBindingNames(element.name, names);
    }
  }
};

const hasUseParameterBinding = (callExpression: ts.CallExpression): boolean => {
  let current: ts.Node | undefined = callExpression.parent;
  while (current) {
    if (isFunctionLikeWithParameters(current)) {
      for (const parameter of current.parameters) {
        const names = new Set<string>();
        collectBindingNames(parameter.name, names);
        if (names.has("use")) return true;
      }
    }
    current = current.parent;
  }
  return false;
};

const hasNonReactUseImport = (sourceFile: ts.SourceFile): boolean => {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text === "react") continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "use" && element.name.text === "use") return true;
    }
  }
  return false;
};

const findUseCallExpression = (
  sourceFile: ts.SourceFile,
  diagnosticOffset: number,
): ts.CallExpression | null => {
  let match: ts.CallExpression | null = null;

  const visit = (node: ts.Node): void => {
    if (match) return;
    if (ts.isCallExpression(node)) {
      const start = node.getStart(sourceFile);
      if (
        diagnosticOffset >= start &&
        diagnosticOffset < node.end &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "use"
      ) {
        match = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return match;
};

export const shouldSuppressLocalUseHookDiagnostic = (
  diagnostic: OxlintDiagnosticCandidate,
  rootDirectory: string,
): boolean => {
  if (diagnostic.code !== RULES_OF_HOOKS_CODE) return false;
  if (!diagnostic.message.startsWith(REACT_HOOK_USE_MESSAGE_PREFIX)) return false;
  const primaryLabel = diagnostic.labels[0];
  if (!primaryLabel) return false;

  const absolutePath = path.isAbsolute(diagnostic.filename)
    ? diagnostic.filename
    : path.join(rootDirectory, diagnostic.filename);

  let sourceText: string;
  try {
    sourceText = fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return false;
  }

  const sourceFile = ts.createSourceFile(
    diagnostic.filename,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    diagnostic.filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const useCallExpression = findUseCallExpression(sourceFile, primaryLabel.span.offset);
  if (!useCallExpression) return false;

  return hasUseParameterBinding(useCallExpression) || hasNonReactUseImport(sourceFile);
};
