export const KNIP_DATA_CONFIG_FILENAMES: ReadonlySet<string> = new Set([
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
]);

export const KNIP_CONFIG_FILENAMES: ReadonlyArray<string> = [
  ...KNIP_DATA_CONFIG_FILENAMES,
  "knip.ts",
  "knip.js",
  "knip.config.ts",
  "knip.config.js",
];
