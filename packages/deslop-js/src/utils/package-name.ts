export const extractPackageName = (specifier: string): string | undefined => {
  const normalizedSpecifier = specifier.startsWith("~") ? specifier.slice(1) : specifier;
  if (normalizedSpecifier.startsWith(".") || normalizedSpecifier.startsWith("/")) return undefined;
  if (specifier.startsWith("node:")) return undefined;

  if (normalizedSpecifier.startsWith("@")) {
    const parts = normalizedSpecifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }

  return normalizedSpecifier.split("/")[0];
};
