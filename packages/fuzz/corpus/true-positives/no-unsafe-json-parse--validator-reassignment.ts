// rule: no-unsafe-json-parse
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

declare const readPayload: () => string;

const isValidJsonArray = (value: string): boolean => {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
};

export const readFirst = (initialValue: string): unknown => {
  let value = initialValue;
  if (!isValidJsonArray(value)) return null;
  value = readPayload();
  return JSON.parse(value)[0];
};
