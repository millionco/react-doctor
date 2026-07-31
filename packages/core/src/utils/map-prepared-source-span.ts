import { originalPositionFor } from "@jridgewell/trace-mapping";
import type { PreparedSourceMap } from "./prepare-lint-sources.js";
import { columnOfUtf8Offset } from "./column-of-utf8-offset.js";
import { lineOfUtf8Offset } from "./line-of-utf8-offset.js";
import { utf8OffsetFromSourcePosition } from "./utf8-offset-from-source-position.js";

export interface PreparedSourceSpan {
  readonly offset: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
}

export const mapPreparedSourceSpan = (
  span: PreparedSourceSpan,
  preparedSourceMap: PreparedSourceMap,
): PreparedSourceSpan | null => {
  const generatedLine = lineOfUtf8Offset(preparedSourceMap.generatedBuffer, span.offset);
  const generatedColumn = columnOfUtf8Offset(preparedSourceMap.generatedBuffer, span.offset) - 1;
  const originalStart = originalPositionFor(preparedSourceMap.traceMap, {
    line: generatedLine,
    column: generatedColumn,
  });
  if (
    originalStart.source === null ||
    originalStart.line === null ||
    originalStart.column === null
  ) {
    return null;
  }
  const originalOffset = utf8OffsetFromSourcePosition(
    preparedSourceMap.sourceBuffer,
    originalStart.line,
    originalStart.column,
  );
  if (originalOffset === null) return null;

  const generatedSpan = preparedSourceMap.generatedBuffer.subarray(
    span.offset,
    span.offset + span.length,
  );
  const matchingSourceSpan = preparedSourceMap.sourceBuffer.subarray(
    originalOffset,
    originalOffset + generatedSpan.length,
  );
  const mappedLength = matchingSourceSpan.equals(generatedSpan) ? generatedSpan.length : 0;

  return {
    offset: originalOffset,
    length: mappedLength,
    line: originalStart.line,
    column: originalStart.column + 1,
  };
};
