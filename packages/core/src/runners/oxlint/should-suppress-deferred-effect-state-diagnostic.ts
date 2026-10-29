import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { getUtf16Offset } from "../../utils/get-utf16-offset.js";
import { getImportModuleSource } from "../../utils/get-import-module-source.js";
import { getTypescriptScriptKind } from "../../utils/get-typescript-script-kind.js";
import { unwrapTypescriptExpression } from "../../utils/unwrap-typescript-expression.js";

interface EffectStateDiagnostic {
  code: string;
  filename: string;
  labels: { span: { offset: number; length: number } }[];
}

interface EffectSourceIndex {
  identifiers: Map<string, Set<ts.Identifier>>;
  calls: ts.CallExpression[];
  hasReflection: boolean;
}

interface ParsedEffectSource {
  sourceText: string;
  sourceFile: ts.SourceFile;
  index: EffectSourceIndex;
}

const REFLECTION_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "require",
  "Function",
  "Object",
  "Reflect",
  "Promise",
  "globalThis",
  "global",
  "window",
  "self",
]);

const collectEffectSourceIndex = (sourceFile: ts.SourceFile): EffectSourceIndex => {
  const identifiers = new Map<string, Set<ts.Identifier>>();
  const calls: ts.CallExpression[] = [];
  const pendingNodes: ts.Node[] = [sourceFile];
  let hasReflection = false;
  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();
    if (!node) continue;
    if (ts.isIdentifier(node)) {
      const sameNameIdentifiers = identifiers.get(node.text) ?? new Set<ts.Identifier>();
      sameNameIdentifiers.add(node);
      identifiers.set(node.text, sameNameIdentifiers);
      if (REFLECTION_IDENTIFIER_NAMES.has(node.text)) hasReflection = true;
    }
    const memberName = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    if (memberName === "constructor" || memberName === "prototype") hasReflection = true;
    if (ts.isWithStatement(node)) hasReflection = true;
    if (ts.isCallExpression(node)) {
      calls.push(node);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) hasReflection = true;
    }
    ts.forEachChild(node, (child) => {
      pendingNodes.push(child);
    });
  }
  return { identifiers, calls, hasReflection };
};

const isInertPrimitive = (expression: ts.Expression): boolean => {
  const unwrapped = unwrapTypescriptExpression(expression);
  return (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped) ||
    ts.isNumericLiteral(unwrapped) ||
    unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isPrefixUnaryExpression(unwrapped) &&
      (unwrapped.operator === ts.SyntaxKind.PlusToken ||
        unwrapped.operator === ts.SyntaxKind.MinusToken) &&
      ts.isNumericLiteral(unwrapped.operand))
  );
};

const isAsyncZeroParameterFunction = (
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression =>
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
  node.parameters.length === 0 &&
  !(ts.isFunctionExpression(node) && node.asteriskToken) &&
  Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));

const getSoleCall = (body: ts.Block): ts.CallExpression | null => {
  if (body.statements.length !== 1) return null;
  const statement = body.statements[0];
  if (!ts.isExpressionStatement(statement)) return null;
  let expression = unwrapTypescriptExpression(statement.expression);
  if (ts.isVoidExpression(expression)) {
    expression = unwrapTypescriptExpression(expression.expression);
  }
  return ts.isCallExpression(expression) && !expression.questionDotToken ? expression : null;
};

const findDirectConst = (
  body: ts.Block,
  name: string,
  beforeStatement: ts.Statement,
): ts.VariableDeclaration | null => {
  for (const statement of body.statements) {
    if (statement === beforeStatement) return null;
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
    }
  }
  return null;
};

const hasOnlyAllowedIdentifiers = (
  index: EffectSourceIndex,
  name: string,
  allowedIdentifiers: ts.Identifier[],
): boolean => {
  const allowed = new Set(allowedIdentifiers);
  return [...(index.identifiers.get(name) ?? [])].every((identifier) => allowed.has(identifier));
};

const isNativeReactCall = (
  call: ts.CallExpression,
  importedName: string,
  sourceFile: ts.SourceFile,
  index: EffectSourceIndex,
): boolean => {
  const callee = unwrapTypescriptExpression(call.expression);
  if (!ts.isIdentifier(callee) || call.questionDotToken) return false;
  let matchingImport: ts.ImportSpecifier | null = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "react"
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) {
      return false;
    }
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const specifier of clause.namedBindings.elements) {
      if (specifier.name.text !== callee.text) continue;
      if (
        matchingImport ||
        specifier.isTypeOnly ||
        (specifier.propertyName?.text ?? specifier.name.text) !== importedName ||
        getImportModuleSource(specifier) !== "react"
      ) {
        return false;
      }
      matchingImport = specifier;
    }
  }
  if (!matchingImport) return false;
  const allowed = [matchingImport.name];
  if (matchingImport.propertyName && ts.isIdentifier(matchingImport.propertyName)) {
    allowed.push(matchingImport.propertyName);
  }
  for (const candidateCall of index.calls) {
    const candidateCallee = unwrapTypescriptExpression(candidateCall.expression);
    if (ts.isIdentifier(candidateCallee) && candidateCallee.text === callee.text) {
      allowed.push(candidateCallee);
    }
  }
  return hasOnlyAllowedIdentifiers(index, callee.text, allowed);
};

const hasDeferredLocalHelper = (
  helperCall: ts.CallExpression,
  sourceFile: ts.SourceFile,
  index: EffectSourceIndex,
): boolean => {
  const helperIdentifier = unwrapTypescriptExpression(helperCall.expression);
  if (!ts.isIdentifier(helperIdentifier) || helperCall.arguments.length !== 0) return false;
  let callbackNode: ts.Node | undefined = helperCall.parent;
  while (
    callbackNode &&
    !ts.isArrowFunction(callbackNode) &&
    !ts.isFunctionExpression(callbackNode)
  ) {
    callbackNode = callbackNode.parent;
  }
  if (
    !callbackNode ||
    !ts.isBlock(callbackNode.body) ||
    callbackNode.parameters.length !== 0 ||
    callbackNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
    (ts.isFunctionExpression(callbackNode) && callbackNode.asteriskToken) ||
    getSoleCall(callbackNode.body) !== helperCall
  ) {
    return false;
  }
  const effectCall = callbackNode.parent;
  if (
    !ts.isCallExpression(effectCall) ||
    effectCall.arguments[0] !== callbackNode ||
    effectCall.arguments.length !== 2 ||
    !isNativeReactCall(effectCall, "useEffect", sourceFile, index) ||
    !ts.isExpressionStatement(effectCall.parent) ||
    !ts.isBlock(effectCall.parent.parent)
  ) {
    return false;
  }
  const ownerBody = effectCall.parent.parent;
  if (
    !ts.isArrowFunction(ownerBody.parent) &&
    !ts.isFunctionExpression(ownerBody.parent) &&
    !ts.isFunctionDeclaration(ownerBody.parent)
  ) {
    return false;
  }
  if (
    ownerBody.parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
    (!ts.isArrowFunction(ownerBody.parent) && ownerBody.parent.asteriskToken)
  ) {
    return false;
  }
  const dependencies = unwrapTypescriptExpression(effectCall.arguments[1]);
  if (!ts.isArrayLiteralExpression(dependencies)) return false;
  const helperReferences = [helperIdentifier];
  for (const dependency of dependencies.elements) {
    const unwrappedDependency = unwrapTypescriptExpression(dependency);
    if (
      !ts.isIdentifier(unwrappedDependency) ||
      unwrappedDependency.text !== helperIdentifier.text
    ) {
      return false;
    }
    helperReferences.push(unwrappedDependency);
  }
  const declaration = findDirectConst(ownerBody, helperIdentifier.text, effectCall.parent);
  if (!declaration?.initializer || !ts.isIdentifier(declaration.name)) return false;
  helperReferences.push(declaration.name);
  if (!hasOnlyAllowedIdentifiers(index, helperIdentifier.text, helperReferences)) return false;
  let helper = unwrapTypescriptExpression(declaration.initializer);
  if (ts.isCallExpression(helper)) {
    if (
      !isNativeReactCall(helper, "useCallback", sourceFile, index) ||
      helper.arguments.length !== 2 ||
      !ts.isArrayLiteralExpression(helper.arguments[1]) ||
      helper.arguments[1].elements.length !== 0
    ) {
      return false;
    }
    helper = unwrapTypescriptExpression(helper.arguments[0]);
  }
  if (!isAsyncZeroParameterFunction(helper) || !ts.isBlock(helper.body)) return false;
  if (helper.body.statements.length !== 1) return false;
  const tryStatement = helper.body.statements[0];
  if (
    !ts.isTryStatement(tryStatement) ||
    tryStatement.finallyBlock ||
    !tryStatement.catchClause ||
    tryStatement.catchClause.variableDeclaration
  ) {
    return false;
  }
  const successCall = getSoleCall(tryStatement.tryBlock);
  const failureCall = getSoleCall(tryStatement.catchClause.block);
  if (
    !successCall ||
    !failureCall ||
    successCall.arguments.length !== 1 ||
    failureCall.arguments.length !== 1
  ) {
    return false;
  }
  const setterIdentifier = unwrapTypescriptExpression(successCall.expression);
  const failureSetter = unwrapTypescriptExpression(failureCall.expression);
  if (
    !ts.isIdentifier(setterIdentifier) ||
    !ts.isIdentifier(failureSetter) ||
    setterIdentifier.text !== failureSetter.text ||
    !isInertPrimitive(failureCall.arguments[0])
  ) {
    return false;
  }
  const awaitedValue = unwrapTypescriptExpression(successCall.arguments[0]);
  if (!ts.isAwaitExpression(awaitedValue)) return false;
  const producerCall = unwrapTypescriptExpression(awaitedValue.expression);
  if (
    !ts.isCallExpression(producerCall) ||
    producerCall.questionDotToken ||
    producerCall.arguments.length !== 0
  ) {
    return false;
  }
  const producerIdentifier = unwrapTypescriptExpression(producerCall.expression);
  if (!ts.isIdentifier(producerIdentifier)) return false;
  const producerDeclaration = findDirectConst(
    ownerBody,
    producerIdentifier.text,
    effectCall.parent,
  );
  if (!producerDeclaration?.initializer || !ts.isIdentifier(producerDeclaration.name)) return false;
  const producer = unwrapTypescriptExpression(producerDeclaration.initializer);
  if (!isAsyncZeroParameterFunction(producer)) return false;
  let producedValue: ts.Expression | undefined;
  if (ts.isBlock(producer.body)) {
    if (producer.body.statements.length !== 1) return false;
    const statement = producer.body.statements[0];
    if (!ts.isReturnStatement(statement)) return false;
    producedValue = statement.expression;
  } else {
    producedValue = producer.body;
  }
  if (!producedValue || !isInertPrimitive(producedValue)) return false;
  if (
    !hasOnlyAllowedIdentifiers(index, producerIdentifier.text, [
      producerDeclaration.name,
      producerIdentifier,
    ])
  ) {
    return false;
  }
  for (const statement of ownerBody.statements) {
    if (statement === effectCall.parent) return false;
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const stateDeclaration of statement.declarationList.declarations) {
      if (
        !ts.isArrayBindingPattern(stateDeclaration.name) ||
        stateDeclaration.name.elements.length !== 2 ||
        !stateDeclaration.initializer
      )
        continue;
      const setterBinding = stateDeclaration.name.elements[1];
      if (
        ts.isOmittedExpression(setterBinding) ||
        !ts.isIdentifier(setterBinding.name) ||
        setterBinding.name.text !== setterIdentifier.text ||
        setterBinding.initializer ||
        setterBinding.dotDotDotToken ||
        setterBinding.propertyName
      )
        continue;
      const stateInitializer = unwrapTypescriptExpression(stateDeclaration.initializer);
      if (
        !ts.isCallExpression(stateInitializer) ||
        !isNativeReactCall(stateInitializer, "useState", sourceFile, index)
      )
        continue;
      return hasOnlyAllowedIdentifiers(index, setterIdentifier.text, [
        setterBinding.name,
        setterIdentifier,
        failureSetter,
      ]);
    }
  }
  return false;
};

export const createDeferredEffectStateDiagnosticChecker = (rootDirectory: string) => {
  const parsedFiles = new Map<string, ParsedEffectSource | null>();
  const readAndParse = (filename: string): ParsedEffectSource | null => {
    const cached = parsedFiles.get(filename);
    if (cached !== undefined) return cached;
    let parsed: ParsedEffectSource | null;
    try {
      const sourceText = fs.readFileSync(filename, "utf8");
      const sourceFile = ts.createSourceFile(
        filename,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        getTypescriptScriptKind(filename),
      );
      parsed =
        "parseDiagnostics" in sourceFile &&
        Array.isArray(sourceFile.parseDiagnostics) &&
        sourceFile.parseDiagnostics.length > 0
          ? null
          : { sourceText, sourceFile, index: collectEffectSourceIndex(sourceFile) };
    } catch {
      parsed = null;
    }
    parsedFiles.set(filename, parsed);
    return parsed;
  };

  return (diagnostic: EffectStateDiagnostic): boolean => {
    if (diagnostic.code !== "react-hooks-js(set-state-in-effect)") return false;
    const span = diagnostic.labels[0]?.span;
    if (
      !span ||
      !Number.isInteger(span.offset) ||
      !Number.isInteger(span.length) ||
      span.offset < 0 ||
      span.length <= 0
    )
      return false;
    const filename = path.resolve(rootDirectory, diagnostic.filename);
    const parsed = readAndParse(filename);
    if (!parsed || parsed.index.hasReflection) return false;
    const { sourceText, sourceFile, index } = parsed;
    const calleeOffset = getUtf16Offset(sourceText, span.offset);
    const helperCall = index.calls.find((call) => {
      const callee = unwrapTypescriptExpression(call.expression);
      return ts.isIdentifier(callee) && callee.getStart(sourceFile) === calleeOffset;
    });
    if (!helperCall || helperCall.questionDotToken) return false;
    const callee = unwrapTypescriptExpression(helperCall.expression);
    return (
      Buffer.byteLength(sourceText.slice(0, calleeOffset)) === span.offset &&
      Buffer.byteLength(callee.getText(sourceFile)) === span.length &&
      hasDeferredLocalHelper(helperCall, sourceFile, index)
    );
  };
};
