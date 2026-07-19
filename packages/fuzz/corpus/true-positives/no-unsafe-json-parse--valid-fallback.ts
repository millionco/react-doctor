// rule: no-unsafe-json-parse
// weakness: fallback
// source: adversarial audit of PR parsing/string-safety group

export const readValue = (raw: string | null): unknown => JSON.parse(raw ?? "{}").value;
