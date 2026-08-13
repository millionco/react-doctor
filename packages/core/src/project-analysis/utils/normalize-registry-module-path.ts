export const normalizeRegistryModulePath = (modulePath: string): string =>
  modulePath.replace(/^\.\//, "").replace(/\.(?:[cm]?[jt]sx?)$/, "");
