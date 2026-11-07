import * as fs from "node:fs";
import { createRequire } from "node:module";
import {
  CROSS_FILE_PARSE_CACHE_MAX_ENTRIES,
  CROSS_FILE_PARSE_MAX_BYTES,
} from "../constants/thresholds.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { hasSameFileSnapshot } from "./has-same-file-snapshot.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const requireCompiler = createRequire(import.meta.url);
let compiler: typeof import("@astrojs/compiler/sync") | undefined;

interface AstroParseCacheEntry {
  readonly stat: fs.Stats;
  readonly program: EsTreeNode | null;
}

const cachedAstroPrograms = new Map<string, AstroParseCacheEntry>();

const parseAstroProgram = (filename: string): EsTreeNode | null => {
  try {
    const astroCompiler = (compiler ??= requireCompiler("@astrojs/compiler/sync"));
    const converted = astroCompiler.convertToTSX(fs.readFileSync(filename, "utf8"), {
      filename: normalizeFilename(filename),
      includeScripts: true,
      sourcemap: false,
    });
    if (converted.diagnostics.length > 0) return null;
    const program = parseSourceText({ filename, sourceText: converted.code });
    if (!program) return null;
    let hasOpaqueScript = false;
    walkAst(program, (node) => {
      if (hasOpaqueScript) return false;
      if (
        isNodeOfType(node, "JSXOpeningElement") &&
        isNodeOfType(node.name, "JSXIdentifier") &&
        node.name.name === "script"
      ) {
        hasOpaqueScript =
          Boolean(findJsxAttribute(node.attributes, "src")) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"));
      }
    });
    return hasOpaqueScript ? null : program;
  } catch {
    return null;
  }
};

export const parseAstroSourceFile = (filename: string): EsTreeNode | null => {
  recordContentProbe(filename);
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  } catch {
    return null;
  }
  if (!stat?.isFile() || stat.size > CROSS_FILE_PARSE_MAX_BYTES) return null;
  const cached = cachedAstroPrograms.get(filename);
  const isCurrent = cached && hasSameFileSnapshot(cached.stat, stat);
  const entry = isCurrent ? cached : { stat, program: parseAstroProgram(filename) };
  cachedAstroPrograms.delete(filename);
  cachedAstroPrograms.set(filename, entry);
  if (cachedAstroPrograms.size > CROSS_FILE_PARSE_CACHE_MAX_ENTRIES) {
    const oldest = cachedAstroPrograms.keys().next().value;
    if (oldest !== undefined) cachedAstroPrograms.delete(oldest);
  }
  return entry.program;
};
