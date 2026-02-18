const REGEX_SPECIAL_CHARACTERS = /[.+^${}()|[\]\\]/g;

export const compileGlobPattern = (pattern: string): RegExp => {
  const normalizedPattern = pattern.replace(/\\/g, "/");

  let regexSource = "^";
  let characterIndex = 0;

  while (characterIndex < normalizedPattern.length) {
    if (
      normalizedPattern[characterIndex] === "*" &&
      normalizedPattern[characterIndex + 1] === "*"
    ) {
      if (normalizedPattern[characterIndex + 2] === "/") {
        regexSource += "(?:.+/)?";
        characterIndex += 3;
      } else {
        regexSource += ".*";
        characterIndex += 2;
      }
    } else if (normalizedPattern[characterIndex] === "*") {
      regexSource += "[^/]*";
      characterIndex++;
    } else if (normalizedPattern[characterIndex] === "?") {
      regexSource += "[^/]";
      characterIndex++;
    } else {
      regexSource += normalizedPattern[characterIndex].replace(REGEX_SPECIAL_CHARACTERS, "\\$&");
      characterIndex++;
    }
  }

  regexSource += "$";
  return new RegExp(regexSource);
};

export const matchGlobPattern = (filePath: string, pattern: string): boolean => {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return compileGlobPattern(pattern).test(normalizedPath);
};
