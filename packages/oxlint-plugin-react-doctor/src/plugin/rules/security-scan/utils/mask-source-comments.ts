import { parseSync } from "oxc-parser";
import { resolveLang } from "../../../utils/parse-source-file.js";

const SOURCE_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;

export const maskSourceComments = (relativePath: string, content: string): string => {
  if (!SOURCE_FILE_EXTENSION_PATTERN.test(relativePath)) return content;
  if (!content.startsWith("#!") && !content.includes("//") && !content.includes("/*")) {
    return content;
  }
  try {
    const result = parseSync(relativePath, content, {
      astType: "ts",
      lang: resolveLang(relativePath),
    });
    if (result.errors.some((parseError) => parseError.severity === "Error")) return content;
    const firstLineTerminatorIndex = content.search(/[\r\n]/);
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
        content.slice(ignoredRange.start, ignoredRange.end).replace(/[^\r\n]/g, " "),
      );
      previousEnd = ignoredRange.end;
    }
    contentParts.push(content.slice(previousEnd));
    return contentParts.join("");
  } catch {
    return content;
  }
};
