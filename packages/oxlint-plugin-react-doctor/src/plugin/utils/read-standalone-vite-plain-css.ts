import * as fs from "node:fs";
import * as path from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import { isPathInside } from "./is-path-inside.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import { readBoundedViteEnvCallback } from "./read-bounded-vite-env-callback.js";

export interface StandalonePlainCssProjection {
  readonly filename: string;
  readonly bytes: number;
  readonly configuration: "no-postcss-config-or-override";
  readonly syntax: "flat-plain-declarations-no-external-edges";
  readonly requiresSeparateStockViteCssPipeline: true;
}
const MAX_CSS_BYTES = 65536;
const POSTCSS_CONFIG_FILES = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.mts",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
];
const observe = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  const value = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (value && fs.realpathSync(filename) !== filename) throw new Error("unsupported link");
  return value;
};
const read = (filename: string): string | null => {
  const value = observe(filename);
  if (!value?.isFile() || value.size > MAX_CSS_BYTES) return null;
  recordContentProbe(filename);
  return fs.readFileSync(filename, "utf8");
};
const hasNoPostcssConfiguration = (root: string): boolean => {
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (!observe(directory)?.isDirectory()) return false;
    if (POSTCSS_CONFIG_FILES.some((name) => observe(path.join(directory, name)))) return false;
    const manifestFile = path.join(directory, "package.json");
    if (observe(manifestFile)) {
      const content = read(manifestFile);
      if (content === null) return false;
      const manifest: unknown = JSON.parse(content);
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Array.isArray(manifest) ||
        Object.hasOwn(manifest, "postcss")
      )
        return false;
    }
    if (path.dirname(directory) === directory) return true;
  }
};
const isFlatPlainCss = (source: string): boolean => {
  let clean = "";
  let quote = "";
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset];
    if (character === "\\" || character === "@" || character === "\0") return false;
    if (quote) {
      if (character === quote) quote = "";
      else if (character === "\n" || character === "\r") return false;
      clean += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      clean += character;
    } else if (character === "/" && source[offset + 1] === "*") {
      const end = source.indexOf("*/", offset + 2);
      if (end < 0) return false;
      clean += " ";
      offset = end + 1;
    } else clean += character;
  }
  if (
    quote ||
    /(?:url|expression|var|image-set|paint)\s*\(|javascript\s*:|behavior\s*:|-moz-binding\s*:/iu.test(
      clean,
    )
  )
    return false;
  let offset = 0;
  while (offset < clean.length) {
    const remaining = clean.slice(offset).trimStart();
    if (!remaining) return true;
    const opening = remaining.indexOf("{");
    const closing = remaining.indexOf("}");
    if (
      opening < 1 ||
      closing < opening ||
      (remaining.indexOf("{", opening + 1) >= 0 && remaining.indexOf("{", opening + 1) < closing)
    )
      return false;
    const selector = remaining.slice(0, opening).trim();
    if (!/^[A-Za-z0-9_.#*\s,:>+~-]+$/u.test(selector)) return false;
    const declarations = remaining.slice(opening + 1, closing).split(";");
    for (const declaration of declarations) {
      if (!declaration.trim()) continue;
      const separator = declaration.indexOf(":");
      if (separator < 1) return false;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (!/^-?[a-z][a-z-]*$/iu.test(property) || !value || /[{};@\\]/u.test(value)) return false;
      const functions = [...value.matchAll(/([a-z][a-z-]*)\s*\(/giu)].map((entry) =>
        entry[1].toLowerCase(),
      );
      if (
        functions.some(
          (name) =>
            ![
              "rgb",
              "rgba",
              "hsl",
              "hsla",
              "radial-gradient",
              "linear-gradient",
              "calc",
              "min",
              "max",
              "clamp",
            ].includes(name),
        )
      )
        return false;
      let nesting = 0;
      for (const character of value) {
        if (character === "(") nesting++;
        if (character === ")" && --nesting < 0) return false;
      }
      if (nesting !== 0) return false;
    }
    offset = clean.length - remaining.length + closing + 1;
  }
  return true;
};
export const readStandaloneVitePlainCss = (input: {
  readonly projectRoot: string;
  readonly filename: string;
  readonly configProgram: EsTreeNode;
}): StandalonePlainCssProjection | null => {
  try {
    const { projectRoot, filename, configProgram } = input;
    if (
      !path.isAbsolute(projectRoot) ||
      path.normalize(projectRoot) !== projectRoot ||
      !path.isAbsolute(filename) ||
      path.normalize(filename) !== filename ||
      !isPathInside(filename, projectRoot) ||
      !filename.endsWith(".css") ||
      filename.endsWith(".module.css") ||
      !readBoundedViteEnvCallback(configProgram) ||
      !hasNoPostcssConfiguration(projectRoot)
    )
      return null;
    const content = read(filename);
    return content !== null && isFlatPlainCss(content)
      ? {
          filename,
          bytes: Buffer.byteLength(content),
          configuration: "no-postcss-config-or-override",
          syntax: "flat-plain-declarations-no-external-edges",
          requiresSeparateStockViteCssPipeline: true,
        }
      : null;
  } catch {
    return null;
  }
};
