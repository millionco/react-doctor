export const toRelativePath = (filePath: string, rootDirectory: string): string => {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedRoot = rootDirectory.replace(/\\/g, "/").replace(/\/$/, "") + "/";

  if (normalizedFilePath.startsWith(normalizedRoot)) {
    return normalizedFilePath.slice(normalizedRoot.length);
  }

  return normalizedFilePath.replace(/^\.\//, "");
};
