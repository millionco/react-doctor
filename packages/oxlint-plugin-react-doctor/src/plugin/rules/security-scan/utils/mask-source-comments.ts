import { parseSync } from "oxc-parser";
import { resolveLang } from "../../../utils/parse-source-file.js";

const SOURCE_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;

export const maskSourceComments = (relativePath: string, content: string): string => {
  if (!SOURCE_FILE_EXTENSION_PATTERN.test(relativePath)) return content;
  try {
    const result = parseSync(relativePath, content, {
      astType: "ts",
      lang: resolveLang(relativePath),
    });
    if (result.errors.some((parseError) => parseError.severity === "Error")) return content;
    if (result.comments.length === 0) return content;

    const contentParts: string[] = [];
    let previousEnd = 0;
    for (const comment of result.comments) {
      contentParts.push(content.slice(previousEnd, comment.start));
      contentParts.push(content.slice(comment.start, comment.end).replace(/[^\r\n]/g, " "));
      previousEnd = comment.end;
    }
    contentParts.push(content.slice(previousEnd));
    return contentParts.join("");
  } catch {
    return content;
  }
};
