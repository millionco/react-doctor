import { lstatSync } from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import type { StaticAlias } from "./resolve-vite-source.js";
import { parseSourceText } from "./parse-source-file.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { readStyleFileDirectives } from "./read-default-vite-style-route.js";

interface VerifiedTailwindStylesheet {
  readonly filename: string;
  readonly sha256: string;
}

export interface Vite5Tailwind4StyleFenceInput {
  readonly appDirectory: string;
  readonly localStylesheets: readonly string[];
  readonly aliases: readonly StaticAlias[];
  // The enclosing build proof supplies the actual Vite "style" resolver,
  // physical stock contract, and verified absence of CSS resolver hooks.
  readonly resolveStockTailwindStylesheet: (
    issuerFilename: string,
  ) => VerifiedTailwindStylesheet | null;
}

export interface Vite5Tailwind4StyleFence {
  readonly postcssConfig: string;
  readonly localStylesheets: readonly string[];
  readonly stockStylesheet: string | null;
}

const plainCssAtRules: ReadonlySet<string> = new Set([
  "import",
  "font-face",
  "keyframes",
  "layer",
  "media",
  "supports",
  "tailwind",
  "theme",
  "apply",
]);
// Vite 5.4's bundled PostCSS discovery considers these before the selected
// JavaScript file. A manifest PostCSS field is checked separately.
const earlierPostcssConfigs = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
];

const present = (file: string): boolean => {
  recordExistenceProbe(file);
  return lstatSync(file, { throwIfNoEntry: false }) !== undefined;
};

const readEmptyPostcssConfig = (directory: string): string | null => {
  const manifestFile = readProviderMember(path.join(directory, "package.json"));
  if (!manifestFile) return null;
  const manifest: unknown = JSON.parse(manifestFile.toString("utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("type" in manifest) ||
    manifest.type !== "module" ||
    Object.hasOwn(manifest, "postcss") ||
    earlierPostcssConfigs.some((name) => present(path.join(directory, name)))
  )
    return null;
  const filename = path.join(directory, "postcss.config.js");
  const text = readProviderMember(filename)?.toString("utf8");
  if (!text) return null;
  const program = parseSourceText({ filename, sourceText: text });
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return null;
  const choice = program.body[0];
  return isNodeOfType(choice, "ExportDefaultDeclaration") &&
    isNodeOfType(choice.declaration, "ObjectExpression") &&
    choice.declaration.properties.length === 0
    ? filename
    : null;
};

const safeLocalCssPath = /^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.css$/u;

const readCss = (text: string) => readStyleFileDirectives(text, false, plainCssAtRules);

// Requires a pinned Vite 5.4 / Tailwind 4 profile and a build config which has
// no CSS override. Only plain CSS roots and a selected stock Tailwind index
// are modeled. JavaScript CSS extensions are deliberately outside this lane.
export const readVite5Tailwind4StyleFence = (
  input: Vite5Tailwind4StyleFenceInput,
): Vite5Tailwind4StyleFence | null => {
  try {
    const { appDirectory, localStylesheets } = input;
    if (!path.isAbsolute(appDirectory) || localStylesheets.length === 0 || input.aliases.length)
      return null;
    const postcssConfig = readEmptyPostcssConfig(appDirectory);
    if (!postcssConfig) return null;
    const checked = new Set<string>();
    const active = new Set<string>();
    let stockStylesheet: string | null = null;
    const visit = (filename: string): boolean => {
      if (checked.has(filename)) return true;
      if (
        !path.isAbsolute(filename) ||
        !isPathInside(filename, appDirectory) ||
        !filename.endsWith(".css") ||
        filename.endsWith(".module.css") ||
        active.has(filename) ||
        checked.size + active.size >= 64
      )
        return false;
      const bytes = readProviderMember(filename);
      const directives = bytes && bytes.length <= 256 * 1024 && readCss(bytes.toString("utf8"));
      if (!directives) return false;
      active.add(filename);
      for (const directive of directives) {
        if (directive.kind !== "import") return false;
        const request = directive.source;
        if (request === "tailwindcss") {
          const local = path.join(path.dirname(filename), request);
          if (present(local) || present(local + ".css")) return false;
          const stock = input.resolveStockTailwindStylesheet(filename);
          if (!stock || (stockStylesheet !== null && stockStylesheet !== stock.filename))
            return false;
          const stylesheet = readProviderMember(stock.filename, stock.sha256);
          const imports = stylesheet && readCss(stylesheet.toString("utf8"));
          if (!imports || imports.length !== 0) return false;
          stockStylesheet = stock.filename;
          continue;
        }
        if (
          !safeLocalCssPath.test(request) ||
          !visit(path.resolve(path.dirname(filename), request))
        )
          return false;
      }
      active.delete(filename);
      checked.add(filename);
      return true;
    };
    return localStylesheets.every(visit)
      ? { postcssConfig, localStylesheets: [...checked], stockStylesheet }
      : null;
  } catch {
    return null;
  }
};
