import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

interface ReactMarkdownLookupCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedDiagnosticCount: number;
}

const cases: ReadonlyArray<ReactMarkdownLookupCase> = [
  {
    name: "canonical-code-classname-substring",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "renamed-default-provider",
    code: 'import Pretty from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Pretty  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Pretty>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "renamed-selected-classname",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className: styleText}) { return <code>{styleText?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "other-static-renderers-coexist",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className,children,...rest}) { return <code>{className?.includes("language-sample")}{children}</code>; }, a({children}) { return <a>{children}</a>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "custom-provider-classname-can-be-array",
    code: 'const Markdown=({components})=>components.code({className:["language-sample"]});\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "foreign-default-provider",
    code: 'import Markdown from "example-ui";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "typeonly-provider",
    code: 'import type Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "selected-classname-reassigned",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { className=["language-sample"]; return <code>{className.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "nested-shadow-binding-is-array",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { const read=(className)=>className.includes("language-sample"); return <code>{read(["language-sample"])}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "defaulted-selected-property",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className=["language-sample"]}) { return <code>{className.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "components-object-is-opaque",
    code: 'import Markdown from "react-markdown"; import components from "example-renderers";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={components}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "spread-may-replace-components",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown {...other} components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "duplicate-code-renderer",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }, code({className}) { return null; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "wrong-renderer-property",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{widget({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ordinary-array-must-remain-warning",
    code: "export const Example=({rows,allowed})=><section>{rows.map(row=>allowed.includes(row.id)?<i/>:null)}</section>;\n",
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "explicit-string-already-legacy-quiet",
    code: 'export const Example=({rows})=><section>{rows.map((row)=>{const text:string="language-sample";return <i>{text.includes("language-sample")}</i>;})}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "ordinary-nonoptional-string-includes",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "inline-arrow-code-renderer",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code: ({className}) => <code>{className?.includes("language-sample")}</code>}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "literal-static-code-and-classname-keys",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{"code"({"className": className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "renamed-selected-field-without-string-name-heuristic",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className: tokenStyle}) { return <code>{tokenStyle?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "provider-value-reassigned",
    code: 'import Markdown from "react-markdown";\nMarkdown = replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "provider-property-replaced",
    code: 'import Markdown from "react-markdown";\nMarkdown.render = replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "provider-escapes-to-global-carrier",
    code: 'import Markdown from "react-markdown";\nglobalThis.Renderer = Markdown;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "provider-passed-to-unknown-call",
    code: 'import Markdown from "react-markdown";\nconfigure(Markdown);\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "second-default-import-exposed",
    code: 'import Markdown from "react-markdown";\nimport Alternate from "react-markdown";\nconfigure(Alternate);\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "namespace-import-default-replacement",
    code: 'import Markdown from "react-markdown";\nimport * as MarkdownNamespace from "react-markdown";\nMarkdownNamespace.default = replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "local-parameter-shadows-canonical-provider",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks, Markdown}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "selected-destructuring-assignment",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { ({className} = source); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "selected-for-of-assignment",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { for (className of selections) { observe(className); } return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "evaluated-typescript-enum-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nenum RendererMode { Basic }\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "global-eval-reference-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nvoid eval;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "interface-masked-runtime-eval-reference",
    code: 'import Markdown from "react-markdown";\ninterface eval {}\nvoid eval;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "type-only-import-masked-runtime-eval-reference",
    code: 'import Markdown from "react-markdown";\nimport type { eval } from "example-types";\nvoid eval;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "unused-erased-type-is-allowed",
    code: 'import Markdown from "react-markdown";\ninterface RenderMetadata { mode: string }\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "duplicate-components-attribute",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown components={other} components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "computed-code-definition",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{["code"]({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "components-object-spread",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{...other, code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "async-code-callback-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{async code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "named-code-function-declines-self-exposure",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code: function renderCode({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "method-this-reference-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { void this; return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "method-arguments-reference-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { void arguments; return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "trailing-opening-spread-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}} {...other}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "multiple-supported-jsx-uses-of-same-provider",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section><Markdown>Plain</Markdown>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "indexof-membership-keeps-legacy-boundary",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className.indexOf("language-sample") !== -1}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "second-renderer-parameter-declines-new-proof",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}, extra) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "script-with-custom-provider-keeps-legacy",
    code: 'const Markdown=({components})=>components.code({className:["language-sample"]});\nconst Example = ({blocks}) => <section>{blocks.map(block => <Markdown components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\nwith (environment) { observe(Example); }\n',
    options: { filename: "renderer-script.cjs", forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-const-eval-cannot-hide-parameter-write",
    code: 'import Markdown from "react-markdown";\ndeclare const eval: (source: string) => unknown;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { eval(\'className = ["language-sample"]\'); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-function-eval-retains-global-boundary",
    code: 'import Markdown from "react-markdown";\ndeclare function eval(source: string): unknown;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { eval(\'className = ["language-sample"]\'); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-class-eval-cannot-hide-global-value",
    code: 'import Markdown from "react-markdown";\ndeclare class eval {}\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { eval(\'className = ["language-sample"]\'); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-namespace-eval-cannot-hide-global-value",
    code: 'import Markdown from "react-markdown";\ndeclare namespace eval {}\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { eval(\'className = ["language-sample"]\'); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-enum-eval-cannot-hide-global-value",
    code: 'import Markdown from "react-markdown";\ndeclare enum eval { None }\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { eval(\'className = ["language-sample"]\'); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-arguments-cannot-hide-method-reference",
    code: 'import Markdown from "react-markdown";\ndeclare const arguments: unknown;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { void arguments; return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-provider-variable-redeclaration-declines",
    code: 'import Markdown from "react-markdown";\ndeclare const Markdown: unknown;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "ambient-provider-namespace-redeclaration-declines",
    code: 'import Markdown from "react-markdown";\ndeclare namespace Markdown {}\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "inner-interface-cannot-hide-selected-write",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { { interface className {} className = ["language-sample"]; } return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "inner-typealias-cannot-hide-selected-write",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { { type className = {}; className = ["language-sample"]; } return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "renamed-selected-field-erased-collision",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className: tokenStyle}) { { interface tokenStyle {} tokenStyle = ["language-sample"]; } return <code>{tokenStyle?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "inner-interface-cannot-hide-provider-escape",
    code: 'import Markdown from "react-markdown";\n{ interface Markdown {} globalThis.Renderer = Markdown; }\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "second-default-alias-erased-exposure-declines",
    code: 'import Markdown from "react-markdown";\nimport Alternate from "react-markdown";\n{ interface Alternate {} configure(Alternate); }\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "typeonly-outer-name-does-not-hide-readonly-parameter",
    code: 'import Markdown from "react-markdown";\nimport type { className } from "example-types";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 0,
  },
  {
    name: "nested-ordinary-reset-erased-selected-write",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { function reset() { interface className {} className = ["language-sample"]; } reset(); return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "nested-ordinary-erased-provider-exposure",
    code: 'import Markdown from "react-markdown";\nfunction exposeProvider() { interface Markdown {} configure(Markdown); }\nexposeProvider();\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    options: { forceJsx: true, includeLocations: true },
    expectedDiagnosticCount: 1,
  },
  {
    name: "inert-eval-property",
    code: 'import Markdown from "react-markdown";\nconst metadata={eval:"label"};\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "inert-eval-member",
    code: 'import Markdown from "react-markdown";\nconst metadata={}; void metadata.eval;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "require-provider-replacement",
    code: 'import Markdown from "react-markdown";\nrequire("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "dynamic-provider-exposure",
    code: 'import Markdown from "react-markdown";\nimport("react-markdown").then(configure);\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "local-require-control",
    code: 'import Markdown from "react-markdown";\nconst require=()=>({default:null});require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "readonly-classname-inert-inner-interface",
    code: 'import Markdown from "react-markdown";\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { {interface className{}} return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "readonly-provider-inert-inner-interface",
    code: 'import Markdown from "react-markdown";\n{interface Markdown{}}\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
    },
  },
  {
    name: "unknown-require-provider-source",
    code: 'import Markdown from "react-markdown";\nrequire(moduleName);\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "foreign-require-provider-source",
    code: 'import Markdown from "react-markdown";\nrequire("example-ui");\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "unknown-dynamic-provider-source",
    code: 'import Markdown from "react-markdown";\nimport(moduleName);\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "foreign-dynamic-provider-source",
    code: 'import Markdown from "react-markdown";\nimport("example-ui");\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "erased-interface-require-provider-write",
    code: 'import Markdown from "react-markdown";\ninterface require {} require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "typeonly-require-provider-write",
    code: 'import Markdown from "react-markdown";\nimport type {require} from "example-types"; require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "outer-runtime-loader-survives-inner-interface",
    code: 'import Markdown from "react-markdown";\nconst require=()=>({default:null}); {interface require {} require("react-markdown").default=replacement;}\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "local-shadow-write-does-not-change-renderer-parameter",
    code: 'import Markdown from "react-markdown";\nconst reset=(className)=>{interface className{};className=[];};reset([]);\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "global-object-require-write",
    code: 'import Markdown from "react-markdown";\nglobalThis.require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "global-carrier-require-write",
    code: 'import Markdown from "react-markdown";\nconst carrier=globalThis;carrier.require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "foreign-global-require-control",
    code: 'import Markdown from "react-markdown";\nglobalThis.require("example-ui");\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "local-global-object-control",
    code: 'import Markdown from "react-markdown";\nconst globalThis={require:()=>({default:null})};globalThis.require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "erased-global-object-require-write",
    code: 'import Markdown from "react-markdown";\ninterface globalThis{} globalThis.require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "erased-global-carrier-require-write",
    code: 'import Markdown from "react-markdown";\ninterface globalThis{};const carrier=globalThis;carrier.require("react-markdown").default=replacement;\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 1,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "real-global-carrier-survives-inner-interface",
    code: 'import Markdown from "react-markdown";\nconst globalThis={require:()=>({default:null})};{interface globalThis{};const carrier=globalThis;carrier.require("react-markdown").default=replacement;}\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "foreign-erased-global-carrier-control",
    code: 'import Markdown from "react-markdown";\ninterface globalThis{};const carrier=globalThis;carrier.require("example-ui");\nexport const Example = ({blocks}) => <section>{blocks.map(block => <Markdown  components={{code({className}) { return <code>{className?.includes("language-sample")}</code>; }}}>{block}</Markdown>)}</section>;\n',
    expectedDiagnosticCount: 0,
    options: {
      forceJsx: true,
      includeLocations: true,
    },
  },
];

describe("js-set-map-lookups ReactMarkdown code className", () => {
  it.each(cases)("$name", ({ code, options, expectedDiagnosticCount }) => {
    const result = runRule(jsSetMapLookups, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
  });
});
