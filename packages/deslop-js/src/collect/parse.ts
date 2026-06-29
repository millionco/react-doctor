import { parseSync } from "oxc-parser";
import { readFileSync, statSync } from "node:fs";
import {
  BINARY_DETECTION_NULL_BYTE_THRESHOLD,
  BINARY_DETECTION_SAMPLE_BYTES,
  MAX_PARSE_FILE_SIZE_BYTES,
  MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD,
  MINIFIED_DETECTION_MIN_BYTES,
} from "../constants.js";
import { type DeslopError, FileReadError, ParseError, describeUnknownError } from "../errors.js";
import type {
  Statement,
  ImportDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  ExportAllDeclaration,
  Declaration,
  VariableDeclaration,
  BindingPattern,
  ModuleExportName,
  CallExpression,
  StaticMemberExpression,
  ImportExpression,
  StringLiteral,
  Expression,
  ModuleDeclaration,
} from "@oxc-project/types";
import type {
  ImportReference,
  ExportReference,
  ImportBinding,
  MemberAccess,
  InlineTypeContext,
  RedundantTypePatternKind,
  SimplifiableExpressionKind,
  SimplifiableFunctionKind,
} from "../types.js";
import { getLineFromOffset, getColumnFromOffset } from "../utils/line-column.js";
import { extractDefaultExportLocalName } from "../utils/extract-default-export-local-name.js";
import {
  detectRedundantTypePatternForTypeAnnotation,
  detectRedundantInterfaceDeclaration,
} from "../utils/detect-redundant-type-pattern.js";
import { detectIdentityWrapperFromInitializer } from "../utils/detect-identity-wrapper.js";
import { normalizeTypeAstHash } from "../utils/normalize-type-hash.js";
import { collectInlineTypeLiterals } from "../utils/collect-inline-type-literals.js";
import { collectSimplifiableFunctions } from "../utils/collect-simplifiable-functions.js";
import { collectSimplifiableExpressions } from "../utils/collect-simplifiable-expressions.js";
import { collectDuplicateConstantCandidates } from "../utils/collect-duplicate-constants.js";

export interface ParsedRedundantTypePattern {
  typeName: string;
  kind: RedundantTypePatternKind;
  line: number;
  column: number;
  reason: string;
  suggestion: string;
}

export interface ParsedIdentityWrapper {
  wrapperName: string;
  wrappedExpression: string;
  line: number;
  column: number;
}

export interface ParsedTypeDefinitionHash {
  typeName: string;
  structuralHash: string;
  line: number;
  column: number;
}

export interface ParsedInlineTypeLiteral {
  structuralHash: string;
  memberCount: number;
  preview: string;
  context: InlineTypeContext;
  nearestName?: string;
  line: number;
  column: number;
}

export interface ParsedSimplifiableFunction {
  kind: SimplifiableFunctionKind;
  functionName?: string;
  line: number;
  column: number;
  reason: string;
  suggestion: string;
}

export interface ParsedSimplifiableExpression {
  kind: SimplifiableExpressionKind;
  snippet: string;
  line: number;
  column: number;
  reason: string;
  suggestion: string;
}

export interface ParsedDuplicateConstantCandidate {
  constantName: string;
  literalHash: string;
  literalPreview: string;
  line: number;
  column: number;
}

export interface ParsedSource {
  imports: ImportReference[];
  exports: ExportReference[];
  memberAccesses: MemberAccess[];
  wholeObjectUses: string[];
  localIdentifierReferences: string[];
  referencedFilenames: string[];
  redundantTypePatterns: ParsedRedundantTypePattern[];
  identityWrappers: ParsedIdentityWrapper[];
  typeDefinitionHashes: ParsedTypeDefinitionHash[];
  inlineTypeLiterals: ParsedInlineTypeLiteral[];
  simplifiableFunctions: ParsedSimplifiableFunction[];
  simplifiableExpressions: ParsedSimplifiableExpression[];
  duplicateConstantCandidates: ParsedDuplicateConstantCandidate[];
  errors: DeslopError[];
}

const extractMdxImportsExports = (sourceText: string): string => {
  const statements: string[] = [];
  let isInMultiline = false;
  let braceDepth = 0;

  for (const line of sourceText.split("\n")) {
    const trimmedLine = line.trim();
    if (isInMultiline) {
      statements.push(line);
      for (const character of trimmedLine) {
        if (character === "{") braceDepth++;
        if (character === "}") braceDepth--;
      }
      const hasFromClause =
        trimmedLine.includes(" from ") ||
        trimmedLine.includes(" from'") ||
        trimmedLine.includes(' from"');
      if (braceDepth <= 0 || trimmedLine.endsWith(";") || hasFromClause) {
        isInMultiline = false;
        braceDepth = 0;
      }
    } else if (
      trimmedLine.startsWith("import ") ||
      trimmedLine.startsWith("import{") ||
      trimmedLine.startsWith("export ") ||
      trimmedLine.startsWith("export{")
    ) {
      statements.push(line);
      for (const character of trimmedLine) {
        if (character === "{") braceDepth++;
        if (character === "}") braceDepth--;
      }
      if (braceDepth > 0 && !trimmedLine.includes(" from ")) {
        isInMultiline = true;
      }
    }
  }

  return statements.join("\n");
};

const ASTRO_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const ASTRO_SCRIPT_TAG_PATTERN =
  /<script\b([^>]*?)\/>|<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
const ASTRO_SCRIPT_SRC_ATTRIBUTE_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/i;

const extractAstroSources = (sourceText: string): string => {
  const sections: string[] = [];
  const frontmatterMatch = sourceText.match(ASTRO_FRONTMATTER_PATTERN);
  if (frontmatterMatch) {
    sections.push(frontmatterMatch[1]);
  }
  ASTRO_SCRIPT_TAG_PATTERN.lastIndex = 0;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = ASTRO_SCRIPT_TAG_PATTERN.exec(sourceText)) !== null) {
    const selfClosingAttributes = scriptMatch[1];
    const pairedAttributes = scriptMatch[2];
    const attributes = selfClosingAttributes ?? pairedAttributes ?? "";
    const body = selfClosingAttributes === undefined ? (scriptMatch[3] ?? "") : "";
    const srcMatch = attributes.match(ASTRO_SCRIPT_SRC_ATTRIBUTE_PATTERN);
    if (srcMatch) {
      sections.push(`import ${JSON.stringify(srcMatch[1])};`);
    }
    if (body) {
      sections.push(body);
    }
  }
  return sections.join("\n");
};

const VUE_SCRIPT_PATTERN =
  /<script[^>]*(?:lang=["'](?:ts|tsx)["'][^>]*)?>([\s\S]*?)<\/script\b[^>]*>/gi;

const extractVueScriptContent = (sourceText: string): string => {
  const scriptBlocks: string[] = [];
  let scriptMatch: RegExpExecArray | null;
  VUE_SCRIPT_PATTERN.lastIndex = 0;
  while ((scriptMatch = VUE_SCRIPT_PATTERN.exec(sourceText)) !== null) {
    if (scriptMatch[1]) {
      scriptBlocks.push(scriptMatch[1]);
    }
  }
  return scriptBlocks.join("\n");
};

const SVELTE_SCRIPT_PATTERN = /<script[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;

const extractSvelteScriptContent = (sourceText: string): string => {
  const scriptBlocks: string[] = [];
  let scriptMatch: RegExpExecArray | null;
  SVELTE_SCRIPT_PATTERN.lastIndex = 0;
  while ((scriptMatch = SVELTE_SCRIPT_PATTERN.exec(sourceText)) !== null) {
    if (scriptMatch[1]) {
      scriptBlocks.push(scriptMatch[1]);
    }
  }
  return scriptBlocks.join("\n");
};

const getModuleExportNameValue = (exportName: ModuleExportName): string => {
  if (exportName.type === "Identifier") return exportName.name;
  if (exportName.type === "Literal") return exportName.value;
  return "default";
};

const CSS_EXTENSIONS = [".css", ".scss", ".less", ".sass"];

const CSS_IMPORT_PATTERN = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g;
const SCSS_USE_FORWARD_PATTERN = /@(?:use|forward)\s+['"]([^'"]+)['"]/g;
const TAILWIND_PLUGIN_REFERENCE_PATTERN = /@(?:plugin|reference|config)\s+['"]([^'"]+)['"]/g;

const parseCssImports = (filePath: string): ParsedSource => {
  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportReference[] = [];

  const patterns = [
    CSS_IMPORT_PATTERN,
    SCSS_USE_FORWARD_PATTERN,
    TAILWIND_PLUGIN_REFERENCE_PATTERN,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(sourceText)) !== null) {
      const specifier = match[1];
      if (specifier && !specifier.startsWith("http")) {
        imports.push({
          specifier,
          importedNames: [],
          isTypeOnly: false,
          isDynamic: false,
          isSideEffect: true,
          line: sourceText.substring(0, match.index).split("\n").length,
          column: 0,
        });
      }
    }
  }

  return {
    imports,
    exports: [],
    memberAccesses: [],
    wholeObjectUses: [],
    localIdentifierReferences: [],
    referencedFilenames: [],
    redundantTypePatterns: [],
    identityWrappers: [],
    typeDefinitionHashes: [],
    inlineTypeLiterals: [],
    simplifiableFunctions: [],
    simplifiableExpressions: [],
    duplicateConstantCandidates: [],
    errors: [],
  };
};

const NON_JS_EXTENSIONS = [".graphql", ".gql"];

const collectLocalIdentifierReferences = (statements: Statement[]): string[] => {
  const references: string[] = [];
  const seenNames = new Set<string>();

  const visitNode = (node: unknown): void => {
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    if (record.type === "Identifier" && typeof record.name === "string") {
      if (!seenNames.has(record.name)) {
        seenNames.add(record.name);
        references.push(record.name);
      }
      return;
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const innerValue of value) visitNode(innerValue);
      } else if (value && typeof value === "object") {
        visitNode(value);
      }
    }
  };

  for (const statement of statements) {
    if (
      statement.type === "ImportDeclaration" ||
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration" ||
      statement.type === "ExportAllDeclaration"
    ) {
      continue;
    }
    visitNode(statement);
  }

  return references;
};

const createEmptyParsedSource = (): ParsedSource => ({
  imports: [],
  exports: [],
  memberAccesses: [],
  wholeObjectUses: [],
  localIdentifierReferences: [],
  referencedFilenames: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  typeDefinitionHashes: [],
  inlineTypeLiterals: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstantCandidates: [],
  errors: [],
});

const stripByteOrderMark = (sourceText: string): string => {
  if (sourceText.charCodeAt(0) === 0xfeff) return sourceText.slice(1);
  return sourceText;
};

const looksLikeBinaryContent = (sourceText: string): boolean => {
  const sampleLength = Math.min(sourceText.length, BINARY_DETECTION_SAMPLE_BYTES);
  let nullByteCount = 0;
  for (let scanIndex = 0; scanIndex < sampleLength; scanIndex++) {
    if (sourceText.charCodeAt(scanIndex) === 0) nullByteCount++;
    if (nullByteCount > BINARY_DETECTION_NULL_BYTE_THRESHOLD) return true;
  }
  return false;
};

const looksLikeMinifiedSource = (sourceText: string): boolean => {
  if (sourceText.length < MINIFIED_DETECTION_MIN_BYTES) return false;
  let newlineCount = 0;
  for (let scanIndex = 0; scanIndex < sourceText.length; scanIndex++) {
    if (sourceText.charCodeAt(scanIndex) === 10) newlineCount++;
  }
  const averageLineLength = sourceText.length / (newlineCount + 1);
  return averageLineLength > MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD;
};

const safeReadSourceFile = (filePath: string, errors: DeslopError[]): string | undefined => {
  try {
    const stats = statSync(filePath);
    if (stats.size === 0) {
      errors.push(
        new FileReadError({
          code: "file-empty",
          severity: "info",
          message: "file is empty — nothing to analyze",
          path: filePath,
        }),
      );
      return undefined;
    }
    if (stats.size > MAX_PARSE_FILE_SIZE_BYTES) {
      errors.push(
        new FileReadError({
          code: "file-too-large",
          message: `file size ${stats.size}B exceeds MAX_PARSE_FILE_SIZE_BYTES (${MAX_PARSE_FILE_SIZE_BYTES})`,
          path: filePath,
        }),
      );
      return undefined;
    }
  } catch (statError) {
    errors.push(
      new FileReadError({
        code: "file-read-failed",
        message: "could not stat source file",
        path: filePath,
        detail: describeUnknownError(statError),
      }),
    );
    return undefined;
  }
  try {
    const rawSourceText = readFileSync(filePath, "utf-8");
    const sourceText = stripByteOrderMark(rawSourceText);
    if (looksLikeBinaryContent(sourceText)) {
      errors.push(
        new FileReadError({
          code: "file-binary",
          severity: "info",
          message: "file appears to be binary — skipping",
          path: filePath,
        }),
      );
      return undefined;
    }
    if (looksLikeMinifiedSource(sourceText)) {
      errors.push(
        new FileReadError({
          code: "file-minified",
          severity: "info",
          message: "file appears to be a minified/bundled artifact — skipping redundancy analysis",
          path: filePath,
        }),
      );
      return undefined;
    }
    return sourceText;
  } catch (readError) {
    errors.push(
      new FileReadError({
        code: "file-read-failed",
        message: "could not read source file",
        path: filePath,
        detail: describeUnknownError(readError),
      }),
    );
    return undefined;
  }
};

export const parseSourceFile = (filePath: string): ParsedSource => {
  const isCss = CSS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (isCss) {
    try {
      return parseCssImports(filePath);
    } catch (cssError) {
      return {
        ...createEmptyParsedSource(),
        errors: [
          new ParseError({
            code: "parse-failed",
            message: "CSS import parsing crashed",
            path: filePath,
            detail: describeUnknownError(cssError),
          }),
        ],
      };
    }
  }

  const isNonJsFile = NON_JS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (isNonJsFile) {
    return createEmptyParsedSource();
  }

  const earlyErrors: DeslopError[] = [];
  const sourceText = safeReadSourceFile(filePath, earlyErrors);
  if (sourceText === undefined) {
    return { ...createEmptyParsedSource(), errors: earlyErrors };
  }
  const imports: ImportReference[] = [];
  const exports: ExportReference[] = [];

  const isMdx = filePath.endsWith(".mdx");
  const isAstro = filePath.endsWith(".astro");
  const isVue = filePath.endsWith(".vue");
  const isSvelte = filePath.endsWith(".svelte");
  const isPreprocessed = isMdx || isAstro || isVue || isSvelte;
  const textToParse = isMdx
    ? extractMdxImportsExports(sourceText)
    : isAstro
      ? extractAstroSources(sourceText)
      : isVue
        ? extractVueScriptContent(sourceText)
        : isSvelte
          ? extractSvelteScriptContent(sourceText)
          : sourceText;
  const parseFileName =
    isMdx || isAstro || isVue || isSvelte
      ? filePath.replace(/\.(mdx|astro|vue|svelte)$/, ".tsx")
      : filePath;

  let result: ReturnType<typeof parseSync>;
  try {
    result = parseSync(parseFileName, textToParse);
  } catch (parseError) {
    return {
      ...createEmptyParsedSource(),
      errors: [
        ...earlyErrors,
        new ParseError({
          code: "parse-failed",
          message: "oxc-parser threw during initial parse",
          path: filePath,
          detail: describeUnknownError(parseError),
        }),
      ],
    };
  }

  const isPlainJsFile =
    parseFileName.endsWith(".js") ||
    parseFileName.endsWith(".mjs") ||
    parseFileName.endsWith(".cjs");

  if (isPlainJsFile && result.errors.length > 0) {
    try {
      const jsxFileName = parseFileName.replace(/\.(m?js|cjs)$/, ".jsx");
      const jsxResult = parseSync(jsxFileName, textToParse);
      if (jsxResult.errors.length === 0) {
        result = jsxResult;
      } else {
        const tsxFileName = parseFileName.replace(/\.(m?js|cjs)$/, ".tsx");
        const tsxResult = parseSync(tsxFileName, textToParse);
        if (tsxResult.errors.length === 0) {
          result = tsxResult;
        }
      }
    } catch {
      // fall through with the existing (error-laden) result
    }
  }

  if (result.errors.length > 0 && !isPreprocessed) {
    return {
      ...createEmptyParsedSource(),
      imports,
      exports,
      referencedFilenames: extractReferencedFilenames(sourceText),
      errors: [
        ...earlyErrors,
        new ParseError({
          code: "parse-recovered",
          severity: "info",
          message: `oxc-parser reported ${result.errors.length} syntax issue(s); skipping deep analysis for this file`,
          path: filePath,
        }),
      ],
    };
  }

  if (result.errors.length > 0) {
    earlyErrors.push(
      new ParseError({
        code: "parse-recovered-partial",
        severity: "info",
        message: `oxc-parser reported ${result.errors.length} syntax issue(s) in extracted ${isAstro ? "Astro" : isVue ? "Vue" : isSvelte ? "Svelte" : "MDX"} sources; continuing with partial AST`,
        path: filePath,
      }),
    );
  }

  const program = result.program;
  if (!program?.body) {
    return {
      ...createEmptyParsedSource(),
      imports,
      exports,
      referencedFilenames: extractReferencedFilenames(sourceText),
      errors: [
        ...earlyErrors,
        new ParseError({
          code: "parse-failed",
          message: "oxc-parser returned no program body",
          path: filePath,
        }),
      ],
    };
  }

  const detectorErrors: DeslopError[] = [];

  const safeWalk = <ResultType>(
    walkerName: string,
    walker: () => ResultType,
    fallback: ResultType,
  ): ResultType => {
    try {
      return walker();
    } catch (walkError) {
      detectorErrors.push(
        new ParseError({
          code: "ast-walk-failed",
          message: `${walkerName} threw during AST traversal`,
          path: filePath,
          detail: describeUnknownError(walkError),
        }),
      );
      return fallback;
    }
  };

  safeWalk(
    "extractImportsAndExports",
    () => {
      for (const node of program.body) {
        switch (node.type) {
          case "ImportDeclaration":
            extractImportDeclaration(node, sourceText, imports);
            break;
          case "ExportNamedDeclaration":
            extractNamedExportDeclaration(node, sourceText, exports);
            break;
          case "ExportDefaultDeclaration":
            extractDefaultExportDeclaration(node, sourceText, exports);
            break;
          case "ExportAllDeclaration":
            extractExportAllDeclaration(node, sourceText, exports);
            break;
        }
      }
      return undefined;
    },
    undefined,
  );

  safeWalk(
    "collectDynamicImports",
    () => {
      collectDynamicImports(program.body, sourceText, imports);
      return undefined;
    },
    undefined,
  );

  const namespaceLocalNames = collectNamespaceLocalNames(imports);
  const memberAccesses: MemberAccess[] = [];
  const wholeObjectUses: string[] = [];
  if (namespaceLocalNames.size > 0) {
    safeWalk(
      "collectMemberAccesses",
      () => {
        collectMemberAccesses(program.body, namespaceLocalNames, memberAccesses, wholeObjectUses);
        return undefined;
      },
      undefined,
    );
  }

  const localIdentifierReferences = safeWalk(
    "collectLocalIdentifierReferences",
    () => collectLocalIdentifierReferences(program.body),
    [],
  );

  const redundantTypePatterns: ParsedRedundantTypePattern[] = [];
  const identityWrappers: ParsedIdentityWrapper[] = [];
  const typeDefinitionHashes: ParsedTypeDefinitionHash[] = [];
  safeWalk(
    "collectDryPatterns",
    () => {
      collectDryPatterns(
        program.body,
        sourceText,
        redundantTypePatterns,
        identityWrappers,
        typeDefinitionHashes,
      );
      return undefined;
    },
    undefined,
  );

  const inlineTypeCaptures = safeWalk(
    "collectInlineTypeLiterals",
    () => collectInlineTypeLiterals(program.body),
    [],
  );
  const inlineTypeLiterals: ParsedInlineTypeLiteral[] = inlineTypeCaptures.map((capture) => ({
    structuralHash: capture.structuralHash,
    memberCount: capture.memberCount,
    preview: capture.preview,
    context: capture.context,
    nearestName: capture.nearestName,
    line: getLineFromOffset(sourceText, capture.startOffset),
    column: getColumnFromOffset(sourceText, capture.startOffset),
  }));

  const simplifiableCaptures = safeWalk(
    "collectSimplifiableFunctions",
    () => collectSimplifiableFunctions(program.body),
    [],
  );
  const simplifiableFunctions: ParsedSimplifiableFunction[] = simplifiableCaptures.map(
    (capture) => ({
      kind: capture.kind,
      functionName: capture.functionName,
      line: getLineFromOffset(sourceText, capture.startOffset),
      column: getColumnFromOffset(sourceText, capture.startOffset),
      reason: capture.reason,
      suggestion: capture.suggestion,
    }),
  );

  const expressionCaptures = safeWalk(
    "collectSimplifiableExpressions",
    () => collectSimplifiableExpressions(program.body),
    [],
  );
  const simplifiableExpressions: ParsedSimplifiableExpression[] = expressionCaptures.map(
    (capture) => ({
      kind: capture.kind,
      snippet: capture.snippet,
      line: getLineFromOffset(sourceText, capture.startOffset),
      column: getColumnFromOffset(sourceText, capture.startOffset),
      reason: capture.reason,
      suggestion: capture.suggestion,
    }),
  );

  const constantCaptures = safeWalk(
    "collectDuplicateConstantCandidates",
    () => collectDuplicateConstantCandidates(program.body),
    [],
  );
  const duplicateConstantCandidates: ParsedDuplicateConstantCandidate[] = constantCaptures.map(
    (capture) => ({
      constantName: capture.constantName,
      literalHash: capture.literalHash,
      literalPreview: capture.literalPreview,
      line: getLineFromOffset(sourceText, capture.startOffset),
      column: getColumnFromOffset(sourceText, capture.startOffset),
    }),
  );

  const referencedFilenames = extractReferencedFilenames(sourceText);

  return {
    imports,
    exports,
    memberAccesses,
    wholeObjectUses,
    localIdentifierReferences,
    referencedFilenames,
    redundantTypePatterns,
    identityWrappers,
    typeDefinitionHashes,
    inlineTypeLiterals,
    simplifiableFunctions,
    simplifiableExpressions,
    duplicateConstantCandidates,
    errors: [...earlyErrors, ...detectorErrors],
  };
};

const REFERENCED_FILENAME_LITERAL_PATTERN =
  /(?<![./@\w-])(?:["'`])([a-z][\w-]*\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs))(?:["'`])/g;

const extractReferencedFilenames = (sourceText: string): string[] => {
  const captured = new Set<string>();
  REFERENCED_FILENAME_LITERAL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCED_FILENAME_LITERAL_PATTERN.exec(sourceText)) !== null) {
    captured.add(match[1]);
  }
  return [...captured];
};

const collectDryPatterns = (
  bodyNodes: Array<Statement | ModuleDeclaration>,
  sourceText: string,
  redundantTypePatterns: ParsedRedundantTypePattern[],
  identityWrappers: ParsedIdentityWrapper[],
  typeDefinitionHashes: ParsedTypeDefinitionHash[],
): void => {
  for (const statement of bodyNodes) {
    inspectStatement(
      statement,
      sourceText,
      redundantTypePatterns,
      identityWrappers,
      typeDefinitionHashes,
    );
  }
};

const inspectStatement = (
  statementNode: Statement | ModuleDeclaration,
  sourceText: string,
  redundantTypePatterns: ParsedRedundantTypePattern[],
  identityWrappers: ParsedIdentityWrapper[],
  typeDefinitionHashes: ParsedTypeDefinitionHash[],
): void => {
  let declarationOfInterest: unknown = statementNode;
  if (
    statementNode.type === "ExportNamedDeclaration" &&
    (statementNode as { declaration?: unknown }).declaration
  ) {
    declarationOfInterest = (statementNode as { declaration?: unknown }).declaration;
  }

  if (declarationOfInterest && typeof declarationOfInterest === "object") {
    const declarationNode = declarationOfInterest as {
      type?: string;
      id?: { name?: string };
      typeAnnotation?: unknown;
      declarations?: Array<{ id?: { name?: string }; init?: unknown; start?: number }>;
      start?: number;
    };

    if (declarationNode.type === "TSTypeAliasDeclaration") {
      const typeAliasName = declarationNode.id?.name;
      const typeAnnotation = declarationNode.typeAnnotation;
      const startOffset = declarationNode.start ?? 0;
      if (typeAliasName && typeAnnotation) {
        const redundantPattern = detectRedundantTypePatternForTypeAnnotation(typeAnnotation);
        if (redundantPattern) {
          redundantTypePatterns.push({
            typeName: typeAliasName,
            kind: redundantPattern.kind,
            line: getLineFromOffset(sourceText, startOffset),
            column: getColumnFromOffset(sourceText, startOffset),
            reason: redundantPattern.reason,
            suggestion: redundantPattern.suggestion,
          });
        }
        typeDefinitionHashes.push({
          typeName: typeAliasName,
          structuralHash: `alias:${normalizeTypeAstHash(typeAnnotation)}`,
          line: getLineFromOffset(sourceText, startOffset),
          column: getColumnFromOffset(sourceText, startOffset),
        });
      }
    } else if (declarationNode.type === "TSInterfaceDeclaration") {
      const interfaceName = declarationNode.id?.name;
      const startOffset = declarationNode.start ?? 0;
      if (interfaceName) {
        const redundantPattern = detectRedundantInterfaceDeclaration(declarationNode);
        if (redundantPattern) {
          redundantTypePatterns.push({
            typeName: interfaceName,
            kind: redundantPattern.kind,
            line: getLineFromOffset(sourceText, startOffset),
            column: getColumnFromOffset(sourceText, startOffset),
            reason: redundantPattern.reason,
            suggestion: redundantPattern.suggestion,
          });
        }
        const declarationCopy = { ...declarationNode, id: undefined };
        typeDefinitionHashes.push({
          typeName: interfaceName,
          structuralHash: `interface:${normalizeTypeAstHash(declarationCopy)}`,
          line: getLineFromOffset(sourceText, startOffset),
          column: getColumnFromOffset(sourceText, startOffset),
        });
      }
    } else if (declarationNode.type === "VariableDeclaration") {
      for (const declarator of declarationNode.declarations ?? []) {
        const wrapperName = declarator.id?.name;
        const initializerNode = declarator.init;
        const startOffset = declarator.start ?? declarationNode.start ?? 0;
        if (!wrapperName || !initializerNode) continue;
        const wrapperDetection = detectIdentityWrapperFromInitializer(initializerNode, wrapperName);
        if (wrapperDetection) {
          identityWrappers.push({
            wrapperName,
            wrappedExpression: wrapperDetection.wrappedExpression,
            line: getLineFromOffset(sourceText, startOffset),
            column: getColumnFromOffset(sourceText, startOffset),
          });
        }
      }
    }
  }
};

const WHOLE_OBJECT_FUNCTION_NAMES = new Set([
  "keys",
  "values",
  "entries",
  "assign",
  "freeze",
  "getOwnPropertyNames",
  "getOwnPropertyDescriptors",
]);

const collectNamespaceLocalNames = (imports: ImportReference[]): Set<string> => {
  const namespaceNames = new Set<string>();
  for (const importInfo of imports) {
    for (const importedName of importInfo.importedNames) {
      if (importedName.isNamespace && importedName.alias) {
        namespaceNames.add(importedName.alias);
      }
    }
  }
  return namespaceNames;
};

const collectMemberAccesses = (
  bodyNodes: Array<Statement | ModuleDeclaration>,
  namespaceLocalNames: Set<string>,
  memberAccesses: MemberAccess[],
  wholeObjectUses: string[],
): void => {
  const walkForMemberAccesses = (node: WalkableNode): void => {
    if (node.type === "MemberExpression" && !node.computed) {
      const memberExpression = node as unknown as StaticMemberExpression;
      if (
        memberExpression.object.type === "Identifier" &&
        namespaceLocalNames.has((memberExpression.object as { name: string }).name)
      ) {
        const objectName = (memberExpression.object as { name: string }).name;
        const memberName = memberExpression.property.name;
        if (memberName) {
          memberAccesses.push({ objectName, memberName });
        }
      }
    }

    if (node.type === "MemberExpression" && Boolean(node.computed)) {
      const computedExpression = node as unknown as {
        object: Expression;
        expression: Expression;
      };
      if (
        computedExpression.object.type === "Identifier" &&
        namespaceLocalNames.has((computedExpression.object as { name: string }).name)
      ) {
        const objectName = (computedExpression.object as { name: string }).name;
        const expressionNode = (node as unknown as { expression: WalkableNode }).expression;
        if (expressionNode?.type === "Literal") {
          const literalValue = (expressionNode as unknown as StringLiteral).value;
          if (typeof literalValue === "string") {
            memberAccesses.push({ objectName, memberName: literalValue });
          } else {
            wholeObjectUses.push(objectName);
          }
        } else {
          wholeObjectUses.push(objectName);
        }
      }
    }

    // `<S.Custom />` — a JSX element whose name is a member of a namespace
    // import. The name node is a `JSXMemberExpression`, not a `MemberExpression`,
    // so it would otherwise be missed and the export reported unused (#875).
    if (node.type === "JSXMemberExpression") {
      const jsxMember = node as unknown as {
        object: { type: string; name?: string };
        property: { name?: string };
      };
      if (
        jsxMember.object.type === "JSXIdentifier" &&
        jsxMember.object.name !== undefined &&
        namespaceLocalNames.has(jsxMember.object.name) &&
        jsxMember.property.name !== undefined
      ) {
        memberAccesses.push({
          objectName: jsxMember.object.name,
          memberName: jsxMember.property.name,
        });
      }
    }

    if (node.type === "SpreadElement") {
      const spreadArgument = (node as unknown as { argument: WalkableNode }).argument;
      if (
        spreadArgument?.type === "Identifier" &&
        namespaceLocalNames.has((spreadArgument as unknown as { name: string }).name)
      ) {
        wholeObjectUses.push((spreadArgument as unknown as { name: string }).name);
      }
    }

    if (node.type === "ForInStatement") {
      const forInRight = (node as unknown as { right: WalkableNode }).right;
      if (
        forInRight?.type === "Identifier" &&
        namespaceLocalNames.has((forInRight as unknown as { name: string }).name)
      ) {
        wholeObjectUses.push((forInRight as unknown as { name: string }).name);
      }
    }

    if (node.type === "CallExpression") {
      const callExpression = node as unknown as CallExpression;
      if (callExpression.callee.type === "MemberExpression" && !callExpression.callee.computed) {
        const calleeMember = callExpression.callee as StaticMemberExpression;
        if (
          calleeMember.object.type === "Identifier" &&
          (calleeMember.object as { name: string }).name === "Object" &&
          WHOLE_OBJECT_FUNCTION_NAMES.has(calleeMember.property.name)
        ) {
          const firstArgument = callExpression.arguments[0];
          if (
            firstArgument &&
            firstArgument.type !== "SpreadElement" &&
            firstArgument.type === "Identifier" &&
            namespaceLocalNames.has((firstArgument as { name: string }).name)
          ) {
            wholeObjectUses.push((firstArgument as { name: string }).name);
          }
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          if (isWalkableNode(element)) walkForMemberAccesses(element);
        }
      } else if (isWalkableNode(value)) {
        walkForMemberAccesses(value);
      }
    }
  };

  for (const topLevelNode of bodyNodes) {
    if (isWalkableNode(topLevelNode)) walkForMemberAccesses(topLevelNode);
  }
};

const extractImportDeclaration = (
  node: ImportDeclaration,
  sourceText: string,
  imports: ImportReference[],
): void => {
  const specifier = node.source.value;
  if (!specifier) return;

  const isTypeOnly = node.importKind === "type";
  const importedNames: ImportBinding[] = [];

  for (const specifierNode of node.specifiers) {
    switch (specifierNode.type) {
      case "ImportDefaultSpecifier": {
        importedNames.push({
          name: "default",
          alias: specifierNode.local.name,
          isNamespace: false,
          isDefault: true,
          isTypeOnly,
        });
        break;
      }
      case "ImportNamespaceSpecifier": {
        importedNames.push({
          name: "*",
          alias: specifierNode.local.name,
          isNamespace: true,
          isDefault: false,
          isTypeOnly,
        });
        break;
      }
      case "ImportSpecifier": {
        const importedName = getModuleExportNameValue(specifierNode.imported);
        const localName = specifierNode.local.name;
        const isSelfAlias =
          localName === importedName &&
          specifierNode.imported.type === "Identifier" &&
          specifierNode.imported.start !== specifierNode.local.start;

        importedNames.push({
          name: importedName,
          alias: localName !== importedName ? localName : undefined,
          isNamespace: false,
          isDefault: importedName === "default",
          isTypeOnly: isTypeOnly || specifierNode.importKind === "type",
          isRedundantAlias: isSelfAlias || undefined,
        });
        break;
      }
    }
  }

  const isSideEffectImport = importedNames.length === 0;

  if (isSideEffectImport) {
    importedNames.push({
      name: "*",
      alias: undefined,
      isNamespace: false,
      isDefault: false,
      isTypeOnly: false,
    });
  }

  imports.push({
    specifier,
    importedNames,
    isTypeOnly,
    isDynamic: false,
    isSideEffect: isSideEffectImport,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
  });
};

const extractNamedExportDeclaration = (
  node: ExportNamedDeclaration,
  sourceText: string,
  exports: ExportReference[],
): void => {
  const isTypeOnly = node.exportKind === "type";
  const reExportSource = node.source?.value;

  if (node.declaration) {
    extractDeclarationNames(node.declaration, isTypeOnly, sourceText, exports, node.start);
  }

  for (const specifierNode of node.specifiers) {
    const exportedName = getModuleExportNameValue(specifierNode.exported);
    const localName = getModuleExportNameValue(specifierNode.local);
    const isSelfAlias =
      exportedName === localName &&
      specifierNode.exported.type === "Identifier" &&
      specifierNode.local.type === "Identifier" &&
      specifierNode.exported.start !== specifierNode.local.start;

    exports.push({
      name: exportedName,
      isDefault: exportedName === "default",
      isTypeOnly: isTypeOnly || specifierNode.exportKind === "type",
      isReExport: reExportSource !== undefined,
      isSynthetic: false,
      reExportSource,
      reExportOriginalName: reExportSource !== undefined ? localName : undefined,
      isNamespaceReExport: false,
      line: getLineFromOffset(sourceText, specifierNode.start ?? node.start),
      column: getColumnFromOffset(sourceText, specifierNode.start ?? node.start),
      isRedundantAlias: isSelfAlias || undefined,
    });
  }
};

const extractDefaultExportDeclaration = (
  node: ExportDefaultDeclaration,
  sourceText: string,
  exports: ExportReference[],
): void => {
  const defaultExportLocalName = extractDefaultExportLocalName(node.declaration);

  exports.push({
    name: "default",
    isDefault: true,
    isTypeOnly: false,
    isReExport: false,
    isSynthetic: false,
    reExportSource: undefined,
    reExportOriginalName: undefined,
    isNamespaceReExport: false,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
    defaultExportLocalName,
  });
};

const extractExportAllDeclaration = (
  node: ExportAllDeclaration,
  sourceText: string,
  exports: ExportReference[],
): void => {
  const reExportSource = node.source.value;
  if (!reExportSource) return;

  const exportedName = node.exported ? getModuleExportNameValue(node.exported) : undefined;

  exports.push({
    name: exportedName ?? "*",
    isDefault: false,
    isTypeOnly: node.exportKind === "type",
    isReExport: true,
    isSynthetic: false,
    reExportSource,
    reExportOriginalName: "*",
    isNamespaceReExport: !exportedName,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
  });
};

const extractDeclarationNames = (
  declaration: Declaration,
  isTypeOnly: boolean,
  sourceText: string,
  exports: ExportReference[],
  fallbackStart: number,
): void => {
  const declarationType = declaration.type;

  if (
    declarationType === "FunctionDeclaration" ||
    declarationType === "ClassDeclaration" ||
    declarationType === "TSEnumDeclaration"
  ) {
    const declarationWithId = declaration as { id: { name: string } | null; start: number };
    const declarationName = declarationWithId.id?.name;
    if (declarationName) {
      exports.push({
        name: declarationName,
        isDefault: false,
        isTypeOnly,
        isReExport: false,
        isSynthetic: false,
        reExportSource: undefined,
        reExportOriginalName: undefined,
        isNamespaceReExport: false,
        line: getLineFromOffset(sourceText, declaration.start ?? fallbackStart),
        column: getColumnFromOffset(sourceText, declaration.start ?? fallbackStart),
      });
    }
    return;
  }

  if (
    declarationType === "TSTypeAliasDeclaration" ||
    declarationType === "TSInterfaceDeclaration"
  ) {
    const typeDeclaration = declaration as { id: { name: string }; start: number };
    const declarationName = typeDeclaration.id.name;
    if (declarationName) {
      exports.push({
        name: declarationName,
        isDefault: false,
        isTypeOnly: true,
        isReExport: false,
        isSynthetic: false,
        reExportSource: undefined,
        reExportOriginalName: undefined,
        isNamespaceReExport: false,
        line: getLineFromOffset(sourceText, declaration.start ?? fallbackStart),
        column: getColumnFromOffset(sourceText, declaration.start ?? fallbackStart),
      });
    }
    return;
  }

  if (declarationType === "VariableDeclaration") {
    const variableDeclaration = declaration as VariableDeclaration;
    for (const declarator of variableDeclaration.declarations) {
      const bindingNames = extractBindingPatternNames(declarator.id);
      for (const bindingName of bindingNames) {
        exports.push({
          name: bindingName,
          isDefault: false,
          isTypeOnly,
          isReExport: false,
          isSynthetic: false,
          reExportSource: undefined,
          reExportOriginalName: undefined,
          isNamespaceReExport: false,
          line: getLineFromOffset(sourceText, declarator.start ?? fallbackStart),
          column: getColumnFromOffset(sourceText, declarator.start ?? fallbackStart),
        });
      }
    }
  }
};

const extractBindingPatternNames = (pattern: BindingPattern): string[] => {
  if (!pattern) return [];

  if (pattern.type === "Identifier") {
    return pattern.name ? [pattern.name] : [];
  }

  if (pattern.type === "ObjectPattern") {
    const names: string[] = [];
    for (const property of pattern.properties) {
      if (property.type === "RestElement") {
        names.push(...extractBindingPatternNames(property.argument));
      } else {
        names.push(...extractBindingPatternNames(property.value));
      }
    }
    return names;
  }

  if (pattern.type === "ArrayPattern") {
    const names: string[] = [];
    for (const element of pattern.elements) {
      if (!element) continue;
      if (element.type === "RestElement") {
        names.push(...extractBindingPatternNames(element.argument));
      } else {
        names.push(...extractBindingPatternNames(element));
      }
    }
    return names;
  }

  if (pattern.type === "AssignmentPattern") {
    return extractBindingPatternNames(pattern.left);
  }

  return [];
};

const createNamespaceImportBinding = (): ImportBinding => ({
  name: "*",
  alias: undefined,
  isNamespace: true,
  isDefault: false,
  isTypeOnly: false,
});

interface WalkableNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const isWalkableNode = (value: unknown): value is WalkableNode =>
  Boolean(value) && typeof value === "object" && typeof (value as WalkableNode).type === "string";

const extractStringLiteralFromArgument = (
  callArguments: CallExpression["arguments"],
): string | undefined => {
  const firstArgument = callArguments[0];
  if (!firstArgument) return undefined;
  if (firstArgument.type === "SpreadElement") return undefined;
  if (firstArgument.type !== "Literal") return undefined;
  const literalValue = (firstArgument as StringLiteral).value;
  return typeof literalValue === "string" ? literalValue : undefined;
};

const extractGlobPatterns = (callArguments: CallExpression["arguments"]): string[] => {
  const firstArgument = callArguments[0];
  if (!firstArgument || firstArgument.type === "SpreadElement") return [];

  if (firstArgument.type === "Literal") {
    const literalValue = (firstArgument as StringLiteral).value;
    if (
      typeof literalValue === "string" &&
      (literalValue.startsWith("./") || literalValue.startsWith("../"))
    ) {
      return [literalValue];
    }
    return [];
  }

  if (firstArgument.type === "ArrayExpression") {
    const arrayExpression = firstArgument as unknown as {
      elements: Array<{ type: string; value?: unknown }>;
    };
    return arrayExpression.elements
      .filter(
        (element): element is { type: "Literal"; value: string } =>
          element.type === "Literal" &&
          typeof element.value === "string" &&
          ((element.value as string).startsWith("./") ||
            (element.value as string).startsWith("../")),
      )
      .map((element) => element.value);
  }

  return [];
};

const extractRegexGlobSuffix = (callArguments: CallExpression["arguments"]): string | undefined => {
  const thirdArgument = callArguments[2];
  if (!thirdArgument || thirdArgument.type === "SpreadElement") return undefined;
  if (thirdArgument.type !== "Literal") return undefined;
  const regExpValue = (thirdArgument as unknown as { regex?: { pattern: string } }).regex;
  if (!regExpValue) return undefined;
  const pattern = regExpValue.pattern;
  const extensionMatch = pattern.match(/^\\\.([\w|]+)\$$/);
  if (extensionMatch) {
    const extensions = extensionMatch[1].split("|");
    if (extensions.length === 1) return `*.${extensions[0]}`;
    return `*.{${extensions.join(",")}}`;
  }
  return undefined;
};

const hasMockFactoryArgument = (callExpression: CallExpression): boolean => {
  const secondArgument = callExpression.arguments[1];
  if (!secondArgument) return false;
  if (secondArgument.type === "SpreadElement") return false;
  return (
    secondArgument.type === "ArrowFunctionExpression" ||
    secondArgument.type === "FunctionExpression"
  );
};

const synthesizeAutoMockSibling = (mockSource: string): string | undefined => {
  if (
    !mockSource ||
    mockSource.includes("://") ||
    mockSource.startsWith("data:") ||
    mockSource.split("/").some((segment) => segment === "__mocks__")
  ) {
    return undefined;
  }
  const lastSlashIndex = mockSource.lastIndexOf("/");
  if (lastSlashIndex === -1) return undefined;
  const directory = mockSource.slice(0, lastSlashIndex);
  const fileName = mockSource.slice(lastSlashIndex + 1);
  if (!fileName) return undefined;
  return `${directory}/__mocks__/${fileName}`;
};

const collectDynamicImports = (
  bodyNodes: Array<Statement | ModuleDeclaration>,
  sourceText: string,
  imports: ImportReference[],
): void => {
  const walkNode = (node: WalkableNode): void => {
    if (node.type === "ImportExpression") {
      const importExpression = node as unknown as ImportExpression;
      const sourceExpression = importExpression.source;
      if (sourceExpression.type === "Literal") {
        const specifierValue = (sourceExpression as StringLiteral).value;
        if (specifierValue) {
          imports.push({
            specifier: specifierValue,
            importedNames: [createNamespaceImportBinding()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, importExpression.start),
            column: getColumnFromOffset(sourceText, importExpression.start),
          });
        }
      } else if (sourceExpression.type === "TemplateLiteral") {
        const templateLiteral = sourceExpression as unknown as {
          quasis: Array<{ value: { cooked: string } }>;
        };
        if (templateLiteral.quasis.length >= 2) {
          const globPattern = templateLiteral.quasis.map((quasi) => quasi.value.cooked).join("*");
          if (globPattern.startsWith("./") || globPattern.startsWith("../")) {
            imports.push({
              specifier: globPattern,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, importExpression.start),
              column: getColumnFromOffset(sourceText, importExpression.start),
            });
          }
        }
      }
      return;
    }

    if (node.type === "CallExpression") {
      const callExpression = node as unknown as CallExpression;

      if (callExpression.callee.type === "Identifier" && callExpression.callee.name === "require") {
        const requireSpecifier = extractStringLiteralFromArgument(callExpression.arguments);
        if (requireSpecifier) {
          imports.push({
            specifier: requireSpecifier,
            importedNames: [createNamespaceImportBinding()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, callExpression.start),
            column: getColumnFromOffset(sourceText, callExpression.start),
          });
        }
      }

      if (callExpression.callee.type === "MemberExpression" && !callExpression.callee.computed) {
        const memberExpression = callExpression.callee as StaticMemberExpression;

        if (
          memberExpression.object.type === "Identifier" &&
          memberExpression.object.name === "require" &&
          memberExpression.property.name === "resolve"
        ) {
          const resolveSpecifier = extractStringLiteralFromArgument(callExpression.arguments);
          if (resolveSpecifier) {
            imports.push({
              specifier: resolveSpecifier,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              line: getLineFromOffset(sourceText, callExpression.start),
              column: getColumnFromOffset(sourceText, callExpression.start),
            });
          }
        }

        if (
          memberExpression.object.type === "Identifier" &&
          (memberExpression.object.name === "vi" || memberExpression.object.name === "jest") &&
          memberExpression.property.name === "mock"
        ) {
          const mockSpecifier = extractStringLiteralFromArgument(callExpression.arguments);
          if (mockSpecifier) {
            imports.push({
              specifier: mockSpecifier,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: true,
              line: getLineFromOffset(sourceText, callExpression.start),
              column: getColumnFromOffset(sourceText, callExpression.start),
            });

            const hasFactoryArgument = hasMockFactoryArgument(callExpression);
            const autoMockSibling = synthesizeAutoMockSibling(mockSpecifier);
            if (!hasFactoryArgument && autoMockSibling) {
              imports.push({
                specifier: autoMockSibling,
                importedNames: [createNamespaceImportBinding()],
                isTypeOnly: false,
                isDynamic: true,
                isSideEffect: true,
                line: getLineFromOffset(sourceText, callExpression.start),
                column: getColumnFromOffset(sourceText, callExpression.start),
              });
            }
          }
        }
        if (
          memberExpression.object.type === "MetaProperty" &&
          memberExpression.property.name === "glob"
        ) {
          const globPatterns = extractGlobPatterns(callExpression.arguments);
          for (const globPattern of globPatterns) {
            imports.push({
              specifier: globPattern,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, callExpression.start),
              column: getColumnFromOffset(sourceText, callExpression.start),
            });
          }
        }

        if (
          memberExpression.object.type === "Identifier" &&
          memberExpression.object.name === "require" &&
          memberExpression.property.name === "context"
        ) {
          const directoryArgument = extractStringLiteralFromArgument(callExpression.arguments);
          if (
            directoryArgument &&
            (directoryArgument.startsWith("./") || directoryArgument.startsWith("../"))
          ) {
            const hasRegexArgument =
              callExpression.arguments.length >= 3 &&
              callExpression.arguments[2].type !== "SpreadElement";
            const regexSuffix = extractRegexGlobSuffix(callExpression.arguments);
            const canResolveFilter = !hasRegexArgument || Boolean(regexSuffix);
            if (canResolveFilter) {
              const isRecursive =
                callExpression.arguments[1]?.type === "Literal" &&
                (callExpression.arguments[1] as unknown as { value: unknown }).value === true;
              const contextGlobPrefix = isRecursive
                ? `${directoryArgument}/**/`
                : `${directoryArgument}/`;
              const contextGlobPattern = regexSuffix
                ? `${contextGlobPrefix}${regexSuffix}`
                : `${contextGlobPrefix}*`;
              imports.push({
                specifier: contextGlobPattern,
                importedNames: [createNamespaceImportBinding()],
                isTypeOnly: false,
                isDynamic: true,
                isSideEffect: false,
                isGlob: true,
                line: getLineFromOffset(sourceText, callExpression.start),
                column: getColumnFromOffset(sourceText, callExpression.start),
              });
            }
          }
        }
      }
    }

    if (node.type === "NewExpression") {
      const newExpression = node as unknown as {
        callee: Expression;
        arguments: CallExpression["arguments"];
        start: number;
      };
      if (
        newExpression.callee.type === "Identifier" &&
        (newExpression.callee as { name: string }).name === "URL" &&
        newExpression.arguments.length >= 2
      ) {
        const secondArgument = newExpression.arguments[1];
        const isImportMetaUrl =
          secondArgument.type === "MemberExpression" &&
          (secondArgument as unknown as StaticMemberExpression).object.type === "MetaProperty" &&
          (secondArgument as unknown as StaticMemberExpression).property.name === "url";
        if (isImportMetaUrl) {
          const urlSpecifier = extractStringLiteralFromArgument(newExpression.arguments);
          if (urlSpecifier) {
            imports.push({
              specifier: urlSpecifier,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: true,
              line: getLineFromOffset(sourceText, newExpression.start),
              column: getColumnFromOffset(sourceText, newExpression.start),
            });
          }
        }
      }
    }

    if (node.type === "Decorator") {
      const decoratorNode = node as unknown as { expression: WalkableNode };
      const expression = decoratorNode.expression;
      if (expression?.type === "CallExpression") {
        const callNode = expression as unknown as CallExpression;
        const callee = callNode.callee;
        if (callee.type === "Identifier" && (callee as { name: string }).name === "Component") {
          const objectArgument = callNode.arguments[0];
          if (objectArgument?.type === "ObjectExpression") {
            const objectProperties = (
              objectArgument as unknown as { properties: Array<WalkableNode> }
            ).properties;
            for (const property of objectProperties) {
              if (property.type !== "ObjectProperty" && property.type !== "Property") continue;
              const propertyKey = (
                property as unknown as { key: { name?: string; value?: string } }
              ).key;
              const propertyName = propertyKey?.name ?? propertyKey?.value;
              const propertyValue = (property as unknown as { value: WalkableNode }).value;
              if (propertyName === "templateUrl" && propertyValue?.type === "Literal") {
                const templatePath = (propertyValue as unknown as StringLiteral).value;
                if (templatePath) {
                  imports.push({
                    specifier: templatePath.startsWith(".") ? templatePath : `./${templatePath}`,
                    importedNames: [],
                    isTypeOnly: false,
                    isDynamic: false,
                    isSideEffect: true,
                    line: getLineFromOffset(sourceText, property.start),
                    column: getColumnFromOffset(sourceText, property.start),
                  });
                }
              }
              if ((propertyName === "styleUrl" || propertyName === "styleUrls") && propertyValue) {
                const styleUrlValues: string[] = [];
                if (propertyValue.type === "Literal") {
                  const singleValue = (propertyValue as unknown as StringLiteral).value;
                  if (singleValue) styleUrlValues.push(singleValue);
                } else if (propertyValue.type === "ArrayExpression") {
                  const arrayElements = (
                    propertyValue as unknown as { elements: Array<WalkableNode> }
                  ).elements;
                  for (const element of arrayElements) {
                    if (element?.type === "Literal") {
                      const elementValue = (element as unknown as StringLiteral).value;
                      if (elementValue) styleUrlValues.push(elementValue);
                    }
                  }
                }
                for (const styleUrl of styleUrlValues) {
                  imports.push({
                    specifier: styleUrl.startsWith(".") ? styleUrl : `./${styleUrl}`,
                    importedNames: [],
                    isTypeOnly: false,
                    isDynamic: false,
                    isSideEffect: true,
                    line: getLineFromOffset(sourceText, property.start),
                    column: getColumnFromOffset(sourceText, property.start),
                  });
                }
              }
            }
          }
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          if (isWalkableNode(element)) walkNode(element);
        }
      } else if (isWalkableNode(value)) {
        walkNode(value);
      }
    }
  };

  for (const topLevelNode of bodyNodes) {
    if (isWalkableNode(topLevelNode)) walkNode(topLevelNode);
  }
};

const ROUTE_CALL_FILE_ARG_INDEX: Record<string, number> = {
  route: 1,
  layout: 0,
  index: 0,
};

const extractStringFromExpression = (expression: WalkableNode): string | undefined => {
  if (expression.type === "Literal") {
    const literalValue = (expression as unknown as StringLiteral).value;
    return typeof literalValue === "string" ? literalValue : undefined;
  }
  if (expression.type === "TemplateLiteral") {
    const templateLiteral = expression as unknown as {
      quasis: Array<{ value: { cooked: string } }>;
      expressions: unknown[];
    };
    if (templateLiteral.expressions.length === 0 && templateLiteral.quasis.length === 1) {
      return templateLiteral.quasis[0]?.value.cooked;
    }
  }
  return undefined;
};

export const extractReactRouterRouteModuleEntries = (routesFilePath: string): string[] => {
  const sourceText = readFileSync(routesFilePath, "utf-8");
  const result = parseSync(routesFilePath, sourceText);

  if (result.errors.length > 0 || !result.program?.body) {
    return [];
  }

  const modulePaths: string[] = [];

  const walkForRouteCalls = (node: WalkableNode): void => {
    if (node.type === "CallExpression") {
      const callExpression = node as unknown as CallExpression;
      const callee = callExpression.callee;

      if (callee.type === "Identifier") {
        const calleeName = (callee as { name: string }).name;
        const fileArgumentIndex = ROUTE_CALL_FILE_ARG_INDEX[calleeName];

        if (fileArgumentIndex !== undefined) {
          const fileArgument = callExpression.arguments[fileArgumentIndex];
          if (fileArgument && fileArgument.type !== "SpreadElement") {
            const filePath = extractStringFromExpression(fileArgument as unknown as WalkableNode);
            if (filePath) {
              modulePaths.push(filePath);
            }
          }
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          if (isWalkableNode(element)) walkForRouteCalls(element);
        }
      } else if (isWalkableNode(value)) {
        walkForRouteCalls(value);
      }
    }
  };

  for (const topLevelNode of result.program.body) {
    if (isWalkableNode(topLevelNode)) walkForRouteCalls(topLevelNode);
  }

  return modulePaths;
};
