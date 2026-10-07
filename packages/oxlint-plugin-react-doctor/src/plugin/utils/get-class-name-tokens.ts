import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

export const getClassNameTokens = (classNameValue: string): string[] =>
  splitTailwindClassName(classNameValue).map((token) => parseTailwindClassNameToken(token).utility);
