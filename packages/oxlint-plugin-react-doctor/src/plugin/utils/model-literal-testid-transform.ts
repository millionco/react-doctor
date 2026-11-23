const TEST_ID_PATTERNS = [
  /\s+data-testid\s*=\s*["'][^"']*["']/g,
  /\s+data-testid\s*=\s*\{[^{}]+\}/g,
  /\s+data-testid\s*=\s*\{`[^`]*`\}/g,
];

export const modelLiteralTestIdTransform = (source: string, filename: string): string => {
  if (
    !source.includes("data-testid") ||
    filename.includes("node_modules") ||
    !/src.*\.(tsx|jsx)$/u.test(filename)
  )
    return source;
  const transformed = TEST_ID_PATTERNS.reduce((code, pattern) => code.replace(pattern, ""), source);
  return (transformed.match(/\{/g)?.length ?? 0) === (transformed.match(/\}/g)?.length ?? 0)
    ? transformed
    : source;
};
