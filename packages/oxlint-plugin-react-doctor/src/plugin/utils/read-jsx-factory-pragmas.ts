import { getNodeStartIndex } from "./get-node-start-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleSourceComment } from "./rule-context.js";

export interface JsxFactoryPragmas {
  readonly elementFactory: string;
  readonly fragmentFactory: string;
}

const JSX_FACTORY_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const JSX_DIRECTIVE_LINE =
  /^[^\S\r\n]*(?:\*[^\S\r\n]*)?@(jsx|jsxFrag|jsxRuntime|jsxImportSource)\b([^\r\n]*)/gim;
const JSX_DIRECTIVE_TOKEN = /@(jsx|jsxFrag|jsxRuntime|jsxImportSource)\b/gi;
const JSX_DIRECTIVE_NAMES = new Set(["jsx", "jsxFrag", "jsxRuntime", "jsxImportSource"]);

export const readJsxFactoryPragmas = (
  program: EsTreeNode,
  comments: ReadonlyArray<RuleSourceComment>,
): JsxFactoryPragmas | null => {
  if (program.type !== "Program") return null;
  const firstStatement = program.body[0];
  if (!firstStatement) return null;
  const firstStatementStart = getNodeStartIndex(firstStatement);
  if (firstStatementStart < 0) return null;

  let elementFactory: string | undefined;
  let fragmentFactory = "React.Fragment";
  const seenDirectives = new Set<string>();
  for (const comment of comments) {
    const matches = [...comment.value.matchAll(JSX_DIRECTIVE_LINE)];
    if (matches.length !== (comment.value.match(JSX_DIRECTIVE_TOKEN) ?? []).length) return null;
    for (const match of matches) {
      const [, directive, rawValue] = match;
      const commentEnd = comment.range?.[1] ?? comment.end;
      if (
        comment.type !== "Block" ||
        !directive ||
        !JSX_DIRECTIVE_NAMES.has(directive) ||
        rawValue === undefined ||
        commentEnd === undefined ||
        commentEnd > firstStatementStart ||
        seenDirectives.has(directive)
      ) {
        return null;
      }
      seenDirectives.add(directive);
      const value = rawValue.trim();
      if (directive === "jsxImportSource") return null;
      if (directive === "jsxRuntime") {
        if (value !== "classic") return null;
        continue;
      }
      if (!JSX_FACTORY_PATH.test(value)) return null;
      if (directive === "jsx") elementFactory = value;
      if (directive === "jsxFrag") fragmentFactory = value;
    }
  }
  return elementFactory ? { elementFactory, fragmentFactory } : null;
};
