// rule: no-unsafe-json-parse
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

export const readValues = (values: string[]): unknown[] => {
  try {
    return Array.from(values, (value) => JSON.parse(value).data);
  } catch {
    return [];
  }
};
