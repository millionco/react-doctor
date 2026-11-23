import type { EsTreeNode } from "../es-tree-node.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { parseSourceText } from "../parse-source-file.js";
import { stripGroupingParens } from "../strip-grouping-parens.js";

// Ordinary SVG geometry and text. Specialized embedding or animation can
// have different data or runtime requirements.
const STATIC_SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "title",
  "desc",
  "text",
  "tspan",
]);
const SVG_XML_DECLARATION =
  /^\s*<\?xml\s+version=(["'])1\.0\1(?:\s+encoding=(["'])utf-8\2)?(?:\s+standalone=(["'])(?:yes|no)\3)?\s*\?>/iu;
const LOCAL_URL = /^url\(\s*#[A-Za-z0-9_.:-]+\s*\)$/u;

const attributeName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "JSXIdentifier")) return node.name;
  if (isNodeOfType(node, "JSXNamespacedName")) return node.namespace.name + ":" + node.name.name;
  return null;
};

const isGeometry = (element: EsTreeNode, remaining: { nodes: number }, root = false): boolean => {
  if (!isNodeOfType(element, "JSXElement") || --remaining.nodes < 0) return false;
  const { name, attributes } = element.openingElement;
  if (
    !isNodeOfType(name, "JSXIdentifier") ||
    !STATIC_SVG_ELEMENTS.has(name.name) ||
    (root && name.name !== "svg")
  )
    return false;
  const seen = new Set<string>();
  for (const attribute of attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.value, "Literal") ||
      typeof attribute.value.value !== "string"
    )
      return false;
    const key = attributeName(attribute.name);
    if (!key || seen.has(key) || /^on/i.test(key)) return false;
    seen.add(key);
    const text = attribute.value.value;
    if (/\burl\s*\(/iu.test(text) && !LOCAL_URL.test(text)) return false;
    if ((key === "href" || key.endsWith(":href")) && !/^#[A-Za-z0-9_.:-]+$/u.test(text))
      return false;
  }
  return element.children.every(
    (child) => isNodeOfType(child, "JSXText") || isGeometry(child, remaining),
  );
};

// Parse a restricted SVG shape as JSX syntax only. Reject declarations other
// than the ordinary XML header, expression containers, spread and components.
export const isStaticSvgSource = (filename: string, source: string): boolean => {
  if (source.length > 1_000_000) return false;
  let invalidComment = false;
  const markup = source
    .replace(/^\ufeff/u, "")
    .replace(SVG_XML_DECLARATION, "")
    .replace(/<!--([\s\S]*?)-->/gu, (_marker, comment: string) => {
      if (comment.includes("--")) invalidComment = true;
      return "";
    })
    .trim();
  if (
    invalidComment ||
    !/^<svg(?=[\s/>])/u.test(markup) ||
    (!markup.endsWith("</svg>") && !markup.endsWith("/>")) ||
    /<!|<\?/u.test(markup) ||
    /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/u.test(markup)
  )
    return false;
  const program = parseSourceText({
    filename,
    language: "jsx",
    sourceText: "(" + markup + ")",
    shouldAttachParentReferences: false,
  });
  if (
    !isNodeOfType(program, "Program") ||
    program.body.length !== 1 ||
    !isNodeOfType(program.body[0], "ExpressionStatement")
  )
    return false;
  return isGeometry(stripGroupingParens(program.body[0].expression), { nodes: 5000 }, true);
};
