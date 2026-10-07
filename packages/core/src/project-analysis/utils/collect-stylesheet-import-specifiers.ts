const STYLESHEET_IMPORT_DIRECTIVE_PATTERN =
  /^@(?:config|forward|import|plugin|reference|use)\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)]+))\s*\)|["']([^"']+)["'])/i;

export interface StylesheetImportSpecifier {
  readonly specifier: string;
  readonly index: number;
}

const replaceStylesheetComments = (content: string): string => {
  let result = "";
  let quote = "";
  let isBlockComment = false;
  let isLineComment = false;

  for (let characterIndex = 0; characterIndex < content.length; characterIndex++) {
    const character = content[characterIndex];
    const nextCharacter = content[characterIndex + 1];

    if (isBlockComment) {
      result += character === "\n" ? "\n" : " ";
      if (character === "*" && nextCharacter === "/") {
        result += " ";
        isBlockComment = false;
        characterIndex++;
      }
      continue;
    }
    if (isLineComment) {
      result += character === "\n" ? "\n" : " ";
      if (character === "\n") isLineComment = false;
      continue;
    }
    if (quote) {
      result += character;
      if (character === "\\" && characterIndex + 1 < content.length) {
        characterIndex++;
        result += content[characterIndex];
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      result += "  ";
      isBlockComment = true;
      characterIndex++;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      result += "  ";
      isLineComment = true;
      characterIndex++;
      continue;
    }
    result += character;
  }

  return result;
};

export const collectStylesheetImportSpecifiers = (content: string): StylesheetImportSpecifier[] => {
  const importSpecifiers: StylesheetImportSpecifier[] = [];
  const uncommentedContent = replaceStylesheetComments(content);
  let quote = "";
  for (let characterIndex = 0; characterIndex < uncommentedContent.length; characterIndex++) {
    const character = uncommentedContent[characterIndex];
    if (quote) {
      if (character === "\\" && characterIndex + 1 < uncommentedContent.length) {
        characterIndex++;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== "@") continue;

    const directiveMatch = uncommentedContent
      .slice(characterIndex)
      .match(STYLESHEET_IMPORT_DIRECTIVE_PATTERN);
    if (!directiveMatch) continue;
    const rawSpecifier = directiveMatch[1] ?? directiveMatch[2] ?? directiveMatch[3];
    if (!rawSpecifier) continue;
    importSpecifiers.push({
      specifier: rawSpecifier.replace(/^pkg:/, "").replace(/[?#].*$/, ""),
      index: characterIndex,
    });
    characterIndex += directiveMatch[0].length - 1;
  }
  return importSpecifiers;
};
