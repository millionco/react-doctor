export interface ParsedFileLineArgument {
  filePath: string;
  line: number;
}

export const parseFileLineArgument = (rawArgument: string): ParsedFileLineArgument => {
  const lastColonIndex = rawArgument.lastIndexOf(":");
  if (lastColonIndex < 0) {
    throw new Error(`Expected "<file>:<line>" (e.g. "src/foo.tsx:42"), got "${rawArgument}".`);
  }
  const filePath = rawArgument.slice(0, lastColonIndex);
  const lineText = rawArgument.slice(lastColonIndex + 1);
  if (filePath.length === 0) {
    throw new Error(`Missing file path in "${rawArgument}".`);
  }
  const line = Number.parseInt(lineText, 10);
  if (!Number.isFinite(line) || line <= 0 || String(line) !== lineText.trim()) {
    throw new Error(`Expected a positive line number in "${rawArgument}".`);
  }
  return { filePath, line };
};
