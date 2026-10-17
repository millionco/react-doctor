import { HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS } from "../../../constants/security-scan.js";
import type { JsxAttributeRange } from "./collect-jsx-attribute-ranges.js";

interface FindOwnJsxAttributeJsonCallEndInput {
  readonly content: string;
  readonly attribute: JsxAttributeRange;
  readonly startIndex: number;
}

const JSON_STRINGIFY_NAME_PATTERN = /\bJSON\.stringify/gi;
const WHITESPACE_PATTERN = /\s/;

export const findOwnJsxAttributeJsonCallEnd = ({
  content,
  attribute,
  startIndex,
}: FindOwnJsxAttributeJsonCallEndInput): number | undefined => {
  const searchWindow = content.slice(
    startIndex,
    Math.min(
      attribute.endIndex,
      startIndex + HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS + "JSON.stringify".length,
    ),
  );
  JSON_STRINGIFY_NAME_PATTERN.lastIndex = 0;
  let nestedAttributeIndex = 0;
  for (const match of searchWindow.matchAll(JSON_STRINGIFY_NAME_PATTERN)) {
    if (match.index > HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS) break;
    const tokenStartIndex = startIndex + match.index;
    while (
      nestedAttributeIndex < attribute.nestedAttributes.length &&
      attribute.nestedAttributes[nestedAttributeIndex].endIndex <= tokenStartIndex
    ) {
      nestedAttributeIndex += 1;
    }
    const nestedAttribute = attribute.nestedAttributes[nestedAttributeIndex];
    if (nestedAttribute !== undefined && nestedAttribute.startIndex <= tokenStartIndex) continue;
    let callEndIndex = tokenStartIndex + match[0].length;
    while (callEndIndex < attribute.endIndex && WHITESPACE_PATTERN.test(content[callEndIndex])) {
      callEndIndex += 1;
    }
    if (content[callEndIndex] === "(") return callEndIndex + 1;
  }
  return undefined;
};
