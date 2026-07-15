export const hasUseServerDirectiveInContent = (content: string): boolean => {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === "") continue;
    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*")) continue;
    if (trimmedLine === '"use server";' || trimmedLine === "'use server';") {
      return true;
    }
    return false;
  }
  return false;
};
