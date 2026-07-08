import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: HTML-injection sinks (dangerouslySetInnerHTML,
// innerHTML/outerHTML, insertAdjacentHTML, setHTMLUnsafe) fed a
// dynamic-looking value. Content-scan rule — variants probe sink
// spellings and taint-naming heuristics.
export const dangerousHtmlSinkCases: FnMiningCase[] = [
  {
    ruleId: "dangerous-html-sink",
    description: "canonical: element.innerHTML = props.markdown",
    filePath: "src/components/preview.ts",
    code: `
      export const renderPreview = (element: HTMLElement, props: PreviewProps) => {
        element.innerHTML = props.markdown;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "dangerous-html-sink",
    description: "dangerouslySetInnerHTML={{ __html: comment.body }}",
    filePath: "src/components/comment.tsx",
    code: `
      export const Comment = ({ comment }: CommentProps) => (
        <div dangerouslySetInnerHTML={{ __html: comment.body }} />
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "dangerous-html-sink",
    description: "bare identifier with no taint-looking name: element.innerHTML = commentMarkup",
    filePath: "src/components/comment.ts",
    code: `
      export const renderComment = (element: HTMLElement, commentMarkup: string) => {
        element.innerHTML = commentMarkup;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "dangerous-html-sink",
    description: 'bracket-notation sink: element["innerHTML"] = props.bio',
    filePath: "src/components/bio.ts",
    code: `
      export const renderBio = (element: HTMLElement, props: BioProps) => {
        element["innerHTML"] = props.bio;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "dangerous-html-sink",
    description: "insertAdjacentHTML with a URL-derived value",
    filePath: "src/components/banner.ts",
    code: `
      export const showBanner = (element: HTMLElement, route: Route) => {
        element.insertAdjacentHTML("beforeend", route.query.message);
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "dangerous-html-sink",
    description: 'jQuery-style sink: $container.html(searchParams.get("q"))',
    filePath: "src/components/results.ts",
    code: `
      export const showResults = ($container: JQuery, searchParams: URLSearchParams) => {
        $container.html(searchParams.get("q"));
      };
    `,
    shouldFire: false,
    carveOutReason:
      "The rule's docs enumerate its sink set (React + native DOM HTML sinks); jQuery is out of scope. `.html(` is far too generic for a regex scan — cheerio, builders, and unrelated `.html()` getters/setters would flood a React-focused linter with FPs.",
  },
  {
    ruleId: "dangerous-html-sink",
    description: "setHTMLUnsafe(location.hash)",
    filePath: "src/components/anchor.ts",
    code: `
      export const jumpToAnchor = (element: HTMLElement) => {
        element.setHTMLUnsafe(location.hash);
      };
    `,
    shouldFire: true,
  },
];
