import ts from "typescript";

const hasReactEnabled = (expression: ts.Expression): boolean => {
  if (!ts.isObjectLiteralExpression(expression)) return false;

  return expression.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "react") ||
        (ts.isStringLiteralLike(property.name) && property.name.text === "react")) &&
      (property.initializer.kind === ts.SyntaxKind.TrueKeyword ||
        ts.isObjectLiteralExpression(property.initializer)),
  );
};

export const hasAntfuEslintReactConfig = (content: string): boolean => {
  const virtualFilePath = "eslint.config.ts";
  const sourceFile = ts.createSourceFile(
    virtualFilePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const compilerHost = ts.createCompilerHost(compilerOptions);
  compilerHost.fileExists = (candidatePath) => candidatePath === virtualFilePath;
  compilerHost.getSourceFile = (candidatePath) =>
    candidatePath === virtualFilePath ? sourceFile : undefined;
  compilerHost.readFile = (candidatePath) =>
    candidatePath === virtualFilePath ? content : undefined;
  const program = ts.createProgram({
    rootNames: [virtualFilePath],
    options: compilerOptions,
    host: compilerHost,
  });
  const boundSourceFile = program.getSourceFile(virtualFilePath);
  if (!boundSourceFile) return false;
  const typeChecker = program.getTypeChecker();
  const antfuFactorySymbols = new Set<ts.Symbol>();

  for (const statement of boundSourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@antfu/eslint-config" ||
      !statement.importClause?.name
    ) {
      continue;
    }
    const factorySymbol = typeChecker.getSymbolAtLocation(statement.importClause.name);
    if (factorySymbol) antfuFactorySymbols.add(factorySymbol);
  }

  let isReactEnabled = false;
  const visit = (node: ts.Node): void => {
    if (isReactEnabled) return;
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && node.arguments[0] && hasReactEnabled(node.arguments[0])) {
      const factorySymbol = typeChecker.getSymbolAtLocation(node.expression);
      if (factorySymbol && antfuFactorySymbols.has(factorySymbol)) {
        isReactEnabled = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of boundSourceFile.statements) {
    if (ts.isExportAssignment(statement)) visit(statement.expression);
  }
  return isReactEnabled;
};
