import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { isStockBrowserSelection } from "./is-stock-browser-selection.js";
import { parseSourceText } from "./parse-source-file.js";
import {
  readStockKktConfigOperations,
  type StockKktConfigOperations,
} from "./read-stock-kkt-config-operations.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const PREFERRED_KKT_CONFIG = ".kktrc.ts";
const HIGHER_PRIORITY_KKT_CONFIGS = [
  ".kktrc",
  ...["json", "json5", "jsonc", "yaml", "yml", "toml", "ini", "js"].map((ext) => ".kktrc." + ext),
];
const COMPILER_OVERRIDES = [
  ".pnp.js",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  "jsconfig.json",
  ".browserslistrc",
  "browserslist",
  "src/setupProxy.js",
  "tailwind.config.js",
];

const observedStat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

// Requires the separately verified KKT build route and config loader
// selection with the separately verified config-discovery order. This only qualifies the selected input.
export const readSelectedStockKktConfig = (root: string): StockKktConfigOperations | null => {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) return null;
  try {
    recordRealpathProbe(root);
    if (fs.realpathSync(root) !== root || !observedStat(root)?.isDirectory()) return null;
    if (
      [...HIGHER_PRIORITY_KKT_CONFIGS, ...COMPILER_OVERRIDES].some((file) =>
        observedStat(path.join(root, file)),
      )
    ) {
      return null;
    }
    const manifest = readProviderMember(path.join(root, "package.json"));
    if (!manifest || manifest.length > 64 * 1024) return null;
    const metadata = JSON.parse(manifest.toString("utf8"));
    if (
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      !isStockBrowserSelection(metadata.browserslist) ||
      typeof metadata.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u.test(metadata.version) ||
      ["browser", "babel", "type"].some((name) => Object.hasOwn(metadata, name))
    )
      return null;
    const filename = path.join(root, PREFERRED_KKT_CONFIG);
    const info = observedStat(filename);
    if (!info?.isFile() || info.nlink !== 1 || info.size > 64 * 1024) return null;
    const config = readProviderMember(filename);
    if (!config) return null;
    const program = parseSourceText({ filename, sourceText: config.toString("utf8") });
    return program ? readStockKktConfigOperations(program, analyzeScopes(program)) : null;
  } catch {
    return null;
  }
};
