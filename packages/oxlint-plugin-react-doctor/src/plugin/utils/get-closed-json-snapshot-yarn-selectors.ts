export const getClosedJsonSnapshotYarnSelectors = (header: string): readonly string[] | null => {
  if (!/^(?:"(?:[^"\\]|\\.)*"|[^,\s":]+)(?:,\s*(?:"(?:[^"\\]|\\.)*"|[^,\s":]+))*$/.test(header))
    return null;
  const tokens = header.match(/"(?:[^"\\]|\\.)*"|[^,]+/g);
  if (!tokens) return null;
  const selectors: string[] = [];
  for (const token of tokens) {
    try {
      const trimmed = token.trim();
      const value: unknown = trimmed.startsWith('"') ? JSON.parse(trimmed) : trimmed;
      if (typeof value !== "string") return null;
      selectors.push(value);
    } catch {
      return null;
    }
  }
  return selectors;
};
