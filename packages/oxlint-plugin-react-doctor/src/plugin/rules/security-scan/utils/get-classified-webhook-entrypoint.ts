import { CROSS_FILE_PARSE_MAX_BYTES } from "../../../constants/thresholds.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScannedFile } from "../../../utils/file-scan.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getScannableContent } from "./scan-by-pattern.js";
import {
  WEBHOOK_FIRST_ITEM_INDEX,
  WEBHOOK_REGION_STEP_COUNT,
  WEBHOOK_MARKER_CHAR_COUNT,
  WEBHOOK_TEMPLATE_EXPRESSION_MARKER_CHAR_COUNT,
  WEBHOOK_NON_ASCII_PATTERN,
  WEBHOOK_LITERAL_WHITESPACE_PATTERN,
  WEBHOOK_IDENTIFIER_NAME_PATTERN,
  WEBHOOK_FUNCTION_NAME_PATTERN,
  WEBHOOK_VARIABLE_NAME_PATTERN,
  WEBHOOK_SYNC_EXPORT_PATTERN,
  WEBHOOK_ASYNC_EXPORT_PATTERN,
  WEBHOOK_CONST_EXPORT_PATTERN,
} from "./webhook-entrypoint/constants.js";

interface EntrypointRegion {
  readonly start: number;
  readonly end: number;
  readonly isRetained: boolean;
}

export interface ClassifiedWebhookEntrypoint {
  readonly index: number | null;
}

const hasValidSourceSpan = (node: EsTreeNode, source: string): boolean => {
  const start = getNodeStartIndex(node);
  const end = getNodeEndIndex(node);
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= WEBHOOK_FIRST_ITEM_INDEX &&
    end >= start &&
    end <= source.length
  );
};

const isDirectExportMatch = (
  node: EsTreeNode,
  match: RegExpMatchArray,
  source: string,
): boolean => {
  const matchStart = match.index;
  if (
    typeof matchStart !== "number" ||
    !isNodeOfType(node, "ExportNamedDeclaration") ||
    !node.declaration ||
    matchStart !== getNodeStartIndex(node) ||
    !source.startsWith("export", matchStart)
  )
    return false;
  const declaration = node.declaration;
  if (isNodeOfType(declaration, "FunctionDeclaration")) {
    return Boolean(
      declaration.id &&
      isNodeOfType(declaration.id, "Identifier") &&
      WEBHOOK_FUNCTION_NAME_PATTERN.test(declaration.id.name) &&
      !declaration.generator &&
      (declaration.async ? WEBHOOK_ASYNC_EXPORT_PATTERN : WEBHOOK_SYNC_EXPORT_PATTERN).test(
        match[WEBHOOK_FIRST_ITEM_INDEX],
      ) &&
      getNodeEndIndex(declaration.id) === matchStart + match[WEBHOOK_FIRST_ITEM_INDEX].length &&
      source.slice(getNodeStartIndex(declaration.id), getNodeEndIndex(declaration.id)) ===
        declaration.id.name,
    );
  }
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !WEBHOOK_CONST_EXPORT_PATTERN.test(match[WEBHOOK_FIRST_ITEM_INDEX])
  )
    return false;
  const firstDeclarator = declaration.declarations[WEBHOOK_FIRST_ITEM_INDEX];
  return Boolean(
    firstDeclarator &&
    isNodeOfType(firstDeclarator, "VariableDeclarator") &&
    isNodeOfType(firstDeclarator.id, "Identifier") &&
    WEBHOOK_VARIABLE_NAME_PATTERN.test(firstDeclarator.id.name) &&
    getNodeEndIndex(firstDeclarator.id) === matchStart + match[WEBHOOK_FIRST_ITEM_INDEX].length &&
    source.slice(getNodeStartIndex(firstDeclarator.id), getNodeEndIndex(firstDeclarator.id)) ===
      firstDeclarator.id.name,
  );
};

export const getClassifiedWebhookEntrypoint = (
  file: ScannedFile,
  entrypointPattern: RegExp,
  readProgram: () => EsTreeNode | null,
): ClassifiedWebhookEntrypoint | null => {
  if (
    file.content.length > CROSS_FILE_PARSE_MAX_BYTES ||
    WEBHOOK_NON_ASCII_PATTERN.test(file.content)
  )
    return null;
  try {
    const program = readProgram();
    if (!program) return null;
    const content = getScannableContent(file);
    if (content.length !== file.content.length) return null;
    const pattern = new RegExp(
      entrypointPattern.source,
      entrypointPattern.flags.includes("g")
        ? entrypointPattern.flags
        : `${entrypointPattern.flags}g`,
    );
    const matches = [...content.matchAll(pattern)];
    if (matches.length === WEBHOOK_FIRST_ITEM_INDEX) return null;
    const matchesByStart = new Map<number, RegExpMatchArray>();
    for (const match of matches) {
      if (typeof match.index !== "number" || !Number.isInteger(match.index)) return null;
      matchesByStart.set(match.index, match);
    }
    const regions: EntrypointRegion[] = [];
    let hasConsistentSpans = true;
    walkAst(program, (node) => {
      if (!hasConsistentSpans) return false;
      if (!hasValidSourceSpan(node, file.content)) {
        hasConsistentSpans = false;
        return false;
      }
      const start = getNodeStartIndex(node);
      const end = getNodeEndIndex(node);
      if (
        isNodeOfType(node, "Identifier") &&
        WEBHOOK_IDENTIFIER_NAME_PATTERN.test(node.name) &&
        file.content.slice(start, end) === node.name
      ) {
        regions.push({ start, end, isRetained: true });
      } else if (isNodeOfType(node, "ExportNamedDeclaration")) {
        const match = matchesByStart.get(start);
        if (match && isDirectExportMatch(node, match, file.content))
          regions.push({
            start,
            end: start + match[WEBHOOK_FIRST_ITEM_INDEX].length,
            isRetained: true,
          });
      } else if (isNodeOfType(node, "Literal")) {
        const rawSource = file.content.slice(start, end);
        if ("regex" in node && node.regex) {
          if (rawSource !== `/${node.regex.pattern}/${node.regex.flags}`) {
            hasConsistentSpans = false;
            return false;
          }
          regions.push({
            start: start + WEBHOOK_MARKER_CHAR_COUNT,
            end: end - node.regex.flags.length - WEBHOOK_MARKER_CHAR_COUNT,
            isRetained: false,
          });
        } else if (typeof node.value === "string") {
          const marker = rawSource[WEBHOOK_FIRST_ITEM_INDEX];
          if ((marker !== '"' && marker !== "'") || !rawSource.endsWith(marker)) {
            hasConsistentSpans = false;
            return false;
          }
          const interior = rawSource.slice(WEBHOOK_MARKER_CHAR_COUNT, -WEBHOOK_MARKER_CHAR_COUNT);
          if (interior.includes("\\")) return;
          if (interior !== node.value) {
            hasConsistentSpans = false;
            return false;
          }
          regions.push({
            start: start + WEBHOOK_MARKER_CHAR_COUNT,
            end: end - WEBHOOK_MARKER_CHAR_COUNT,
            isRetained: !WEBHOOK_LITERAL_WHITESPACE_PATTERN.test(interior),
          });
        }
      } else if (isNodeOfType(node, "TemplateElement")) {
        const rawSource = file.content.slice(start, end);
        const marker = rawSource[WEBHOOK_FIRST_ITEM_INDEX];
        const ending = node.tail ? "`" : "${";
        const endingLength = node.tail
          ? WEBHOOK_MARKER_CHAR_COUNT
          : WEBHOOK_TEMPLATE_EXPRESSION_MARKER_CHAR_COUNT;
        if (
          (marker !== "`" && marker !== "}") ||
          !rawSource.endsWith(ending) ||
          rawSource.slice(WEBHOOK_MARKER_CHAR_COUNT, -endingLength) !== node.value.raw
        ) {
          hasConsistentSpans = false;
          return false;
        }
        regions.push({
          start: start + WEBHOOK_MARKER_CHAR_COUNT,
          end: end - endingLength,
          isRetained: false,
        });
      }
    });
    if (
      !hasConsistentSpans ||
      regions.some(
        (region) =>
          region.start < WEBHOOK_FIRST_ITEM_INDEX ||
          region.end < region.start ||
          region.end > file.content.length,
      )
    )
      return null;
    regions.sort((left, right) => left.start - right.start || left.end - right.end);
    let regionIndex = WEBHOOK_FIRST_ITEM_INDEX;
    let firstRetainedIndex: number | null = null;
    for (const match of matches) {
      const index = match.index;
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        match[WEBHOOK_FIRST_ITEM_INDEX].length === WEBHOOK_FIRST_ITEM_INDEX
      )
        return null;
      while (regions[regionIndex] && regions[regionIndex].end <= index)
        regionIndex += WEBHOOK_REGION_STEP_COUNT;
      const region = regions[regionIndex];
      if (
        !region ||
        region.start > index ||
        region.end < index + match[WEBHOOK_FIRST_ITEM_INDEX].length
      )
        return null;
      if (region.isRetained && firstRetainedIndex === null) firstRetainedIndex = index;
    }
    return { index: firstRetainedIndex };
  } catch {
    return null;
  }
};
