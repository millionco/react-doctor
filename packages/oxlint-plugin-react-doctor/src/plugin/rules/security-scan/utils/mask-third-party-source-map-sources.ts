const SOURCE_MAP_FILE_PATTERN = /\.map$/i;
const JSON_WHITESPACE_PATTERN = /\s/;
const LINE_TERMINATOR_PATTERN = /[^\r\n\u2028\u2029]/g;
const JSON_NULL = "null";

interface JsonRange {
  start: number;
  end: number;
}

const skipJsonWhitespace = (content: string, start: number): number => {
  let index = start;
  while (index < content.length && JSON_WHITESPACE_PATTERN.test(content[index] ?? "")) index += 1;
  return index;
};

const findJsonStringEnd = (content: string, start: number): number | undefined => {
  if (content[start] !== '"') return undefined;
  let index = start + 1;
  while (index < content.length) {
    if (content[index] === "\\") {
      index += 2;
      continue;
    }
    if (content[index] === '"') return index + 1;
    index += 1;
  }
  return undefined;
};

const findJsonValueEnd = (content: string, start: number): number | undefined => {
  const valueStart = skipJsonWhitespace(content, start);
  if (content[valueStart] === '"') return findJsonStringEnd(content, valueStart);
  if (content[valueStart] !== "[" && content[valueStart] !== "{") {
    let index = valueStart;
    while (index < content.length && ![",", "]", "}"].includes(content[index] ?? "")) index += 1;
    return index;
  }

  const closingTokens: string[] = [content[valueStart] === "[" ? "]" : "}"];
  let index = valueStart + 1;
  while (index < content.length && closingTokens.length > 0) {
    if (content[index] === '"') {
      const stringEnd = findJsonStringEnd(content, index);
      if (stringEnd === undefined) return undefined;
      index = stringEnd;
      continue;
    }
    if (content[index] === "[") closingTokens.push("]");
    if (content[index] === "{") closingTokens.push("}");
    if (content[index] === closingTokens.at(-1)) closingTokens.pop();
    index += 1;
  }
  return closingTokens.length === 0 ? index : undefined;
};

const findTopLevelPropertyValueStart = (
  content: string,
  propertyName: string,
): number | undefined => {
  let index = skipJsonWhitespace(content, 0);
  if (content[index] !== "{") return undefined;
  index = skipJsonWhitespace(content, index + 1);

  let propertyValueStart: number | undefined;
  while (index < content.length && content[index] !== "}") {
    const keyEnd = findJsonStringEnd(content, index);
    if (keyEnd === undefined) return undefined;
    const key = JSON.parse(content.slice(index, keyEnd));
    index = skipJsonWhitespace(content, keyEnd);
    if (content[index] !== ":") return undefined;
    index = skipJsonWhitespace(content, index + 1);
    if (key === propertyName) {
      if (propertyValueStart !== undefined) return undefined;
      propertyValueStart = index;
    }
    const valueEnd = findJsonValueEnd(content, index);
    if (valueEnd === undefined) return undefined;
    index = skipJsonWhitespace(content, valueEnd);
    if (content[index] === ",") {
      index = skipJsonWhitespace(content, index + 1);
      continue;
    }
    if (content[index] !== "}") return undefined;
  }
  return propertyValueStart;
};

const findSourceContentRanges = (
  content: string,
  sourcesContentStart: number,
  sourcesContent: unknown[],
): JsonRange[] | undefined => {
  let index = skipJsonWhitespace(content, sourcesContentStart);
  if (content[index] !== "[") return undefined;
  index = skipJsonWhitespace(content, index + 1);

  const ranges: JsonRange[] = [];
  for (const sourceContent of sourcesContent) {
    if (typeof sourceContent === "string") {
      const end = findJsonStringEnd(content, index);
      if (end === undefined) return undefined;
      ranges.push({ start: index, end });
      index = end;
    } else if (sourceContent === null && content.startsWith(JSON_NULL, index)) {
      ranges.push({ start: index, end: index + JSON_NULL.length });
      index += JSON_NULL.length;
    } else {
      return undefined;
    }
    index = skipJsonWhitespace(content, index);
    if (content[index] === ",") {
      index = skipJsonWhitespace(content, index + 1);
      continue;
    }
  }
  return content[index] === "]" ? ranges : undefined;
};

const isThirdPartySource = (sourceRoot: string, source: string): boolean =>
  `${sourceRoot}/${source}`.split(/[\\/]/).includes("node_modules");

export const maskThirdPartySourceMapSources = (relativePath: string, content: string): string => {
  if (!SOURCE_MAP_FILE_PATTERN.test(relativePath) || !content.includes('"sourcesContent"')) {
    return content;
  }

  try {
    const sourceMap = JSON.parse(content);
    if (typeof sourceMap !== "object" || sourceMap === null || Array.isArray(sourceMap)) {
      return content;
    }
    const sources = Reflect.get(sourceMap, "sources");
    const sourcesContent = Reflect.get(sourceMap, "sourcesContent");
    const sourceRootValue = Reflect.get(sourceMap, "sourceRoot");
    if (
      !Array.isArray(sources) ||
      !sources.every((source) => typeof source === "string") ||
      !Array.isArray(sourcesContent) ||
      sources.length !== sourcesContent.length ||
      (sourceRootValue !== undefined && typeof sourceRootValue !== "string")
    ) {
      return content;
    }

    const sourcesContentStart = findTopLevelPropertyValueStart(content, "sourcesContent");
    if (sourcesContentStart === undefined) return content;
    const sourceContentRanges = findSourceContentRanges(
      content,
      sourcesContentStart,
      sourcesContent,
    );
    if (sourceContentRanges === undefined) return content;

    const sourceRoot = sourceRootValue ?? "";
    const contentParts: string[] = [];
    let previousEnd = 0;
    for (const [sourceIndex, source] of sources.entries()) {
      if (!isThirdPartySource(sourceRoot, source)) continue;
      const sourceContentRange = sourceContentRanges[sourceIndex];
      if (sourceContentRange === undefined) return content;
      contentParts.push(content.slice(previousEnd, sourceContentRange.start));
      contentParts.push(
        content
          .slice(sourceContentRange.start, sourceContentRange.end)
          .replace(LINE_TERMINATOR_PATTERN, " "),
      );
      previousEnd = sourceContentRange.end;
    }
    if (previousEnd === 0) return content;
    contentParts.push(content.slice(previousEnd));
    return contentParts.join("");
  } catch {
    return content;
  }
};
