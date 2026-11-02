import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { jsxCurlyBracePresence } from "../react-builtins/jsx-curly-brace-presence.js";
import { LOCAL_TEXT_MAX_SOURCE_CHARACTERS } from "./utils/local-text-wrapper/constants.js";

const supportedSettings = {
  "react-doctor": {
    framework: "vite",
    capabilities: ["client-only", "react", "react:17", "vite"],
  },
};

const closedSource = `
import React from "react";
const TextParcel = ({ children }) => <span>{children}</span>;
export const MineralStrip = () => "amber|granite|mica".split("|").map((mineral, index) => <TextParcel key={index}>{mineral}</TextParcel>);
`;

const retainedCases = [
  {
    name: "render effect",
    code: closedSource.replace(
      "=> <span>{children}</span>",
      "=> { inspect(children); return <span>{children}</span>; }",
    ),
  },
  {
    name: "hook",
    code: closedSource.replace(
      "=> <span>{children}</span>",
      "=> { useState(false); return <span>{children}</span>; }",
    ),
  },
  {
    name: "input root",
    code: closedSource.replace("<span>{children}</span>", "<input defaultValue={children} />"),
  },
  {
    name: "media descendant",
    code: closedSource.replace("<span>{children}</span>", "<span><video src={children} /></span>"),
  },
  {
    name: "custom descendant",
    code: closedSource.replace(
      "<span>{children}</span>",
      "<span><Opaque>{children}</Opaque></span>",
    ),
  },
  { name: "return event prop", code: closedSource.replace("<span>", "<span onClick={inspect}>") },
  { name: "return class prop", code: closedSource.replace("<span>", '<span className="mineral">') },
  { name: "return ref", code: closedSource.replace("<span>", "<span ref={mineralRef}>") },
  { name: "editable return", code: closedSource.replace("<span>", "<span contentEditable>") },
  {
    name: "extra selected prop",
    code: closedSource.replace("key={index}", "key={index} ref={mineralRef}"),
  },
  {
    name: "selected spread",
    code: closedSource.replace("key={index}", "key={index} {...attributes}"),
  },
  {
    name: "duplicate selected attribute",
    code: closedSource.replace("key={index}", 'key={index} key="fixed"'),
  },
  {
    name: "renamed children pattern",
    code: closedSource.replace(
      "({ children }) => <span>{children}</span>",
      "({ children: content }) => <span>{content}</span>",
    ),
  },
  {
    name: "computed children pattern",
    code: closedSource.replace("({ children })", '({ ["children"]: children })'),
  },
  {
    name: "default children pattern",
    code: closedSource.replace("({ children })", "({ children = fallback })"),
  },
  {
    name: "duplicate children property",
    code: closedSource.replace("({ children })", "({ children, children: other })"),
  },
  {
    name: "rest pattern",
    code: closedSource.replace("({ children })", "({ children, ...attributes })"),
  },
  {
    name: "props object parameter",
    code: closedSource.replace(
      "({ children }) => <span>{children}</span>",
      "props => <span>{props.children}</span>",
    ),
  },
  {
    name: "additional wrapper parameter",
    code: closedSource.replace("({ children })", "({ children }, ref)"),
  },
  { name: "mutable wrapper", code: closedSource.replace("const TextParcel", "let TextParcel") },
  {
    name: "wrapper factory",
    code: closedSource.replace(
      "({ children }) => <span>{children}</span>",
      "memo(({ children }) => <span>{children}</span>)",
    ),
  },
  { name: "extra runtime statement", code: `${closedSource} inspect();` },
  { name: "wrapper escape", code: `${closedSource} register(TextParcel);` },
  { name: "wrapper property write", code: `${closedSource} TextParcel.defaultProps = {};` },
  { name: "provider write", code: `${closedSource} String.prototype.split = unknownSplit;` },
  {
    name: "provider reflection",
    code: `${closedSource} Reflect.set(String.prototype, "split", unknownSplit);`,
  },
  { name: "opaque import", code: `import "./unknown-provider"; ${closedSource}` },
  {
    name: "alternate React import",
    code: closedSource.replace('from "react"', 'from "preact/compat"'),
  },
  {
    name: "type-only React import",
    code: closedSource.replace("import React", "import type React"),
  },
  {
    name: "React import attributes",
    code: closedSource.replace('from "react";', 'from "react" with { type: "json" };'),
  },
  {
    name: "source phase React import",
    code: closedSource.replace("import React", "import source React"),
  },
  {
    name: "JSX type arguments",
    code: closedSource.replace("<TextParcel key", "<TextParcel<string> key"),
  },
  {
    name: "aliased React binding",
    code: closedSource.replace("import React", "import ReactRuntime"),
  },
  { name: "callback shadows React", code: closedSource.replaceAll("mineral", "React") },
  { name: "callback shadows wrapper", code: closedSource.replaceAll("mineral", "TextParcel") },
  {
    name: "callback third parameter",
    code: closedSource.replace("(mineral, index)", "(mineral, index, collection)"),
  },
  {
    name: "callback function expression",
    code: closedSource.replace(
      "(mineral, index) => <TextParcel key={index}>{mineral}</TextParcel>",
      "function (mineral, index) { return <TextParcel key={index}>{mineral}</TextParcel>; }",
    ),
  },
  {
    name: "callback extra read",
    code: closedSource.replace("{mineral}</TextParcel>", "{mineral}{mineral}</TextParcel>"),
  },
  {
    name: "index extra read",
    code: closedSource.replace(
      "{mineral}</TextParcel>",
      "{index ? mineral : mineral}</TextParcel>",
    ),
  },
  {
    name: "coerced child",
    code: closedSource.replace("{mineral}</TextParcel>", "{String(mineral)}</TextParcel>"),
  },
  {
    name: "children attribute",
    code: closedSource.replace(
      "key={index}>{mineral}</TextParcel>",
      "key={index} children={mineral} />",
    ),
  },
  {
    name: "member child",
    code: closedSource.replace("{mineral}</TextParcel>", "{mineral.content}</TextParcel>"),
  },
  {
    name: "dynamic source",
    code: closedSource.replace('"amber|granite|mica"', "externalMinerals"),
  },
  {
    name: "source alias",
    code: closedSource.replace('"amber|granite|mica".split("|")', "minerals"),
  },
  { name: "regex separator", code: closedSource.replace('split("|")', "split(/\\|/)") },
  { name: "computed splitter", code: closedSource.replace('.split("|")', '["split"]("|")') },
  { name: "split limit", code: closedSource.replace('split("|")', 'split("|", 2)') },
  { name: "optional split", code: closedSource.replace('.split("|")', '?.split("|")') },
  { name: "computed map", code: closedSource.replace(".map(", '["map"](') },
  {
    name: "map thisArg",
    code: closedSource.replace("</TextParcel>);", "</TextParcel>, receiver);"),
  },
  {
    name: "asserted scalar type",
    code: closedSource.replace("{mineral}</TextParcel>", "{mineral as string}</TextParcel>"),
  },
  {
    name: "typed wrapper parameter",
    code: closedSource.replace("({ children })", "({ children }: { children: string })"),
  },
  {
    name: "generic wrapper",
    code: closedSource.replace("= ({ children })", "= <Content,>({ children })"),
  },
  {
    name: "typed callback item",
    code: closedSource.replace("(mineral, index)", "(mineral: string, index)"),
  },
  {
    name: "optional callback index",
    code: closedSource.replace("(mineral, index)", "(mineral, index?)"),
  },
  { name: "JSX directive", code: `/** @jsx mineralFactory */ ${closedSource}` },
  { name: "automatic runtime directive", code: `/** @jsxRuntime automatic */ ${closedSource}` },
  {
    name: "directive-like data",
    code: closedSource.replace("amber|granite|mica", "@jsx|granite|mica"),
  },
  { name: "unrecognized framework", code: closedSource },
];

describe("closed local text wrapper index keys", () => {
  it("preserves the positive through the actual semantic host wrapper", () => {
    const result = runRule(wrapWithSemanticContext(noArrayIndexAsKey), closedSource, {
      settings: supportedSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains the actual host warning for a missing profile", () => {
    expect(
      runRule(wrapWithSemanticContext(noArrayIndexAsKey), closedSource).diagnostics,
    ).toHaveLength(1);
  });

  it("preserves the exact host source object and both receivers", () => {
    let readCount = 0;
    const observingHost = {
      ...noArrayIndexAsKey,
      create: (context: RuleContext) => {
        const sourceCode = {
          ast: context.sourceCode?.ast,
          getText() {
            expect(this).toBe(sourceCode);
            readCount += 1;
            return closedSource;
          },
        };
        const hostContext = {
          ...context,
          get sourceCode() {
            expect(this).toBe(hostContext);
            return sourceCode;
          },
        };
        const observingRule = {
          ...noArrayIndexAsKey,
          create: (enrichedContext: RuleContext) => {
            expect(enrichedContext.sourceCode).toBe(sourceCode);
            return noArrayIndexAsKey.create(enrichedContext);
          },
        };
        return wrapWithSemanticContext(observingRule).create(hostContext);
      },
    };
    const result = runRule(observingHost, closedSource, { settings: supportedSettings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(readCount).toBeGreaterThan(0);
  });

  it.each([
    { name: "supported then missing", settings: [supportedSettings, {}], expected: [0, 1] },
    { name: "missing then supported", settings: [{}, supportedSettings], expected: [1, 0] },
  ])("checks each profile for a reused Program: $name", ({ settings, expected }) => {
    const parsed = parseFixture(closedSource);
    const wrapped = wrapWithSemanticContext(noArrayIndexAsKey);
    const results = settings.map((profile) =>
      runRuleOnParsedFixture(wrapped, closedSource, parsed, { settings: profile }),
    );
    expect(results.map((result) => result.parseErrors)).toEqual([[], []]);
    expect(results.map((result) => result.diagnostics.length)).toEqual(expected);
  });

  it("invalidates a reused Program when source text drifts", () => {
    const parsed = parseFixture(closedSource);
    const wrapped = wrapWithSemanticContext(noArrayIndexAsKey);
    const first = runRuleOnParsedFixture(wrapped, closedSource, parsed, {
      settings: supportedSettings,
    });
    const drifted = runRuleOnParsedFixture(wrapped, `${closedSource} inspect();`, parsed, {
      settings: supportedSettings,
    });
    const reused = runRuleOnParsedFixture(wrapped, closedSource, parsed, {
      settings: supportedSettings,
    });
    expect([
      first.diagnostics.length,
      drifted.diagnostics.length,
      reused.diagnostics.length,
    ]).toEqual([0, 1, 1]);
    expect(runRule(wrapped, closedSource, { settings: supportedSettings }).diagnostics).toEqual([]);
  });

  it("fails closed on a directive with a reused Program", () => {
    const parsed = parseFixture(closedSource);
    const wrapped = wrapWithSemanticContext(noArrayIndexAsKey);
    expect(
      runRuleOnParsedFixture(wrapped, closedSource, parsed, { settings: supportedSettings })
        .diagnostics,
    ).toEqual([]);
    expect(
      runRuleOnParsedFixture(wrapped, `/** @jsx opaqueFactory */ ${closedSource}`, parsed, {
        settings: supportedSettings,
      }).diagnostics,
    ).toHaveLength(1);
  });

  it.each(["missing", "throwing"])("fails closed with %s actual host source text", (mode) => {
    const wrapped = wrapWithSemanticContext(noArrayIndexAsKey);
    const host = {
      ...noArrayIndexAsKey,
      create: (context: RuleContext) =>
        wrapped.create({
          ...context,
          sourceCode:
            mode === "missing"
              ? undefined
              : {
                  ast: context.sourceCode?.ast,
                  getText: () => {
                    throw new Error("host source unavailable");
                  },
                },
        }),
    };
    expect(runRule(host, closedSource, { settings: supportedSettings }).diagnostics).toHaveLength(
      1,
    );
  });

  it.each([
    { code: 'const content = <span>{"mineral"}</span>;', count: 1 },
    { code: 'const content = <span>{/* keep note */ "mineral"}</span>;', count: 0 },
    { code: 'const content = <span title={/* keep note */ "mineral"} />;', count: 0 },
    { code: 'const content = <a href={"https://mineral.example/path"} />;', count: 0 },
  ])("preserves the existing curly-brace source guard through the host", ({ code, count }) => {
    const direct = runRule(jsxCurlyBracePresence, code);
    const wrapped = runRule(wrapWithSemanticContext(jsxCurlyBracePresence), code);
    expect(direct.parseErrors).toEqual([]);
    expect(wrapped.parseErrors).toEqual([]);
    expect(direct.diagnostics).toHaveLength(count);
    expect(wrapped.diagnostics).toEqual(direct.diagnostics);
  });

  it("uses the already projected CRA capability profile", () => {
    const result = runRule(noArrayIndexAsKey, closedSource, {
      settings: {
        "react-doctor": {
          framework: "cra",
          capabilities: ["cra", "react", "react:17", "client-only"],
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("preserves the independently invented fuzz seed only with its supported profile", () => {
    const code = readFileSync(
      new URL(
        "../../../../../fuzz/corpus/regressions/no-array-index-as-key--closed-local-text-wrapper.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const supported = runRule(noArrayIndexAsKey, code, { settings: supportedSettings });
    expect(supported.parseErrors).toEqual([]);
    expect(supported.diagnostics).toEqual([]);
    expect(runRule(noArrayIndexAsKey, code).diagnostics).toHaveLength(1);
  });
  it.each([
    closedSource,
    closedSource.replace("=> <span>{children}</span>", "=> { return <span>{children}</span>; }"),
    closedSource
      .replace('() => "amber|granite|mica"', '() => { return "amber|granite|mica"')
      .replace("</TextParcel>);", "</TextParcel>); };"),
    closedSource.replace(
      "(mineral, index) => <TextParcel key={index}>{mineral}</TextParcel>",
      "(mineral, index) => { return <TextParcel key={index}>{mineral}</TextParcel>; }",
    ),
    closedSource
      .replaceAll("TextParcel", "TextEnvelope")
      .replaceAll("mineral", "segment")
      .replaceAll("index", "idx"),
    `/* scalar mineral display */ ${closedSource.replace("const TextParcel", "/* local wrapper */ const TextParcel")} // trailing note`,
  ])("preserves a fully visible scalar wrapper", (code) => {
    const result = runRule(noArrayIndexAsKey, code, { settings: supportedSettings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(retainedCases)("retains the warning for $name", ({ name, code }) => {
    const settings =
      name === "unrecognized framework"
        ? { "react-doctor": { ...supportedSettings["react-doctor"], framework: "unknown" } }
        : supportedSettings;
    const result = runRule(noArrayIndexAsKey, code, { settings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {},
    { "react-doctor": {} },
    { "react-doctor": { framework: "vite" } },
    {
      "react-doctor": {
        ...supportedSettings["react-doctor"],
        capabilities: ["vite", "react", "react:17", "react:18"],
      },
    },
    {
      "react-doctor": {
        ...supportedSettings["react-doctor"],
        capabilities: [...supportedSettings["react-doctor"].capabilities, "react-compiler"],
      },
    },
    {
      "react-doctor": {
        ...supportedSettings["react-doctor"],
        capabilities: [...supportedSettings["react-doctor"].capabilities, "react-native"],
      },
    },
    {
      "react-doctor": {
        ...supportedSettings["react-doctor"],
        capabilities: [...supportedSettings["react-doctor"].capabilities, "preact"],
      },
    },
    { "react-doctor": { ...supportedSettings["react-doctor"], capabilities: ["react-native"] } },
    { "react-doctor": { ...supportedSettings["react-doctor"], capabilities: "unknown" } },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react"] } },
    { "react-doctor": { framework: "vite", capabilities: ["cra", "react", "react:17"] } },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react:17"] } },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react", "react:17", null] } },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react", "react:17", ""] } },
    {
      "react-doctor": {
        framework: "vite",
        capabilities: ["vite", "react", "react:17", "react:17"],
      },
    },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react", "react:17", "expo"] } },
    {
      "react-doctor": {
        framework: "vite",
        capabilities: ["vite", "react", "react:17", "pure-preact"],
      },
    },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react", "react:17", "r3f"] } },
    { "react-doctor": { framework: "vite", capabilities: ["vite", "react", "react:17", "three"] } },
    {
      "react-doctor": {
        framework: "vite",
        capabilities: ["vite", "react", "react:17", "remotion"],
      },
    },
  ])("retains the warning without a supported profile", (settings) => {
    const result = runRule(noArrayIndexAsKey, closedSource, { settings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains dynamic record identity despite a fixed split receiver", () => {
    const code = `import React, { useState } from "react";
      const MineralEditor = ({ slot, record }) => { const [draft, setDraft] = useState(record.name); return <label>{slot}<input value={draft} onChange={event => setDraft(event.target.value)} /></label>; };
      export const MineralList = ({ records }) => "left|right".split("|").map((slot, index) => <MineralEditor key={index} slot={slot} record={records[index]} />);`;
    const result = runRule(noArrayIndexAsKey, code, { settings: supportedSettings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fails closed on the source budget", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `${closedSource}${" ".repeat(LOCAL_TEXT_MAX_SOURCE_CHARACTERS)}`,
      { settings: supportedSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fails closed on a large unsupported descendant tree", () => {
    const code = closedSource.replace(
      "<span>{children}</span>",
      `<span>${"<b />".repeat(100)}{children}</span>`,
    );
    const result = runRule(noArrayIndexAsKey, code, { settings: supportedSettings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fails closed when source text is unavailable", () => {
    const rule = {
      ...noArrayIndexAsKey,
      create: (context: Parameters<typeof noArrayIndexAsKey.create>[0]) =>
        noArrayIndexAsKey.create({ ...context, sourceCode: undefined }),
    };
    expect(runRule(rule, closedSource, { settings: supportedSettings }).diagnostics).toHaveLength(
      1,
    );
  });

  it("fails closed when source text cannot be read", () => {
    const rule = {
      ...noArrayIndexAsKey,
      create: (context: Parameters<typeof noArrayIndexAsKey.create>[0]) =>
        noArrayIndexAsKey.create({
          ...context,
          sourceCode: {
            getText: () => {
              throw new Error("unavailable");
            },
          },
        }),
    };
    expect(runRule(rule, closedSource, { settings: supportedSettings }).diagnostics).toHaveLength(
      1,
    );
  });
});
