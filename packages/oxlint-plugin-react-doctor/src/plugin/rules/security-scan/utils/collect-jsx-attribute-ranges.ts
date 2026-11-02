import type { ScannedFile } from "../../../utils/file-scan.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";
import { walkAst } from "../../../utils/walk-ast.js";

export interface JsxAttributeRange {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly nestedAttributes: JsxAttributeRange[];
}

export const collectJsxAttributeRanges = (file: ScannedFile): Map<number, JsxAttributeRange> => {
  const attributes = new Map<number, JsxAttributeRange>();
  const program = parseSourceText({
    filename: file.absolutePath,
    sourceText: file.content,
    shouldAttachParentReferences: false,
  });
  if (program === null) return attributes;
  const ranges: JsxAttributeRange[] = [];
  walkAst(program, (node) => {
    if (node.type !== "JSXAttribute" && node.type !== "JSXSpreadAttribute") return;
    const startIndex = getNodeStartIndex(node);
    const endIndex = getNodeEndIndex(node);
    if (startIndex < 0 || endIndex <= startIndex) return;
    ranges.push({
      startIndex,
      endIndex,
      nestedAttributes: [],
    });
  });
  ranges.sort(
    (leftAttribute, rightAttribute) => leftAttribute.startIndex - rightAttribute.startIndex,
  );
  const ancestors: JsxAttributeRange[] = [];
  for (const attribute of ranges) {
    while (
      ancestors.length > 0 &&
      ancestors[ancestors.length - 1].endIndex <= attribute.startIndex
    ) {
      ancestors.pop();
    }
    ancestors[ancestors.length - 1]?.nestedAttributes.push(attribute);
    ancestors.push(attribute);
    attributes.set(attribute.startIndex, attribute);
  }
  return attributes;
};
