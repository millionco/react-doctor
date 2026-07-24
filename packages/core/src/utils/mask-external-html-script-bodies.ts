import { CARRIAGE_RETURN_UTF8_BYTE, LINE_FEED_UTF8_BYTE, SPACE_UTF8_BYTE } from "../constants.js";

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const SCRIPT_TAG_NAME = "script";
const SCRIPT_OPEN = `<${SCRIPT_TAG_NAME}`;
const SCRIPT_CLOSE = `</${SCRIPT_TAG_NAME}`;
const RAW_TEXT_TAG_NAMES = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "style",
  "textarea",
  "title",
  "xmp",
]);
const PLAINTEXT_TAG_NAME = "plaintext";
const TAG_OPEN_UTF8_BYTE = "<".charCodeAt(0);
const TAG_CLOSE_UTF8_BYTE = ">".charCodeAt(0);
const SINGLE_QUOTE_UTF8_BYTE = "'".charCodeAt(0);
const DOUBLE_QUOTE_UTF8_BYTE = '"'.charCodeAt(0);
const ATTRIBUTE_ASSIGNMENT_UTF8_BYTE = "=".charCodeAt(0);
const TAG_SELF_CLOSE_UTF8_BYTE = "/".charCodeAt(0);
const TAB_UTF8_BYTE = "\t".charCodeAt(0);
const FORM_FEED_UTF8_BYTE = "\f".charCodeAt(0);

const isHtmlWhitespace = (byte: number | undefined): boolean =>
  byte === TAB_UTF8_BYTE ||
  byte === LINE_FEED_UTF8_BYTE ||
  byte === FORM_FEED_UTF8_BYTE ||
  byte === CARRIAGE_RETURN_UTF8_BYTE ||
  byte === SPACE_UTF8_BYTE;

const matchesAsciiCaseInsensitive = (
  sourceBuffer: Buffer,
  startByte: number,
  expected: string,
): boolean => {
  if (startByte + expected.length > sourceBuffer.length) return false;
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex++) {
    const sourceByte = sourceBuffer[startByte + expectedIndex];
    if (
      sourceByte === undefined ||
      String.fromCharCode(sourceByte).toLowerCase() !== expected[expectedIndex]
    ) {
      return false;
    }
  }
  return true;
};

const isTagBoundary = (byte: number | undefined): boolean =>
  byte === TAG_CLOSE_UTF8_BYTE || byte === TAG_SELF_CLOSE_UTF8_BYTE || isHtmlWhitespace(byte);

const isPotentialTagStart = (byte: number | undefined): boolean => {
  if (byte === undefined) return false;
  return /[A-Za-z!/?]/.test(String.fromCharCode(byte));
};

const readStartTagName = (sourceBuffer: Buffer, tagStartByte: number): string | null => {
  const firstNameByte = sourceBuffer[tagStartByte + 1];
  if (firstNameByte === undefined || !/[A-Za-z]/.test(String.fromCharCode(firstNameByte))) {
    return null;
  }
  let nameEndByte = tagStartByte + 2;
  while (
    nameEndByte < sourceBuffer.length &&
    /[A-Za-z0-9:-]/.test(String.fromCharCode(sourceBuffer[nameEndByte] ?? SPACE_UTF8_BYTE))
  ) {
    nameEndByte++;
  }
  return sourceBuffer
    .subarray(tagStartByte + 1, nameEndByte)
    .toString("ascii")
    .toLowerCase();
};

const findTagEnd = (sourceBuffer: Buffer, startByte: number): number => {
  let quoteByte: number | null = null;
  for (let byteIndex = startByte; byteIndex < sourceBuffer.length; byteIndex++) {
    const byte = sourceBuffer[byteIndex];
    if (quoteByte !== null) {
      if (byte === quoteByte) quoteByte = null;
      continue;
    }
    if (byte === SINGLE_QUOTE_UTF8_BYTE || byte === DOUBLE_QUOTE_UTF8_BYTE) {
      quoteByte = byte;
      continue;
    }
    if (byte === TAG_CLOSE_UTF8_BYTE) return byteIndex;
  }
  return sourceBuffer.length;
};

const hasSourceAttribute = (
  sourceBuffer: Buffer,
  attributesStartByte: number,
  tagEndByte: number,
): boolean => {
  let byteIndex = attributesStartByte;
  while (byteIndex < tagEndByte) {
    while (
      byteIndex < tagEndByte &&
      (isHtmlWhitespace(sourceBuffer[byteIndex]) ||
        sourceBuffer[byteIndex] === TAG_SELF_CLOSE_UTF8_BYTE)
    ) {
      byteIndex++;
    }
    const attributeNameStartByte = byteIndex;
    while (
      byteIndex < tagEndByte &&
      !isHtmlWhitespace(sourceBuffer[byteIndex]) &&
      sourceBuffer[byteIndex] !== ATTRIBUTE_ASSIGNMENT_UTF8_BYTE &&
      sourceBuffer[byteIndex] !== TAG_SELF_CLOSE_UTF8_BYTE
    ) {
      byteIndex++;
    }
    if (
      sourceBuffer.subarray(attributeNameStartByte, byteIndex).toString("ascii").toLowerCase() ===
      "src"
    ) {
      return true;
    }
    while (byteIndex < tagEndByte && isHtmlWhitespace(sourceBuffer[byteIndex])) byteIndex++;
    if (sourceBuffer[byteIndex] !== ATTRIBUTE_ASSIGNMENT_UTF8_BYTE) continue;
    byteIndex++;
    while (byteIndex < tagEndByte && isHtmlWhitespace(sourceBuffer[byteIndex])) byteIndex++;
    const quoteByte = sourceBuffer[byteIndex];
    if (quoteByte === SINGLE_QUOTE_UTF8_BYTE || quoteByte === DOUBLE_QUOTE_UTF8_BYTE) {
      byteIndex++;
      while (byteIndex < tagEndByte && sourceBuffer[byteIndex] !== quoteByte) byteIndex++;
      byteIndex++;
      continue;
    }
    while (
      byteIndex < tagEndByte &&
      !isHtmlWhitespace(sourceBuffer[byteIndex]) &&
      sourceBuffer[byteIndex] !== TAG_CLOSE_UTF8_BYTE
    ) {
      byteIndex++;
    }
  }
  return false;
};

const findElementClose = (sourceBuffer: Buffer, startByte: number, tagName: string): number => {
  const closeTagStart = `</${tagName}`;
  for (let byteIndex = startByte; byteIndex < sourceBuffer.length; byteIndex++) {
    if (
      sourceBuffer[byteIndex] === TAG_OPEN_UTF8_BYTE &&
      matchesAsciiCaseInsensitive(sourceBuffer, byteIndex, closeTagStart) &&
      isTagBoundary(sourceBuffer[byteIndex + closeTagStart.length])
    ) {
      return byteIndex;
    }
  }
  return sourceBuffer.length;
};

export const maskExternalHtmlScriptBodies = (sourceBuffer: Buffer): Buffer => {
  let maskedBuffer: Buffer | null = null;
  let byteIndex = 0;
  while (byteIndex < sourceBuffer.length) {
    if (sourceBuffer[byteIndex] !== TAG_OPEN_UTF8_BYTE) {
      byteIndex++;
      continue;
    }
    if (matchesAsciiCaseInsensitive(sourceBuffer, byteIndex, COMMENT_OPEN)) {
      const commentEndByte = sourceBuffer.indexOf(COMMENT_CLOSE, byteIndex + COMMENT_OPEN.length);
      byteIndex =
        commentEndByte === -1 ? sourceBuffer.length : commentEndByte + COMMENT_CLOSE.length;
      continue;
    }
    if (
      !matchesAsciiCaseInsensitive(sourceBuffer, byteIndex, SCRIPT_OPEN) ||
      !isTagBoundary(sourceBuffer[byteIndex + SCRIPT_OPEN.length])
    ) {
      if (!isPotentialTagStart(sourceBuffer[byteIndex + 1])) {
        byteIndex++;
        continue;
      }
      const tagEndByte = findTagEnd(sourceBuffer, byteIndex + 1);
      const tagName = readStartTagName(sourceBuffer, byteIndex);
      if (tagName === PLAINTEXT_TAG_NAME) break;
      if (tagName !== null && RAW_TEXT_TAG_NAMES.has(tagName)) {
        const closeTagStartByte = findElementClose(sourceBuffer, tagEndByte + 1, tagName);
        if (closeTagStartByte === sourceBuffer.length) break;
        const closeTagEndByte = findTagEnd(sourceBuffer, closeTagStartByte + tagName.length + 2);
        byteIndex = Math.min(closeTagEndByte + 1, sourceBuffer.length);
        continue;
      }
      byteIndex = Math.min(tagEndByte + 1, sourceBuffer.length);
      continue;
    }

    const tagEndByte = findTagEnd(sourceBuffer, byteIndex + SCRIPT_OPEN.length);
    if (tagEndByte === sourceBuffer.length) break;
    const bodyStartByte = tagEndByte + 1;
    const bodyEndByte = findElementClose(sourceBuffer, bodyStartByte, SCRIPT_TAG_NAME);
    if (hasSourceAttribute(sourceBuffer, byteIndex + SCRIPT_OPEN.length, tagEndByte)) {
      maskedBuffer ??= Buffer.from(sourceBuffer);
      for (let bodyByteIndex = bodyStartByte; bodyByteIndex < bodyEndByte; bodyByteIndex++) {
        const byte = maskedBuffer[bodyByteIndex];
        if (byte !== LINE_FEED_UTF8_BYTE && byte !== CARRIAGE_RETURN_UTF8_BYTE) {
          maskedBuffer[bodyByteIndex] = SPACE_UTF8_BYTE;
        }
      }
    }
    if (bodyEndByte === sourceBuffer.length) break;
    const closeTagEndByte = findTagEnd(sourceBuffer, bodyEndByte + SCRIPT_CLOSE.length);
    byteIndex = Math.min(closeTagEndByte + 1, sourceBuffer.length);
  }
  return maskedBuffer ?? sourceBuffer;
};
