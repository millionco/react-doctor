import ts from "typescript";

export interface JitiLoadReference {
  column: number;
  line: number;
  path: string | undefined;
}

export const extractJitiLoadReferences = (sourceText: string): JitiLoadReference[] => {
  if (!sourceText.includes("jiti")) return [];
  const virtualFilePath = "react-doctor-jiti-source.tsx";
  const sourceFile = ts.createSourceFile(
    virtualFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const compilerHost = ts.createCompilerHost(compilerOptions);
  compilerHost.fileExists = (candidatePath) => candidatePath === virtualFilePath;
  compilerHost.getSourceFile = (candidatePath) =>
    candidatePath === virtualFilePath ? sourceFile : undefined;
  compilerHost.readFile = (candidatePath) =>
    candidatePath === virtualFilePath ? sourceText : undefined;
  const program = ts.createProgram({
    rootNames: [virtualFilePath],
    options: compilerOptions,
    host: compilerHost,
  });
  const boundSourceFile = program.getSourceFile(virtualFilePath);
  if (!boundSourceFile) return [{ path: undefined, line: 0, column: 0 }];
  const typeChecker = program.getTypeChecker();
  const factorySymbols = new Set<ts.Symbol>();
  const moduleSymbols = new Set<ts.Symbol>();
  const loaderSymbols = new Set<ts.Symbol>();

  const isRequireJitiCall = (expression: ts.Expression): expression is ts.CallExpression =>
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "require" &&
    typeChecker.getSymbolAtLocation(expression.expression) === undefined &&
    expression.arguments.length === 1 &&
    ts.isStringLiteralLike(expression.arguments[0]) &&
    expression.arguments[0].text === "jiti";

  for (const statement of boundSourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "jiti"
    ) {
      const importClause = statement.importClause;
      if (!importClause) continue;
      if (importClause.name) {
        const defaultImportSymbol = typeChecker.getSymbolAtLocation(importClause.name);
        if (defaultImportSymbol) factorySymbols.add(defaultImportSymbol);
      }
      if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        const moduleSymbol = typeChecker.getSymbolAtLocation(importClause.namedBindings.name);
        if (moduleSymbol) moduleSymbols.add(moduleSymbol);
      }
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const importSpecifier of importClause.namedBindings.elements) {
          if ((importSpecifier.propertyName?.text ?? importSpecifier.name.text) !== "createJiti") {
            continue;
          }
          const factorySymbol = typeChecker.getSymbolAtLocation(importSpecifier.name);
          if (factorySymbol) factorySymbols.add(factorySymbol);
        }
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer || !isRequireJitiCall(declaration.initializer)) continue;
      if (ts.isIdentifier(declaration.name)) {
        const moduleSymbol = typeChecker.getSymbolAtLocation(declaration.name);
        if (moduleSymbol) moduleSymbols.add(moduleSymbol);
        continue;
      }
      if (!ts.isObjectBindingPattern(declaration.name)) continue;
      for (const bindingElement of declaration.name.elements) {
        const importedName = bindingElement.propertyName ?? bindingElement.name;
        if (!ts.isIdentifier(importedName) || importedName.text !== "createJiti") continue;
        if (!ts.isIdentifier(bindingElement.name)) continue;
        const factorySymbol = typeChecker.getSymbolAtLocation(bindingElement.name);
        if (factorySymbol) factorySymbols.add(factorySymbol);
      }
    }
  }

  const isRequireJitiFactoryCall = (expression: ts.Expression): boolean =>
    ts.isCallExpression(expression) && isRequireJitiCall(expression.expression);
  const isFactoryExpression = (expression: ts.Expression): boolean => {
    const factorySymbol = typeChecker.getSymbolAtLocation(expression);
    if (factorySymbol && factorySymbols.has(factorySymbol)) return true;
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "createJiti") {
      return false;
    }
    const moduleSymbol = typeChecker.getSymbolAtLocation(expression.expression);
    return moduleSymbol !== undefined && moduleSymbols.has(moduleSymbol);
  };
  const collectLoaderBindings = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      if (
        isRequireJitiFactoryCall(node.initializer) ||
        isFactoryExpression(node.initializer.expression)
      ) {
        const loaderSymbol = typeChecker.getSymbolAtLocation(node.name);
        if (loaderSymbol) loaderSymbols.add(loaderSymbol);
      }
    }
    ts.forEachChild(node, collectLoaderBindings);
  };
  collectLoaderBindings(boundSourceFile);

  const references: JitiLoadReference[] = [];
  const recordLoaderCall = (callExpression: ts.CallExpression): void => {
    const firstArgument = callExpression.arguments[0];
    const position = boundSourceFile.getLineAndCharacterOfPosition(callExpression.getStart());
    references.push({
      path: firstArgument && ts.isStringLiteralLike(firstArgument) ? firstArgument.text : undefined,
      line: position.line + 1,
      column: position.character,
    });
  };
  const visitLoaderCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeSymbol = typeChecker.getSymbolAtLocation(node.expression);
      if (calleeSymbol && loaderSymbols.has(calleeSymbol)) {
        recordLoaderCall(node);
      } else if (ts.isCallExpression(node.expression)) {
        if (
          isRequireJitiFactoryCall(node.expression) ||
          isFactoryExpression(node.expression.expression)
        ) {
          recordLoaderCall(node);
        }
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "import"
      ) {
        const loaderExpression = node.expression.expression;
        const loaderSymbol = typeChecker.getSymbolAtLocation(loaderExpression);
        const isInlineFactory =
          ts.isCallExpression(loaderExpression) && isFactoryExpression(loaderExpression.expression);
        if ((loaderSymbol && loaderSymbols.has(loaderSymbol)) || isInlineFactory) {
          recordLoaderCall(node);
        }
      }
    }
    ts.forEachChild(node, visitLoaderCalls);
  };
  visitLoaderCalls(boundSourceFile);
  return references;
};
