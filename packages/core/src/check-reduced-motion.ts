import * as fs from "node:fs";
import * as path from "node:path";
import { MOTION_LIBRARY_PACKAGES } from "oxlint-plugin-react-doctor";
import ts from "typescript";
import type { Diagnostic } from "./types/index.js";
import { walkSourceTreeFiles } from "./utils/walk-source-tree-files.js";
import { isFile, readPackageJson } from "./project-info/index.js";

interface MotionExpressionEvidence {
  isAnimationFunction: boolean;
  isMotionComponent: boolean;
  isMotionComponentFactory: boolean;
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

const EMPTY_MOTION_EXPRESSION_EVIDENCE: MotionExpressionEvidence = {
  isAnimationFunction: false,
  isMotionComponent: false,
  isMotionComponentFactory: false,
  isMotionConfig: false,
  isMotionNamespace: false,
  isReducedMotionHook: false,
};

const MOTION_COMPONENT_FACTORY_EXPORT_NAMES = new Set(["m", "motion"]);
const MOTION_COMPONENT_EXPORT_NAMES = new Set([
  "AnimatePresence",
  "LayoutGroup",
  "LazyMotion",
  "MotionConfig",
  "Reorder",
]);
const MOTION_ANIMATION_FUNCTION_EXPORT_NAMES = new Set([
  "animate",
  "inView",
  "scroll",
  "spring",
  "stagger",
  "useAnimate",
  "useAnimation",
  "useAnimationControls",
  "useMotionValue",
  "useScroll",
  "useSpring",
  "useTime",
  "useTransform",
  "useVelocity",
]);
const REDUCED_MOTION_HOOK_EXPORT_NAME = "useReducedMotion";
const MOTION_CONFIG_EXPORT_NAME = "MotionConfig";
const REDUCED_MOTION_PROP_NAME = "reducedMotion";
const REDUCED_MOTION_CONFIG_VALUES = new Set(["always", "user"]);
const SCRIPT_FILE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
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
  isMotionComponent: MOTION_COMPONENT_EXPORT_NAMES.has(exportName),
  isMotionComponentFactory: MOTION_COMPONENT_FACTORY_EXPORT_NAMES.has(exportName),
  isMotionConfig: exportName === MOTION_CONFIG_EXPORT_NAME,
  isMotionNamespace: false,
  isReducedMotionHook: exportName === REDUCED_MOTION_HOOK_EXPORT_NAME,
});

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let currentExpression = expression;
  while (
    ts.isParenthesizedExpression(currentExpression) ||
    ts.isAsExpression(currentExpression) ||
    ts.isSatisfiesExpression(currentExpression) ||
    ts.isNonNullExpression(currentExpression) ||
    ts.isTypeAssertionExpression(currentExpression)
  ) {
    currentExpression = currentExpression.expression;
  }
  return currentExpression;
};

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
): MotionExpressionEvidence | null => {
  const moduleSource = getImportModuleSource(declaration);
  if (!moduleSource || !isMotionModuleSource(moduleSource)) return null;

  if (ts.isNamespaceImport(declaration)) {
    return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionNamespace: true };
  }
  if (ts.isImportSpecifier(declaration)) {
    if (declaration.isTypeOnly) return null;
    return classifyMotionExport(declaration.propertyName?.text ?? declaration.name.text);
  }
  if (ts.isImportClause(declaration)) {
    if (declaration.isTypeOnly) return null;
    return EMPTY_MOTION_EXPRESSION_EVIDENCE;
  }
  return null;
};

const mergeMotionExpressionEvidence = (
  leftEvidence: MotionExpressionEvidence,
  rightEvidence: MotionExpressionEvidence,
): MotionExpressionEvidence => ({
  isAnimationFunction: leftEvidence.isAnimationFunction || rightEvidence.isAnimationFunction,
  isMotionComponent: leftEvidence.isMotionComponent || rightEvidence.isMotionComponent,
  isMotionComponentFactory:
    leftEvidence.isMotionComponentFactory || rightEvidence.isMotionComponentFactory,
  isMotionConfig: leftEvidence.isMotionConfig || rightEvidence.isMotionConfig,
  isMotionNamespace: leftEvidence.isMotionNamespace || rightEvidence.isMotionNamespace,
  isReducedMotionHook: leftEvidence.isReducedMotionHook || rightEvidence.isReducedMotionHook,
});

const resolveMotionExpressionEvidence = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: Set<ts.Symbol> = new Set(),
): MotionExpressionEvidence => {
  const unwrappedExpression = unwrapExpression(expression);

  if (ts.isIdentifier(unwrappedExpression)) {
    const symbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
    if (!symbol || visitedSymbols.has(symbol)) return EMPTY_MOTION_EXPRESSION_EVIDENCE;
    const nextVisitedSymbols = new Set(visitedSymbols);
    nextVisitedSymbols.add(symbol);

    let resolvedEvidence = EMPTY_MOTION_EXPRESSION_EVIDENCE;
    for (const declaration of symbol.declarations ?? []) {
      const importedEvidence = getImportedBindingEvidence(declaration);
      if (importedEvidence) {
        resolvedEvidence = mergeMotionExpressionEvidence(resolvedEvidence, importedEvidence);
        continue;
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        resolvedEvidence = mergeMotionExpressionEvidence(
          resolvedEvidence,
          resolveMotionExpressionEvidence(declaration.initializer, typeChecker, nextVisitedSymbols),
        );
      }
    }
    return resolvedEvidence;
  }

  if (ts.isPropertyAccessExpression(unwrappedExpression)) {
    const receiverEvidence = resolveMotionExpressionEvidence(
      unwrappedExpression.expression,
      typeChecker,
      visitedSymbols,
    );
    if (receiverEvidence.isMotionNamespace) {
      return classifyMotionExport(unwrappedExpression.name.text);
    }
    if (receiverEvidence.isMotionComponentFactory) {
      return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionComponent: true };
    }
    return receiverEvidence;
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
      visitedSymbols,
    );
    if (receiverEvidence.isMotionNamespace) {
      return classifyMotionExport(unwrappedExpression.argumentExpression.text);
    }
    if (receiverEvidence.isMotionComponentFactory) {
      return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionComponent: true };
    }
    return receiverEvidence;
  }

  if (ts.isCallExpression(unwrappedExpression)) {
    const calleeEvidence = resolveMotionExpressionEvidence(
      unwrappedExpression.expression,
      typeChecker,
      visitedSymbols,
    );
    if (calleeEvidence.isMotionComponentFactory) {
      return { ...EMPTY_MOTION_EXPRESSION_EVIDENCE, isMotionComponent: true };
    }
    return calleeEvidence;
  }

  return EMPTY_MOTION_EXPRESSION_EVIDENCE;
};

const getStaticJsxAttributeValue = (attribute: ts.JsxAttribute): string | null => {
  if (!attribute.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return null;
  const expression = unwrapExpression(attribute.initializer.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return null;
};

const jsxElementHasReducedMotionConfiguration = (attributes: ts.JsxAttributes): boolean =>
  attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === REDUCED_MOTION_PROP_NAME &&
      REDUCED_MOTION_CONFIG_VALUES.has(getStaticJsxAttributeValue(attribute) ?? ""),
  );

const collectScriptMotionEvidence = (
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): ProjectMotionEvidence => {
  const evidence: ProjectMotionEvidence = {
    hasMotionUse: false,
    hasReducedMotionHandling: false,
  };

  const visitNode = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeEvidence = resolveMotionExpressionEvidence(node.expression, typeChecker);
      if (
        calleeEvidence.isAnimationFunction ||
        calleeEvidence.isMotionComponentFactory ||
        calleeEvidence.isReducedMotionHook
      ) {
        evidence.hasMotionUse = true;
      }
      if (calleeEvidence.isReducedMotionHook) evidence.hasReducedMotionHandling = true;
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializerEvidence = resolveMotionExpressionEvidence(node.initializer, typeChecker);
      if (initializerEvidence.isMotionComponent) evidence.hasMotionUse = true;
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagEvidence = ts.isJsxNamespacedName(node.tagName)
        ? EMPTY_MOTION_EXPRESSION_EVIDENCE
        : resolveMotionExpressionEvidence(node.tagName, typeChecker);
      if (
        tagEvidence.isMotionComponent ||
        tagEvidence.isMotionComponentFactory ||
        tagEvidence.isMotionConfig
      ) {
        evidence.hasMotionUse = true;
      }
      if (tagEvidence.isMotionConfig && jsxElementHasReducedMotionConfiguration(node.attributes)) {
        evidence.hasReducedMotionHandling = true;
      }
    }

    ts.forEachChild(node, visitNode);
  };

  visitNode(sourceFile);
  return evidence;
};

const getScriptKind = (fileName: string): ts.ScriptKind => {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};

export const analyzeReducedMotionSource = ({
  fileName,
  sourceText,
}: AnalyzeReducedMotionSourceInput): ProjectMotionEvidence => {
  if (!MOTION_SOURCE_PREFILTER.test(sourceText)) {
    return { hasMotionUse: false, hasReducedMotionHandling: false };
  }

  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  };
  const normalizedFileName = path.resolve(fileName);
  const compilerHost = ts.createCompilerHost(compilerOptions);
  const getDefaultSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.getSourceFile = (
    requestedFileName,
    languageVersionOrOptions,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    path.resolve(requestedFileName) === normalizedFileName
      ? ts.createSourceFile(
          normalizedFileName,
          sourceText,
          languageVersionOrOptions,
          true,
          getScriptKind(normalizedFileName),
        )
      : getDefaultSourceFile(
          requestedFileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram([normalizedFileName], compilerOptions, compilerHost);
  const sourceFile = program.getSourceFile(normalizedFileName);
  if (!sourceFile) return { hasMotionUse: false, hasReducedMotionHandling: false };
  return collectScriptMotionEvidence(sourceFile, program.getTypeChecker());
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
  const scriptFiles: Array<{ absolutePath: string; content: string }> = [];
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
    if (MOTION_SOURCE_PREFILTER.test(content)) scriptFiles.push({ absolutePath, content });
  }

  if (scriptFiles.length === 0) {
    return { hasMotionUse: false, hasReducedMotionHandling };
  }

  let hasMotionUse = false;
  for (const { absolutePath, content } of scriptFiles) {
    const fileEvidence = analyzeReducedMotionSource({
      fileName: absolutePath,
      sourceText: content,
    });
    hasMotionUse ||= fileEvidence.hasMotionUse;
    hasReducedMotionHandling ||= fileEvidence.hasReducedMotionHandling;
    if (hasMotionUse && hasReducedMotionHandling) break;
  }

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
