import { Parser } from "acorn";
import acornJsx from "acorn-jsx";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxjsEsmFromMarkdown } from "mdast-util-mdxjs-esm";
import { mdxjsEsm } from "micromark-extension-mdxjs-esm";

const markdownAcornParser = Parser.extend(acornJsx());

const maskNonModuleContent = (sourceText: string): string => {
  const markdownTree = fromMarkdown(sourceText, {
    extensions: [mdxjsEsm({ acorn: markdownAcornParser })],
    mdastExtensions: [mdxjsEsmFromMarkdown()],
  });
  const maskedSource: string[] = sourceText
    .split("")
    .map((character) => (character === "\n" || character === "\r" ? character : " "));
  for (const child of markdownTree.children) {
    if (child.type !== "mdxjsEsm" || !child.position) continue;
    const startOffset = child.position.start.offset;
    const endOffset = child.position.end.offset;
    if (startOffset === undefined || endOffset === undefined) continue;
    for (let characterIndex = startOffset; characterIndex < endOffset; characterIndex++) {
      maskedSource[characterIndex] = sourceText[characterIndex];
    }
  }
  return maskedSource.join("");
};

export const extractMarkdownModuleStatements = (sourceText: string): string => {
  try {
    return maskNonModuleContent(sourceText);
  } catch {
    const markdownTree = fromMarkdown(sourceText);
    const maskedSource: string[] = sourceText
      .split("")
      .map((character) => (character === "\n" || character === "\r" ? character : " "));
    for (const child of markdownTree.children) {
      if (!child.position || child.type === "code" || child.type === "html") continue;
      const startOffset = child.position.start.offset;
      const endOffset = child.position.end.offset;
      if (startOffset === undefined || endOffset === undefined) continue;
      const childSource = sourceText.slice(startOffset, endOffset);
      try {
        const maskedChildSource = maskNonModuleContent(childSource);
        for (let characterIndex = 0; characterIndex < maskedChildSource.length; characterIndex++) {
          const character = maskedChildSource[characterIndex];
          if (character !== " " && character !== "\n" && character !== "\r") {
            maskedSource[startOffset + characterIndex] = character;
          }
        }
      } catch {}
    }
    return maskedSource.join("");
  }
};
