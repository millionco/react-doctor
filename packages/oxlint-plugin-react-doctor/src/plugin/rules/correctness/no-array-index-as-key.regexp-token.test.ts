import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface RegExpTokenFixtureOptions {
  readonly entryPrefix?: string;
  readonly useUncontrolledNames?: boolean;
  readonly astroSource?: string;
  readonly tokenSource?: string;
  readonly useChildrenProp?: boolean;
  readonly useOpaqueSlot?: boolean;
  readonly virtualProvider?:
    | "complete"
    | "missing"
    | "redirected"
    | "executable"
    | "foreign"
    | "rebound";
}

const TOKEN_LABEL_SOURCE = `
export const TokenLabel = (props) => {
  const { matcher } = props;
  if (!matcher) return props.name;
  return props.name.split(matcher).map((part, index) =>
    part.match(matcher) ? <b key={index}>{part}</b> : part
  );
};
`;

const DECLARED_TOKEN_LABEL_SOURCE = TOKEN_LABEL_SOURCE.replace(
  "const TokenLabel = (props) =>",
  "function TokenLabel(props)",
);

const VIRTUAL_CONFIG_SOURCE = `
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { palette } from "fixture-colors/meta";
export default defineConfig({
  base: "/colors", trailingSlash: "never", integrations: [react()],
  vite: { plugins: [createPalettePlugin()] },
});
function createPalettePlugin() {
  const source = "virtual:palette";
  const resolved = "\\0" + source;
  return {
    name: "palette",
    resolveId(id) {
      if (id === source) { return resolved; }
      return undefined;
    },
    load(id) {
      if (id === resolved) {
        let code = "export function getColor(id) { switch (id) {";
        for (const item of palette) {
          code += \`case "\${item.id}": return import("fixture-colors/\${item.id}");\`;
        }
        code += "} };";
        return code;
      }
      return undefined;
    },
  };
}
`;

const writeVirtualProvider = (
  rootDirectory: string,
  provider: NonNullable<RegExpTokenFixtureOptions["virtualProvider"]>,
) => {
  fs.writeFileSync(path.join(rootDirectory, "astro.config.ts"), VIRTUAL_CONFIG_SOURCE);
  if (provider === "missing") return;
  const directory = path.join(rootDirectory, "node_modules", "fixture-colors");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "fixture-colors",
      exports: {
        "./meta": {
          import: "./entry.mjs",
          default: provider === "redirected" ? "./other.mjs" : "./entry.mjs",
        },
        "./amber": "./amber.mjs",
      },
    }),
  );
  fs.writeFileSync(
    path.join(directory, "entry.mjs"),
    provider === "rebound"
      ? 'export * from "./values.mjs"; export function draw(data) { draw = data.callback; return (props) => data.text; }'
      : 'export * from "./values.mjs"; export function draw(data) { return (props) => data.text; }',
  );
  fs.writeFileSync(path.join(directory, "values.mjs"), 'export var palette = [{ id: "amber" }];');
  const factorySource = provider === "foreign" ? "./foreign.mjs" : "./entry.mjs";
  const initialization = provider === "executable" ? "window.RegExp = Replacement;" : "";
  fs.writeFileSync(
    path.join(directory, "amber.mjs"),
    `import { draw } from "${factorySource}"; ${initialization}
export function Amber(props) { return draw({"text":"amber"})(props); };`,
  );
  if (provider === "foreign")
    fs.writeFileSync(
      path.join(directory, "foreign.mjs"),
      "export function draw(data) { return (props) => data.text; }",
    );
};

const runRegExpTokenFixture = ({
  entryPrefix = "",
  useUncontrolledNames = false,
  astroSource,
  tokenSource = TOKEN_LABEL_SOURCE,
  virtualProvider,
  useChildrenProp = false,
  useOpaqueSlot = false,
}: RegExpTokenFixtureOptions = {}) => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-regexp-token-"));
  try {
    const filename = path.join(rootDirectory, "token-label.tsx");
    const rowProps = useUncontrolledNames ? "matcher, names" : "matcher";
    const names = useUncontrolledNames ? "names" : "Object.keys({ amber: true, teal: true })";
    const entryProps = useUncontrolledNames ? "{ names }" : "";
    const forwardedNames = useUncontrolledNames ? " names={names}" : "";
    const token = useChildrenProp
      ? "<TokenLabel children={name} matcher={matcher}>{override}</TokenLabel>"
      : "<TokenLabel name={name} matcher={matcher} />";
    const label = useOpaqueSlot ? `<Slot><>${token}</></Slot>` : token;

    fs.writeFileSync(path.join(rootDirectory, "package.json"), '{"private":true,"type":"module"}');
    if (virtualProvider) writeVirtualProvider(rootDirectory, virtualProvider);
    fs.writeFileSync(filename, tokenSource);
    fs.writeFileSync(
      path.join(rootDirectory, "token-rows.tsx"),
      `import { TokenLabel } from "./token-label";
${
  useChildrenProp
    ? `
const override = { split: () => [{
  match: () => true,
  *[Symbol.iterator]() { yield <Counter />; },
}] };
`
    : ""
}
export const TokenRows = ({ ${rowProps} }) => (
  <div>{${names}.map((name) => ${label})}</div>
);
`,
    );
    fs.writeFileSync(
      path.join(rootDirectory, "entry.tsx"),
      `import { TokenRows } from "./token-rows";
${virtualProvider ? 'import { getColor } from "virtual:palette"; void getColor("amber");' : ""}
${entryPrefix}
export const Screen = (${entryProps}) => (
  <div><TokenRows matcher={new RegExp("(a)", "g")}${forwardedNames} /></div>
);
`,
    );
    if (astroSource !== undefined)
      fs.writeFileSync(path.join(rootDirectory, "page.astro"), astroSource);

    return runRule(noArrayIndexAsKey, tokenSource, {
      filename,
      settings: { "react-doctor": { rootDirectory } },
    });
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
};

describe("no-array-index-as-key RegExp text tokens", () => {
  it("allows ordinal text keys with a closed forwarded matcher and Object.keys names", () => {
    const result = runRegExpTokenFixture();
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows the same proof for a function declaration with only JSX callers", () => {
    expect(runRegExpTokenFixture({ tokenSource: DECLARED_TOKEN_LABEL_SOURCE }).diagnostics).toEqual(
      [],
    );
  });

  it("allows the same token proof with a confined Astro virtual module", () => {
    expect(
      runRegExpTokenFixture({
        virtualProvider: "complete",
        entryPrefix: `
import { ClientRouter } from "astro:transitions";
const path = globalThis.window.location.pathname;
if (globalThis.window) {
  globalThis.window.addEventListener("hashchange", () => console.log(path));
}
`,
      }).diagnostics,
    ).toEqual([]);
  });

  it.each<[string, RegExpTokenFixtureOptions]>([
    ["an overridden splitter", { entryPrefix: 'String.prototype.split = () => ["replacement"];' }],
    [
      "a navigation write through the global window location",
      { entryPrefix: 'globalThis.window.location.pathname = "/different";' },
    ],
    [
      "RegExp replacement through a nested window alias",
      { entryPrefix: "window.window.RegExp = Replacement;" },
    ],
    [
      "RegExp replacement through the document view",
      { entryPrefix: "document.defaultView.RegExp = Replacement;" },
    ],
    [
      "a splitter reached through destructuring",
      {
        entryPrefix: `
const { constructor: StringConstructor } = "";
const { prototype: stringPrototype } = StringConstructor;
stringPrototype.split = () => [<Counter />];
`,
      },
    ],
    [
      "a splitter reached through computed aliases",
      {
        entryPrefix: `
const constructorKey = "constructor";
const prototypeKey = "prototype";
const methodKey = "split";
""[constructorKey][prototypeKey][methodKey] = () => [<Counter />];
`,
      },
    ],
    [
      "a dynamic CommonJS consumer",
      {
        entryPrefix: `
const componentPath = "./token-label";
const component = require(componentPath);
register(component);
`,
      },
    ],
    ["uncontrolled input", { useUncontrolledNames: true }],
    [
      "nested JSX children replacing the explicit children prop",
      {
        useChildrenProp: true,
        tokenSource: TOKEN_LABEL_SOURCE.replaceAll("props.name", "props.children"),
      },
    ],
    [
      "an opaque same-module invocation of a function declaration",
      { tokenSource: DECLARED_TOKEN_LABEL_SOURCE + "\nTokenLabel(opaqueProps);" },
    ],
    ["a custom slot that can rewrite its children", { useOpaqueSlot: true }],
    [
      "a JSX element saved and then cloned with different props",
      {
        entryPrefix: `
import { cloneElement as clone } from "react";
import { TokenLabel } from "./token-label";
const seed = <TokenLabel name="plain text" matcher={new RegExp("(a)", "g")} />;
export const Changed = () => <div>{clone(seed, { name: opaquePayload })}</div>;
`,
      },
    ],
    ["a virtual module without its installed provider", { virtualProvider: "missing" }],
    ["a virtual module with an ambiguous provider export", { virtualProvider: "redirected" }],
    ["an executable import target", { virtualProvider: "executable" }],
    ["a generated target importing an unverified factory module", { virtualProvider: "foreign" }],
    ["a generated target whose factory can be reassigned", { virtualProvider: "rebound" }],
    [
      "an unproven framework virtual import",
      { virtualProvider: "complete", entryPrefix: 'import "astro:unknown-loader";' },
    ],
    [
      "a callback that can replace a later token with a stateful child",
      {
        tokenSource: `
export const TokenLabel = (props) => {
  const { matcher } = props;
  if (!matcher) return props.name;
  return props.name.split(matcher).map((part, index, parts) => {
    const children = [<Counter />];
    children.match = () => true;
    if (index === 0) parts[part ? 2 : 1] = children;
    return part.match(matcher) ? <b key={index}>{part}</b> : part;
  });
};
`,
      },
    ],
    [
      "a direct Astro consumer with an opaque name",
      {
        astroSource: `---
import { TokenLabel } from "./token-label";
---
<TokenLabel name={Astro.props.name} matcher={new RegExp("(a)", "g")} />
`,
      },
    ],
    [
      "a spread on an Astro consumer",
      {
        astroSource: `---
import { TokenLabel } from "./token-label";
---
<TokenLabel {...Astro.props} />
`,
      },
    ],
  ])("retains the warning with %s", (_name, options) => {
    const result = runRegExpTokenFixture(options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
