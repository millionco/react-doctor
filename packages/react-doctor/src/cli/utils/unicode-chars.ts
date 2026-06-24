import isUnicodeSupported from "is-unicode-supported";

const unicodeSupported = isUnicodeSupported();

export const MULTIPLY_SIGN = unicodeSupported ? "×" : "x";
export const EM_DASH = unicodeSupported ? "—" : "-";
export const POINTER = unicodeSupported ? "›" : ">";
