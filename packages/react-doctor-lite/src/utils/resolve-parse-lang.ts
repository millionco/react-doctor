import * as path from "node:path";

const EXTENSION_TO_LANG: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "jsx",
  ".jsx": "jsx",
  ".mjs": "jsx",
  ".cjs": "jsx",
  ".mts": "ts",
  ".cts": "ts",
};

// Maps a filename to the oxc-parser `lang`. `.js`/`.mjs`/`.cjs` map to `jsx`
// so JSX in plain JavaScript files still parses — React projects routinely
// ship `.js` files containing JSX.
export const resolveParseLang = (filename: string): "ts" | "tsx" | "js" | "jsx" =>
  EXTENSION_TO_LANG[path.extname(filename).toLowerCase()] ?? "tsx";
