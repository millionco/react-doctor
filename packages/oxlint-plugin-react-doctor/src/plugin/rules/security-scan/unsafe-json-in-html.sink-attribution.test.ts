import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS } from "../../constants/security-scan.js";
import { unsafeJsonInHtml } from "./unsafe-json-in-html.js";

interface HtmlSinkAttributionCase {
  readonly name: string;
  readonly code: string;
  readonly relativePath: string;
  readonly expectedLocations: readonly (readonly number[])[];
}

const nestedAttributePrefix = "choose(<i data-label={JSON.stringify(label)} />, ";
const htmlAttributePrefix = "export const view = <div dangerouslySetInnerHTML={{__html:";
const cases: readonly HtmlSinkAttributionCase[] = [
  {
    name: "own-serialization-at-existing-lookahead-boundary",
    code: `${htmlAttributePrefix}${nestedAttributePrefix}${" ".repeat(HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS - nestedAttributePrefix.length)}JSON.stringify(payload))}}/>;`,
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "own-serialization-beyond-existing-lookahead-boundary",
    code: `${htmlAttributePrefix}${nestedAttributePrefix}${" ".repeat(HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS - nestedAttributePrefix.length + 1)}JSON.stringify(payload))}}/>;`,
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "own-serialization-preserves-call-whitespace-after-name-window",
    code: `${htmlAttributePrefix}${nestedAttributePrefix}JSON.stringify${" ".repeat(HTML_JSON_STRINGIFY_LOOKAHEAD_CHARS)}(payload))}}/>;`,
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "own-serialization-after-nested-non-html-attribute",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: choose(<div data-label={JSON.stringify(label)} />, JSON.stringify(payload)) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "nested-spread-attribute-does-not-taint-outer-html",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div {...{ label: JSON.stringify(payload) }} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-html-attribute-owns-its-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 84]],
  },
  {
    name: "nested-non-html-attribute-does-not-taint-outer-html",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div data-label={JSON.stringify(payload)} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-both-dynamic-attributes-keep-own-locations",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(outer), ignored: <div dangerouslySetInnerHTML={{ __html: JSON.stringify(inner) }} /> }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [
      [1, 26],
      [1, 98],
    ],
  },
  {
    name: "nested-escaped-html-attribute-stays-quiet",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div dangerouslySetInnerHTML={{ __html: escapeHtml(JSON.stringify(payload)) }} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "outer-escape-wrapper-does-not-sanitize-nested-html",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: escapeHtml(<div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 77]],
  },
  {
    name: "nested-html-through-non-html-attribute-keeps-own-location",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div title={<div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 96]],
  },
  {
    name: "nested-namespaced-attribute-does-not-taint-outer-html",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div data:label={JSON.stringify(payload)} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-html-without-matched-object-shape-stays-outside-contract",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready", ignored: <div dangerouslySetInnerHTML={JSON.stringify(payload)} /> }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "closed-static-attribute-before-unrelated-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const serialized = JSON.stringify(payload);',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "closed-static-attribute-before-later-attribute",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 26]],
  },
  {
    name: "closed-static-attribute-before-ordinary-jsx-prop",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} title={JSON.stringify(payload)} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "closed-static-attribute-before-react-text-child",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const text = <output>{JSON.stringify(payload)}</output>;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-static-object-before-unrelated-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: makeText({ nested: { count: 1 } }) }} />;\nexport const serialized = JSON.stringify(payload);",
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "quoted-closing-braces-before-unrelated-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "}}" }} />;\nexport const serialized = JSON.stringify(payload);',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "template-closing-braces-before-unrelated-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: `}}` }} />;\nexport const serialized = JSON.stringify(payload);",
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "regex-closing-braces-before-own-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: /}}/.test(label) ? JSON.stringify(payload) : "" }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "nested-template-before-own-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: `prefix ${makeText(`}`)} ${JSON.stringify(payload)}` }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "comment-closing-braces-before-own-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: /* }} */ JSON.stringify(payload) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "two-dynamic-attributes",
    code: "export const first = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(firstPayload) }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(secondPayload) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [
      [1, 27],
      [2, 28],
    ],
  },
  {
    name: "static-json-before-dynamic-attribute",
    code: 'export const first = <div dangerouslySetInnerHTML={{ __html: JSON.stringify({ "count": 1 }) }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 28]],
  },
  {
    name: "escaped-json-before-dynamic-attribute",
    code: "export const first = <div dangerouslySetInnerHTML={{ __html: escapeHtml(JSON.stringify(payload)) }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 28]],
  },
  {
    name: "two-static-attributes-before-dynamic-attribute",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const middle = <div dangerouslySetInnerHTML={{ __html: "More" }} />;\nexport const last = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[3, 26]],
  },
  {
    name: "earlier-static-attribute-does-not-hide-return-escaped-later-sink",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload).replaceAll("<", "\\u003c") }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "commented-out-attribute-before-dynamic-attribute",
    code: '// <div dangerouslySetInnerHTML={{ __html: "Ready" }} />\nexport const view = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 26]],
  },
  {
    name: "unicode-before-static-and-dynamic-attributes",
    code: 'export const label = "🌱";\nexport const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[3, 26]],
  },
  {
    name: "whitespace-and-comments-between-closed-attributes",
    code: 'export const first = <div dangerouslySetInnerHTML={{\n __html: "Ready",\n}} />;\n/* marker */\nexport const second = <div dangerouslySetInnerHTML={{\n __html: JSON.stringify(payload),\n}} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[5, 28]],
  },
  {
    name: "non-html-attribute-serialization-after-static-sink",
    code: 'export const view = <section><div dangerouslySetInnerHTML={{ __html: "Ready" }} /><output data-value={JSON.stringify(payload)} /></section>;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "call-after-closed-static-attribute",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nconsume(JSON.stringify(payload));',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "preserves-inline-script-interpolation",
    code: "export const html = `<script>const value = ${JSON.stringify(payload)};</script>`;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 22]],
  },
  {
    name: "preserves-inline-script-runtime-serialization",
    code: "export const html = `<script>const value = JSON.stringify(payload);</script>`;",
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "preserves-unparseable-input-fallback",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;\nconst unfinished =",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "preserves-template-markup-fallback",
    code: "export const html = `<div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />`;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 27]],
  },
  {
    name: "preserves-non-source-path-gate",
    code: "<div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />",
    relativePath: "src/view.html",
    expectedLocations: [],
  },
  {
    name: "closed-attribute-before-outside-argument-with-braces",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const serialized = JSON.stringify({ nested: payload });',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-jsx-attributes-keep-their-own-owner",
    code: 'export const view = <section title={<div dangerouslySetInnerHTML={{ __html: "Ready" }} />}><div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} /></section>;',
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 97]],
  },
  {
    name: "empty-html-before-dynamic-attribute",
    code: 'export const first = <div dangerouslySetInnerHTML={{ __html: "" }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 28]],
  },
];

describe("unsafe-json-in-html sink attribution", () => {
  it.each(cases)("$name", ({ code, relativePath, expectedLocations }) => {
    const findings = runScanRule(unsafeJsonInHtml, { content: code, relativePath });
    expect(findings.map(({ line, column }) => [line, column])).toEqual(expectedLocations);
  });
});
