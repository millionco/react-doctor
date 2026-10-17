export const NODE_FILE_URL_ARGUMENT_COUNT = 1;
export const NODE_FILE_URL_ERASED_TYPES: ReadonlySet<string> = new Set([
  "TSTypeAnnotation",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
]);
export const NODE_FILE_URL_RUNTIME_TYPES: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
