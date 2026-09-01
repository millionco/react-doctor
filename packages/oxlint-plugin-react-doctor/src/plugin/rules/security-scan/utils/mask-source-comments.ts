import { parseSync } from "oxc-parser";
import { resolveLang } from "../../../utils/parse-source-file.js";

const SOURCE_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;
const SOURCEMAP_EXTENSION_PATTERN = /\.map$/i;
const POSSIBLE_SOURCE_COMMENT_PATTERN = /\/\/|\/\*|<!--/;
const LINE_TERMINATORS = new Set(["\r", "\n", "\u2028", "\u2029"]);

interface SourceMap {
  sources?: string[];
  sourcesContent?: (string | null)[];
}

const maskSourceMapContent = (content: string): string | undefined => {
  try {
    const sourcemap = JSON.parse(content) as SourceMap;
    if (!sourcemap.sources || !sourcemap.sourcesContent) return content;
    if (sourcemap.sources.length !== sourcemap.sourcesContent.length) return content;

    let didMaskAny = false;
    const maskedSourcesContent = sourcemap.sourcesContent.map((sourceContent, index) => {
      if (sourceContent === null) return null;
      const sourcePath = sourcemap.sources?.[index] ?? "";
      if (!sourcePath.includes("node_modules")) return sourceContent;

      const syntheticPath = sourcePath.endsWith(".ts")
        ? "synthetic.ts"
        : sourcePath.endsWith(".tsx")
          ? "synthetic.tsx"
          : sourcePath.endsWith(".jsx")
            ? "synthetic.jsx"
            : sourcePath.endsWith(".mts")
              ? "synthetic.mts"
              : sourcePath.endsWith(".cts")
                ? "synthetic.cts"
                : sourcePath.endsWith(".mjs")
                  ? "synthetic.mjs"
                  : sourcePath.endsWith(".cjs")
                    ? "synthetic.cjs"
                    : "synthetic.js";

      const masked = maskSingleSource(syntheticPath, sourceContent);
      if (masked !== sourceContent && masked !== undefined) didMaskAny = true;
      return masked ?? sourceContent;
    });

    if (!didMaskAny) return content;

    return JSON.stringify({ ...sourcemap, sourcesContent: maskedSourcesContent });
  } catch {
    return content;
  }
};

const maskSingleSource = (relativePath: string, content: string): string | undefined => {
  if (
    !content.startsWith("#!") &&
    !POSSIBLE_SOURCE_COMMENT_PATTERN.test(content) &&
    !hasPossibleAnnexBClosingComment(content)
  ) {
    return content;
  }
  try {
    const result = parseSync(relativePath, content, {
      astType: "ts",
      lang: resolveLang(relativePath),
    });
    if (result.errors.some((parseError) => parseError.severity === "Error")) return undefined;
    const firstLineTerminatorIndex = content.search(/[\r\n\u2028\u2029]/);
    const hashbangRanges = content.startsWith("#!")
      ? [
          {
            start: 0,
            end: firstLineTerminatorIndex === -1 ? content.length : firstLineTerminatorIndex,
          },
        ]
      : [];
    const ignoredRanges = [...hashbangRanges, ...result.comments];
    if (ignoredRanges.length === 0) return content;

    const contentParts: string[] = [];
    let previousEnd = 0;
    for (const ignoredRange of ignoredRanges) {
      contentParts.push(content.slice(previousEnd, ignoredRange.start));
      contentParts.push(
        content.slice(ignoredRange.start, ignoredRange.end).replace(/[^\r\n\u2028\u2029]/g, " "),
      );
      previousEnd = ignoredRange.end;
    }
    contentParts.push(content.slice(previousEnd));
    return contentParts.join("");
  } catch {
    return undefined;
  }
};

const hasPossibleAnnexBClosingComment = (content: string): boolean => {
  let searchIndex = 0;
  while (searchIndex < content.length) {
    const closingCommentIndex = content.indexOf("-->", searchIndex);
    if (closingCommentIndex === -1) return false;
    let prefixIndex = closingCommentIndex - 1;
    while (prefixIndex >= 0 && !LINE_TERMINATORS.has(content[prefixIndex] ?? "")) {
      if (content[prefixIndex]?.trim() !== "") break;
      prefixIndex -= 1;
    }
    if (prefixIndex < 0 || LINE_TERMINATORS.has(content[prefixIndex] ?? "")) return true;
    searchIndex = closingCommentIndex + 3;
  }
  return false;
};

export const maskSourceComments = (relativePath: string, content: string): string | undefined => {
  if (SOURCEMAP_EXTENSION_PATTERN.test(relativePath)) {
    return maskSourceMapContent(content);
  }
  if (!SOURCE_FILE_EXTENSION_PATTERN.test(relativePath)) return content;

  return maskSingleSource(relativePath, content);
};
