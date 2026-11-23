import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";

const isDefinitelyAbsent = (candidate: string): boolean => {
  recordExistenceProbe(candidate);
  try {
    fs.lstatSync(candidate);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
};

/** Project-local entries only, after qualifying the stock package graph. */
export const hasUnshadowedStockGatsbyV1Entries = (
  root: string,
  plugins: ReadonlyArray<string>,
): boolean => {
  if (!path.isAbsolute(root) || !plugins.every((name) => /^[a-z][a-z0-9-]+$/u.test(name)))
    return false;
  const implicitEntries = [
    "src/html",
    "src/html.js",
    "src/html.jsx",
    "src/html.json",
    ".babelrc",
    ".babelrc.js",
    ".babelrc.json",
    ".babelignore",
    "babel.config.js",
    "babel.config.cjs",
    "webpack.config.js",
    "postcss.config.js",
    ".postcssrc",
    ".postcssrc.js",
    ".postcssrc.json",
    "tsconfig.json",
    "jsconfig.json",
    "src/node_modules",
    ...plugins.map((plugin) => path.join("plugins", plugin)),
  ];
  return implicitEntries.every((filename) => isDefinitelyAbsent(path.join(root, filename)));
};
