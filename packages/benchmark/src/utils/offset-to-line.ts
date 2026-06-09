// Convert a 0-based byte/char offset into a 1-based line number by counting
// newlines before it. oxc reports spans as offsets only, so checks use this to
// fill `ScanFinding.line`.
export const offsetToLine = (sourceText: string, offset: number): number => {
  let line = 1;
  const limit = Math.min(offset, sourceText.length);
  for (let index = 0; index < limit; index++) {
    if (sourceText.charCodeAt(index) === 10) line++;
  }
  return line;
};
