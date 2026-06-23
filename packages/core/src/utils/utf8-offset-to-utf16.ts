/**
 * Converts a UTF-8 byte offset (oxlint / oxc diagnostics report locations in
 * bytes) into the UTF-16 code-unit index that `String.prototype.slice` and oxc
 * AST `start`/`end` spans use. The two diverge on any non-ASCII source, so a
 * caller crossing that boundary (e.g. slicing a snippet around a diagnostic)
 * must convert first or it indexes the wrong character.
 */
export const utf8OffsetToUtf16 = (sourceText: string, utf8Offset: number): number =>
  Buffer.from(sourceText).subarray(0, utf8Offset).toString("utf8").length;
