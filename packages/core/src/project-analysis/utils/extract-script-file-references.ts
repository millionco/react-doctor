const SCRIPT_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]s)$/;

export const extractScriptFileReferences = (command: string): string[] => {
  const references = new Set<string>();
  let currentToken = "";
  let quote = "";

  const collectCurrentToken = (): void => {
    const mappingSeparatorIndex = currentToken.indexOf(":");
    const mappingPrefix = currentToken.slice(0, mappingSeparatorIndex);
    const scriptFileReference =
      mappingSeparatorIndex > 0 && /^[\w-]+$/.test(mappingPrefix)
        ? currentToken.slice(mappingSeparatorIndex + 1)
        : currentToken;
    if (
      !currentToken.startsWith("-") &&
      !currentToken.includes("=") &&
      SCRIPT_FILE_EXTENSION_PATTERN.test(scriptFileReference)
    ) {
      references.add(scriptFileReference);
    }
    currentToken = "";
  };

  for (let characterIndex = 0; characterIndex < command.length; characterIndex++) {
    const character = command[characterIndex];
    if (quote) {
      if (character === quote) {
        quote = "";
      } else if (character === "\\" && quote !== "'" && characterIndex + 1 < command.length) {
        characterIndex++;
        currentToken += command[characterIndex];
      } else {
        currentToken += character;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (/\s/.test(character) || character === ";" || character === "|" || character === "&") {
      collectCurrentToken();
      continue;
    }
    if (character === "\\" && characterIndex + 1 < command.length) {
      characterIndex++;
      currentToken += command[characterIndex];
      continue;
    }
    currentToken += character;
  }

  collectCurrentToken();
  return [...references];
};
