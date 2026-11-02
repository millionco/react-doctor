export const JSON_PARSE_LOCAL_RESULT_MESSAGE =
  "Reading a property from an unchecked local `JSON.parse(...)` result combines a throwing parse with an unvalidated value. Wrap the parse in try/catch and validate its shape before accessing fields.";

export const JSON_PARSE_LOCAL_RESULT_RUNTIME_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const JSON_PARSE_LOCAL_RESULT_PROVIDER_NAMES = new Set([
  "JSON",
  "globalThis",
  "window",
  "self",
  "global",
  "document",
  "eval",
]);

export const JSON_PARSE_LOCAL_RESULT_CARRIER_PROPERTIES = new Set([
  "eval",
  "JSON",
  "globalThis",
  "window",
  "self",
  "global",
  "document",
  "constructor",
  "prototype",
]);
