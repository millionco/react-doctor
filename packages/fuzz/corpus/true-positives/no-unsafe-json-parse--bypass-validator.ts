// rule: no-unsafe-json-parse
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

const validJson = (value: string, enabled: boolean): boolean => {
  try {
    if (enabled) return true;
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

export const readValue = (raw: string, enabled: boolean): unknown =>
  validJson(raw, enabled) ? JSON.parse(raw).value : null;
