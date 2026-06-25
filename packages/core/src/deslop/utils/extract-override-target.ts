export const extractOverrideTargetPackage = (overrideValue: string): string | undefined => {
  let normalizedValue = overrideValue.trim().replace(/^["']|["']$/g, "");
  if (normalizedValue.startsWith("npm:")) {
    normalizedValue = normalizedValue.slice("npm:".length);
  }

  if (normalizedValue.startsWith("@")) {
    const slashIndex = normalizedValue.indexOf("/");
    if (slashIndex === -1) return undefined;

    const scope = normalizedValue.slice(0, slashIndex);
    const remainder = normalizedValue.slice(slashIndex + 1);
    const versionSeparatorIndex = remainder.indexOf("@");
    const packageName =
      versionSeparatorIndex === -1 ? remainder : remainder.slice(0, versionSeparatorIndex);

    if (!packageName) return undefined;
    return `${scope}/${packageName}`;
  }

  const versionSeparatorIndex = normalizedValue.indexOf("@");
  const packageName =
    versionSeparatorIndex === -1
      ? normalizedValue
      : normalizedValue.slice(0, versionSeparatorIndex);

  return packageName || undefined;
};
