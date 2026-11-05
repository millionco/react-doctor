import { STATIC_VIRTUAL_GENERATED_MODULE_MAX_BYTES } from "../constants/thresholds.js";

export interface GeneratedEsmFactoryImport {
  readonly source: string;
  readonly exportedName: string;
}

const MAX_GENERATED_ESM_WRAPPERS = 16_384;
const MAX_GENERATED_ESM_IDENTIFIER_LENGTH = 256;
const MAX_GENERATED_ESM_SPECIFIER_LENGTH = 512;
const MAX_GENERATED_JSON_DEPTH = 64;
const JSON_UNICODE_ESCAPE_DIGITS = 4;
const HEX_RADIX = 16;
const HEX_LETTER_DIGIT_OFFSET = 10;
const FIRST_PRINTABLE_ASCII_CODE = 0x20;
const LAST_PRINTABLE_ASCII_CODE = 0x7e;
const PROTOTYPE_PROPERTY_NAME = "__proto__";
const RESERVED_MODULE_BINDINGS = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const isLineTerminator = (character: string | undefined): boolean =>
  character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029";

const isDecimalDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= "0" && character <= "9";

const isIdentifierStart = (character: string | undefined): boolean =>
  character !== undefined &&
  (character === "_" ||
    character === "$" ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z"));

const readHexDigit = (character: string | undefined): number => {
  if (character === undefined) return -1;
  if (character >= "0" && character <= "9") return character.charCodeAt(0) - "0".charCodeAt(0);
  if (character >= "a" && character <= "f")
    return character.charCodeAt(0) - "a".charCodeAt(0) + HEX_LETTER_DIGIT_OFFSET;
  if (character >= "A" && character <= "F")
    return character.charCodeAt(0) - "A".charCodeAt(0) + HEX_LETTER_DIGIT_OFFSET;
  return -1;
};

export const readGeneratedEsmFactoryImport = (
  sourceText: string,
): GeneratedEsmFactoryImport | null => {
  if (sourceText.length === 0 || sourceText.length > STATIC_VIRTUAL_GENERATED_MODULE_MAX_BYTES)
    return null;
  let cursor = 0;

  const take = (character: string): boolean => {
    if (sourceText[cursor] !== character) return false;
    cursor += 1;
    return true;
  };

  const skipTrivia = (disallowLineBreak = false): boolean => {
    while (cursor < sourceText.length) {
      const character = sourceText[cursor];
      if (isLineTerminator(character)) {
        if (disallowLineBreak) return false;
        cursor += 1;
      } else if (
        character === " " ||
        character === "\t" ||
        character === "\v" ||
        character === "\f" ||
        character === "\uFEFF"
      ) {
        cursor += 1;
      } else if (character === "/" && sourceText[cursor + 1] === "/") {
        cursor += 2;
        while (cursor < sourceText.length && !isLineTerminator(sourceText[cursor])) cursor += 1;
      } else if (character === "/" && sourceText[cursor + 1] === "*") {
        cursor += 2;
        while (
          cursor < sourceText.length &&
          !(sourceText[cursor] === "*" && sourceText[cursor + 1] === "/")
        ) {
          if (disallowLineBreak && isLineTerminator(sourceText[cursor])) return false;
          cursor += 1;
        }
        if (cursor >= sourceText.length) return false;
        cursor += 2;
      } else {
        break;
      }
    }
    return true;
  };

  const takeToken = (character: string): boolean => skipTrivia() && take(character);

  const readIdentifier = (): string | null => {
    if (!skipTrivia() || !isIdentifierStart(sourceText[cursor])) return null;
    const start = cursor;
    cursor += 1;
    while (isIdentifierStart(sourceText[cursor]) || isDecimalDigit(sourceText[cursor])) {
      if (cursor - start >= MAX_GENERATED_ESM_IDENTIFIER_LENGTH) return null;
      cursor += 1;
    }
    return sourceText.slice(start, cursor);
  };

  const readModuleSpecifier = (): string | null => {
    if (!skipTrivia()) return null;
    const quote = sourceText[cursor];
    if (quote !== '"' && quote !== "'") return null;
    cursor += 1;
    const start = cursor;
    while (cursor < sourceText.length) {
      if (sourceText[cursor] === quote) {
        if (cursor === start) return null;
        const source = sourceText.slice(start, cursor);
        cursor += 1;
        return source;
      }
      const character = sourceText.charCodeAt(cursor);
      if (
        character < FIRST_PRINTABLE_ASCII_CODE ||
        character > LAST_PRINTABLE_ASCII_CODE ||
        sourceText[cursor] === "\\" ||
        cursor - start >= MAX_GENERATED_ESM_SPECIFIER_LENGTH
      )
        return null;
      cursor += 1;
    }
    return null;
  };

  const skipJsonWhitespace = (): void => {
    while (true) {
      const character = sourceText[cursor];
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r")
        return;
      cursor += 1;
    }
  };

  const readJsonString = (isProperty = false): boolean => {
    if (!take('"')) return false;
    let isPrototypeProperty = isProperty;
    let propertyOffset = 0;
    while (cursor < sourceText.length) {
      let character = sourceText.charCodeAt(cursor);
      const current = sourceText[cursor];
      cursor += 1;
      if (current === '"')
        return !isPrototypeProperty || propertyOffset !== PROTOTYPE_PROPERTY_NAME.length;
      if (character < FIRST_PRINTABLE_ASCII_CODE) return false;
      if (current === "\\") {
        const escape = sourceText[cursor];
        cursor += 1;
        if (escape === "u") {
          character = 0;
          for (let digitIndex = 0; digitIndex < JSON_UNICODE_ESCAPE_DIGITS; digitIndex += 1) {
            const digit = readHexDigit(sourceText[cursor]);
            if (digit < 0) return false;
            character = character * HEX_RADIX + digit;
            cursor += 1;
          }
        } else if (
          escape === '"' ||
          escape === "\\" ||
          escape === "/" ||
          escape === "b" ||
          escape === "f" ||
          escape === "n" ||
          escape === "r" ||
          escape === "t"
        ) {
          isPrototypeProperty = false;
        } else {
          return false;
        }
      }
      if (isPrototypeProperty) {
        isPrototypeProperty = character === PROTOTYPE_PROPERTY_NAME.charCodeAt(propertyOffset);
        propertyOffset += 1;
      }
    }
    return false;
  };

  const readDigits = (): boolean => {
    const start = cursor;
    while (isDecimalDigit(sourceText[cursor])) cursor += 1;
    return cursor !== start;
  };

  const readJsonNumber = (): boolean => {
    take("-");
    if (!take("0") && !readDigits()) return false;
    if (take(".") && !readDigits()) return false;
    if (take("e") || take("E")) {
      if (!take("+")) take("-");
      return readDigits();
    }
    return true;
  };

  const readJsonValue = (depth: number): boolean => {
    if (depth > MAX_GENERATED_JSON_DEPTH) return false;
    skipJsonWhitespace();
    const character = sourceText[cursor];
    if (character === '"') return readJsonString();
    if (character === "-" || isDecimalDigit(character)) return readJsonNumber();
    if (character === "t" || character === "f" || character === "n") {
      const literal = character === "t" ? "true" : character === "f" ? "false" : "null";
      if (!sourceText.startsWith(literal, cursor)) return false;
      cursor += literal.length;
      return true;
    }
    if (character !== "{" && character !== "[") return false;
    const close = character === "{" ? "}" : "]";
    cursor += 1;
    skipJsonWhitespace();
    if (take(close)) return true;
    while (true) {
      if (character === "{") {
        if (!readJsonString(true)) return false;
        skipJsonWhitespace();
        if (!take(":")) return false;
      }
      if (!readJsonValue(depth + 1)) return false;
      skipJsonWhitespace();
      if (take(close)) return true;
      if (!take(",")) return false;
      skipJsonWhitespace();
    }
  };

  if (readIdentifier() !== "import" || !takeToken("{")) return null;
  const exportedName = readIdentifier();
  if (!exportedName || !skipTrivia()) return null;
  let importedBinding = exportedName;
  if (!take("}")) {
    if (readIdentifier() !== "as") return null;
    const alias = readIdentifier();
    if (!alias || !takeToken("}")) return null;
    importedBinding = alias;
  }
  if (RESERVED_MODULE_BINDINGS.has(importedBinding) || readIdentifier() !== "from") return null;
  const source = readModuleSpecifier();
  if (!source) return null;
  const afterSpecifier = cursor;
  if (skipTrivia(true)) {
    if (!take(";")) return null;
  } else {
    cursor = afterSpecifier;
    if (!skipTrivia()) return null;
  }

  const wrapperNames = new Set<string>();
  while (skipTrivia()) {
    if (cursor === sourceText.length) {
      return wrapperNames.size > 0 ? { source, exportedName } : null;
    }
    if (take(";")) continue;
    if (
      wrapperNames.size >= MAX_GENERATED_ESM_WRAPPERS ||
      readIdentifier() !== "export" ||
      readIdentifier() !== "function"
    )
      return null;
    const name = readIdentifier();
    if (
      !name ||
      name === "then" ||
      name === importedBinding ||
      RESERVED_MODULE_BINDINGS.has(name) ||
      wrapperNames.has(name) ||
      !takeToken("(")
    )
      return null;
    const parameter = readIdentifier();
    if (
      !parameter ||
      parameter === importedBinding ||
      RESERVED_MODULE_BINDINGS.has(parameter) ||
      !takeToken(")") ||
      !takeToken("{") ||
      readIdentifier() !== "return" ||
      !skipTrivia(true) ||
      readIdentifier() !== importedBinding ||
      !takeToken("(") ||
      !skipTrivia() ||
      sourceText[cursor] !== "{" ||
      !readJsonValue(0) ||
      !takeToken(")") ||
      !takeToken("(") ||
      readIdentifier() !== parameter ||
      !takeToken(")") ||
      !skipTrivia()
    )
      return null;
    take(";");
    if (!takeToken("}")) return null;
    wrapperNames.add(name);
  }
  return null;
};
