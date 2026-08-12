export const buildExportKey = (filePath: string, exportName: string): string =>
  `${filePath}::${exportName}`;
