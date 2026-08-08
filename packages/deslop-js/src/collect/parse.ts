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
  ModuleDeclaration,
} from "@oxc-project/types";
import type {
  ImportReference,
  ExportReference,
  ImportBinding,
  MemberAccess,
  SourceModuleAnalysis,
  SourceModuleDuplicateConstantCandidate,
  SourceModuleIdentityWrapper,
  SourceModuleInlineTypeLiteral,
  SourceModuleRedundantTypePattern,
  SourceModuleSimplifiableExpression,
  SourceModuleSimplifiableFunction,
  SourceModuleTypeDefinitionHash,
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
import { getIdentifierName } from "../utils/oxc-ast-node.js";

export interface ParsedSource extends SourceModuleAnalysis {
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
    topLevelImportReferences: [],
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

  // Exported declarations are visited through their VALUE side only
  // (initializers, function/class bodies) — never their binding names —
  // so a same-file call to another exported symbol counts as a local
  // reference without every export marking itself referenced.
  const visitExportedDeclarationValues = (declaration: unknown): void => {
    if (!declaration || typeof declaration !== "object") return;
    const record = declaration as Record<string, unknown>;
    if (record.type === "VariableDeclaration" && Array.isArray(record.declarations)) {
      for (const declarator of record.declarations) {
        if (declarator && typeof declarator === "object") {
          visitNode((declarator as Record<string, unknown>).init);
        }
      }
      return;
    }
    if (record.type === "FunctionDeclaration" || record.type === "ClassDeclaration") {
      visitNode(record.params);
      visitNode(record.superClass);
      visitNode(record.body);
      return;
    }
    if (typeof record.type === "string" && !record.type.startsWith("TS")) {
      visitNode(declaration);
    }
  };

  for (const statement of statements) {
    if (statement.type === "ImportDeclaration" || statement.type === "ExportAllDeclaration") {
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      visitExportedDeclarationValues((statement as { declaration?: unknown }).declaration);
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      visitExportedDeclarationValues((statement as { declaration?: unknown }).declaration);
      continue;
    }
    visitNode(statement);
  }

  return references;
};

// TS wrapper expressions whose inner `.expression` is still a VALUE evaluated
// at runtime; every other `TS*` node is an erased type position.
const TS_VALUE_WRAPPER_NODE_TYPES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "TSTypeAssertion",
]);

// TS declarations that survive emit and evaluate at module init.
const TS_RUNTIME_DECLARATION_NODE_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSExportAssignment",
]);

const FUNCTION_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const collectStaticImportLocalNames = (imports: ImportReference[]): Set<string> => {
  const localNames = new Set<string>();
  for (const importInfo of imports) {
    if (importInfo.isDynamic || importInfo.isTypeOnly) continue;
    for (const binding of importInfo.importedNames) {
      if (binding.isTypeOnly) continue;
      const localName = binding.alias ?? binding.name;
      if (localName && localName !== "*") localNames.add(localName);
    }
  }
  return localNames;
};

// Records which static import bindings are dereferenced in code that runs at
// MODULE INIT time: top-level statements, IIFE bodies, class `extends` /
// decorators / static members — but not function bodies, method bodies, or
// erased TS type positions, all of which run (or vanish) after every module
// in a cycle has finished initializing. Cycle detection uses this to keep the
// documented initialization-order hazard firing while suppressing cycles whose
// back edges are only touched lazily.
const collectTopLevelImportReferences = (
  bodyNodes: Array<Statement | ModuleDeclaration>,
  importLocalNames: Set<string>,
): string[] => {
  const referencedNames = new Set<string>();
  if (importLocalNames.size === 0) return [];

  const visitClassBody = (classBody: WalkableNode): void => {
    const bodyElements = Array.isArray(classBody.body) ? classBody.body.filter(isWalkableNode) : [];
    for (const element of bodyElements) {
      if (element.type === "StaticBlock") {
        visitValueNode(element.body);
        continue;
      }
      const isComputedKey = Boolean(element.computed);
      if (isComputedKey) visitValueNode(element.key);
      const isStatic = Boolean(element.static);
      if (element.type === "PropertyDefinition" && isStatic) {
        visitValueNode(element.value);
      }
      visitValueNode(element.decorators);
    }
  };

  const visitValueNode = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const element of node) visitValueNode(element);
      return;
    }
    if (!isWalkableNode(node)) return;

    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      if (typeof node.name === "string" && importLocalNames.has(node.name)) {
        const identifierName = node.name;
        referencedNames.add(identifierName);
      }
      return;
    }

    if (node.type.startsWith("TS")) {
      if (TS_VALUE_WRAPPER_NODE_TYPES.has(node.type)) {
        visitValueNode(node.expression);
        return;
      }
      if (!TS_RUNTIME_DECLARATION_NODE_TYPES.has(node.type)) return;
    }

    if (FUNCTION_NODE_TYPES.has(node.type)) return;

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      visitValueNode(node.superClass);
      visitValueNode(node.decorators);
      if (isWalkableNode(node.body)) visitClassBody(node.body);
      return;
    }

    if (node.type === "CallExpression" || node.type === "NewExpression") {
      if (isWalkableNode(node.callee) && FUNCTION_NODE_TYPES.has(node.callee.type)) {
        visitValueNode(node.callee.body);
      }
    }

    if (node.type === "MemberExpression" || node.type === "JSXMemberExpression") {
      visitValueNode(node.object);
      if (node.computed) {
        visitValueNode(node.property);
      }
      return;
    }

    if (node.type === "Property") {
      if (node.computed) {
        visitValueNode(node.key);
      }
      visitValueNode(node.value);
      return;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) visitValueNode(element);
      } else if (value && typeof value === "object") {
        visitValueNode(value);
      }
    }
  };

  for (const statement of bodyNodes) {
    if (statement.type === "ImportDeclaration" || statement.type === "ExportAllDeclaration") {
      continue;
    }
    if (
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
    ) {
      visitValueNode((statement as { declaration?: unknown }).declaration);
      continue;
    }
    visitValueNode(statement);
  }

  return [...referencedNames];
};

const createEmptyParsedSource = (): ParsedSource => ({
  imports: [],
  exports: [],
  memberAccesses: [],
  wholeObjectUses: [],
  localIdentifierReferences: [],
  topLevelImportReferences: [],
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

  const topLevelImportReferences = safeWalk(
    "collectTopLevelImportReferences",
    () => collectTopLevelImportReferences(program.body, collectStaticImportLocalNames(imports)),
    [],
  );

  const redundantTypePatterns: SourceModuleRedundantTypePattern[] = [];
  const identityWrappers: SourceModuleIdentityWrapper[] = [];
  const typeDefinitionHashes: SourceModuleTypeDefinitionHash[] = [];
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
  const inlineTypeLiterals: SourceModuleInlineTypeLiteral[] = inlineTypeCaptures.map((capture) => ({
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
  const simplifiableFunctions: SourceModuleSimplifiableFunction[] = simplifiableCaptures.map(
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
  const simplifiableExpressions: SourceModuleSimplifiableExpression[] = expressionCaptures.map(
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
  const duplicateConstantCandidates: SourceModuleDuplicateConstantCandidate[] =
    constantCaptures.map((capture) => ({
      constantName: capture.constantName,
      literalHash: capture.literalHash,
      literalPreview: capture.literalPreview,
      line: getLineFromOffset(sourceText, capture.startOffset),
      column: getColumnFromOffset(sourceText, capture.startOffset),
    }));

  const referencedFilenames = extractReferencedFilenames(sourceText, program.body);

  return {
    imports,
    exports,
    memberAccesses,
    wholeObjectUses,
    localIdentifierReferences,
    topLevelImportReferences,
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
const REFERENCED_MODULE_PATH_PATTERN = /^[a-zA-Z0-9_@-][a-zA-Z0-9_@.-]*(?:\/[a-zA-Z0-9_@.-]+)+$/;

const extractReferencedFilenames = (
  sourceText: string,
  bodyNodes: Array<Statement | ModuleDeclaration> = [],
): string[] => {
  const captured = new Set<string>();
  REFERENCED_FILENAME_LITERAL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCED_FILENAME_LITERAL_PATTERN.exec(sourceText)) !== null) {
    captured.add(match[1]);
  }

  const visitNode = (node: WalkableNode): void => {
    if (node.type === "ImportExpression") {
      const sourceExpression = node.source;
      if (isWalkableNode(sourceExpression) && sourceExpression.type === "Literal") {
        const literalValue = sourceExpression.value;
        if (typeof literalValue === "string" && REFERENCED_MODULE_PATH_PATTERN.test(literalValue)) {
          captured.add(literalValue);
        }
      }
    }

    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const callArguments = node.arguments;
      for (const callArgument of Array.isArray(callArguments) ? callArguments : []) {
        if (!isWalkableNode(callArgument) || callArgument.type !== "Literal") continue;
        const literalValue = callArgument.value;
        if (typeof literalValue === "string" && REFERENCED_MODULE_PATH_PATTERN.test(literalValue)) {
          captured.add(literalValue);
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          if (isWalkableNode(element)) visitNode(element);
        }
      } else if (isWalkableNode(value)) {
        visitNode(value);
      }
    }
  };

  for (const bodyNode of bodyNodes) {
    if (isWalkableNode(bodyNode)) visitNode(bodyNode);
  }
  return [...captured];
};

const collectDryPatterns = (
  bodyNodes: Array<Statement | ModuleDeclaration>,
  sourceText: string,
  redundantTypePatterns: SourceModuleRedundantTypePattern[],
  identityWrappers: SourceModuleIdentityWrapper[],
  typeDefinitionHashes: SourceModuleTypeDefinitionHash[],
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
  redundantTypePatterns: SourceModuleRedundantTypePattern[],
  identityWrappers: SourceModuleIdentityWrapper[],
  typeDefinitionHashes: SourceModuleTypeDefinitionHash[],
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
      const objectName = getIdentifierName(node.object);
      const memberName = getIdentifierName(node.property);
      if (objectName && memberName && namespaceLocalNames.has(objectName)) {
        memberAccesses.push({ objectName, memberName });
      }
    }

    if (node.type === "MemberExpression" && Boolean(node.computed)) {
      const objectName = getIdentifierName(node.object);
      if (objectName && namespaceLocalNames.has(objectName)) {
        const expressionNode = node.expression;
        if (
          isWalkableNode(expressionNode) &&
          expressionNode.type === "Literal" &&
          typeof expressionNode.value === "string"
        ) {
          memberAccesses.push({ objectName, memberName: expressionNode.value });
        } else {
          wholeObjectUses.push(objectName);
        }
      }
    }

    // `<S.Custom />` — a JSX element whose name is a member of a namespace
    // import. The name node is a `JSXMemberExpression`, not a `MemberExpression`,
    // so it would otherwise be missed and the export reported unused (#875).
    if (node.type === "JSXMemberExpression") {
      const objectNode = isWalkableNode(node.object) ? node.object : undefined;
      const propertyNode = isWalkableNode(node.property) ? node.property : undefined;
      if (
        objectNode?.type === "JSXIdentifier" &&
        typeof objectNode.name === "string" &&
        namespaceLocalNames.has(objectNode.name) &&
        typeof propertyNode?.name === "string"
      ) {
        memberAccesses.push({
          objectName: objectNode.name,
          memberName: propertyNode.name,
        });
      }
    }

    if (node.type === "SpreadElement") {
      const spreadArgumentName = getIdentifierName(node.argument);
      if (spreadArgumentName && namespaceLocalNames.has(spreadArgumentName)) {
        wholeObjectUses.push(spreadArgumentName);
      }
    }

    // `const { a, b } = ns` — destructuring a namespace import reads those
    // members without a MemberExpression, so it would otherwise be invisible
    // to the usage map and the destructured exports reported unused (#875).
    if (node.type === "VariableDeclarator") {
      const namespaceName = getIdentifierName(node.init);
      if (
        namespaceName &&
        namespaceLocalNames.has(namespaceName) &&
        isWalkableNode(node.id) &&
        node.id.type === "ObjectPattern" &&
        Array.isArray(node.id.properties)
      ) {
        for (const property of node.id.properties.filter(isWalkableNode)) {
          if (property.type === "RestElement") {
            wholeObjectUses.push(namespaceName);
            continue;
          }
          if (property.computed) {
            wholeObjectUses.push(namespaceName);
          } else if (isWalkableNode(property.key)) {
            const propertyName = getIdentifierName(property.key);
            if (propertyName) {
              memberAccesses.push({ objectName: namespaceName, memberName: propertyName });
            } else if (property.key.type === "Literal" && typeof property.key.value === "string") {
              memberAccesses.push({ objectName: namespaceName, memberName: property.key.value });
            }
          }
        }
      }
    }

    if (node.type === "ForInStatement") {
      const rightName = getIdentifierName(node.right);
      if (rightName && namespaceLocalNames.has(rightName)) {
        wholeObjectUses.push(rightName);
      }
    }

    if (node.type === "CallExpression") {
      const calleeMember = isWalkableNode(node.callee) ? node.callee : undefined;
      if (calleeMember?.type === "MemberExpression" && !calleeMember.computed) {
        const calleeObjectName = getIdentifierName(calleeMember.object);
        const calleePropertyName = getIdentifierName(calleeMember.property);
        if (
          calleeObjectName === "Object" &&
          calleePropertyName &&
          WHOLE_OBJECT_FUNCTION_NAMES.has(calleePropertyName) &&
          Array.isArray(node.arguments)
        ) {
          const firstArgumentName = getIdentifierName(node.arguments[0]);
          if (firstArgumentName && namespaceLocalNames.has(firstArgumentName)) {
            wholeObjectUses.push(firstArgumentName);
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

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const isWalkableNode = (value: unknown): value is WalkableNode =>
  isObjectRecord(value) && typeof value.type === "string";

const getTemplateCookedValues = (expression: WalkableNode): string[] | undefined => {
  if (!Array.isArray(expression.quasis)) return undefined;
  const cookedValues: string[] = [];
  for (const quasi of expression.quasis) {
    if (
      !isObjectRecord(quasi) ||
      !isObjectRecord(quasi.value) ||
      typeof quasi.value.cooked !== "string"
    ) {
      return undefined;
    }
    cookedValues.push(quasi.value.cooked);
  }
  return cookedValues;
};

const extractStringLiteralFromArgument = (callArguments: unknown): string | undefined => {
  if (!Array.isArray(callArguments)) return undefined;
  const firstArgument = callArguments[0];
  if (!isWalkableNode(firstArgument)) return undefined;
  if (firstArgument.type === "SpreadElement") return undefined;
  if (firstArgument.type !== "Literal") return undefined;
  const literalValue = firstArgument.value;
  return typeof literalValue === "string" ? literalValue : undefined;
};

const extractGlobPatterns = (callArguments: unknown): string[] => {
  if (!Array.isArray(callArguments)) return [];
  const firstArgument = callArguments[0];
  if (!isWalkableNode(firstArgument) || firstArgument.type === "SpreadElement") return [];

  if (firstArgument.type === "Literal") {
    const literalValue = firstArgument.value;
    if (
      typeof literalValue === "string" &&
      (literalValue.startsWith("./") || literalValue.startsWith("../"))
    ) {
      return [literalValue];
    }
    return [];
  }

  if (firstArgument.type === "ArrayExpression") {
    if (!Array.isArray(firstArgument.elements)) return [];
    return firstArgument.elements.flatMap((element) => {
      if (
        !isWalkableNode(element) ||
        element.type !== "Literal" ||
        typeof element.value !== "string" ||
        (!element.value.startsWith("./") && !element.value.startsWith("../"))
      ) {
        return [];
      }
      return [element.value];
    });
  }

  return [];
};

interface RegexMetadata {
  pattern: string;
}

const isRegexMetadata = (value: unknown): value is RegexMetadata =>
  value !== null &&
  typeof value === "object" &&
  "pattern" in value &&
  typeof value.pattern === "string";

const extractRegexGlobSuffix = (callArguments: unknown): string | undefined => {
  if (!Array.isArray(callArguments)) return undefined;
  const thirdArgument = callArguments[2];
  if (!isWalkableNode(thirdArgument) || thirdArgument.type === "SpreadElement") return undefined;
  if (thirdArgument.type !== "Literal") return undefined;
  if (!isRegexMetadata(thirdArgument.regex)) return undefined;
  const pattern = thirdArgument.regex.pattern;
  const extensionMatch = pattern.match(/^\\\.([\w|]+)\$$/);
  if (extensionMatch) {
    const extensions = extensionMatch[1].split("|");
    if (extensions.length === 1) return `*.${extensions[0]}`;
    return `*.{${extensions.join(",")}}`;
  }
  return undefined;
};

const hasMockFactoryArgument = (callArguments: unknown): boolean => {
  if (!Array.isArray(callArguments)) return false;
  const secondArgument = callArguments[1];
  if (!isWalkableNode(secondArgument)) return false;
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
      const sourceExpression = isWalkableNode(node.source) ? node.source : undefined;
      if (!sourceExpression) return;
      if (sourceExpression.type === "Literal") {
        if (typeof sourceExpression.value === "string" && sourceExpression.value) {
          imports.push({
            specifier: sourceExpression.value,
            importedNames: [createNamespaceImportBinding()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, node.start),
            column: getColumnFromOffset(sourceText, node.start),
          });
        }
      } else if (sourceExpression.type === "TemplateLiteral") {
        const cookedValues = getTemplateCookedValues(sourceExpression);
        if (cookedValues && cookedValues.length >= 2) {
          const globPattern = cookedValues.join("*");
          if (globPattern.startsWith("./") || globPattern.startsWith("../")) {
            imports.push({
              specifier: globPattern,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, node.start),
              column: getColumnFromOffset(sourceText, node.start),
            });
          }
        }
      }
      return;
    }

    if (node.type === "CallExpression") {
      const callee = isWalkableNode(node.callee) ? node.callee : undefined;
      if (getIdentifierName(callee) === "require") {
        const requireSpecifier = extractStringLiteralFromArgument(node.arguments);
        if (requireSpecifier) {
          imports.push({
            specifier: requireSpecifier,
            importedNames: [createNamespaceImportBinding()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, node.start),
            column: getColumnFromOffset(sourceText, node.start),
          });
        }
      }

      if (callee?.type === "MemberExpression" && !callee.computed) {
        const objectName = getIdentifierName(callee.object);
        const propertyName = getIdentifierName(callee.property);

        if (objectName === "require" && propertyName === "resolve") {
          const resolveSpecifier = extractStringLiteralFromArgument(node.arguments);
          if (resolveSpecifier) {
            imports.push({
              specifier: resolveSpecifier,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              line: getLineFromOffset(sourceText, node.start),
              column: getColumnFromOffset(sourceText, node.start),
            });
          }
        }

        if ((objectName === "vi" || objectName === "jest") && propertyName === "mock") {
          const mockSpecifier = extractStringLiteralFromArgument(node.arguments);
          if (mockSpecifier) {
            imports.push({
              specifier: mockSpecifier,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: true,
              line: getLineFromOffset(sourceText, node.start),
              column: getColumnFromOffset(sourceText, node.start),
            });

            const hasFactoryArgument = hasMockFactoryArgument(node.arguments);
            const autoMockSibling = synthesizeAutoMockSibling(mockSpecifier);
            if (!hasFactoryArgument && autoMockSibling) {
              imports.push({
                specifier: autoMockSibling,
                importedNames: [createNamespaceImportBinding()],
                isTypeOnly: false,
                isDynamic: true,
                isSideEffect: true,
                line: getLineFromOffset(sourceText, node.start),
                column: getColumnFromOffset(sourceText, node.start),
              });
            }
          }
        }
        if (
          isWalkableNode(callee.object) &&
          callee.object.type === "MetaProperty" &&
          propertyName === "glob"
        ) {
          const globPatterns = extractGlobPatterns(node.arguments);
          for (const globPattern of globPatterns) {
            imports.push({
              specifier: globPattern,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, node.start),
              column: getColumnFromOffset(sourceText, node.start),
            });
          }
        }

        if (objectName === "require" && propertyName === "context") {
          const directoryArgument = extractStringLiteralFromArgument(node.arguments);
          if (
            directoryArgument &&
            (directoryArgument.startsWith("./") || directoryArgument.startsWith("../"))
          ) {
            const hasRegexArgument =
              Array.isArray(node.arguments) &&
              node.arguments.length >= 3 &&
              isWalkableNode(node.arguments[2]) &&
              node.arguments[2].type !== "SpreadElement";
            const regexSuffix = extractRegexGlobSuffix(node.arguments);
            const canResolveFilter = !hasRegexArgument || Boolean(regexSuffix);
            if (canResolveFilter) {
              const isRecursive =
                Array.isArray(node.arguments) &&
                isWalkableNode(node.arguments[1]) &&
                node.arguments[1].type === "Literal" &&
                node.arguments[1].value === true;
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
                line: getLineFromOffset(sourceText, node.start),
                column: getColumnFromOffset(sourceText, node.start),
              });
            }
          }
        }
      }
    }

    if (node.type === "NewExpression") {
      const calleeName = getIdentifierName(node.callee);
      if (calleeName === "URL" && Array.isArray(node.arguments) && node.arguments.length >= 2) {
        const secondArgument = isWalkableNode(node.arguments[1]) ? node.arguments[1] : undefined;
        const isImportMetaUrl =
          secondArgument?.type === "MemberExpression" &&
          isWalkableNode(secondArgument.object) &&
          secondArgument.object.type === "MetaProperty" &&
          getIdentifierName(secondArgument.property) === "url";
        if (isImportMetaUrl) {
          const urlSpecifier = extractStringLiteralFromArgument(node.arguments);
          if (urlSpecifier) {
            imports.push({
              specifier: urlSpecifier,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: true,
              line: getLineFromOffset(sourceText, node.start),
              column: getColumnFromOffset(sourceText, node.start),
            });
          }
        }
      }
    }

    if (node.type === "Decorator") {
      const expression = isWalkableNode(node.expression) ? node.expression : undefined;
      if (
        expression?.type === "CallExpression" &&
        getIdentifierName(expression.callee) === "Component"
      ) {
        const objectArgument = Array.isArray(expression.arguments)
          ? expression.arguments[0]
          : undefined;
        if (isWalkableNode(objectArgument) && objectArgument.type === "ObjectExpression") {
          const objectProperties = Array.isArray(objectArgument.properties)
            ? objectArgument.properties.filter(isWalkableNode)
            : [];
          for (const property of objectProperties) {
            if (property.type !== "ObjectProperty" && property.type !== "Property") continue;
            const propertyKey = isWalkableNode(property.key) ? property.key : undefined;
            const propertyName = getIdentifierName(propertyKey) ?? propertyKey?.value;
            const propertyValue = isWalkableNode(property.value) ? property.value : undefined;
            if (
              propertyName === "templateUrl" &&
              propertyValue?.type === "Literal" &&
              typeof propertyValue.value === "string" &&
              propertyValue.value
            ) {
              const templatePath = propertyValue.value;
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
            if ((propertyName === "styleUrl" || propertyName === "styleUrls") && propertyValue) {
              const styleUrlValues: string[] = [];
              if (propertyValue.type === "Literal" && typeof propertyValue.value === "string") {
                styleUrlValues.push(propertyValue.value);
              } else if (
                propertyValue.type === "ArrayExpression" &&
                Array.isArray(propertyValue.elements)
              ) {
                for (const element of propertyValue.elements) {
                  if (
                    isWalkableNode(element) &&
                    element.type === "Literal" &&
                    typeof element.value === "string"
                  ) {
                    styleUrlValues.push(element.value);
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
    const literalValue = expression.value;
    return typeof literalValue === "string" ? literalValue : undefined;
  }
  if (expression.type === "TemplateLiteral") {
    const cookedValues = getTemplateCookedValues(expression);
    if (Array.isArray(expression.expressions) && expression.expressions.length === 0) {
      return cookedValues?.length === 1 ? cookedValues[0] : undefined;
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
      const calleeName = getIdentifierName(node.callee);
      if (calleeName) {
        const fileArgumentIndex = ROUTE_CALL_FILE_ARG_INDEX[calleeName];

        if (fileArgumentIndex !== undefined && Array.isArray(node.arguments)) {
          const fileArgument = node.arguments[fileArgumentIndex];
          if (isWalkableNode(fileArgument) && fileArgument.type !== "SpreadElement") {
            const filePath = extractStringFromExpression(fileArgument);
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
