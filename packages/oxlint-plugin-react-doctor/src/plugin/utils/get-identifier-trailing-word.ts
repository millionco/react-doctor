import { tokenizeIdentifierWords } from "./tokenize-identifier-words.js";

export const getIdentifierTrailingWord = (identifierName: string): string =>
  tokenizeIdentifierWords(identifierName).at(-1) ?? identifierName.toLowerCase();
