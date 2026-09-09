import {
  JSX_DUPLICATION_SOURCE_READ_SENTINEL_BYTES,
  UTF8_MAX_BYTES_PER_UTF16_CODE_UNIT,
} from "../constants.js";

export const resolveBoundedSourceReadBytes = (
  maximumLengthChars: number,
  sizeBytes: number,
): number =>
  Math.min(
    sizeBytes,
    maximumLengthChars * UTF8_MAX_BYTES_PER_UTF16_CODE_UNIT +
      JSX_DUPLICATION_SOURCE_READ_SENTINEL_BYTES,
  );
