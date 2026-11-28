import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface PlaceholderCase {
  name: string;
  parts: Partial<typeof fixture>;
  expected: number;
}

const fixture = {
  table: 'const messages = ["Badge: [[mark]].", "[[mark]], thank you for welcoming [[mark]]."];',
  wrapper:
    'function Badge({ children, tone }: { children: string; tone?: string }) {\n  return <i style={{ color: tone ?? "gray" }}>{children}</i>;\n}',
  setup: "const text = messages[Math.floor(Math.random() * messages.length)];",
  body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>Ready</Badge>]).slice(0, -1);',
  ending: "",
};

const cases: PlaceholderCase[] = [
  {
    name: "literal-table",
    parts: {},
    expected: 0,
  },
  {
    name: "single-template",
    parts: {
      table: "",
      setup: 'const text = "Status: [[mark]].";',
    },
    expected: 0,
  },
  {
    name: "static-primitive-alias",
    parts: {
      setup:
        'const text = messages[Math.floor(Math.random() * messages.length)]; const content = "Ready";',
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>{content}</Badge>]).slice(0, -1);',
    },
    expected: 0,
  },
  {
    name: "guarded-primitive-prop",
    parts: {
      setup:
        'const text = messages[Math.floor(Math.random() * messages.length)]; const content = typeof label === "string" ? label : "Ready";',
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>{content}</Badge>]).slice(0, -1);',
    },
    expected: 0,
  },
  {
    name: "no-lookahead-needed",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <span key={index}>Ready</span>]).slice(0, -1);',
    },
    expected: 0,
  },
  {
    name: "mutable-table",
    parts: {
      setup:
        'messages.push("Dismissed"); const text = messages[Math.floor(Math.random() * messages.length)];',
    },
    expected: 1,
  },
  {
    name: "escaped-table",
    parts: {
      ending: "inspect(messages);",
    },
    expected: 1,
  },
  {
    name: "exported-table",
    parts: {
      table:
        'export const messages = ["Badge: [[mark]].", "[[mark]], thank you for welcoming [[mark]]."];',
    },
    expected: 1,
  },
  {
    name: "reexported-table",
    parts: {
      ending: "export { messages };",
    },
    expected: 1,
  },
  {
    name: "computed-slot-write",
    parts: {
      ending: "messages[0] = label;",
    },
    expected: 1,
  },
  {
    name: "foreign-rng",
    parts: {
      setup: "const text = messages[choose(messages.length)];",
    },
    expected: 1,
  },
  {
    name: "shadowed-math",
    parts: {
      setup:
        "const Math = { floor: (value) => value, random: () => 0 }; const text = messages[Math.floor(Math.random() * messages.length)];",
    },
    expected: 1,
  },
  {
    name: "mutable-math-alias",
    parts: { ending: "let reference = Math; reference.random = () => 0.2;" },
    expected: 1,
  },
  {
    name: "captured-math-value",
    parts: { ending: "const readMath = () => Math; readMath().floor = () => 0;" },
    expected: 1,
  },
  {
    name: "math-object-escape",
    parts: { ending: "const handles = { Math }; handles.Math.random = () => 0.2;" },
    expected: 1,
  },
  {
    name: "patched-math",
    parts: {
      ending: "Math.random = () => 0;",
    },
    expected: 1,
  },
  {
    name: "destructured-array-protocol",
    parts: { ending: "const { __proto__: methods } = []; methods.flatMap = () => [];" },
    expected: 1,
  },
  {
    name: "destructured-string-protocol",
    parts: {
      table: "",
      setup: "const text = 'Welcome [[mark]].';",
      ending: "const { __proto__: methods } = 'plain'; methods.split = () => [<Editor />];",
    },
    expected: 1,
  },
  {
    name: "computed-protocol-destructure",
    parts: {
      ending:
        "const property = '__proto__'; const { [property]: methods } = []; methods.slice = () => [];",
    },
    expected: 1,
  },
  {
    name: "patched-prototype",
    parts: {
      ending: "Array.prototype.slice = () => [];",
    },
    expected: 1,
  },
  {
    name: "dynamic-table-entry",
    parts: {
      table: 'const messages = ["Badge: [[mark]].", createText()];',
    },
    expected: 1,
  },
  {
    name: "zero-slot-table-row",
    parts: {
      table: 'const messages = ["Badge: [[mark]].", "Welcome."];',
    },
    expected: 0,
  },
  {
    name: "dynamic-text",
    parts: {
      setup: "const text = label;",
    },
    expected: 1,
  },
  {
    name: "unknown-child",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>{label}</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "external-property-child",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>{model.title}</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "stateful-child",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}><Editor /></Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "guarded-chunk-child",
    parts: {
      body: fixture.body.replace(
        ">Ready</Badge>",
        ">{typeof chunk === 'string' ? chunk : 'Ready'}</Badge>",
      ),
    },
    expected: 1,
  },
  {
    name: "index-dependent-child",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>{index}</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "unknown-style-value",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone={model.tone} key={index}>Ready</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "spread-attribute",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge {...model} key={index}>Ready</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "leaf-ref",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge ref={owner} key={index}>Ready</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "leaf-extra-output",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>Ready</Badge>, " extra"]).slice(0, -1);',
    },
    expected: 1,
  },
  {
    name: "missing-tail-trim",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>Ready</Badge>]);',
    },
    expected: 1,
  },
  {
    name: "other-trim",
    parts: {
      body: 'return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>Ready</Badge>]).slice(1, -1);',
    },
    expected: 1,
  },
  {
    name: "stateful-wrapper",
    parts: {
      wrapper:
        'function Badge({ children, tone }: { children: string; tone?: string }) {\n  useEffect(() => observe(), []); return <i style={{ color: tone ?? "gray" }}>{children}</i>;\n}',
    },
    expected: 1,
  },
  {
    name: "foreign-wrapper",
    parts: {
      wrapper: 'import { Badge } from "other-ui";',
    },
    expected: 1,
  },
  {
    name: "wrapper-ref",
    parts: {
      wrapper:
        'function Badge({ children, tone }: { children: string; tone?: string }) {\n  return <i ref={observe} style={{ color: tone ?? "gray" }}>{children}</i>;\n}',
    },
    expected: 1,
  },
  {
    name: "wrapper-event",
    parts: {
      wrapper:
        'function Badge({ children, tone }: { children: string; tone?: string }) {\n  return <i onClick={select} style={{ color: tone ?? "gray" }}>{children}</i>;\n}',
    },
    expected: 1,
  },
  {
    name: "effectful-wrapper-key",
    parts: { wrapper: "const Badge = ({ children, tone }) => <i key={observe()}>{children}</i>;" },
    expected: 1,
  },
  {
    name: "destructured-math-replacement",
    parts: { ending: "({ Math } = foreign);" },
    expected: 1,
  },
  {
    name: "wrapper-input",
    parts: {
      wrapper: "const Badge = ({children, tone}) => <input defaultValue={children} />;",
    },
    expected: 1,
  },
  {
    name: "wrapper-default",
    parts: {
      wrapper:
        'function Badge({ children = getDefault(), tone }: { children: string; tone?: string }) {\n  return <i style={{ color: tone ?? "gray" }}>{children}</i>;\n}',
    },
    expected: 1,
  },
  {
    name: "replaced-wrapper",
    parts: {
      ending: "Badge = Foreign;",
    },
    expected: 1,
  },
  {
    name: "user-code-between",
    parts: {
      body: 'work(); return text.split("[[mark]]").flatMap((chunk, index) => [chunk, <Badge tone="tomato" key={index}>Ready</Badge>]).slice(0, -1);',
    },
    expected: 1,
  },
];

describe("no-array-index-as-key literal text placeholders", () => {
  it.each(cases)("$name", ({ parts, expected }) => {
    const { table, wrapper, setup, body, ending } = { ...fixture, ...parts };
    const result = runRule(
      noArrayIndexAsKey,
      `
${table}
${wrapper}
export function Banner({ label, model, owner }) {
  ${setup}
  ${body}
}
${ending}
`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
