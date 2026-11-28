import * as fs from "node:fs";
import {
  MINIFIED_SNIFF_BYTES,
  VITE_ENTRY_ASSET_FILE_PATTERN,
  VITE_ENTRY_DENSITY_SAMPLE_BYTES,
  VITE_ENTRY_MIN_SIZE_BYTES,
  VITE_ENTRY_PRELUDE_SNIFF_BYTES,
} from "../project-info/constants.js";
import { statSourceFileSize } from "./is-large-minified-file.js";
import { hasMinifiedSample } from "./is-minified-source.js";

const MODULE_PRELOAD_POLYFILL_START =
  /^\(function\(\)\{(?:const|let|var) [\w$]+=document\.createElement\((?:"link"|'link')\)\.relList;/;
const MODULE_PRELOAD_POLYFILL_MARKERS = [
  /\.supports\((?:"modulepreload"|'modulepreload')\)/,
  /document\.querySelectorAll\([^)]*link\[rel=["']modulepreload["']\]/,
  /new MutationObserver\(/,
  /\.observe\(document,/,
];

export const isMinifiedViteEntry = (
  absolutePath: string,
  knownSizeBytes?: number | null,
): boolean => {
  if (!VITE_ENTRY_ASSET_FILE_PATTERN.test(absolutePath)) return false;
  const sizeBytes =
    knownSizeBytes === undefined ? statSourceFileSize(absolutePath) : knownSizeBytes;
  if (sizeBytes === null || sizeBytes < VITE_ENTRY_MIN_SIZE_BYTES) return false;

  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = fs.openSync(absolutePath, "r");
    const buffer = Buffer.alloc(VITE_ENTRY_DENSITY_SAMPLE_BYTES);
    const preludeBytesRead = fs.readSync(
      fileDescriptor,
      buffer,
      0,
      VITE_ENTRY_PRELUDE_SNIFF_BYTES,
      0,
    );
    const prelude = buffer.toString("utf8", 0, preludeBytesRead);
    const polyfillEndOffset = prelude.indexOf("})();");
    if (polyfillEndOffset === -1) return false;
    const polyfill = prelude.slice(0, polyfillEndOffset);
    if (
      !MODULE_PRELOAD_POLYFILL_START.test(polyfill) ||
      !MODULE_PRELOAD_POLYFILL_MARKERS.every((marker) => marker.test(polyfill))
    ) {
      return false;
    }

    const middleOffset = Math.max(
      MINIFIED_SNIFF_BYTES,
      Math.floor((sizeBytes - VITE_ENTRY_DENSITY_SAMPLE_BYTES) / 2),
    );
    const tailOffset = sizeBytes - VITE_ENTRY_DENSITY_SAMPLE_BYTES;
    for (const offset of [middleOffset, tailOffset]) {
      const bytesRead = fs.readSync(
        fileDescriptor,
        buffer,
        0,
        VITE_ENTRY_DENSITY_SAMPLE_BYTES,
        offset,
      );
      if (
        bytesRead !== VITE_ENTRY_DENSITY_SAMPLE_BYTES ||
        !hasMinifiedSample(buffer.toString("utf8"))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
  }
};
