export const isOctanePackageSource = (source: string): boolean =>
  source === "octane" || source.startsWith("octane/") || source.startsWith("@octanejs/");
