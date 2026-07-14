export const FAST_REFRESH_CONFIG_FILENAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "webpack.config.ts",
  "webpack.config.js",
  "webpack.config.mjs",
  "webpack.config.cjs",
  "rsbuild.config.ts",
  "rsbuild.config.js",
  "rspack.config.ts",
  "rspack.config.js",
] as const;

export const MINIMUM_FAST_REFRESH_VERSIONS = {
  dumi: { major: 2, minor: 0 },
  expo: { major: 36, minor: 0 },
  gatsby: { major: 2, minor: 31 },
  next: { major: 9, minor: 4 },
  parcel: { major: 2, minor: 0 },
  reactForGatsbyTwo: { major: 17, minor: 0 },
  reactNative: { major: 0, minor: 61 },
  reactScripts: { major: 4, minor: 0 },
  storybookReact: { major: 6, minor: 1 },
} as const;
