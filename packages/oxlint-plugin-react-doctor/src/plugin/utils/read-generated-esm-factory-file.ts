import * as fs from "node:fs";
import {
  CROSS_FILE_PARSE_CACHE_MAX_ENTRIES,
  STATIC_VIRTUAL_GENERATED_MODULE_MAX_BYTES,
} from "../constants/thresholds.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import { hasSameFileSnapshot } from "./has-same-file-snapshot.js";
import {
  readGeneratedEsmFactoryImport,
  type GeneratedEsmFactoryImport,
} from "./read-generated-esm-factory-import.js";

interface GeneratedFactoryFile {
  readonly bytes: number;
  readonly factory: GeneratedEsmFactoryImport;
}

interface GeneratedFactoryCacheEntry {
  readonly stat: fs.Stats;
  readonly result: GeneratedFactoryFile | null;
}

const generatedFactoryCache = new Map<string, GeneratedFactoryCacheEntry>();
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

const readGeneratedFactorySnapshot = (
  filename: string,
  stat: fs.Stats,
): GeneratedFactoryFile | null => {
  const bytes = fs.readFileSync(filename);
  if (bytes.length !== stat.size || !hasSameFileSnapshot(stat, fs.lstatSync(filename))) return null;
  const factory = readGeneratedEsmFactoryImport(strictUtf8Decoder.decode(bytes));
  return factory ? { bytes: bytes.length, factory } : null;
};

export const readGeneratedEsmFactoryFile = (
  filename: string,
  remainingBytes: number,
): GeneratedFactoryFile | null => {
  recordContentProbe(filename);
  try {
    const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
    if (
      !stat?.isFile() ||
      stat.size > Math.min(remainingBytes, STATIC_VIRTUAL_GENERATED_MODULE_MAX_BYTES)
    )
      return null;
    const cached = generatedFactoryCache.get(filename);
    const entry =
      cached && hasSameFileSnapshot(cached.stat, stat)
        ? cached
        : { stat, result: readGeneratedFactorySnapshot(filename, stat) };
    generatedFactoryCache.delete(filename);
    generatedFactoryCache.set(filename, entry);
    if (generatedFactoryCache.size > CROSS_FILE_PARSE_CACHE_MAX_ENTRIES) {
      const oldest = generatedFactoryCache.keys().next().value;
      if (oldest !== undefined) generatedFactoryCache.delete(oldest);
    }
    return entry.result;
  } catch {
    return null;
  }
};
