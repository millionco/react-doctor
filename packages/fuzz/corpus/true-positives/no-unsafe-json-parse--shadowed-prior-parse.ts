// rule: no-unsafe-json-parse
// weakness: binding-resolution
// source: adversarial audit of PR parsing/string-safety group

export const readValue = (raw: string): unknown => {
  {
    const raw = "{}";
    JSON.parse(raw);
  }
  return JSON.parse(raw).value;
};
