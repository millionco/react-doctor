import { parse, type DefaultTreeAdapterMap } from "parse5";

export const collectHtmlElementAttributes = (
  sourceText: string,
  tagName: string,
): ReadonlyArray<ReadonlyMap<string, string>> => {
  const attributes: Array<ReadonlyMap<string, string>> = [];

  const visitNode = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node && node.tagName.toLowerCase() === tagName.toLowerCase()) {
      attributes.push(
        new Map(node.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value])),
      );
    }
    if ("childNodes" in node) {
      for (const childNode of node.childNodes) visitNode(childNode);
    }
    if ("content" in node) visitNode(node.content);
  };

  visitNode(parse(sourceText));
  return attributes;
};
