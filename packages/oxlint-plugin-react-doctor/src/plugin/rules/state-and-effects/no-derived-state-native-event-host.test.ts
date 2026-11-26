import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noDerivedState } from "./no-derived-state.js";

const context = `import { createContext } from "react";
export const PanelContext = createContext(null);`;

const disclosure = `import { useEffect, useRef, useState } from "react";
import { PanelContext } from "./panel-context";

export const Disclosure = ({ seed, as: Host = "div", ...rest }) => {
  const [open, setOpen] = useState(seed);
  const setFromEvent = (next) => setOpen(next);
  const latest = useRef({ setFromEvent });
  latest.current = { setFromEvent };

  const activate = (event) => {
    event.preventDefault();
    setFromEvent(!open);
  };
  useEffect(() => { setOpen(seed); }, [seed]);
  return <PanelContext.Provider value={null}>
    <Host {...rest}>
      <button onClick={activate}>{String(open)}</button>
    </Host>
  </PanelContext.Provider>;
};
Disclosure.displayName = "Disclosure";`;

interface Case {
  readonly name: string;
  readonly body?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly count: number;
}

const cases: readonly Case[] = [
  { name: "default native host under a local React context", count: 0 },
  {
    name: "passes through a declaration-only relative dependency",
    body: 'import { Input } from "./shape";\n' + disclosure,
    files: {
      "shape.ts": 'import { Input } from "./input"; export { Input };',
      "input.ts": "export interface Input { enabled: boolean }",
    },
    count: 0,
  },
  {
    name: "preserves an explicitly replaced provider",
    files: { "panel-context.ts": context + "\nPanelContext.Provider = () => null;" },
    count: 1,
  },
  {
    name: "preserves a lookalike provider",
    files: { "panel-context.ts": "export const PanelContext = { Provider: () => null };" },
    count: 1,
  },
  {
    name: "preserves an override in the provider declaration",
    files: {
      "panel-context.ts": `import { createContext } from "react";
export const PanelContext = createContext(null),
  discarded = (PanelContext.Provider = () => null);`,
    },
    count: 1,
  },
  {
    name: "preserves a mutation performed by the imported barrel",
    files: {
      "panel-context.ts": `import { PanelContext } from "./context";
PanelContext.Provider = () => null;
export { PanelContext };`,
      "context.ts": context,
    },
    count: 1,
  },
  {
    name: "preserves a mutation performed by a transitive relative import",
    body: 'import "./shape";\n' + disclosure,
    files: {
      "shape.ts": 'import "./override"; export interface Input { enabled: boolean }',
      "override.ts": `import { PanelContext } from "./panel-context";
PanelContext.Provider = () => null;`,
    },
    count: 1,
  },
  {
    name: "preserves a mutation performed by a named tsconfig alias import",
    body: 'import { enable } from "override";\n' + disclosure + "\nvoid enable;",
    files: {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { override: ["./override.ts"] } },
      }),
      "override.ts": `import { PanelContext } from "./panel-context";
PanelContext.Provider = () => null;
export const enable = true;`,
    },
    count: 1,
  },
  {
    name: "preserves replacement of the default host through defaultProps",
    body: disclosure + "\nDisclosure.defaultProps = { as: () => null };",
    count: 1,
  },
  {
    name: "preserves hidden defaults through a component alias",
    body: disclosure + "\nconst Alias = Disclosure;\nAlias.defaultProps = { hidden: true };",
    count: 1,
  },
  {
    name: "preserves an opaque spread",
    body: disclosure.replace("...rest })", "hostProps })").replace("{...rest}", "{...hostProps}"),
    count: 1,
  },
  {
    name: "preserves explicit hidden styles",
    body: disclosure.replace("<Host {...rest}>", '<Host {...rest} style={{display: "none"}}>'),
    count: 1,
  },
  {
    name: "preserves capture handlers that can block the click",
    body: disclosure.replace(
      "<Host {...rest}>",
      "<Host {...rest} onClickCapture={(event) => event.stopPropagation()}>",
    ),
    count: 1,
  },
];

describe("native event writer render path", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-event-writer-host-"));
    __clearParseSourceFileCacheForTests();
    resetTsconfigAliasCaches();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(cases)("$name", ({ body = disclosure, files, count }) => {
    for (const [file, source] of Object.entries({ "panel-context.ts": context, ...files })) {
      fs.writeFileSync(path.join(directory, file), source, "utf8");
    }
    const filename = path.join(directory, "Disclosure.tsx");
    fs.writeFileSync(filename, body, "utf8");
    const result = runRule(noDerivedState, body, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
