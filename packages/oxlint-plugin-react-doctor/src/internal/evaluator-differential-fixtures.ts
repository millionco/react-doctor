import * as fs from "node:fs";
import * as path from "node:path";
import type { OxcFixture } from "../test-utils/run-fixtures.js";
import {
  failCases as ariaRoleFailCases,
  passCases as ariaRolePassCases,
} from "../plugin/rules/a11y/__fixtures__/aria-role.fixtures.js";
import {
  failCases as imgRedundantAltFailCases,
  passCases as imgRedundantAltPassCases,
} from "../plugin/rules/a11y/__fixtures__/img-redundant-alt.fixtures.js";
import {
  failCases as noAccessKeyFailCases,
  passCases as noAccessKeyPassCases,
} from "../plugin/rules/a11y/__fixtures__/no-access-key.fixtures.js";
import {
  failCases as tabindexNoPositiveFailCases,
  passCases as tabindexNoPositivePassCases,
} from "../plugin/rules/a11y/__fixtures__/tabindex-no-positive.fixtures.js";
import { TRANSLATORS } from "../plugin/rules/a11y/__fixtures__/oxc-settings-translators.js";

export interface DifferentialFixtureCase {
  readonly name: string;
  readonly provenance: string;
  readonly sourceText: string;
  readonly expectedDiagnosticCount: number;
}

export interface DifferentialFixtureGroup {
  readonly ruleId: string;
  readonly severity: "error" | "warn";
  readonly evaluationMode: "source" | "virtual";
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly cases: ReadonlyArray<DifferentialFixtureCase>;
}

export interface DifferentialVirtualProjectCase {
  readonly name: string;
  readonly provenance: string;
  readonly ruleId: string;
  readonly severity: "error" | "warn";
  readonly files: ReadonlyMap<string, string>;
  readonly expectedDiagnosticCountByFile: ReadonlyMap<string, number>;
}

interface UpstreamReactHooksCase {
  readonly code: string;
  readonly errorCount?: number;
}

interface UpstreamReactHooksFixture {
  readonly valid: ReadonlyArray<UpstreamReactHooksCase>;
  readonly invalid: ReadonlyArray<UpstreamReactHooksCase>;
}

interface OxcFixtureSelection {
  readonly kind: "pass" | "fail";
  readonly index: number;
  readonly suppress?: boolean;
}

interface ReactHooksFixtureSelection {
  readonly kind: "valid" | "invalid";
  readonly index: number;
}

const buildOxcCases = (
  fixtureName: string,
  passCases: ReadonlyArray<OxcFixture>,
  failCases: ReadonlyArray<OxcFixture>,
  selections: ReadonlyArray<OxcFixtureSelection>,
): ReadonlyArray<DifferentialFixtureCase> =>
  selections.map((selection) => {
    const fixtureCases = selection.kind === "pass" ? passCases : failCases;
    const fixture = fixtureCases[selection.index];
    if (!fixture) {
      throw new Error(`Missing ${fixtureName} ${selection.kind}[${selection.index}] fixture`);
    }
    const suppressionPrefix = selection.suppress
      ? `// oxlint-disable-next-line react-doctor/${fixtureName}\n`
      : "";
    return {
      name: `${selection.kind}[${selection.index}]${selection.suppress ? " suppressed" : ""}`,
      provenance: `OXC ${fixtureName} ${selection.kind}[${selection.index}]`,
      sourceText: `${suppressionPrefix}${fixture.code}`,
      expectedDiagnosticCount: selection.kind === "fail" && selection.suppress !== true ? 1 : 0,
    };
  });

const readReactHooksFixture = (fixtureName: string): UpstreamReactHooksFixture => {
  const fixturePath = path.join(
    import.meta.dirname,
    "../plugin/rules/react-builtins/__upstream-fixtures__",
    `${fixtureName}.json`,
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as UpstreamReactHooksFixture;
};

const buildReactHooksCases = (
  fixtureName: string,
  selections: ReadonlyArray<ReactHooksFixtureSelection>,
): ReadonlyArray<DifferentialFixtureCase> => {
  const fixture = readReactHooksFixture(fixtureName);
  return selections.map((selection) => {
    const fixtureCases = fixture[selection.kind];
    const fixtureCase = fixtureCases[selection.index];
    if (!fixtureCase) {
      throw new Error(
        `Missing eslint-plugin-react-hooks ${fixtureName} ${selection.kind}[${selection.index}] fixture`,
      );
    }
    return {
      name: `${selection.kind}[${selection.index}]`,
      provenance: `eslint-plugin-react-hooks ${fixtureName} ${selection.kind}[${selection.index}]`,
      sourceText: fixtureCase.code,
      expectedDiagnosticCount: selection.kind === "valid" ? 0 : (fixtureCase.errorCount ?? 1),
    };
  });
};

const customImgRedundantAltFixture = imgRedundantAltFailCases[3];
if (!customImgRedundantAltFixture) {
  throw new Error("Missing OXC img-redundant-alt fail[3] fixture");
}
const standardImgRedundantAltFixture = imgRedundantAltPassCases[0];
if (!standardImgRedundantAltFixture) {
  throw new Error("Missing OXC img-redundant-alt pass[0] fixture");
}
const customImgRedundantAltSettings = TRANSLATORS["img-redundant-alt"](
  customImgRedundantAltFixture,
);
if (!customImgRedundantAltSettings) {
  throw new Error("Missing translated OXC img-redundant-alt fail[3] settings");
}

const oxcGroups: ReadonlyArray<DifferentialFixtureGroup> = [
  {
    ruleId: "no-access-key",
    severity: "warn",
    evaluationMode: "source",
    cases: buildOxcCases("no-access-key", noAccessKeyPassCases, noAccessKeyFailCases, [
      { kind: "pass", index: 0 },
      { kind: "pass", index: 2 },
      { kind: "fail", index: 0 },
      { kind: "fail", index: 5 },
      { kind: "fail", index: 1, suppress: true },
    ]),
  },
  {
    ruleId: "aria-role",
    severity: "error",
    evaluationMode: "source",
    cases: buildOxcCases("aria-role", ariaRolePassCases, ariaRoleFailCases, [
      { kind: "pass", index: 0 },
      { kind: "pass", index: 5 },
      { kind: "fail", index: 0 },
      { kind: "fail", index: 5 },
    ]),
  },
  {
    ruleId: "img-redundant-alt",
    severity: "warn",
    evaluationMode: "source",
    cases: buildOxcCases("img-redundant-alt", imgRedundantAltPassCases, imgRedundantAltFailCases, [
      { kind: "pass", index: 0 },
      { kind: "pass", index: 11 },
      { kind: "fail", index: 0 },
      { kind: "fail", index: 16 },
    ]),
  },
  {
    ruleId: "img-redundant-alt",
    severity: "warn",
    evaluationMode: "source",
    settings: customImgRedundantAltSettings,
    cases: [
      {
        name: "custom words pass[0]",
        provenance: "OXC img-redundant-alt pass[0] with translated fail[3] options",
        sourceText: standardImgRedundantAltFixture.code,
        expectedDiagnosticCount: 0,
      },
      {
        name: "custom words fail[3]",
        provenance: "OXC img-redundant-alt fail[3] translated options",
        sourceText: customImgRedundantAltFixture.code,
        expectedDiagnosticCount: 1,
      },
    ],
  },
  {
    ruleId: "tabindex-no-positive",
    severity: "warn",
    evaluationMode: "source",
    cases: buildOxcCases(
      "tabindex-no-positive",
      tabindexNoPositivePassCases,
      tabindexNoPositiveFailCases,
      [
        { kind: "pass", index: 6 },
        { kind: "pass", index: 15 },
        { kind: "fail", index: 0 },
        { kind: "fail", index: 4 },
      ],
    ),
  },
];

const reactHooksGroups: ReadonlyArray<DifferentialFixtureGroup> = [
  {
    ruleId: "rules-of-hooks",
    severity: "error",
    evaluationMode: "virtual",
    cases: buildReactHooksCases("rules-of-hooks", [
      { kind: "valid", index: 0 },
      { kind: "valid", index: 30 },
      { kind: "invalid", index: 10 },
      { kind: "invalid", index: 50 },
    ]),
  },
  {
    ruleId: "exhaustive-deps",
    severity: "warn",
    evaluationMode: "virtual",
    cases: buildReactHooksCases("exhaustive-deps", [
      { kind: "valid", index: 10 },
      { kind: "valid", index: 20 },
      { kind: "invalid", index: 3 },
      { kind: "invalid", index: 30 },
    ]),
  },
];

const regressionGroups: ReadonlyArray<DifferentialFixtureGroup> = [
  {
    ruleId: "no-eval",
    severity: "error",
    evaluationMode: "source",
    cases: [
      {
        name: "globalThis polyfill",
        provenance: "security/no-eval.regressions globalThis polyfill",
        sourceText: `const globalObject = new Function("return this")();`,
        expectedDiagnosticCount: 0,
      },
      {
        name: "dynamic Function input",
        provenance: "security/no-eval.regressions dynamic Function input",
        sourceText: `const fn = new Function("value", userExpression);`,
        expectedDiagnosticCount: 1,
      },
      {
        name: "computed global eval",
        provenance: "security/no-eval.regressions computed global form",
        sourceText: `globalThis["eval"](payload);`,
        expectedDiagnosticCount: 1,
      },
      {
        name: "shadowed eval",
        provenance: "security/no-eval.regressions shadowed lookalike",
        sourceText: `const eval = (value: string) => value; eval(payload);`,
        expectedDiagnosticCount: 0,
      },
    ],
  },
  {
    ruleId: "no-unsafe-json-parse",
    severity: "warn",
    evaluationMode: "source",
    cases: [
      {
        name: "cast member access",
        provenance: "correctness/no-unsafe-json-parse cast regression",
        sourceText: `const value = (JSON.parse(raw) as Payload).error;`,
        expectedDiagnosticCount: 1,
      },
      {
        name: "enclosing try",
        provenance: "correctness/no-unsafe-json-parse try regression",
        sourceText: `try { const value = JSON.parse(raw).error; } catch (error) { handle(error); }`,
        expectedDiagnosticCount: 0,
      },
      {
        name: "callback escapes try",
        provenance: "correctness/no-unsafe-json-parse callback regression",
        sourceText: `try { socket.onmessage = (event) => JSON.parse(event.data).items; } catch (error) { handle(error); }`,
        expectedDiagnosticCount: 1,
      },
      {
        name: "shadowed JSON",
        provenance: "correctness/no-unsafe-json-parse shadowing regression",
        sourceText: `function read(raw) { const JSON = { parse: () => ({ value: 1 }) }; return JSON.parse(raw).value; }`,
        expectedDiagnosticCount: 0,
      },
    ],
  },
  {
    ruleId: "no-direct-state-mutation",
    severity: "warn",
    evaluationMode: "source",
    cases: [
      {
        name: "lazy array mutation",
        provenance: "state-and-effects/no-direct-state-mutation Bugbot regression",
        sourceText:
          "function List() { const [items, setItems] = useState(() => []); const add = (item) => { items.push(item); }; return <button onClick={() => add(1)}>{items.length}</button>; }",
        expectedDiagnosticCount: 1,
      },
      {
        name: "opaque instance mutation",
        provenance: "state-and-effects/no-direct-state-mutation third-party instance regression",
        sourceText:
          "function Playlist() { const [queue] = useState(() => new TrackQueue()); queue.push(track); return null; }",
        expectedDiagnosticCount: 0,
      },
    ],
  },
  {
    ruleId: "no-set-state-in-render",
    severity: "warn",
    evaluationMode: "source",
    cases: [
      {
        name: "top-level setter",
        provenance: "state-and-effects/no-set-state-in-render unconditional regression",
        sourceText:
          "function Counter() { const [count, setCount] = useState(0); setCount(1); return count; }",
        expectedDiagnosticCount: 1,
      },
      {
        name: "event setter",
        provenance: "state-and-effects/no-set-state-in-render event regression",
        sourceText:
          "function Counter() { const [count, setCount] = useState(0); const onClick = () => setCount(count + 1); return <button onClick={onClick} />; }",
        expectedDiagnosticCount: 0,
      },
    ],
  },
  {
    ruleId: "no-usememo-simple-expression",
    severity: "warn",
    evaluationMode: "source",
    cases: [
      {
        name: "TS-wrapped read",
        provenance: "performance/no-usememo-simple-expression fuzz sweep",
        sourceText:
          "function C({ x }) { const memo = useMemo(() => [x], [x]); return <p>{memo!.length}</p>; }",
        expectedDiagnosticCount: 1,
      },
      {
        name: "identity-consuming alias",
        provenance: "performance/no-usememo-simple-expression fuzz sweep",
        sourceText:
          "function C({ x }) { const memo = useMemo(() => [x], [x]); const alias = memo; return <p>{alias.length}</p>; }",
        expectedDiagnosticCount: 0,
      },
    ],
  },
  {
    ruleId: "role-supports-aria-props",
    severity: "warn",
    evaluationMode: "source",
    cases: [
      {
        name: "fuzzed multiselect roles",
        provenance: "a11y/role-supports-aria-props OXC #20855 fuzz reproducer",
        sourceText:
          'const F = () => <><ul role="listbox" aria-multiselectable="true" /><div role="treegrid" aria-multiselectable="true" /></>;',
        expectedDiagnosticCount: 0,
      },
      {
        name: "unsupported role properties",
        provenance: "a11y/role-supports-aria-props prohibited-property regression",
        sourceText:
          'const F = () => <><th role="columnheader" aria-checked="true" /><button aria-selected="true" /></>;',
        expectedDiagnosticCount: 2,
      },
    ],
  },
  {
    ruleId: "no-derived-state-effect",
    severity: "warn",
    evaluationMode: "virtual",
    cases: [
      {
        name: "braceless guarded setters",
        provenance: "state-and-effects/no-derived-state-effect fuzz hardening",
        sourceText:
          'function Field({ value }) { const [draft, setDraft] = useState(value); useEffect(() => { if (value) setDraft(value); else setDraft(""); }, [value]); return draft; }',
        expectedDiagnosticCount: 1,
      },
      {
        name: "literal else-if ladder",
        provenance: "state-and-effects/no-derived-state-effect fuzz hardening",
        sourceText:
          'function Field({ value }) { const [draft, setDraft] = useState(""); useEffect(() => { if (value === "a") setDraft("A"); else if (value === "b") setDraft("B"); else setDraft(""); }, [value]); return draft; }',
        expectedDiagnosticCount: 0,
      },
    ],
  },
];

export const DIFFERENTIAL_FIXTURE_GROUPS: ReadonlyArray<DifferentialFixtureGroup> = [
  ...oxcGroups,
  ...reactHooksGroups,
  ...regressionGroups,
];

export const DIFFERENTIAL_VIRTUAL_PROJECT_CASES: ReadonlyArray<DifferentialVirtualProjectCase> = [
  {
    name: "renamed reducer through barrel",
    provenance: "no-mutating-reducer-state cross-file regression",
    ruleId: "no-mutating-reducer-state",
    severity: "error",
    files: new Map([
      [
        "src/App.tsx",
        `import { useReducer } from "react";
import { todoReducer } from "./reducers";
export const App = () => useReducer(todoReducer, { items: [] });`,
      ],
      ["src/reducers/index.ts", `export { reducer as todoReducer } from "./todo";`],
      [
        "src/reducers/todo.ts",
        `export const reducer = (state, action) => {
  state.items.push(action.item);
  return state;
};`,
      ],
    ]),
    expectedDiagnosticCountByFile: new Map([["src/App.tsx", 1]]),
  },
  {
    name: "missing reducer module",
    provenance: "no-mutating-reducer-state unresolved-module crash regression",
    ruleId: "no-mutating-reducer-state",
    severity: "error",
    files: new Map([
      [
        "src/App.tsx",
        `import { useReducer } from "react";
import { reducer } from "./missing";
export const App = () => useReducer(reducer, {});`,
      ],
    ]),
    expectedDiagnosticCountByFile: new Map(),
  },
  {
    name: "barrel import suggestion",
    provenance: "no-barrel-import renamed re-export regression",
    ruleId: "no-barrel-import",
    severity: "warn",
    files: new Map([
      [
        "src/App.tsx",
        `import { Button } from "./components";
export const App = () => <Button />;`,
      ],
      [
        "src/components/index.ts",
        `export { PrimaryButton as Button } from "./button";
export { Card } from "./card";`,
      ],
      ["src/components/button.tsx", `export const PrimaryButton = () => <button />;`],
      ["src/components/card.tsx", `export const Card = () => <section />;`],
    ]),
    expectedDiagnosticCountByFile: new Map([["src/App.tsx", 1]]),
  },
];
