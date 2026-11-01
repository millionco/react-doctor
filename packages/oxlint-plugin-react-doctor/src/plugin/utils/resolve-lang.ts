import * as path from "node:path";

const FILENAME_TO_LANG: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".mts": "ts",
  ".cts": "ts",
};

export const resolveLang = (filename: string): "ts" | "tsx" | "js" | "jsx" => {
  const extension = path.extname(filename).toLowerCase();
  return FILENAME_TO_LANG[extension] ?? "tsx";
};
