const LETTER_OR_DECIMAL_DIGIT_PATTERN = /[\p{L}\p{Nd}]/u;

export const hasLetterOrDecimalDigit = (value: string): boolean =>
  LETTER_OR_DECIMAL_DIGIT_PATTERN.test(value);
