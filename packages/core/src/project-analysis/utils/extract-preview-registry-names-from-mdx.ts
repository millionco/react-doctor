import { fromMarkdown } from "mdast-util-from-markdown";
import {
  mdxJsxFromMarkdown,
  type MdxJsxAttribute,
  type MdxJsxAttributeValueExpression,
} from "mdast-util-mdx-jsx";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxExpressionFromMarkdown } from "mdast-util-mdx-expression";
import { parseSync } from "oxc-parser";
import type { Nodes } from "mdast";

const REGISTRY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const maskHtmlComments = (sourceText: string): string => {
  const maskedSource = sourceText.split("");

  const visitNode = (node: Nodes): void => {
    const shouldMask = node.type === "html" && node.value.trimStart().startsWith("<!--");
    const startOffset = node.position?.start.offset;
    const endOffset = node.position?.end.offset;
    if (shouldMask && startOffset !== undefined && endOffset !== undefined) {
      for (let characterIndex = startOffset; characterIndex < endOffset; characterIndex++) {
        const character = sourceText[characterIndex];
        maskedSource[characterIndex] = character === "\n" || character === "\r" ? character : " ";
      }
    }
    if ("children" in node) {
      for (const childNode of node.children) visitNode(childNode);
    }
  };

  visitNode(fromMarkdown(sourceText));
  return maskedSource.join("");
};

const extractStaticStringExpression = (
  expression: MdxJsxAttributeValueExpression,
): string | undefined => {
  const parsed = parseSync("registry-name.ts", `const registryName = (${expression.value})`);
  if (parsed.errors.length > 0) return undefined;
  const statement = parsed.program.body[0];
  if (statement?.type !== "VariableDeclaration") return undefined;
  const initializer = statement.declarations[0]?.init;
  if (!initializer) return undefined;
  const expressionNode =
    initializer.type === "ParenthesizedExpression" ? initializer.expression : initializer;
  return expressionNode.type === "Literal" && typeof expressionNode.value === "string"
    ? expressionNode.value
    : undefined;
};

const extractRegistryName = (attribute: MdxJsxAttribute): string | undefined => {
  if (attribute.name !== "registryName") return undefined;
  if (typeof attribute.value === "string") return attribute.value;
  return attribute.value?.type === "mdxJsxAttributeValueExpression"
    ? extractStaticStringExpression(attribute.value)
    : undefined;
};

export const extractPreviewRegistryNamesFromMdx = (sourceText: string): string[] => {
  const registryNames = new Set<string>();
  try {
    const markdownTree = fromMarkdown(maskHtmlComments(sourceText), {
      extensions: [mdxJsx(), mdxExpression()],
      mdastExtensions: [mdxJsxFromMarkdown(), mdxExpressionFromMarkdown()],
    });

    const visitNode = (node: Nodes): void => {
      if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        node.name === "PreviewComponents"
      ) {
        for (const attribute of node.attributes) {
          if (attribute.type !== "mdxJsxAttribute") continue;
          const registryName = extractRegistryName(attribute);
          if (registryName && REGISTRY_NAME_PATTERN.test(registryName)) {
            registryNames.add(registryName);
          }
        }
      }
      if ("children" in node) {
        for (const childNode of node.children) visitNode(childNode);
      }
    };

    visitNode(markdownTree);
  } catch {}
  return [...registryNames];
};
