import { CARRIAGE_RETURN_UTF8_BYTE, LINE_FEED_UTF8_BYTE, SPACE_UTF8_BYTE } from "../constants.js";

export interface ExtractedHtmlScriptSource {
  readonly content: Buffer;
  readonly extension: ".js" | ".mjs";
}

const SCRIPT_SOURCE_ATTRIBUTE_PATTERN = /(?:^|\s)src(?:\s*=|\s|$)/i;
const SCRIPT_TYPE_ATTRIBUTE_PATTERN = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const JAVASCRIPT_MIME_TYPE_PATTERN = /^(?:text|application)\/(?:java|ecma)script$/i;
const HTML_COMMENT_END = "-->";

const findTagEnd = (sourceText: string, searchStartIndex: number): number | null => {
  let quote: "'" | '"' | null = null;
  for (
    let characterIndex = searchStartIndex;
    characterIndex < sourceText.length;
    characterIndex++
  ) {
    const character = sourceText[characterIndex];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">") return characterIndex;
  }
  return null;
};

const resolveScriptExtension = (attributes: string): ".js" | ".mjs" | null => {
  if (SCRIPT_SOURCE_ATTRIBUTE_PATTERN.test(attributes)) return null;
  const typeMatch = attributes.match(SCRIPT_TYPE_ATTRIBUTE_PATTERN);
  const rawType =
    typeMatch
      ?.slice(1)
      .find((value) => value !== undefined)
      ?.trim() ?? "";
  const type = rawType.split(";")[0]?.trim() ?? "";
  if (type === "" || JAVASCRIPT_MIME_TYPE_PATTERN.test(type)) return ".js";
  return type.toLowerCase() === "module" ? ".mjs" : null;
};

const createWhitespaceSourceBuffer = (sourceBuffer: Buffer): Buffer => {
  const extractedBuffer = Buffer.alloc(sourceBuffer.length, SPACE_UTF8_BYTE);
  for (let byteIndex = 0; byteIndex < sourceBuffer.length; byteIndex++) {
    const byte = sourceBuffer[byteIndex];
    if (byte === LINE_FEED_UTF8_BYTE || byte === CARRIAGE_RETURN_UTF8_BYTE) {
      extractedBuffer[byteIndex] = byte;
    }
  }
  return extractedBuffer;
};

const findNextScriptOpenTag = (
  sourceText: string,
  scriptOrCommentPattern: RegExp,
): RegExpExecArray | null => {
  let boundaryMatch = scriptOrCommentPattern.exec(sourceText);
  while (boundaryMatch !== null && boundaryMatch[0] === "<!--") {
    const commentEndIndex = sourceText.indexOf(HTML_COMMENT_END, scriptOrCommentPattern.lastIndex);
    if (commentEndIndex === -1) return null;
    scriptOrCommentPattern.lastIndex = commentEndIndex + HTML_COMMENT_END.length;
    boundaryMatch = scriptOrCommentPattern.exec(sourceText);
  }
  return boundaryMatch;
};

export const extractHtmlScriptSources = (sourceText: string): ExtractedHtmlScriptSource[] => {
  const sourceBuffer = Buffer.from(sourceText);
  const extractedSources: ExtractedHtmlScriptSource[] = [];
  const scriptOrCommentPattern = /<!--|<script\b/gi;
  const scriptCloseTagPattern = /<\/script\s*>/gi;
  let openTagMatch = findNextScriptOpenTag(sourceText, scriptOrCommentPattern);

  while (openTagMatch !== null) {
    const openTagEndIndex = findTagEnd(sourceText, scriptOrCommentPattern.lastIndex);
    if (openTagEndIndex === null) break;
    scriptCloseTagPattern.lastIndex = openTagEndIndex + 1;
    const closeTagMatch = scriptCloseTagPattern.exec(sourceText);
    if (closeTagMatch === null) break;

    const attributes = sourceText.slice(scriptOrCommentPattern.lastIndex, openTagEndIndex);
    const extension = resolveScriptExtension(attributes);
    const bodyStartIndex = openTagEndIndex + 1;
    const bodyEndIndex = closeTagMatch.index;
    const body = sourceText.slice(bodyStartIndex, bodyEndIndex);
    if (extension !== null && body.trim().length > 0) {
      const bodyStartByte = Buffer.byteLength(sourceText.slice(0, bodyStartIndex));
      const bodyEndByte = bodyStartByte + Buffer.byteLength(body);
      const extractedBuffer = createWhitespaceSourceBuffer(sourceBuffer);
      sourceBuffer.copy(extractedBuffer, bodyStartByte, bodyStartByte, bodyEndByte);
      extractedSources.push({ content: extractedBuffer, extension });
    }

    scriptOrCommentPattern.lastIndex = scriptCloseTagPattern.lastIndex;
    openTagMatch = findNextScriptOpenTag(sourceText, scriptOrCommentPattern);
  }

  return extractedSources;
};
