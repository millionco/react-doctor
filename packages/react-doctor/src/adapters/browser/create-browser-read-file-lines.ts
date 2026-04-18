const normalizeKey = (rootDirectory: string, filePath: string): string => {
  const normalizedRoot = rootDirectory.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.startsWith(normalizedRoot + "/")) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath.replace(/^\.\//, "");
};

export const createBrowserReadFileLinesSync = (
  rootDirectory: string,
  projectFiles: Record<string, string>,
): ((absoluteOrRelativePath: string) => string[] | null) => {
  return (absoluteOrRelativePath: string): string[] | null => {
    const key = normalizeKey(rootDirectory, absoluteOrRelativePath);
    const content = projectFiles[key];
    if (content === undefined) return null;
    return content.split("\n");
  };
};
