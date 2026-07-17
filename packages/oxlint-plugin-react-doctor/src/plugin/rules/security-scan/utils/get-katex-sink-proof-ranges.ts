import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getKatexHtmlProof, registerKatexProofSource } from "./get-katex-html-proof.js";
import type { KatexHtmlProof } from "./get-katex-html-proof.js";

interface KatexSinkProofRange {
  readonly endIndex: number;
  readonly proof: KatexHtmlProof;
  readonly startIndex: number;
}

const getDangerouslySetInnerHtmlExpression = (attribute: EsTreeNode): EsTreeNode | null => {
  let objectExpression: EsTreeNode | null = null;
  if (
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "dangerouslySetInnerHTML" &&
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "ObjectExpression")
  ) {
    objectExpression = attribute.value.expression;
  }
  if (
    isNodeOfType(attribute, "Property") &&
    getStaticPropertyKeyName(attribute, { allowComputedString: true }) ===
      "dangerouslySetInnerHTML" &&
    isNodeOfType(stripParenExpression(attribute.value), "ObjectExpression")
  ) {
    objectExpression = stripParenExpression(attribute.value);
  }
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return null;

  let htmlExpression: EsTreeNode | null = null;
  for (const property of objectExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      htmlExpression = null;
      continue;
    }
    if (!isNodeOfType(property, "Property")) {
      htmlExpression = null;
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) {
      htmlExpression = null;
      continue;
    }
    if (propertyName === "__html") htmlExpression = property.value;
  }
  return htmlExpression;
};

export const collectKatexSinkProofRanges = (
  fileContent: string,
  filename: string,
): KatexSinkProofRange[] => {
  const program = parseSourceText({ filename, sourceText: fileContent });
  if (program === null) return [];
  const scopes = analyzeScopes(program);
  registerKatexProofSource(scopes, filename, 0);
  const ranges: KatexSinkProofRange[] = [];
  walkAst(program, (node) => {
    const htmlExpression = getDangerouslySetInnerHtmlExpression(node);
    if (htmlExpression === null) return;
    const proof = getKatexHtmlProof(htmlExpression, scopes, new Set());
    if (!proof.containsKatex) return;
    const startIndex = getNodeStartIndex(node);
    const endIndex = getNodeEndIndex(node);
    if (startIndex < 0 || endIndex < 0) return;
    ranges.push({ endIndex, proof, startIndex });
  });
  return ranges;
};
