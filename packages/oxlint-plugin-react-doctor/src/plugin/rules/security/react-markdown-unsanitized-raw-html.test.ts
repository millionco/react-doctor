import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactMarkdownUnsanitizedRawHtml } from "./react-markdown-unsanitized-raw-html.js";

const runReactMarkdownRule = (source: string) =>
  runRule(reactMarkdownUnsanitizedRawHtml, source, { filename: "src/markdown.tsx" });

describe("react-markdown-unsanitized-raw-html", () => {
  it.each([
    {
      name: "direct imports",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "renamed default imports and exact const aliases",
      source: `
        import Renderer from "react-markdown";
        import parseHtml from "rehype-raw";
        const Markdown = Renderer;
        const raw = parseHtml;
        const plugins = [raw] as const;
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={plugins}>{content}</Markdown>
        );
      `,
    },
    {
      name: "namespace imports",
      source: `
        import * as Markdown from "react-markdown";
        import * as Raw from "rehype-raw";
        export const Preview = ({ content }) => (
          <Markdown.default rehypePlugins={[Raw.default]}>{content}</Markdown.default>
        );
      `,
    },
    {
      name: "named async React Markdown export",
      source: `
        import { MarkdownAsync as AsyncRenderer } from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content }) => (
          <AsyncRenderer rehypePlugins={[[raw, { passThrough: ["custom"] }]]}>
            {content}
          </AsyncRenderer>
        );
      `,
    },
    {
      name: "statically resolved plugin spreads",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import katex from "rehype-katex";
        const basePlugins = [katex];
        const plugins = [...basePlugins, raw];
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={plugins}>{content}</Markdown>
        );
      `,
    },
    {
      name: "a repeated statically resolved spread",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import katex from "rehype-katex";
        const basePlugins = [katex];
        const plugins = [...basePlugins, ...basePlugins, raw];
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={plugins}>{content}</Markdown>
        );
      `,
    },
    {
      name: "skipHtml because rehype-raw consumes raw nodes first",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content }) => (
          <Markdown skipHtml={true} rehypePlugins={[raw]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "an explicit plugin prop after an unknown JSX spread",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content, options }) => (
          <Markdown {...options} rehypePlugins={[raw]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "children prop",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]} children={content} />
        );
      `,
    },
    {
      name: "member-expression children with sibling plugin props",
      source: `
        import type { Components } from "react-markdown";
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import gfm from "remark-gfm";
        export const Preview = (props: { children?: string; components?: Components }) => (
          <Markdown
            rehypePlugins={[raw]}
            remarkPlugins={[gfm]}
            components={props.components}
          >
            {props.children}
          </Markdown>
        );
      `,
    },
    {
      name: "userland sanitizer and DOMPurify lookalikes",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        const rehypeSanitize = () => {};
        const DOMPurify = { sanitize: (value) => value };
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw, rehypeSanitize]}>
            {DOMPurify.sanitize(content)}
          </Markdown>
        );
      `,
    },
  ])("reports $name", ({ source }) => {
    const result = runReactMarkdownRule(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a rehype-sanitize plugin after rehype-raw",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import sanitize from "rehype-sanitize";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw, [sanitize, { clobberPrefix: "safe-" }]]}>
            {content}
          </Markdown>
        );
      `,
    },
    {
      name: "a rehype-sanitize plugin before rehype-raw",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import sanitize from "rehype-sanitize";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[sanitize, raw]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "a sanitizer hidden in a statically resolved spread",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import sanitize from "rehype-sanitize";
        const safetyPlugins = [[sanitize, {}]];
        const plugins = [raw, ...safetyPlugins];
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={plugins}>{content}</Markdown>
        );
      `,
    },
    {
      name: "namespace and const aliases of rehype-sanitize",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import * as Sanitize from "rehype-sanitize";
        const sanitizer = Sanitize.default;
        const sanitizerTuple = [sanitizer, { clobberPrefix: "safe-" }] as const;
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw, sanitizerTuple]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "DOMPurify-sanitized input",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import DOMPurify from "dompurify";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]}>{DOMPurify.sanitize(content)}</Markdown>
        );
      `,
    },
    {
      name: "namespace DOMPurify-sanitized input",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import * as DOMPurify from "isomorphic-dompurify";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]} children={DOMPurify.sanitize(content)} />
        );
      `,
    },
    {
      name: "a const alias of a DOMPurify-sanitized input",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import ImportedDOMPurify from "isomorphic-dompurify";
        const DOMPurify = ImportedDOMPurify;
        export const Preview = ({ content }) => {
          const safeContent = DOMPurify.sanitize(content);
          return <Markdown rehypePlugins={[raw]}>{safeContent}</Markdown>;
        };
      `,
    },
    {
      name: "literal JSX children",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = () => (
          <Markdown rehypePlugins={[raw]}>{"<details>trusted docs</details>"}</Markdown>
        );
      `,
    },
    {
      name: "a static const child",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        const CONTENT = "<details>trusted docs</details>";
        export const Preview = () => <Markdown rehypePlugins={[raw]}>{CONTENT}</Markdown>;
      `,
    },
    {
      name: "a static concatenation and non-string literal child",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        const TAG = "details";
        export const Preview = () => (
          <>
            <Markdown rehypePlugins={[raw]}>{"<" + TAG + ">trusted docs</" + TAG + ">"}</Markdown>
            <Markdown rehypePlugins={[raw]}>{0}</Markdown>
          </>
        );
      `,
    },
    {
      name: "no rehype-raw plugin",
      source: `
        import Markdown from "react-markdown";
        import gfm from "remark-gfm";
        export const Preview = ({ content }) => (
          <Markdown remarkPlugins={[gfm]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "an unresolved plugin spread that could contain a sanitizer",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content, safetyPlugins }) => (
          <Markdown rehypePlugins={[raw, ...safetyPlugins]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "a later unknown JSX spread that can override rehypePlugins",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content, options }) => (
          <Markdown rehypePlugins={[raw]} {...options}>{content}</Markdown>
        );
      `,
    },
    {
      name: "a userland component and plugin with matching names",
      source: `
        const ReactMarkdown = ({ children }) => <div>{children}</div>;
        const rehypeRaw = () => {};
        export const Preview = ({ content }) => (
          <ReactMarkdown rehypePlugins={[rehypeRaw]}>{content}</ReactMarkdown>
        );
      `,
    },
    {
      name: "a shadowed React Markdown import",
      source: `
        import ImportedMarkdown from "react-markdown";
        import raw from "rehype-raw";
        export const Preview = ({ content }) => {
          const ImportedMarkdown = ({ children }) => <div>{children}</div>;
          return <ImportedMarkdown rehypePlugins={[raw]}>{content}</ImportedMarkdown>;
        };
      `,
    },
    {
      name: "a shadowed rehype-raw import",
      source: `
        import Markdown from "react-markdown";
        import importedRaw from "rehype-raw";
        export const Preview = ({ content }) => {
          const importedRaw = () => {};
          return <Markdown rehypePlugins={[importedRaw]}>{content}</Markdown>;
        };
      `,
    },
    {
      name: "a same-named import from another package",
      source: `
        import Markdown from "my-react-markdown";
        import raw from "my-rehype-raw";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "reassignable plugin and component aliases",
      source: `
        import ImportedMarkdown from "react-markdown";
        import importedRaw from "rehype-raw";
        let Markdown = ImportedMarkdown;
        let raw = importedRaw;
        Markdown = CustomMarkdown;
        raw = customPlugin;
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]}>{content}</Markdown>
        );
      `,
    },
    {
      name: "a plugin prop overridden by a later safe explicit prop",
      source: `
        import Markdown from "react-markdown";
        import raw from "rehype-raw";
        import sanitize from "rehype-sanitize";
        export const Preview = ({ content }) => (
          <Markdown rehypePlugins={[raw]} rehypePlugins={[raw, sanitize]}>
            {content}
          </Markdown>
        );
      `,
    },
  ])("stays quiet for $name", ({ source }) => {
    const result = runReactMarkdownRule(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
