export const maskJavaScriptStringsAndComments = (content: string): string => {
  const maskedCharacters = content.split("");
  let quote: string | undefined;
  let isEscaped = false;
  let isLineComment = false;
  let isBlockComment = false;

  for (let position = 0; position < content.length; position++) {
    const character = content[position];
    const nextCharacter = content[position + 1];
    if (isLineComment) {
      if (character === "\n") {
        isLineComment = false;
      } else {
        maskedCharacters[position] = " ";
      }
      continue;
    }
    if (isBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        maskedCharacters[position] = " ";
        maskedCharacters[position + 1] = " ";
        isBlockComment = false;
        position++;
      } else if (character !== "\n") {
        maskedCharacters[position] = " ";
      }
      continue;
    }
    if (quote) {
      if (character !== "\n") maskedCharacters[position] = " ";
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      maskedCharacters[position] = " ";
      maskedCharacters[position + 1] = " ";
      isLineComment = true;
      position++;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      maskedCharacters[position] = " ";
      maskedCharacters[position + 1] = " ";
      isBlockComment = true;
      position++;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      maskedCharacters[position] = " ";
      quote = character;
    }
  }

  return maskedCharacters.join("");
};
