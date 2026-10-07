import { TUI_PRINTABLE_ASCII_MIN_CODE_POINT } from "./constants.js";

export const isPrintableInput = (input: string): boolean =>
  input.length > 0 &&
  [...input].every((character) => character.charCodeAt(0) >= TUI_PRINTABLE_ASCII_MIN_CODE_POINT);
