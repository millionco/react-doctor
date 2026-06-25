import { HttpCode } from "./code.js";

export const codeToName = (numericCode: number): string => HttpCode[numericCode];

console.log(codeToName(0), codeToName(2));
