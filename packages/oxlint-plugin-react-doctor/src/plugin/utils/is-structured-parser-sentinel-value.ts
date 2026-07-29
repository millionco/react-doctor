import { SECRET_SENTINEL_BOUNDARY_WORDS, SECRET_VARIABLE_PATTERN } from "../constants/security.js";
import { tokenizeIdentifierWords } from "./tokenize-identifier-words.js";

export const isStructuredParserSentinelValue = (
  variableName: string,
  literalValue: string,
): boolean => {
  if (!/^[A-Z]+$/.test(literalValue)) return false;
  const variableNameWords = tokenizeIdentifierWords(variableName.replace(/[_$]+/g, " "));
  const boundaryWord = variableNameWords.at(-1);
  if (!boundaryWord || !SECRET_SENTINEL_BOUNDARY_WORDS.has(boundaryWord)) return false;

  const normalizedLiteralValue = literalValue.toLowerCase();
  if (
    !normalizedLiteralValue.startsWith(boundaryWord) &&
    !normalizedLiteralValue.endsWith(boundaryWord)
  ) {
    return false;
  }

  return variableNameWords
    .slice(0, -1)
    .some((word) => !SECRET_VARIABLE_PATTERN.test(word) && normalizedLiteralValue.includes(word));
};
