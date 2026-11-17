import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";
import {
  REACT_MARKDOWN_LARGE_LOOKUP_COUNT,
  REACT_MARKDOWN_MAXIMUM_WORK_MULTIPLIER,
  REACT_MARKDOWN_SMALL_LOOKUP_COUNT,
} from "./utils/constants.js";
import { isReactMarkdownCodeClassname } from "./utils/is-react-markdown-code-classname.js";

const measureProofWork = (lookupCount: number, hasSeparateRenderers: boolean): number => {
  const lookup = 'className.includes("language-sample");';
  const renderer = (count: number): string =>
    `<Markdown components={{code({className}){${lookup.repeat(count)}return <code/>;}}}>{block}</Markdown>`;
  const renderers = hasSeparateRenderers
    ? Array.from({ length: lookupCount }, () => renderer(1)).join("")
    : renderer(lookupCount);
  const code = `import Markdown from "react-markdown"; export const Example=({blocks})=><section>{blocks.map(block=><section>${renderers}</section>)}</section>;`;
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const nodes: EsTreeNode[] = [];
  const identifiers: Array<EsTreeNodeOfType<"Identifier">> = [];
  walkAst(parsed.program, (node) => {
    nodes.push(node);
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "className" &&
      isNodeOfType(node.parent, "MemberExpression") &&
      node.parent.object === node
    ) {
      identifiers.push(node);
    }
  });
  let typeReads = 0;
  for (const node of nodes) {
    const originalType = node.type;
    Object.defineProperty(node, "type", {
      configurable: true,
      enumerable: true,
      get: () => {
        typeReads++;
        return originalType;
      },
    });
  }
  expect(identifiers).toHaveLength(lookupCount);
  expect(identifiers.every((identifier) => isReactMarkdownCodeClassname(identifier, scopes))).toBe(
    true,
  );
  expect(typeReads).toBeGreaterThan(lookupCount);
  const result = runRule(jsSetMapLookups, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
  const foreign = runRule(
    jsSetMapLookups,
    code.replace('from "react-markdown"', 'from "example-ui"'),
  );
  expect(foreign.parseErrors).toEqual([]);
  expect(foreign.diagnostics).toHaveLength(lookupCount);
  return typeReads;
};

describe("ReactMarkdown code className proof scaling", () => {
  it.each([false, true])(
    "bounds syntax work with separate renderers=%s",
    (hasSeparateRenderers) => {
      const smallWork = measureProofWork(REACT_MARKDOWN_SMALL_LOOKUP_COUNT, hasSeparateRenderers);
      const largeWork = measureProofWork(REACT_MARKDOWN_LARGE_LOOKUP_COUNT, hasSeparateRenderers);
      expect(largeWork).toBeGreaterThan(smallWork);
      expect(largeWork).toBeLessThan(smallWork * REACT_MARKDOWN_MAXIMUM_WORK_MULTIPLIER);
    },
  );
});
