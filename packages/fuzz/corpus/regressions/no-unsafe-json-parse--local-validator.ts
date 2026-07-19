// rule: no-unsafe-json-parse
// weakness: control-flow
// source: local RDE validation (PostHog breakdown labels)
const isValidJsonArray = (value: string): boolean => {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
};

export const firstValue = (value: string): unknown => {
  if (!isValidJsonArray(value)) return null;
  const normalizedValue = value.replace(/\bnan\b/g, "null");
  return JSON.parse(normalizedValue)[0];
};
