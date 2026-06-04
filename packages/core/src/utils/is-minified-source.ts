import * as fs from "node:fs";
import {
  MINIFIED_AVG_LINE_LENGTH_CHARS,
  MINIFIED_MAX_LINE_LENGTH_CHARS,
  MINIFIED_SNIFF_BYTES,
} from "../project-info/constants.js";

// Content sniff for minified / generated files that carry an ordinary
// source extension (e.g. a one-line `public/inject.js` bundle that the
// path-based `isLintableSourceFile` gate can't catch). Reads only a small
// prefix — a minified file's enormous lines show up immediately, so we
// never read the whole bundle. A file counts as minified only when BOTH
// its longest line and its average line exceed their thresholds, so a
// real source file with a single long line (inline SVG path, base64 URI,
// one-line generated GraphQL doc) among many short ones isn't dropped.
// Returns false on any read error so an unreadable file is scanned as usual.
export const isMinifiedSource = (absolutePath: string): boolean => {
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = fs.openSync(absolutePath, "r");
    const buffer = Buffer.alloc(MINIFIED_SNIFF_BYTES);
    const bytesRead = fs.readSync(fileDescriptor, buffer, 0, MINIFIED_SNIFF_BYTES, 0);
    const prefix = buffer.toString("utf8", 0, bytesRead);
    const lines = prefix.split("\n");
    const longestLineLength = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
    const averageLineLength = prefix.length / lines.length;
    return (
      longestLineLength > MINIFIED_MAX_LINE_LENGTH_CHARS &&
      averageLineLength > MINIFIED_AVG_LINE_LENGTH_CHARS
    );
  } catch {
    return false;
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
  }
};
