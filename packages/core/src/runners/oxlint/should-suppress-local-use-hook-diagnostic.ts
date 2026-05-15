import fs from "node:fs";
import path from "node:path";

interface OxlintSpan {
  offset: number;
  length: number;
}

interface OxlintLabel {
  label: string;
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
const ASYNC_FUNCTION_LABEL = "This function is async.";
const USE_IDENTIFIER = "use";

const IDENTIFIER_CHARACTER_PATTERN = /[$\w]/;

const isIdentifierCharacter = (character: string | undefined): boolean =>
  character !== undefined && IDENTIFIER_CHARACTER_PATTERN.test(character);

const skipWhitespace = (sourceText: string, offset: number): number => {
  let currentOffset = offset;
  while (/\s/.test(sourceText[currentOffset] ?? "")) {
    currentOffset++;
  }
  return currentOffset;
};

const findMatchingDelimiter = (
  sourceText: string,
  openOffset: number,
  openDelimiter: string,
  closeDelimiter: string,
): number => {
  let depth = 0;
  for (let offset = openOffset; offset < sourceText.length; offset++) {
    const character = sourceText[offset];
    if (character === openDelimiter) depth++;
    if (character === closeDelimiter) {
      depth--;
      if (depth === 0) return offset;
    }
  }
  return -1;
};

const findTopLevelCharacter = (text: string, targetCharacters: ReadonlySet<string>): number => {
  const delimiterStack: string[] = [];
  const closingToOpening = new Map([
    [")", "("],
    ["}", "{"],
    ["]", "["],
  ]);

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(" || character === "{" || character === "[") {
      delimiterStack.push(character);
      continue;
    }
    const openingDelimiter = closingToOpening.get(character ?? "");
    if (openingDelimiter) {
      if (delimiterStack.at(-1) === openingDelimiter) delimiterStack.pop();
      continue;
    }
    if (delimiterStack.length === 0 && targetCharacters.has(character ?? "")) {
      return index;
    }
  }

  return -1;
};

const splitTopLevel = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let startIndex = 0;
  let depth = 0;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(" || character === "{" || character === "[") depth++;
    if (character === ")" || character === "}" || character === "]") depth--;
    if (character === separator && depth === 0) {
      parts.push(text.slice(startIndex, index));
      startIndex = index + separator.length;
    }
  }
  parts.push(text.slice(startIndex));
  return parts;
};

const getBindingPattern = (parameterText: string): string => {
  const boundaryIndex = findTopLevelCharacter(parameterText, new Set([":", "="]));
  const rawPattern = boundaryIndex === -1 ? parameterText : parameterText.slice(0, boundaryIndex);
  return rawPattern
    .trim()
    .replace(/^\.\.\./, "")
    .trim();
};

const getFirstIdentifier = (text: string): string | null => {
  const match = text.trim().match(/^[$A-Z_a-z][$\w]*/);
  return match?.[0] ?? null;
};

const bindingPatternHasUse = (patternText: string): boolean => {
  const pattern = patternText.trim();
  if (!pattern) return false;
  if (pattern.startsWith("{") && pattern.endsWith("}")) {
    return objectBindingPatternHasUse(pattern.slice(1, -1));
  }
  if (pattern.startsWith("[") && pattern.endsWith("]")) {
    return splitTopLevel(pattern.slice(1, -1), ",").some((part) =>
      bindingPatternHasUse(getBindingPattern(part)),
    );
  }
  return getFirstIdentifier(pattern) === USE_IDENTIFIER;
};

const objectBindingPatternHasUse = (patternText: string): boolean =>
  splitTopLevel(patternText, ",").some((propertyText) => {
    const property = propertyText
      .trim()
      .replace(/^\.\.\./, "")
      .trim();
    if (!property) return false;
    const colonIndex = findTopLevelCharacter(property, new Set([":"]));
    if (colonIndex === -1) {
      return getFirstIdentifier(getBindingPattern(property)) === USE_IDENTIFIER;
    }
    return bindingPatternHasUse(getBindingPattern(property.slice(colonIndex + 1)));
  });

const parametersHaveUseBinding = (parametersText: string): boolean =>
  splitTopLevel(parametersText, ",").some((parameterText) =>
    bindingPatternHasUse(getBindingPattern(parameterText)),
  );

const getAsyncFunctionParametersText = (
  sourceText: string,
  asyncOffset: number,
  useCallOffset: number,
): string | null => {
  let offset = skipWhitespace(sourceText, asyncOffset + "async".length);
  if (sourceText.startsWith("function", offset)) {
    offset += "function".length;
    const openParenOffset = sourceText.indexOf("(", offset);
    if (openParenOffset === -1 || openParenOffset > useCallOffset) return null;
    const closeParenOffset = findMatchingDelimiter(sourceText, openParenOffset, "(", ")");
    if (closeParenOffset === -1 || closeParenOffset > useCallOffset) return null;
    return sourceText.slice(openParenOffset + 1, closeParenOffset);
  }

  offset = skipWhitespace(sourceText, offset);
  if (sourceText[offset] === "(") {
    const closeParenOffset = findMatchingDelimiter(sourceText, offset, "(", ")");
    if (closeParenOffset === -1 || closeParenOffset > useCallOffset) return null;
    return sourceText.slice(offset + 1, closeParenOffset);
  }

  const parameterStartOffset = offset;
  while (isIdentifierCharacter(sourceText[offset])) offset++;
  return sourceText.slice(parameterStartOffset, offset);
};

export const shouldSuppressLocalUseHookDiagnostic = (
  diagnostic: OxlintDiagnosticCandidate,
  rootDirectory: string,
): boolean => {
  if (diagnostic.code !== RULES_OF_HOOKS_CODE) return false;
  if (!diagnostic.message.startsWith(REACT_HOOK_USE_MESSAGE_PREFIX)) return false;
  const primaryLabel = diagnostic.labels[0];
  if (!primaryLabel) return false;
  const asyncLabel = diagnostic.labels.find((label) => label.label === ASYNC_FUNCTION_LABEL);
  if (!asyncLabel) return false;

  const absolutePath = path.isAbsolute(diagnostic.filename)
    ? diagnostic.filename
    : path.join(rootDirectory, diagnostic.filename);

  let sourceText: string;
  try {
    sourceText = fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return false;
  }

  if (
    sourceText.slice(primaryLabel.span.offset, primaryLabel.span.offset + USE_IDENTIFIER.length) !==
    USE_IDENTIFIER
  ) {
    return false;
  }
  if (sourceText[primaryLabel.span.offset - 1] === ".") return false;
  const nextOffset = skipWhitespace(sourceText, primaryLabel.span.offset + USE_IDENTIFIER.length);
  if (sourceText[nextOffset] !== "(") return false;

  const parametersText = getAsyncFunctionParametersText(
    sourceText,
    asyncLabel.span.offset,
    primaryLabel.span.offset,
  );
  return parametersText !== null && parametersHaveUseBinding(parametersText);
};
