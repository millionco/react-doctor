import { parse as parseAstro } from "@astrojs/compiler/sync";
import type { Node as AstroNode } from "@astrojs/compiler/types";
import { parseSync } from "oxc-parser";
import { readFileSync, statSync } from "node:fs";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import ts from "typescript";
import {
  BINARY_DETECTION_NULL_BYTE_THRESHOLD,
  BINARY_DETECTION_SAMPLE_BYTES,
  MAX_PARSE_FILE_SIZE_BYTES,
  MINIFIED_DETECTION_MEDIAN_LINE_LENGTH_THRESHOLD,
  MINIFIED_DETECTION_MIN_BYTES,
} from "../constants.js";
import {
  type ProjectAnalysisError,
  FileReadError,
  ParseError,
  describeUnknownError,
} from "../errors.js";
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
} from "oxc-parser";
import type {
  ImportReference,
  ExportReference,
  ImportBinding,
  MemberAccess,
  SourceModuleAnalysis,
} from "../types.js";
import { getLineFromOffset, getColumnFromOffset } from "../utils/line-column.js";
import { extractDefaultExportLocalName } from "../utils/extract-default-export-local-name.js";
import { getIdentifierName, isOxcAstNode } from "../utils/oxc-ast-node.js";
import { visitOxcAstWithBindings } from "../utils/visit-oxc-ast-with-bindings.js";
import { isGeneratedSource } from "../utils/is-generated-source.js";
import { collectStylesheetImportSpecifiers } from "../utils/collect-stylesheet-import-specifiers.js";
import { extractJitiLoadReferences } from "../utils/extract-jiti-load-references.js";
import { extractMarkdownModuleStatements } from "../utils/extract-markdown-module-statements.js";

export interface ParsedSource extends SourceModuleAnalysis {
  errors: ProjectAnalysisError[];
  isGenerated: boolean;
}

const extractRecoveryImports = (filePath: string, sourceText: string): ImportReference[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: ImportReference[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const importedNames: ImportBinding[] = [];
    const importClause = statement.importClause;
    if (importClause?.name) {
      importedNames.push({
        name: "default",
        alias: importClause.name.text,
        isNamespace: false,
        isDefault: true,
        isTypeOnly: importClause.isTypeOnly,
      });
    }
    if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
      importedNames.push({
        name: "*",
        alias: importClause.namedBindings.name.text,
        isNamespace: true,
        isDefault: false,
        isTypeOnly: importClause.isTypeOnly,
      });
    }
    if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        importedNames.push({
          name: element.propertyName?.text ?? element.name.text,
          alias: element.name.text,
          isNamespace: false,
          isDefault: false,
          isTypeOnly: importClause.isTypeOnly || element.isTypeOnly,
        });
      }
    }
    const offset = statement.getStart(sourceFile);
    imports.push({
      specifier: statement.moduleSpecifier.text,
      importedNames,
      isTypeOnly: importClause?.isTypeOnly ?? false,
      isDynamic: false,
      isSideEffect: importClause === undefined,
      line: getLineFromOffset(sourceText, offset),
      column: getColumnFromOffset(sourceText, offset),
    });
  }
  return imports;
};

const createWhitespaceMask = (sourceText: string): string[] =>
  sourceText
    .split("")
    .map((character) => (character === "\n" || character === "\r" ? character : " "));

const restoreMaskedSourceRange = (
  maskedSource: string[],
  sourceSection: string,
  startOffset: number,
): void => {
  for (let characterIndex = 0; characterIndex < sourceSection.length; characterIndex++) {
    maskedSource[startOffset + characterIndex] = sourceSection[characterIndex];
  }
};

const maskSelectedExportKeywords = (
  sourceText: string,
  shouldMaskStatement: (statement: ts.Statement) => boolean,
): string => {
  const sourceFile = ts.createSourceFile(
    "embedded-component.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const maskedSource = sourceText.split("");
  for (const statement of sourceFile.statements) {
    if (!shouldMaskStatement(statement) || !ts.canHaveModifiers(statement)) continue;
    const exportModifier = ts
      .getModifiers(statement)
      ?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportModifier) continue;
    for (
      let characterIndex = exportModifier.getStart(sourceFile);
      characterIndex < exportModifier.end;
      characterIndex++
    ) {
      maskedSource[characterIndex] = " ";
    }
  }
  return maskedSource.join("");
};

const maskAstroPropsExports = (sourceText: string): string =>
  maskSelectedExportKeywords(
    sourceText,
    (statement) =>
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === "Props",
  );

const maskSvelteInstancePropExports = (sourceText: string): string =>
  maskSelectedExportKeywords(
    sourceText,
    (statement) =>
      ts.isVariableStatement(statement) &&
      (statement.declarationList.flags & ts.NodeFlags.Let) !== 0,
  );

const extractAstroSources = (sourceText: string): string => {
  const maskedSource = createWhitespaceMask(sourceText);
  let astroRoot: ReturnType<typeof parseAstro>["ast"];
  try {
    astroRoot = parseAstro(sourceText, { position: true }).ast;
  } catch {
    return maskedSource.join("");
  }

  const sourceOffsetByByteOffset = new Map<number, number>();
  let byteOffset = 0;
  let sourceOffset = 0;
  for (const character of sourceText) {
    sourceOffsetByByteOffset.set(byteOffset, sourceOffset);
    byteOffset += Buffer.byteLength(character);
    sourceOffset += character.length;
  }
  sourceOffsetByByteOffset.set(byteOffset, sourceOffset);

  const getSourceOffset = (node: AstroNode): number | undefined => {
    const nodeByteOffset = node.position?.start.offset;
    return nodeByteOffset === undefined ? undefined : sourceOffsetByByteOffset.get(nodeByteOffset);
  };
  const restoreNodeValue = (
    node: AstroNode,
    sourceValue: string,
    maskedValue = sourceValue,
  ): void => {
    const nodeStartOffset = getSourceOffset(node);
    if (nodeStartOffset === undefined) return;
    const valueStartOffset = sourceText.indexOf(sourceValue, nodeStartOffset);
    if (valueStartOffset === -1) return;
    restoreMaskedSourceRange(maskedSource, maskedValue, valueStartOffset);
  };
  const visitNode = (node: AstroNode): void => {
    if (node.type === "frontmatter") {
      restoreNodeValue(node, node.value, maskAstroPropsExports(node.value));
      return;
    }
    if (node.type === "element" && node.name.toLowerCase() === "script") {
      const sourceAttribute = node.attributes.find(
        (attribute) => attribute.name.toLowerCase() === "src" && attribute.kind === "quoted",
      );
      const nodeStartOffset = getSourceOffset(node);
      if (sourceAttribute && nodeStartOffset !== undefined) {
        restoreMaskedSourceRange(
          maskedSource,
          `import ${JSON.stringify(sourceAttribute.value)};`,
          nodeStartOffset,
        );
      }
      for (const childNode of node.children) {
        if (childNode.type === "text") restoreNodeValue(childNode, childNode.value);
      }
    }
    if ("children" in node) {
      for (const childNode of node.children) visitNode(childNode);
    }
  };
  visitNode(astroRoot);
  return maskedSource.join("");
};

const extractHtmlLikeTopLevelScriptContent = (
  sourceText: string,
  transformScriptBody: (
    scriptBody: string,
    scriptElement: DefaultTreeAdapterMap["element"],
  ) => string,
): string => {
  const maskedSource = createWhitespaceMask(sourceText);
  const documentFragment = parseFragment(sourceText, { sourceCodeLocationInfo: true });
  const visitNode = (node: DefaultTreeAdapterMap["node"], isLexicallyTopLevel: boolean): void => {
    if (!("tagName" in node)) return;
    if (isLexicallyTopLevel && node.tagName.toLowerCase() === "script") {
      const bodyStartOffset = node.sourceCodeLocation?.startTag?.endOffset;
      const bodyEndOffset = node.sourceCodeLocation?.endTag?.startOffset;
      if (bodyStartOffset !== undefined && bodyEndOffset !== undefined) {
        const scriptBody = sourceText.slice(bodyStartOffset, bodyEndOffset);
        restoreMaskedSourceRange(
          maskedSource,
          transformScriptBody(scriptBody, node),
          bodyStartOffset,
        );
      }
      return;
    }
    const startTagLocation = node.sourceCodeLocation?.startTag;
    const hasSelfClosingStartTag =
      startTagLocation !== undefined &&
      sourceText
        .slice(startTagLocation.startOffset, startTagLocation.endOffset)
        .trimEnd()
        .endsWith("/>");
    for (const childNode of node.childNodes) {
      visitNode(childNode, isLexicallyTopLevel && hasSelfClosingStartTag);
    }
  };
  for (const childNode of documentFragment.childNodes) visitNode(childNode, true);
  return maskedSource.join("");
};

const extractVueScriptContent = (sourceText: string): string =>
  extractHtmlLikeTopLevelScriptContent(sourceText, (scriptBody) => scriptBody);

const extractSvelteScriptContent = (sourceText: string): string =>
  extractHtmlLikeTopLevelScriptContent(sourceText, (scriptBody, scriptElement) => {
    const isModuleScript = scriptElement.attrs.some(
      (attribute) =>
        attribute.name === "module" ||
        (attribute.name === "context" && attribute.value === "module"),
    );
    return isModuleScript ? scriptBody : maskSvelteInstancePropExports(scriptBody);
  });

const getModuleExportNameValue = (exportName: ModuleExportName): string => {
  if (exportName.type === "Identifier") return exportName.name;
  if (exportName.type === "Literal") return exportName.value;
  return "default";
};

const CSS_EXTENSIONS = [".css", ".scss", ".less", ".sass"];

const parseCssImports = (filePath: string): ParsedSource => {
  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportReference[] = [];

  for (const { specifier, index } of collectStylesheetImportSpecifiers(sourceText)) {
    if (!specifier.startsWith("http")) {
      imports.push({
        specifier,
        importedNames: [],
        isTypeOnly: false,
        isDynamic: false,
        isSideEffect: true,
        line: sourceText.substring(0, index).split("\n").length,
        column: 0,
      });
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
    hasUnknownDynamicModuleLoad: false,
    errors: [],
    isGenerated: false,
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

  const visitExportedDeclarationValues = (declaration: unknown): void => {
    if (!declaration || typeof declaration !== "object") return;
    const record = declaration as Record<string, unknown>;
    if (typeof record.type === "string" && TS_VALUE_WRAPPER_NODE_TYPES.has(record.type)) {
      visitNode(record.expression);
      return;
    }
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
    if (record.type === "TSTypeAliasDeclaration") {
      visitNode(record.typeParameters);
      visitNode(record.typeAnnotation);
      return;
    }
    if (record.type === "TSInterfaceDeclaration") {
      visitNode(record.typeParameters);
      visitNode(record.extends);
      visitNode(record.body);
      return;
    }
    if (record.type === "TSEnumDeclaration" && Array.isArray(record.members)) {
      for (const member of record.members) {
        if (member && typeof member === "object") {
          visitNode((member as Record<string, unknown>).initializer);
        }
      }
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

const TS_VALUE_WRAPPER_NODE_TYPES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "TSTypeAssertion",
]);

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

  const addBindingNames = (pattern: unknown, names: Set<string>): void => {
    if (!isWalkableNode(pattern)) return;
    if (pattern.type === "Identifier") {
      if (typeof pattern.name === "string") names.add(pattern.name);
      return;
    }
    if (pattern.type === "RestElement") {
      addBindingNames(pattern.argument, names);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      addBindingNames(pattern.left, names);
      return;
    }
    if (pattern.type === "ObjectPattern" && Array.isArray(pattern.properties)) {
      for (const property of pattern.properties) {
        if (!isWalkableNode(property)) continue;
        addBindingNames(
          property.type === "RestElement" ? property.argument : property.value,
          names,
        );
      }
      return;
    }
    if (pattern.type === "ArrayPattern" && Array.isArray(pattern.elements)) {
      for (const element of pattern.elements) addBindingNames(element, names);
    }
  };

  const collectDirectBlockBindings = (body: unknown): Set<string> => {
    const names = new Set<string>();
    if (!Array.isArray(body)) return names;
    for (const statement of body) {
      if (!isWalkableNode(statement)) continue;
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        for (const declaration of Array.isArray(statement.declarations)
          ? statement.declarations
          : []) {
          if (isWalkableNode(declaration)) addBindingNames(declaration.id, names);
        }
      }
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        addBindingNames(statement.id, names);
      }
    }
    return names;
  };

  const collectFunctionBindings = (functionNode: WalkableNode): Set<string> => {
    const names = new Set<string>();
    addBindingNames(functionNode.id, names);
    for (const parameter of Array.isArray(functionNode.params) ? functionNode.params : []) {
      addBindingNames(parameter, names);
    }
    const visitForVarBindings = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const element of node) visitForVarBindings(element);
        return;
      }
      if (!isWalkableNode(node)) return;
      if (node !== functionNode && FUNCTION_NODE_TYPES.has(node.type)) return;
      if (node.type === "VariableDeclaration" && node.kind === "var") {
        for (const declaration of Array.isArray(node.declarations) ? node.declarations : []) {
          if (isWalkableNode(declaration)) addBindingNames(declaration.id, names);
        }
      }
      for (const value of Object.values(node)) visitForVarBindings(value);
    };
    visitForVarBindings(functionNode.body);
    return names;
  };

  const unwrapFunctionExpression = (node: unknown): WalkableNode | undefined => {
    let currentNode = isWalkableNode(node) ? node : undefined;
    while (
      currentNode &&
      (currentNode.type === "ParenthesizedExpression" ||
        TS_VALUE_WRAPPER_NODE_TYPES.has(currentNode.type))
    ) {
      currentNode = isWalkableNode(currentNode.expression) ? currentNode.expression : undefined;
    }
    return currentNode && FUNCTION_NODE_TYPES.has(currentNode.type) ? currentNode : undefined;
  };

  const mergeShadowedNames = (
    shadowedNames: ReadonlySet<string>,
    newNames: ReadonlySet<string>,
  ): ReadonlySet<string> =>
    newNames.size === 0 ? shadowedNames : new Set([...shadowedNames, ...newNames]);

  const visitClassBody = (classBody: WalkableNode, shadowedNames: ReadonlySet<string>): void => {
    const bodyElements = Array.isArray(classBody.body) ? classBody.body.filter(isWalkableNode) : [];
    for (const element of bodyElements) {
      if (element.type === "StaticBlock") {
        visitValueNode(element, shadowedNames);
        continue;
      }
      const isComputedKey = Boolean(element.computed);
      if (isComputedKey) visitValueNode(element.key, shadowedNames);
      const isStatic = Boolean(element.static);
      if (element.type === "PropertyDefinition" && isStatic) {
        visitValueNode(element.value, shadowedNames);
      }
      visitValueNode(element.decorators, shadowedNames);
    }
  };

  const visitValueNode = (node: unknown, shadowedNames: ReadonlySet<string>): void => {
    if (Array.isArray(node)) {
      for (const element of node) visitValueNode(element, shadowedNames);
      return;
    }
    if (!isWalkableNode(node)) return;

    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      if (
        typeof node.name === "string" &&
        importLocalNames.has(node.name) &&
        !shadowedNames.has(node.name)
      ) {
        const identifierName = node.name;
        referencedNames.add(identifierName);
      }
      return;
    }

    if (node.type.startsWith("TS")) {
      if (TS_VALUE_WRAPPER_NODE_TYPES.has(node.type)) {
        visitValueNode(node.expression, shadowedNames);
        return;
      }
      if (!TS_RUNTIME_DECLARATION_NODE_TYPES.has(node.type)) return;
    }

    if (FUNCTION_NODE_TYPES.has(node.type)) return;

    if (node.type === "BlockStatement" || node.type === "StaticBlock") {
      const blockShadowedNames = mergeShadowedNames(
        shadowedNames,
        collectDirectBlockBindings(node.body),
      );
      visitValueNode(node.body, blockShadowedNames);
      return;
    }

    if (node.type === "VariableDeclarator") {
      visitValueNode(node.init, shadowedNames);
      return;
    }

    if (node.type === "CatchClause") {
      const catchBindingNames = new Set<string>();
      addBindingNames(node.param, catchBindingNames);
      const catchShadowedNames = mergeShadowedNames(shadowedNames, catchBindingNames);
      visitValueNode(node.body, catchShadowedNames);
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      visitValueNode(node.superClass, shadowedNames);
      visitValueNode(node.decorators, shadowedNames);
      if (isWalkableNode(node.body)) visitClassBody(node.body, shadowedNames);
      return;
    }

    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const calledFunction = unwrapFunctionExpression(node.callee);
      if (calledFunction) {
        const functionShadowedNames = mergeShadowedNames(
          shadowedNames,
          collectFunctionBindings(calledFunction),
        );
        visitValueNode(calledFunction.body, functionShadowedNames);
        visitValueNode(node.arguments, shadowedNames);
        return;
      }
    }

    if (node.type === "MemberExpression" || node.type === "JSXMemberExpression") {
      visitValueNode(node.object, shadowedNames);
      if (node.computed) {
        visitValueNode(node.property, shadowedNames);
      }
      return;
    }

    if (node.type === "Property") {
      if (node.computed) {
        visitValueNode(node.key, shadowedNames);
      }
      visitValueNode(node.value, shadowedNames);
      return;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) visitValueNode(element, shadowedNames);
      } else if (value && typeof value === "object") {
        visitValueNode(value, shadowedNames);
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
      visitValueNode((statement as { declaration?: unknown }).declaration, new Set());
      continue;
    }
    visitValueNode(statement, new Set());
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
  hasUnknownDynamicModuleLoad: false,
  errors: [],
  isGenerated: false,
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
  const lineLengths = sourceText
    .split("\n")
    .map((sourceLine) => sourceLine.length)
    .sort((leftLength, rightLength) => leftLength - rightLength);
  const medianLineLength = lineLengths[Math.floor(lineLengths.length / 2)];
  return medianLineLength > MINIFIED_DETECTION_MEDIAN_LINE_LENGTH_THRESHOLD;
};

const safeReadSourceFile = (
  filePath: string,
  errors: ProjectAnalysisError[],
): string | undefined => {
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
  const shouldCollectPushReferences = !/(?:^|[\\/])app\.config\.[^\\/]+$/.test(filePath);
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

  const earlyErrors: ProjectAnalysisError[] = [];
  const sourceText = safeReadSourceFile(filePath, earlyErrors);
  if (sourceText === undefined) {
    return {
      ...createEmptyParsedSource(),
      errors: earlyErrors,
      isGenerated: isGeneratedSource(filePath, ""),
    };
  }
  const isGenerated = isGeneratedSource(filePath, sourceText);
  const imports: ImportReference[] = [];
  const exports: ExportReference[] = [];

  const isMdx = filePath.endsWith(".mdx") || filePath.endsWith(".md");
  const isAstro = filePath.endsWith(".astro");
  const isVue = filePath.endsWith(".vue");
  const isSvelte = filePath.endsWith(".svelte");
  const isPreprocessed = isMdx || isAstro || isVue || isSvelte;
  const textToParse = isMdx
    ? extractMarkdownModuleStatements(sourceText)
    : isAstro
      ? extractAstroSources(sourceText)
      : isVue
        ? extractVueScriptContent(sourceText)
        : isSvelte
          ? extractSvelteScriptContent(sourceText)
          : sourceText;
  const parseFileName =
    isMdx || isAstro || isVue || isSvelte
      ? filePath.replace(/\.(md|mdx|astro|vue|svelte)$/, ".tsx")
      : filePath;

  let result: ReturnType<typeof parseSync>;
  try {
    result = parseSync(parseFileName, textToParse);
  } catch (parseError) {
    return {
      ...createEmptyParsedSource(),
      isGenerated,
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
    imports.push(...extractRecoveryImports(filePath, sourceText));
    return {
      ...createEmptyParsedSource(),
      imports,
      exports,
      referencedFilenames: extractReferencedFilenames(sourceText, [], shouldCollectPushReferences),
      isGenerated,
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
      referencedFilenames: extractReferencedFilenames(sourceText, [], shouldCollectPushReferences),
      isGenerated,
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

  const detectorErrors: ProjectAnalysisError[] = [];

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

  const hasUnknownDynamicModuleLoad = safeWalk(
    "collectDynamicImports",
    () => collectDynamicImports(program.body, sourceText, imports),
    true,
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

  const referencedFilenames = extractReferencedFilenames(
    sourceText,
    program.body,
    shouldCollectPushReferences,
  );

  return {
    imports,
    exports,
    memberAccesses,
    wholeObjectUses,
    localIdentifierReferences,
    topLevelImportReferences,
    referencedFilenames,
    hasUnknownDynamicModuleLoad,
    errors: [...earlyErrors, ...detectorErrors],
    isGenerated,
  };
};

const REFERENCED_FILENAME_LITERAL_PATTERN =
  /(?<![./@\w-])(?:["'`])([a-z][\w-]*\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs))(?:["'`])/g;
const REFERENCED_MODULE_PATH_PATTERN = /^[a-zA-Z0-9_@-][a-zA-Z0-9_@.-]*(?:\/[a-zA-Z0-9_@.-]+)+$/;
const REFERENCED_MODULE_STEM_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

const extractReferencedFilenames = (
  sourceText: string,
  bodyNodes: Array<Statement | ModuleDeclaration> = [],
  shouldCollectPushReferences = true,
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
      const isPushCall =
        node.type === "CallExpression" &&
        isWalkableNode(node.callee) &&
        node.callee.type === "MemberExpression" &&
        getIdentifierName(node.callee.property) === "push";
      if (!isPushCall || shouldCollectPushReferences) {
        for (const callArgument of Array.isArray(callArguments) ? callArguments : []) {
          if (!isWalkableNode(callArgument) || callArgument.type !== "Literal") continue;
          const literalValue = callArgument.value;
          if (
            typeof literalValue === "string" &&
            (REFERENCED_MODULE_PATH_PATTERN.test(literalValue) ||
              REFERENCED_MODULE_STEM_PATTERN.test(literalValue))
          ) {
            captured.add(literalValue);
          }
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
    isNamespaceReExport: true,
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

const createTypeImportBinding = (qualifier: unknown): ImportBinding => {
  let importedName: string | undefined;
  let currentQualifier = isWalkableNode(qualifier) ? qualifier : undefined;
  while (currentQualifier?.type === "TSQualifiedName") {
    currentQualifier = isWalkableNode(currentQualifier.left) ? currentQualifier.left : undefined;
  }
  if (currentQualifier?.type === "Identifier" && typeof currentQualifier.name === "string") {
    importedName = currentQualifier.name;
  }
  return importedName
    ? {
        name: importedName,
        alias: importedName,
        isNamespace: false,
        isDefault: false,
        isTypeOnly: true,
      }
    : {
        ...createNamespaceImportBinding(),
        isTypeOnly: true,
      };
};

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

const isImportMeta = (value: unknown): boolean =>
  isWalkableNode(value) &&
  value.type === "MetaProperty" &&
  getIdentifierName(value.meta) === "import" &&
  getIdentifierName(value.property) === "meta";

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
      (literalValue.startsWith("./") ||
        literalValue.startsWith("../") ||
        literalValue.startsWith("/"))
    ) {
      return [literalValue];
    }
    return [];
  }

  if (firstArgument.type === "TemplateLiteral") {
    const cookedValues = getTemplateCookedValues(firstArgument);
    if (
      cookedValues?.length === 1 &&
      (cookedValues[0].startsWith("./") ||
        cookedValues[0].startsWith("../") ||
        cookedValues[0].startsWith("/"))
    ) {
      return [cookedValues[0]];
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
        (!element.value.startsWith("./") &&
          !element.value.startsWith("../") &&
          !element.value.startsWith("/"))
      ) {
        return [];
      }
      return [element.value];
    });
  }

  return [];
};

interface WebpackContextMetadata {
  specifier: string;
  globBaseDirectory: string;
  globFilterPattern: string | undefined;
  globFilterFlags: string | undefined;
}

const extractRequireContextMetadata = (
  callArguments: unknown,
): WebpackContextMetadata | undefined => {
  if (!Array.isArray(callArguments)) return undefined;
  const directoryArgument = callArguments[0];
  const recursiveArgument = callArguments[1];
  const regularExpressionArgument = callArguments[2];
  if (
    !isWalkableNode(directoryArgument) ||
    directoryArgument.type !== "Literal" ||
    typeof directoryArgument.value !== "string" ||
    (!directoryArgument.value.startsWith("./") &&
      !directoryArgument.value.startsWith("../") &&
      directoryArgument.value !== "." &&
      directoryArgument.value !== "..")
  ) {
    return undefined;
  }

  let isRecursive = true;
  if (recursiveArgument !== undefined) {
    if (
      !isWalkableNode(recursiveArgument) ||
      recursiveArgument.type !== "Literal" ||
      typeof recursiveArgument.value !== "boolean"
    ) {
      return undefined;
    }
    isRecursive = recursiveArgument.value;
  }

  let globFilterPattern: string | undefined;
  let globFilterFlags: string | undefined;
  if (regularExpressionArgument !== undefined) {
    if (
      !isWalkableNode(regularExpressionArgument) ||
      regularExpressionArgument.type !== "Literal" ||
      !isObjectRecord(regularExpressionArgument.regex) ||
      typeof regularExpressionArgument.regex.pattern !== "string"
    ) {
      return undefined;
    }
    globFilterPattern = regularExpressionArgument.regex.pattern;
    globFilterFlags =
      typeof regularExpressionArgument.regex.flags === "string"
        ? regularExpressionArgument.regex.flags
        : undefined;
  }

  const directory = directoryArgument.value.replace(/\/$/, "");
  return {
    specifier: `${directory}/${isRecursive ? "**/*" : "*"}`,
    globBaseDirectory: directoryArgument.value,
    globFilterPattern,
    globFilterFlags,
  };
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
): boolean => {
  const trustedTestApiBindingNames = new Set<string>();
  const trustedCreateRequireFactoryNames = new Set<string>();
  const trustedModuleNamespaceNames = new Set<string>();
  for (const statement of bodyNodes) {
    if (statement.type !== "ImportDeclaration") continue;
    const moduleName =
      isWalkableNode(statement.source) && typeof statement.source.value === "string"
        ? statement.source.value
        : undefined;
    const isNodeModule = moduleName === "module" || moduleName === "node:module";
    const trustedImportName =
      moduleName === "vitest" ? "vi" : moduleName === "@jest/globals" ? "jest" : undefined;
    if (!Array.isArray(statement.specifiers)) continue;
    for (const specifier of statement.specifiers) {
      if (!isWalkableNode(specifier)) continue;
      const localName = getIdentifierName(specifier.local);
      if (!localName) continue;
      if (
        trustedImportName &&
        specifier.type === "ImportSpecifier" &&
        getIdentifierName(specifier.imported) === trustedImportName
      )
        trustedTestApiBindingNames.add(localName);
      if (!isNodeModule) continue;
      if (
        specifier.type === "ImportSpecifier" &&
        getIdentifierName(specifier.imported) === "createRequire"
      )
        trustedCreateRequireFactoryNames.add(localName);
      if (specifier.type === "ImportNamespaceSpecifier") {
        trustedModuleNamespaceNames.add(localName);
      }
    }
  }
  let isGlobalRequireAvailable = true;
  visitOxcAstWithBindings(
    { type: "Program", start: 0, end: sourceText.length, body: bodyNodes },
    (_node, bindingNames) => {
      isGlobalRequireAvailable = !bindingNames.has("require");
      return false;
    },
  );
  const unwrapExpression = (value: unknown): WalkableNode | undefined => {
    let expression = isWalkableNode(value) ? value : undefined;
    while (
      expression &&
      (expression.type === "ParenthesizedExpression" ||
        expression.type === "TSAsExpression" ||
        expression.type === "TSTypeAssertion" ||
        expression.type === "TSNonNullExpression" ||
        expression.type === "ChainExpression")
    ) {
      expression = isWalkableNode(expression.expression) ? expression.expression : undefined;
    }
    return expression;
  };
  const isTrustedNodeModuleRequireCall = (value: unknown): boolean => {
    const expression = unwrapExpression(value);
    if (!isGlobalRequireAvailable || expression?.type !== "CallExpression") return false;
    if (getIdentifierName(unwrapExpression(expression.callee)) !== "require") return false;
    const moduleName = extractStringLiteralFromArgument(expression.arguments);
    return moduleName === "module" || moduleName === "node:module";
  };
  for (const statement of bodyNodes) {
    if (statement.type !== "VariableDeclaration" || statement.kind !== "const") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isWalkableNode(declaration)) continue;
      const initializer = unwrapExpression(declaration.init);
      if (isTrustedNodeModuleRequireCall(initializer)) {
        const namespaceName = getIdentifierName(declaration.id);
        if (namespaceName) trustedModuleNamespaceNames.add(namespaceName);
        if (isWalkableNode(declaration.id) && declaration.id.type === "ObjectPattern") {
          const properties = Array.isArray(declaration.id.properties)
            ? declaration.id.properties
            : [];
          for (const property of properties) {
            if (
              isWalkableNode(property) &&
              property.type === "Property" &&
              !property.computed &&
              getIdentifierName(property.key) === "createRequire"
            ) {
              const factoryName = getIdentifierName(property.value);
              if (factoryName) trustedCreateRequireFactoryNames.add(factoryName);
            }
          }
        }
      }
      if (
        initializer?.type === "MemberExpression" &&
        !initializer.computed &&
        getIdentifierName(initializer.property) === "createRequire" &&
        isTrustedNodeModuleRequireCall(initializer.object)
      ) {
        const factoryName = getIdentifierName(declaration.id);
        if (factoryName) trustedCreateRequireFactoryNames.add(factoryName);
      }
    }
  }
  const isTrustedCreateRequireCall = (value: unknown): boolean => {
    const expression = unwrapExpression(value);
    if (expression?.type !== "CallExpression") return false;
    const callee = unwrapExpression(expression.callee);
    const directCalleeName = getIdentifierName(callee);
    if (directCalleeName && trustedCreateRequireFactoryNames.has(directCalleeName)) return true;
    if (callee?.type !== "MemberExpression" || callee.computed) return false;
    if (getIdentifierName(callee.property) !== "createRequire") return false;
    const namespaceName = getIdentifierName(unwrapExpression(callee.object));
    if (namespaceName && trustedModuleNamespaceNames.has(namespaceName)) return true;
    return isTrustedNodeModuleRequireCall(callee.object);
  };
  const trustedRequireBindingNames = new Set<string>();
  for (const statement of bodyNodes) {
    if (statement.type !== "VariableDeclaration" || statement.kind !== "const") continue;
    const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
    for (const declaration of declarations) {
      if (!isWalkableNode(declaration) || !isTrustedCreateRequireCall(declaration.init)) continue;
      const localName = getIdentifierName(declaration.id);
      if (localName) trustedRequireBindingNames.add(localName);
    }
  }
  const jitiLoadReferences = extractJitiLoadReferences(sourceText);
  let hasUnknownDynamicModuleLoad = jitiLoadReferences.some(
    (jitiLoadReference) => jitiLoadReference.path === undefined,
  );
  for (const jitiLoadReference of jitiLoadReferences) {
    if (!jitiLoadReference.path) continue;
    imports.push({
      specifier: jitiLoadReference.path,
      importedNames: [createNamespaceImportBinding()],
      isTypeOnly: false,
      isDynamic: true,
      isSideEffect: false,
      line: jitiLoadReference.line,
      column: jitiLoadReference.column,
    });
  }
  const walkNode = (
    node: WalkableNode,
    bindingNames: ReadonlySet<string>,
    parentNode: WalkableNode | undefined,
    nestedBindingNames: ReadonlySet<string>,
  ): boolean | void => {
    const isGlobalRequire = !bindingNames.has("require");
    if (node.type === "TSImportType") {
      const sourceExpression = isWalkableNode(node.source) ? node.source : undefined;
      if (
        sourceExpression?.type === "Literal" &&
        typeof sourceExpression.value === "string" &&
        sourceExpression.value
      ) {
        imports.push({
          specifier: sourceExpression.value,
          importedNames: [createTypeImportBinding(node.qualifier)],
          isTypeOnly: true,
          isDynamic: false,
          isSideEffect: false,
          line: getLineFromOffset(sourceText, node.start),
          column: getColumnFromOffset(sourceText, node.start),
        });
      }
      return;
    }

    if (node.type === "ImportExpression") {
      const sourceExpression = isWalkableNode(node.source) ? node.source : undefined;
      if (!sourceExpression) {
        hasUnknownDynamicModuleLoad = true;
        return;
      }
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
          } else {
            hasUnknownDynamicModuleLoad = true;
          }
        } else {
          hasUnknownDynamicModuleLoad = true;
        }
      } else {
        hasUnknownDynamicModuleLoad = true;
      }
      return;
    }

    if (node.type === "CallExpression") {
      const callee = isWalkableNode(node.callee) ? node.callee : undefined;
      const directCalleeName = getIdentifierName(callee);
      const memberCalleeName =
        callee?.type === "MemberExpression" && !callee.computed
          ? getIdentifierName(callee.property)
          : undefined;
      if (
        directCalleeName === "readdir" ||
        directCalleeName === "readdirSync" ||
        memberCalleeName === "readdir" ||
        memberCalleeName === "readdirSync"
      ) {
        hasUnknownDynamicModuleLoad = true;
      }
      const isTrustedDirectRequire =
        (directCalleeName === "require" && (isGlobalRequire || bindingNames.size === 0)) ||
        (directCalleeName !== undefined &&
          trustedRequireBindingNames.has(directCalleeName) &&
          !nestedBindingNames.has(directCalleeName));
      if (isTrustedDirectRequire) {
        const requireSpecifier = extractStringLiteralFromArgument(node.arguments);
        if (requireSpecifier) {
          const parentMemberExpression =
            parentNode?.type === "MemberExpression" && parentNode.object === node
              ? parentNode
              : undefined;
          const importedMemberName = parentMemberExpression
            ? parentMemberExpression.computed
              ? isWalkableNode(parentMemberExpression.property) &&
                parentMemberExpression.property.type === "Literal" &&
                typeof parentMemberExpression.property.value === "string"
                ? parentMemberExpression.property.value
                : undefined
              : getIdentifierName(parentMemberExpression.property)
            : undefined;
          imports.push({
            specifier: requireSpecifier,
            importedNames: importedMemberName
              ? [
                  {
                    name: importedMemberName,
                    alias: undefined,
                    isNamespace: false,
                    isDefault: importedMemberName === "default",
                    isTypeOnly: false,
                  },
                ]
              : [createNamespaceImportBinding()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, node.start),
            column: getColumnFromOffset(sourceText, node.start),
          });
        } else {
          hasUnknownDynamicModuleLoad = true;
        }
      }

      if (callee?.type === "MemberExpression" && !callee.computed) {
        const objectName = getIdentifierName(callee.object);
        const propertyName = getIdentifierName(callee.property);
        const isTrustedRequireObject =
          (objectName === "require" && isGlobalRequire) ||
          (objectName !== undefined &&
            trustedRequireBindingNames.has(objectName) &&
            !nestedBindingNames.has(objectName));

        if (objectName === "require" && propertyName === "context" && isGlobalRequire) {
          const contextMetadata = extractRequireContextMetadata(node.arguments);
          if (contextMetadata) {
            imports.push({
              ...contextMetadata,
              importedNames: [createNamespaceImportBinding()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, node.start),
              column: getColumnFromOffset(sourceText, node.start),
            });
          } else {
            hasUnknownDynamicModuleLoad = true;
          }
        }

        if (propertyName === "resolve" && isTrustedRequireObject) {
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
          } else {
            hasUnknownDynamicModuleLoad = true;
          }
        }

        const isUnshadowedTestApi =
          objectName !== undefined &&
          (trustedTestApiBindingNames.has(objectName)
            ? !nestedBindingNames.has(objectName)
            : (objectName === "vi" || objectName === "jest") && !bindingNames.has(objectName));
        if (isUnshadowedTestApi && propertyName === "mock") {
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
        if (isImportMeta(callee.object) && propertyName === "glob") {
          const globPatterns = extractGlobPatterns(node.arguments);
          if (globPatterns.length === 0) hasUnknownDynamicModuleLoad = true;
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
      }
    }

    if (node.type === "NewExpression") {
      const calleeName = getIdentifierName(node.callee);
      if (calleeName === "URL" && Array.isArray(node.arguments) && node.arguments.length >= 2) {
        const secondArgument = isWalkableNode(node.arguments[1]) ? node.arguments[1] : undefined;
        const isImportMetaUrl =
          secondArgument?.type === "MemberExpression" &&
          isImportMeta(secondArgument.object) &&
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
          } else {
            hasUnknownDynamicModuleLoad = true;
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

    return true;
  };

  visitOxcAstWithBindings(bodyNodes, (node, bindingNames, parentNode, nestedBindingNames) => {
    if (!isWalkableNode(node)) return;
    return walkNode(
      node,
      bindingNames,
      parentNode && isOxcAstNode(parentNode) && isWalkableNode(parentNode) ? parentNode : undefined,
      nestedBindingNames,
    );
  });
  return hasUnknownDynamicModuleLoad;
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
