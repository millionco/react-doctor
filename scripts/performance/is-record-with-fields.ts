export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isRecordWithFields = (
  value: unknown,
  fieldTypes: Record<string, "string" | "number" | "boolean">,
): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.entries(fieldTypes).every(
    ([fieldName, expectedType]) => typeof value[fieldName] === expectedType,
  );
