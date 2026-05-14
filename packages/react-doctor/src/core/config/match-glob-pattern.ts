const REGEX_SPECIAL_CHARACTERS = /[.+^${}()|[\]\\]/g;

const MAX_PATTERN_LENGTH = 500;
const MAX_WILDCARDS = 20;

export const compileGlobPattern = (pattern: string): RegExp => {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Glob pattern exceeds maximum length of ${MAX_PATTERN_LENGTH}`);
  }

  const wildcardCount = (pattern.match(/[*?]/g) || []).length;
  if (wildcardCount > MAX_WILDCARDS) {
    throw new Error(`Glob pattern exceeds maximum wildcard count of ${MAX_WILDCARDS}`);
  }
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\//, "");

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
