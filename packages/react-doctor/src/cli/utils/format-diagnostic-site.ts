export const formatDiagnosticSite = (site: { filePath: string; line: number }): string =>
  site.line > 0 ? `${site.filePath}:${site.line}` : site.filePath;
