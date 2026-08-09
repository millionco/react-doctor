interface ParsedPathMappings {
  paths: Record<string, string[]> | undefined;
  invalidEntries: string[];
}

export const parsePathMappings = (rawMappings: string[] | undefined): ParsedPathMappings => {
  if (!rawMappings || rawMappings.length === 0) {
    return { paths: undefined, invalidEntries: [] };
  }

  const paths: Record<string, string[]> = {};
  const invalidEntries: string[] = [];
  for (const entry of rawMappings) {
    const separatorIndex = entry.indexOf("=");
    const pattern = separatorIndex === -1 ? "" : entry.slice(0, separatorIndex);
    const target = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1);
    if (!pattern || !target) {
      invalidEntries.push(entry);
      continue;
    }
    const existingTargets = paths[pattern];
    if (existingTargets) {
      existingTargets.push(target);
    } else {
      paths[pattern] = [target];
    }
  }

  return {
    paths: Object.keys(paths).length > 0 ? paths : undefined,
    invalidEntries,
  };
};
