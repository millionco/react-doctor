import { CARRIAGE_RETURN_UTF8_BYTE, LINE_FEED_UTF8_BYTE, SPACE_UTF8_BYTE } from "../constants.js";

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const FRONTMATTER_FENCE = "---";
const SCRIPT_TAG_NAME = "script";
const SCRIPT_OPEN = `<${SCRIPT_TAG_NAME}`;
const SCRIPT_CLOSE = `</${SCRIPT_TAG_NAME}`;
const TEMPLATE_TAG_NAME = "template";
const TEMPLATE_CLOSE = `</${TEMPLATE_TAG_NAME}`;
const JAVASCRIPT_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);
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

export interface PreparedHtmlScriptSource {
  readonly executableScriptBodies: ReadonlyArray<Buffer>;
  readonly lintBuffer: Buffer;
}

interface ScriptAttributes {
  readonly hasSource: boolean;
  readonly language: string | null;
  readonly type: string | null;
}

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

const findLineEnd = (sourceBuffer: Buffer, lineStartByte: number): number => {
  let byteIndex = lineStartByte;
  while (
    byteIndex < sourceBuffer.length &&
    sourceBuffer[byteIndex] !== LINE_FEED_UTF8_BYTE &&
    sourceBuffer[byteIndex] !== CARRIAGE_RETURN_UTF8_BYTE
  ) {
    byteIndex++;
  }
  return byteIndex;
};

const findNextLineStart = (sourceBuffer: Buffer, lineStartByte: number): number => {
  const lineEndByte = findLineEnd(sourceBuffer, lineStartByte);
  if (
    sourceBuffer[lineEndByte] === CARRIAGE_RETURN_UTF8_BYTE &&
    sourceBuffer[lineEndByte + 1] === LINE_FEED_UTF8_BYTE
  ) {
    return lineEndByte + 2;
  }
  return Math.min(lineEndByte + 1, sourceBuffer.length);
};

const isFrontmatterFenceLine = (sourceBuffer: Buffer, lineStartByte: number): boolean => {
  if (!matchesAsciiCaseInsensitive(sourceBuffer, lineStartByte, FRONTMATTER_FENCE)) return false;
  const lineEndByte = findLineEnd(sourceBuffer, lineStartByte);
  for (
    let byteIndex = lineStartByte + FRONTMATTER_FENCE.length;
    byteIndex < lineEndByte;
    byteIndex++
  ) {
    if (!isHtmlWhitespace(sourceBuffer[byteIndex])) return false;
  }
  return true;
};

const findFrontmatterEnd = (sourceBuffer: Buffer): number => {
  if (!isFrontmatterFenceLine(sourceBuffer, 0)) return 0;
  const openingFenceEndByte = findLineEnd(sourceBuffer, 0);
  let lineStartByte = findNextLineStart(sourceBuffer, 0);
  while (lineStartByte < sourceBuffer.length) {
    if (isFrontmatterFenceLine(sourceBuffer, lineStartByte)) {
      return findLineEnd(sourceBuffer, lineStartByte);
    }
    lineStartByte = findNextLineStart(sourceBuffer, lineStartByte);
  }
  return openingFenceEndByte;
};

const maskByteRange = (maskedBuffer: Buffer, startByte: number, endByte: number): void => {
  for (let byteIndex = startByte; byteIndex < endByte; byteIndex++) {
    const byte = maskedBuffer[byteIndex];
    if (byte !== LINE_FEED_UTF8_BYTE && byte !== CARRIAGE_RETURN_UTF8_BYTE) {
      maskedBuffer[byteIndex] = SPACE_UTF8_BYTE;
    }
  }
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

const parseScriptAttributes = (
  sourceBuffer: Buffer,
  attributesStartByte: number,
  tagEndByte: number,
): ScriptAttributes => {
  let byteIndex = attributesStartByte;
  let hasSource = false;
  let language: string | null = null;
  let scriptType: string | null = null;
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
    const attributeName = sourceBuffer
      .subarray(attributeNameStartByte, byteIndex)
      .toString("ascii")
      .toLowerCase();
    while (byteIndex < tagEndByte && isHtmlWhitespace(sourceBuffer[byteIndex])) byteIndex++;
    let attributeValue = "";
    if (sourceBuffer[byteIndex] === ATTRIBUTE_ASSIGNMENT_UTF8_BYTE) {
      byteIndex++;
      while (byteIndex < tagEndByte && isHtmlWhitespace(sourceBuffer[byteIndex])) byteIndex++;
      const quoteByte = sourceBuffer[byteIndex];
      if (quoteByte === SINGLE_QUOTE_UTF8_BYTE || quoteByte === DOUBLE_QUOTE_UTF8_BYTE) {
        const valueStartByte = byteIndex + 1;
        byteIndex = valueStartByte;
        while (byteIndex < tagEndByte && sourceBuffer[byteIndex] !== quoteByte) byteIndex++;
        attributeValue = sourceBuffer.subarray(valueStartByte, byteIndex).toString("utf8");
        if (byteIndex < tagEndByte) byteIndex++;
      } else {
        const valueStartByte = byteIndex;
        while (
          byteIndex < tagEndByte &&
          !isHtmlWhitespace(sourceBuffer[byteIndex]) &&
          sourceBuffer[byteIndex] !== TAG_CLOSE_UTF8_BYTE
        ) {
          byteIndex++;
        }
        attributeValue = sourceBuffer.subarray(valueStartByte, byteIndex).toString("utf8");
      }
    }
    if (attributeName === "src") hasSource = true;
    else if (attributeName === "type" && scriptType === null) scriptType = attributeValue;
    else if (attributeName === "language" && language === null) language = attributeValue;
  }
  return { hasSource, language, type: scriptType };
};

const isExecutableScript = (attributes: ScriptAttributes): boolean => {
  if (attributes.hasSource) return false;
  const type = attributes.type?.trim().toLowerCase() ?? "";
  if (type !== "") {
    const mimeType = type.split(";")[0]?.trim() ?? "";
    return mimeType === "module" || JAVASCRIPT_MIME_TYPES.has(mimeType);
  }
  const language = attributes.language?.trim().toLowerCase() ?? "";
  return language === "" || JAVASCRIPT_MIME_TYPES.has(`text/${language}`);
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

export const prepareHtmlScriptSource = (sourceBuffer: Buffer): PreparedHtmlScriptSource => {
  const frontmatterEndByte = findFrontmatterEnd(sourceBuffer);
  let maskedBuffer: Buffer | null = frontmatterEndByte > 0 ? Buffer.from(sourceBuffer) : null;
  if (maskedBuffer !== null) maskByteRange(maskedBuffer, 0, frontmatterEndByte);
  const executableScriptBodies: Buffer[] = [];
  let byteIndex = frontmatterEndByte;
  let templateDepth = 0;
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
      matchesAsciiCaseInsensitive(sourceBuffer, byteIndex, TEMPLATE_CLOSE) &&
      isTagBoundary(sourceBuffer[byteIndex + TEMPLATE_CLOSE.length])
    ) {
      const tagEndByte = findTagEnd(sourceBuffer, byteIndex + TEMPLATE_CLOSE.length);
      if (templateDepth > 0) templateDepth--;
      byteIndex = Math.min(tagEndByte + 1, sourceBuffer.length);
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
      if (tagName === TEMPLATE_TAG_NAME) templateDepth++;
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
    const attributes = parseScriptAttributes(
      sourceBuffer,
      byteIndex + SCRIPT_OPEN.length,
      tagEndByte,
    );
    if (attributes.hasSource || templateDepth > 0) {
      maskedBuffer ??= Buffer.from(sourceBuffer);
      maskByteRange(maskedBuffer, bodyStartByte, bodyEndByte);
    } else if (isExecutableScript(attributes)) {
      executableScriptBodies.push(sourceBuffer.subarray(bodyStartByte, bodyEndByte));
    }
    if (bodyEndByte === sourceBuffer.length) break;
    const closeTagEndByte = findTagEnd(sourceBuffer, bodyEndByte + SCRIPT_CLOSE.length);
    byteIndex = Math.min(closeTagEndByte + 1, sourceBuffer.length);
  }
  return { executableScriptBodies, lintBuffer: maskedBuffer ?? sourceBuffer };
};
