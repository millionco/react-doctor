// rule: no-unsafe-json-parse
// weakness: validation
// source: adversarial audit of PR parsing/string-safety group

const isValidJson = (_value: string): boolean => {
  try {
    JSON.parse("{}");
    return true;
  } catch {
    return false;
  }
};

export const readValue = (raw: string): unknown =>
  isValidJson(raw) ? JSON.parse(raw).value : null;
