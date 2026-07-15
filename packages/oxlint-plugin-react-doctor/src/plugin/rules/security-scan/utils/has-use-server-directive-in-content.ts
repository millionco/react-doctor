import { hasDirective } from "../../../utils/has-directive.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";

export const hasUseServerDirectiveInContent = (
  content: string,
  relativePath = "source.tsx",
): boolean => {
  const programNode = parseSourceText({
    filename: relativePath,
    sourceText: content,
    shouldAttachParentReferences: false,
  });
  return programNode === null ? false : hasDirective(programNode, "use server");
};
