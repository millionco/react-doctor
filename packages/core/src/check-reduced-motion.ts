import * as fs from "node:fs";
import * as path from "node:path";
import { MOTION_LIBRARY_PACKAGES } from "oxlint-plugin-react-doctor";
import ts from "typescript";
import type { Diagnostic } from "./types/index.js";
import { getTypescriptScriptKind } from "./utils/get-typescript-script-kind.js";
import { unwrapTypescriptExpression } from "./utils/unwrap-typescript-expression.js";
import { walkSourceTreeFiles } from "./utils/walk-source-tree-files.js";
import { isFile, readPackageJson } from "./project-info/index.js";

interface MotionExpressionEvidence {
  isAnimationFunction: boolean;
  isMotionComponent: boolean;
  isMotionComponentFactory: boolean;
  isMotionComponentNamespace: boolean;
  isMotionConfig: boolean;
  isMotionNamespace: boolean;
  isReducedMotionHook: boolean;
}

export interface ProjectMotionEvidence {
  hasMotionUse: boolean;
  hasReducedMotionHandling: boolean;
}

export interface AnalyzeReducedMotionSourceInput {
  fileName: string;
  sourceText: string;
}

interface ScriptMotionSource {
  fileName: string;
  sourceText: string;
}

const EMPTY_MOTION_EXPRESSION_EVIDENCE: MotionExpressionEvidence = {
  isAnimationFunction: false,
  isMotionComponent: false,
  isMotionComponentFactory: false,
  isMotionComponentNamespace: false,
  isMotionConfig: false,
  isMotionNamespace: false,
  isReducedMotionHook: false,
};

const MOTION_COMPONENT_FACTORY_EXPORT_NAMES = new Set(["m", "motion"]);
const MOTION_COMPONENT_NAMESPACE_EXPORT_NAMES = new Set(["Reorder"]);
const MOTION_COMPONENT_NAMESPACE_MEMBER_NAMES = new Set(["Item"]);
const MOTION_ANIMATION_FUNCTION_EXPORT_NAMES = new Set(["animate"]);
const REDUCED_MOTION_HOOK_EXPORT_NAME = "useReducedMotion";
const MOTION_CONFIG_EXPORT_NAME = "MotionConfig";
const REDUCED_MOTION_PROP_NAME = "reducedMotion";
const REDUCED_MOTION_CONFIG_VALUES = new Set(["always", "user"]);
const SCRIPT_MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const SCRIPT_FILE_EXTENSIONS = new Set(SCRIPT_MODULE_EXTENSIONS);
const STYLE_FILE_EXTENSIONS = new Set([".css", ".scss"]);
const MOTION_SOURCE_PREFILTER =
  /framer-motion|["']motion(?:\/[A-Za-z0-9_./-]+)?["']|MotionConfig|useReducedMotion/;
const REDUCED_MOTION_MEDIA_QUERY_PATTERN =
  /@media\s+([^{}]*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[^{}]*)\{/gi;
const CSS_DECLARATION_PATTERN = /(?:^|[;{])\s*[-_A-Za-z][-_A-Za-z0-9]*\s*:/;

const MISSING_REDUCED_MOTION_DIAGNOSTIC: Diagnostic = {
  filePath: "package.json",
  plugin: "react-doctor",
  rule: "require-reduced-motion",
  severity: "error",
  message:
    "Project uses a motion library but has no prefers-reduced-motion handling — required for accessibility (WCAG 2.3.3)",
  help: "Add `useReducedMotion()` from your animation library, or a `@media (prefers-reduced-motion: reduce)` CSS query",
  line: 0,
  column: 0,
  category: "Accessibility",
};

const isMotionModuleSource = (moduleSource: string): boolean => {
  for (const packageName of MOTION_LIBRARY_PACKAGES) {
    if (moduleSource === packageName || moduleSource.startsWith(`${packageName}/`)) return true;
  }
  return false;
};

const classifyMotionExport = (exportName: string): MotionExpressionEvidence => ({
  isAnimationFunction: MOTION_ANIMATION_FUNCTION_EXPORT_NAMES.has(exportName),
  isMotionComponent: false,
  isMotionComponentFactory: MOTION_COMPONENT_FACTORY_EXPORT_NAMES.has(exportName),
  isMotionComponentNamespace: MOTION_COMPONENT_NAMESPACE_EXPORT_NAMES.has(exportName),
  isMotionConfig: exportName === MOTION_CONFIG_EXPORT_NAME,
  isMotionNamespace: false,
  isReducedMotionHook: exportName === REDUCED_MOTION_HOOK_EXPORT_NAME,
});

const getImportModuleSource = (node: ts.Node): string | null => {
  let currentNode: ts.Node | undefined = node;
  while (currentNode) {
    if (ts.isImportDeclaration(currentNode) && ts.isStringLiteral(currentNode.moduleSpecifier)) {
      return currentNode.moduleSpecifier.text;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const getImportedBindingEvidence = (
  declaration: ts.Declaration,
  typeChecker: ts.TypeChecker,
  program: ts.Program,
  visitedSymbols: Set<ts.Symbol>,
): MotionExpressionEvidence | null => {
  const moduleSource = getImportModuleSource(declaration);
  if (!moduleSource) return null;

  if (isMotionModuleSource(moduleSource) && ts.isNamespaceImport(declaration)) {
    return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionNamespace: true };
  }
  if (isMotionModuleSource(moduleSource) && ts.isImportSpecifier(declaration)) {
    if (declaration.isTypeOnly) return null;
    return classifyMotionExport(declaration.propertyName?.text ?? declaration.name.text);
  }
  if (isMotionModuleSource(moduleSource) && ts.isImportClause(declaration)) {
    if (declaration.isTypeOnly) return null;
    return EMPTY_MOTION_EXPRESSION_EVIDENCE;
  }
  if (
    (ts.isImportSpecifier(declaration) && !declaration.isTypeOnly) ||
    (ts.isImportClause(declaration) && !declaration.isTypeOnly && declaration.name)
  ) {
    const importedName = ts.isImportSpecifier(declaration)
      ? (declaration.propertyName?.text ?? declaration.name.text)
      : "default";
    const importingSourceFile = declaration.getSourceFile();
    const moduleSourceFile = getLocalModuleSourceFile(
      moduleSource,
      importingSourceFile.fileName,
      program,
    );
    if (!moduleSourceFile) return null;
    return resolveModuleExportEvidence(
      moduleSourceFile,
      importedName,
      typeChecker,
      program,
      visitedSymbols,
    );
  }
  return null;
};

const getLocalModuleSourceFile = (
  moduleSource: string,
  importingFileName: string,
  program: ts.Program,
): ts.SourceFile | null => {
  if (!moduleSource.startsWith(".")) return null;
  const moduleBasePath = path.resolve(path.dirname(importingFileName), moduleSource);
  const moduleBaseExtension = path.extname(moduleBasePath);
  const typescriptModuleBasePath =
    moduleBaseExtension === ".js" || moduleBaseExtension === ".jsx"
      ? moduleBasePath.slice(0, -moduleBaseExtension.length)
      : null;
  const candidates = [
    moduleBasePath,
    ...(typescriptModuleBasePath
      ? [
          `${typescriptModuleBasePath}.ts`,
          `${typescriptModuleBasePath}.tsx`,
          path.join(typescriptModuleBasePath, "index.ts"),
          path.join(typescriptModuleBasePath, "index.tsx"),
        ]
      : []),
    ...SCRIPT_MODULE_EXTENSIONS.map((extension) => `${moduleBasePath}${extension}`),
    ...SCRIPT_MODULE_EXTENSIONS.map((extension) => path.join(moduleBasePath, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    const sourceFile = program.getSourceFile(candidate);
    if (sourceFile) return sourceFile;
  }
  return null;
};

const resolveModuleExportEvidence = (
  sourceFile: ts.SourceFile,
  exportName: string,
  typeChecker: ts.TypeChecker,
  program: ts.Program,
  visitedSymbols: Set<ts.Symbol>,
): MotionExpressionEvidence => {
  const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol && visitedSymbols.has(moduleSymbol)) {
    return EMPTY_MOTION_EXPRESSION_EVIDENCE;
  }
  const nextVisitedSymbols = new Set(visitedSymbols);
  if (moduleSymbol) nextVisitedSymbols.add(moduleSymbol);

  for (const statement of sourceFile.statements) {
    if (exportName === "default" && ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const evidence = resolveMotionExpressionEvidence(
        statement.expression,
        typeChecker,
        program,
        nextVisitedSymbols,
      );
      if (hasMotionExpressionEvidence(evidence)) return evidence;
      continue;
    }
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    if (statement.isTypeOnly) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleSource = statement.moduleSpecifier.text;
    if (!statement.exportClause) {
      if (isMotionModuleSource(moduleSource)) {
        const evidence = classifyMotionExport(exportName);
        if (hasMotionExpressionEvidence(evidence)) return evidence;
        continue;
      }
      const moduleSourceFile = getLocalModuleSourceFile(moduleSource, sourceFile.fileName, program);
      if (moduleSourceFile) {
        const evidence = resolveModuleExportEvidence(
          moduleSourceFile,
          exportName,
          typeChecker,
          program,
          nextVisitedSymbols,
        );
        if (hasMotionExpressionEvidence(evidence)) return evidence;
      }
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const exportSpecifier of statement.exportClause.elements) {
      if (exportSpecifier.name.text !== exportName || exportSpecifier.isTypeOnly) continue;
      const sourceExportName = exportSpecifier.propertyName?.text ?? exportSpecifier.name.text;
      if (isMotionModuleSource(moduleSource)) return classifyMotionExport(sourceExportName);
      const moduleSourceFile = getLocalModuleSourceFile(moduleSource, sourceFile.fileName, program);
      if (!moduleSourceFile) continue;
      return resolveModuleExportEvidence(
        moduleSourceFile,
        sourceExportName,
        typeChecker,
        program,
        nextVisitedSymbols,
      );
    }
  }

  if (!moduleSymbol) return EMPTY_MOTION_EXPRESSION_EVIDENCE;
  const exportedSymbol = typeChecker
    .getExportsOfModule(moduleSymbol)
    .find((candidateSymbol) => candidateSymbol.name === exportName);
  if (!exportedSymbol || nextVisitedSymbols.has(exportedSymbol)) {
    return EMPTY_MOTION_EXPRESSION_EVIDENCE;
  }
  nextVisitedSymbols.add(exportedSymbol);

  let resolvedEvidence = EMPTY_MOTION_EXPRESSION_EVIDENCE;
  for (const declaration of exportedSymbol.declarations ?? []) {
    if (ts.isExportSpecifier(declaration)) {
      const targetSymbol = typeChecker.getExportSpecifierLocalTargetSymbol(declaration);
      for (const targetDeclaration of targetSymbol?.declarations ?? []) {
        const importedEvidence = getImportedBindingEvidence(
          targetDeclaration,
          typeChecker,
          program,
          nextVisitedSymbols,
        );
        if (importedEvidence) {
          resolvedEvidence = mergeMotionExpressionEvidence(resolvedEvidence, importedEvidence);
        }
        if (ts.isVariableDeclaration(targetDeclaration) && targetDeclaration.initializer) {
          resolvedEvidence = mergeMotionExpressionEvidence(
            resolvedEvidence,
            resolveMotionExpressionEvidence(
              targetDeclaration.initializer,
              typeChecker,
              program,
              nextVisitedSymbols,
            ),
          );
        }
      }
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      resolvedEvidence = mergeMotionExpressionEvidence(
        resolvedEvidence,
        resolveMotionExpressionEvidence(
          declaration.initializer,
          typeChecker,
          program,
          nextVisitedSymbols,
        ),
      );
    }
  }
  return resolvedEvidence;
};

const mergeMotionExpressionEvidence = (
  leftEvidence: MotionExpressionEvidence,
  rightEvidence: MotionExpressionEvidence,
): MotionExpressionEvidence => ({
  isAnimationFunction: leftEvidence.isAnimationFunction || rightEvidence.isAnimationFunction,
  isMotionComponent: leftEvidence.isMotionComponent || rightEvidence.isMotionComponent,
  isMotionComponentFactory:
    leftEvidence.isMotionComponentFactory || rightEvidence.isMotionComponentFactory,
  isMotionComponentNamespace:
    leftEvidence.isMotionComponentNamespace || rightEvidence.isMotionComponentNamespace,
  isMotionConfig: leftEvidence.isMotionConfig || rightEvidence.isMotionConfig,
  isMotionNamespace: leftEvidence.isMotionNamespace || rightEvidence.isMotionNamespace,
  isReducedMotionHook: leftEvidence.isReducedMotionHook || rightEvidence.isReducedMotionHook,
});

const hasMotionExpressionEvidence = (evidence: MotionExpressionEvidence): boolean =>
  evidence.isAnimationFunction ||
  evidence.isMotionComponent ||
  evidence.isMotionComponentFactory ||
  evidence.isMotionComponentNamespace ||
  evidence.isMotionConfig ||
  evidence.isMotionNamespace ||
  evidence.isReducedMotionHook;

const classifyMotionMember = (
  receiverEvidence: MotionExpressionEvidence,
  memberName: string,
): MotionExpressionEvidence => {
  if (receiverEvidence.isMotionNamespace) return classifyMotionExport(memberName);
  if (receiverEvidence.isMotionComponentFactory) {
    return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionComponent: true };
  }
  if (
    receiverEvidence.isMotionComponentNamespace &&
    MOTION_COMPONENT_NAMESPACE_MEMBER_NAMES.has(memberName)
  ) {
    return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionComponent: true };
  }
  return EMPTY_MOTION_EXPRESSION_EVIDENCE;
};

const resolveMotionExpressionEvidence = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  program: ts.Program,
  visitedSymbols: Set<ts.Symbol> = new Set(),
): MotionExpressionEvidence => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);

  if (ts.isIdentifier(unwrappedExpression)) {
    const symbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
    if (!symbol || visitedSymbols.has(symbol)) return EMPTY_MOTION_EXPRESSION_EVIDENCE;
    const nextVisitedSymbols = new Set(visitedSymbols);
    nextVisitedSymbols.add(symbol);

    let resolvedEvidence = EMPTY_MOTION_EXPRESSION_EVIDENCE;
    for (const declaration of symbol.declarations ?? []) {
      const importedEvidence = getImportedBindingEvidence(
        declaration,
        typeChecker,
        program,
        nextVisitedSymbols,
      );
      if (importedEvidence) {
        resolvedEvidence = mergeMotionExpressionEvidence(resolvedEvidence, importedEvidence);
        continue;
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        resolvedEvidence = mergeMotionExpressionEvidence(
          resolvedEvidence,
          resolveMotionExpressionEvidence(
            declaration.initializer,
            typeChecker,
            program,
            nextVisitedSymbols,
          ),
        );
      }
      if (
        ts.isBindingElement(declaration) &&
        ts.isObjectBindingPattern(declaration.parent) &&
        ts.isVariableDeclaration(declaration.parent.parent) &&
        declaration.parent.parent.initializer
      ) {
        const propertyName = declaration.propertyName ?? declaration.name;
        if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) {
          const receiverEvidence = resolveMotionExpressionEvidence(
            declaration.parent.parent.initializer,
            typeChecker,
            program,
            nextVisitedSymbols,
          );
          resolvedEvidence = mergeMotionExpressionEvidence(
            resolvedEvidence,
            classifyMotionMember(receiverEvidence, propertyName.text),
          );
        }
      }
    }
    return resolvedEvidence;
  }

  if (ts.isPropertyAccessExpression(unwrappedExpression)) {
    const receiverEvidence = resolveMotionExpressionEvidence(
      unwrappedExpression.expression,
      typeChecker,
      program,
      visitedSymbols,
    );
    return classifyMotionMember(receiverEvidence, unwrappedExpression.name.text);
  }

  if (
    ts.isElementAccessExpression(unwrappedExpression) &&
    unwrappedExpression.argumentExpression &&
    (ts.isStringLiteral(unwrappedExpression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(unwrappedExpression.argumentExpression))
  ) {
    const receiverEvidence = resolveMotionExpressionEvidence(
      unwrappedExpression.expression,
      typeChecker,
      program,
      visitedSymbols,
    );
    return classifyMotionMember(receiverEvidence, unwrappedExpression.argumentExpression.text);
  }

  if (ts.isCallExpression(unwrappedExpression)) {
    if (
      ts.isIdentifier(unwrappedExpression.expression) &&
      unwrappedExpression.expression.text === "require" &&
      !typeChecker.getSymbolAtLocation(unwrappedExpression.expression) &&
      unwrappedExpression.arguments.length === 1 &&
      ts.isStringLiteral(unwrappedExpression.arguments[0]) &&
      isMotionModuleSource(unwrappedExpression.arguments[0].text)
    ) {
      return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionNamespace: true };
    }
    if (
      ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
      unwrappedExpression.expression.name.text === "bind"
    ) {
      const boundReceiverEvidence = resolveMotionExpressionEvidence(
        unwrappedExpression.expression.expression,
        typeChecker,
        program,
        visitedSymbols,
      );
      if (boundReceiverEvidence.isAnimationFunction) return boundReceiverEvidence;
    }
    const calleeEvidence = resolveMotionExpressionEvidence(
      unwrappedExpression.expression,
      typeChecker,
      program,
      visitedSymbols,
    );
    if (calleeEvidence.isMotionComponentFactory) {
      return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionComponent: true };
    }
    return calleeEvidence;
  }

  return EMPTY_MOTION_EXPRESSION_EVIDENCE;
};

const getStaticStringExpressionValue = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: Set<ts.Symbol> = new Set(),
): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    ts.isStringLiteral(unwrappedExpression) ||
    ts.isNoSubstitutionTemplateLiteral(unwrappedExpression)
  ) {
    return unwrappedExpression.text;
  }
  if (!ts.isIdentifier(unwrappedExpression)) return null;
  const symbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
  if (!symbol || visitedSymbols.has(symbol)) return null;
  const nextVisitedSymbols = new Set(visitedSymbols);
  nextVisitedSymbols.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) continue;
    if (!ts.isVariableDeclarationList(declaration.parent)) continue;
    if (!(declaration.parent.flags & ts.NodeFlags.Const)) continue;
    const value = getStaticStringExpressionValue(
      declaration.initializer,
      typeChecker,
      nextVisitedSymbols,
    );
    if (value !== null) return value;
  }
  return null;
};

const getStaticJsxAttributeValue = (
  attribute: ts.JsxAttribute,
  typeChecker: ts.TypeChecker,
): string | null => {
  if (!attribute.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return null;
  return getStaticStringExpressionValue(attribute.initializer.expression, typeChecker);
};

const isExpressionValueConsumed = (expression: ts.Expression): boolean => {
  let currentExpression = expression;
  while (
    ts.isParenthesizedExpression(currentExpression.parent) ||
    ts.isAsExpression(currentExpression.parent) ||
    ts.isSatisfiesExpression(currentExpression.parent) ||
    ts.isNonNullExpression(currentExpression.parent) ||
    ts.isTypeAssertionExpression(currentExpression.parent)
  ) {
    currentExpression = currentExpression.parent;
  }
  return (
    !ts.isExpressionStatement(currentExpression.parent) &&
    !ts.isVoidExpression(currentExpression.parent)
  );
};

const jsxElementHasReducedMotionConfiguration = (
  attributes: ts.JsxAttributes,
  typeChecker: ts.TypeChecker,
): boolean =>
  attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === REDUCED_MOTION_PROP_NAME &&
      REDUCED_MOTION_CONFIG_VALUES.has(getStaticJsxAttributeValue(attribute, typeChecker) ?? ""),
  );

const collectScriptMotionEvidence = (
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  program: ts.Program,
): ProjectMotionEvidence => {
  const evidence: ProjectMotionEvidence = {
    hasMotionUse: false,
    hasReducedMotionHandling: false,
  };

  const visitNode = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeEvidence = resolveMotionExpressionEvidence(node.expression, typeChecker, program);
      const isAnimationFunctionCallViaCallOrApply =
        ((ts.isPropertyAccessExpression(node.expression) &&
          (node.expression.name.text === "call" || node.expression.name.text === "apply")) ||
          (ts.isElementAccessExpression(node.expression) &&
            node.expression.argumentExpression &&
            (ts.isStringLiteral(node.expression.argumentExpression) ||
              ts.isNoSubstitutionTemplateLiteral(node.expression.argumentExpression)) &&
            (node.expression.argumentExpression.text === "call" ||
              node.expression.argumentExpression.text === "apply"))) &&
        resolveMotionExpressionEvidence(node.expression.expression, typeChecker, program)
          .isAnimationFunction;
      if (calleeEvidence.isAnimationFunction || isAnimationFunctionCallViaCallOrApply) {
        evidence.hasMotionUse = true;
      }
      if (calleeEvidence.isReducedMotionHook && isExpressionValueConsumed(node)) {
        evidence.hasReducedMotionHandling = true;
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagEvidence = ts.isJsxNamespacedName(node.tagName)
        ? EMPTY_MOTION_EXPRESSION_EVIDENCE
        : resolveMotionExpressionEvidence(node.tagName, typeChecker, program);
      if (tagEvidence.isMotionComponent || tagEvidence.isMotionComponentFactory) {
        evidence.hasMotionUse = true;
      }
      if (
        tagEvidence.isMotionConfig &&
        jsxElementHasReducedMotionConfiguration(node.attributes, typeChecker)
      ) {
        evidence.hasReducedMotionHandling = true;
      }
    }

    ts.forEachChild(node, visitNode);
  };

  visitNode(sourceFile);
  return evidence;
};

export const analyzeReducedMotionSource = ({
  fileName,
  sourceText,
}: AnalyzeReducedMotionSourceInput): ProjectMotionEvidence => {
  if (!MOTION_SOURCE_PREFILTER.test(sourceText)) {
    return { hasMotionUse: false, hasReducedMotionHandling: false };
  }

  const sources = [{ fileName, sourceText }];
  return analyzeReducedMotionSources(sources);
};

const analyzeReducedMotionSources = (sources: ScriptMotionSource[]): ProjectMotionEvidence => {
  if (!sources.some(({ sourceText }) => MOTION_SOURCE_PREFILTER.test(sourceText))) {
    return { hasMotionUse: false, hasReducedMotionHandling: false };
  }

  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  };
  const sourceTextByFileName = new Map(
    sources.map(({ fileName: sourceFileName, sourceText: content }) => [
      path.resolve(sourceFileName),
      content,
    ]),
  );
  const compilerHost = ts.createCompilerHost(compilerOptions);
  const getDefaultSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.getSourceFile = (
    requestedFileName,
    languageVersionOrOptions,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    sourceTextByFileName.has(path.resolve(requestedFileName))
      ? ts.createSourceFile(
          path.resolve(requestedFileName),
          sourceTextByFileName.get(path.resolve(requestedFileName)) ?? "",
          languageVersionOrOptions,
          true,
          getTypescriptScriptKind(requestedFileName),
        )
      : getDefaultSourceFile(
          requestedFileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram([...sourceTextByFileName.keys()], compilerOptions, compilerHost);
  const typeChecker = program.getTypeChecker();
  const evidence: ProjectMotionEvidence = {
    hasMotionUse: false,
    hasReducedMotionHandling: false,
  };
  for (const sourceFileName of sourceTextByFileName.keys()) {
    const sourceFile = program.getSourceFile(sourceFileName);
    if (!sourceFile) continue;
    const fileEvidence = collectScriptMotionEvidence(sourceFile, typeChecker, program);
    evidence.hasMotionUse ||= fileEvidence.hasMotionUse;
    evidence.hasReducedMotionHandling ||= fileEvidence.hasReducedMotionHandling;
  }
  return evidence;
};

const removeCssCommentsAndStrings = (content: string): string => {
  let sanitizedContent = "";
  let quote: '"' | "'" | null = null;
  let isInsideComment = false;
  let isInsideLineComment = false;

  for (let characterIndex = 0; characterIndex < content.length; characterIndex += 1) {
    const character = content[characterIndex];
    const nextCharacter = content[characterIndex + 1];

    if (isInsideLineComment) {
      sanitizedContent += character === "\n" ? "\n" : " ";
      if (character === "\n") isInsideLineComment = false;
      continue;
    }

    if (isInsideComment) {
      if (character === "*" && nextCharacter === "/") {
        sanitizedContent += "  ";
        characterIndex += 1;
        isInsideComment = false;
      } else {
        sanitizedContent += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        sanitizedContent += "  ";
        characterIndex += 1;
        continue;
      }
      if (character === quote) quote = null;
      sanitizedContent += character === "\n" ? "\n" : " ";
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      sanitizedContent += "  ";
      characterIndex += 1;
      isInsideComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      sanitizedContent += "  ";
      characterIndex += 1;
      isInsideLineComment = true;
      continue;
    }

    if (character === '"' || character === "'") {
      sanitizedContent += " ";
      quote = character;
      continue;
    }

    sanitizedContent += character;
  }

  return sanitizedContent;
};

const findMatchingClosingBrace = (content: string, openingBraceIndex: number): number => {
  let depth = 0;
  for (
    let characterIndex = openingBraceIndex;
    characterIndex < content.length;
    characterIndex += 1
  ) {
    if (content[characterIndex] === "{") depth += 1;
    if (content[characterIndex] !== "}") continue;
    depth -= 1;
    if (depth === 0) return characterIndex;
  }
  return -1;
};

const hasReducedMotionMediaQuery = (content: string): boolean => {
  const sanitizedContent = removeCssCommentsAndStrings(content);
  REDUCED_MOTION_MEDIA_QUERY_PATTERN.lastIndex = 0;

  for (const match of sanitizedContent.matchAll(REDUCED_MOTION_MEDIA_QUERY_PATTERN)) {
    const mediaPrelude = match[1];
    if (/\bnot\b/i.test(mediaPrelude)) continue;
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    const closingBraceIndex = findMatchingClosingBrace(sanitizedContent, openingBraceIndex);
    if (closingBraceIndex === -1) continue;
    const body = sanitizedContent.slice(openingBraceIndex + 1, closingBraceIndex);
    if (CSS_DECLARATION_PATTERN.test(body)) return true;
  }

  return false;
};

const collectProjectMotionEvidence = (rootDirectory: string): ProjectMotionEvidence => {
  const scriptSources: ScriptMotionSource[] = [];
  let hasReducedMotionHandling = false;

  for (const { absolutePath, name } of walkSourceTreeFiles(rootDirectory)) {
    const extension = path.extname(name);
    if (!SCRIPT_FILE_EXTENSIONS.has(extension) && !STYLE_FILE_EXTENSIONS.has(extension)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      continue;
    }

    if (STYLE_FILE_EXTENSIONS.has(extension)) {
      if (hasReducedMotionMediaQuery(content)) hasReducedMotionHandling = true;
      continue;
    }
    scriptSources.push({ fileName: absolutePath, sourceText: content });
  }

  if (scriptSources.length === 0) {
    return { hasMotionUse: false, hasReducedMotionHandling };
  }

  const scriptEvidence = analyzeReducedMotionSources(scriptSources);
  const hasMotionUse = scriptEvidence.hasMotionUse;
  hasReducedMotionHandling ||= scriptEvidence.hasReducedMotionHandling;

  return { hasMotionUse, hasReducedMotionHandling };
};

export const checkReducedMotion = (rootDirectory: string): Diagnostic[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return [];

  try {
    const packageJson = readPackageJson(packageJsonPath);
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (
      !Object.keys(allDependencies).some((packageName) => MOTION_LIBRARY_PACKAGES.has(packageName))
    ) {
      return [];
    }
  } catch {
    return [];
  }

  const evidence = collectProjectMotionEvidence(rootDirectory);
  return evidence.hasMotionUse && !evidence.hasReducedMotionHandling
    ? [MISSING_REDUCED_MOTION_DIAGNOSTIC]
    : [];
};
