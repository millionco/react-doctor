// Split a PascalCase / camelCase identifier into its word segments so a text
// keyword can be matched on a whole word instead of a substring: "DataTable"
// -> ["Data", "Table"] (so the "Tab" keyword can't shadow "Table"),
// "PrimaryButton" -> ["Primary", "Button"], "XMLLabel" -> ["XML", "Label"].
export const splitIdentifierWords = (identifier: string): string[] =>
  identifier.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[A-Z]/g) ?? [];
