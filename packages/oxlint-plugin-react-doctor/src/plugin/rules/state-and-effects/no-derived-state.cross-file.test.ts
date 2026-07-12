import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearTsconfigAliasCacheForTests } from "../../utils/resolve-tsconfig-alias.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";
import { noInitializeState } from "./no-initialize-state.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "no-derived-state-helper-"));
  __clearParseSourceFileCacheForTests();
  __clearTsconfigAliasCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const runConsumer = (
  source: string,
  rule: typeof noDerivedState = noDerivedState,
): ReturnType<typeof runRule> => {
  const consumerPath = writeFile("src/App.tsx", source);
  return runRule(rule, source, { filename: consumerPath });
};

describe("no-derived-state — cross-file helper return summaries", () => {
  it("flags a render-phase mirror through an imported pure helper", () => {
    writeFile("src/derive-label.ts", `export const deriveLabel = (value) => value.trim();\n`);
    const result = runConsumer(`
import { deriveLabel } from "./derive-label";
function Field({ value }) {
  const previousValue = useRef(value);
  const [label, setLabel] = useState(deriveLabel(value));
  if (value !== previousValue.current) {
    previousValue.current = value;
    setLabel(deriveLabel(value));
  }
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a named helper imported under an alias", () => {
    writeFile(
      "src/select-visible.ts",
      `
export const selectVisible = (items, ignoredMeasurement) =>
  items.filter((item) => item.visible);
`,
    );
    const result = runConsumer(`
import { selectVisible as deriveVisible } from "./select-visible";
function List({ items }) {
  const measurementRef = useRef(null);
  const [visibleItems, setVisibleItems] = useState([]);
  useEffect(() => {
    setVisibleItems(deriveVisible(items, measurementRef));
  }, [items]);
  return visibleItems.length;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      dependencies: "[value]",
      name: "no-adjust-state-on-prop-change",
      rule: noAdjustStateOnPropChange,
    },
    { dependencies: "[value]", name: "no-derived-state", rule: noDerivedState },
    { dependencies: "[value]", name: "no-derived-state-effect", rule: noDerivedStateEffect },
    { dependencies: "[]", name: "no-initialize-state", rule: noInitializeState },
  ])("shares imported helper provenance with $name", ({ dependencies, rule }) => {
    writeFile("src/derive-label.ts", `export const deriveLabel = (value) => value.trim();\n`);
    const result = runConsumer(
      `
import { deriveLabel } from "./derive-label";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(deriveLabel(value));
  }, ${dependencies});
  return label;
}
`,
      rule,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      dependencies: "[value]",
      name: "no-adjust-state-on-prop-change",
      rule: noAdjustStateOnPropChange,
    },
    { dependencies: "[value]", name: "no-derived-state", rule: noDerivedState },
    { dependencies: "[value]", name: "no-derived-state-effect", rule: noDerivedStateEffect },
    { dependencies: "[]", name: "no-initialize-state", rule: noInitializeState },
  ])("keeps external-value helpers unknown for $name", ({ dependencies, rule }) => {
    writeFile(
      "src/derive-label.ts",
      `export const deriveLabel = (value, measurement) => value + measurement.current;\n`,
    );
    const result = runConsumer(
      `
import { deriveLabel } from "./derive-label";
function Field({ value }) {
  const measurementRef = useRef(null);
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(deriveLabel(value, measurementRef));
  }, ${dependencies});
  return label;
}
`,
      rule,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a default helper only when every control path returns", () => {
    writeFile(
      "src/derive-label.ts",
      `
export default function deriveLabel(value) {
  if (value) return value.trim();
  return "";
}
`,
    );
    const result = runConsumer(`
import deriveLabel from "./derive-label";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(deriveLabel(value));
  }, [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows renamed re-exports and consumer aliases", () => {
    writeFile(
      "src/internal.ts",
      `export const internalLabel = (value) => ({ text: value.profile.name.trim() });\n`,
    );
    writeFile("src/labels.ts", `export { internalLabel as selectLabel } from "./internal";\n`);
    writeFile("src/index.ts", `export { selectLabel } from "./labels";\n`);
    const result = runConsumer(`
import { selectLabel as deriveLabel } from "./index";
function Field({ value }) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    setLabel(deriveLabel(value));
  }, [value]);
  return label?.text;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows a unique export-star chain", () => {
    writeFile("src/derive-label.ts", `export const deriveLabel = (value) => value.trim();\n`);
    writeFile("src/labels.ts", `export * from "./derive-label";\n`);
    const result = runConsumer(`
import { deriveLabel } from "./labels";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveLabel(value)), [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps ambiguous export-star bindings unknown", () => {
    writeFile("src/first.ts", `export const deriveLabel = (value) => value.trim();\n`);
    writeFile("src/second.ts", `export const deriveLabel = (value) => value.toUpperCase();\n`);
    writeFile("src/labels.ts", `export * from "./first";\nexport * from "./second";\n`);
    const result = runConsumer(`
import { deriveLabel } from "./labels";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveLabel(value)), [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps cyclic re-export chains unknown", () => {
    writeFile("src/first.ts", `export * from "./second";\n`);
    writeFile("src/second.ts", `export * from "./first";\n`);
    const result = runConsumer(`
import { deriveLabel } from "./first";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveLabel(value)), [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("summarizes the implementation behind TypeScript overloads", () => {
    writeFile(
      "src/derive-label.ts",
      `
export function deriveLabel(value: string): string;
export function deriveLabel(value: string): string {
  return value.trim();
}
`,
    );
    const result = runConsumer(`
import { deriveLabel } from "./derive-label";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveLabel(value)), [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a project-local tsconfig alias through normalized paths", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@helpers/*": ["src/lib/*"] } } }),
    );
    writeFile("src/lib/derive-label.ts", `export const deriveLabel = (value) => value.trim();\n`);
    const result = runConsumer(`
import { deriveLabel } from "@helpers/nested/../derive-label";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveLabel(value)), [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["incomplete returns", `export const derive = (value) => { if (value) return value.trim(); };`],
    [
      "side effects",
      `export const derive = (value) => { analytics.track(value); return value.trim(); };`,
    ],
    [
      "callback side effects",
      `export const derive = (value) => value.map((item) => { analytics.track(item); return item; });`,
    ],
    ["external calls", `export const derive = (value) => readExternal(value);`],
    [
      "deferred callbacks",
      `export const derive = (value) => Promise.resolve(value).then((next) => next.trim());`,
    ],
    ["recursive calls", `export const derive = (value) => value ? derive(value.slice(1)) : value;`],
    ["destructured parameters", `export const derive = ({ value }) => value.trim();`],
    ["mutable free values", `let suffix = "!"; export const derive = (value) => value + suffix;`],
  ])("keeps cross-file %s unknown", (_scenario, helperSource) => {
    writeFile("src/derive.ts", `${helperSource}\n`);
    const result = runConsumer(`
import { derive } from "./derive";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(derive(value)), [value]);
  return label;
}
`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("invalidates the parsed helper summary when the dependency changes", () => {
    const helperPath = writeFile(
      "src/derive-label.ts",
      `export const deriveLabel = (value) => value.trim();\n`,
    );
    const source = `
import { deriveLabel } from "./derive-label";
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(deriveLabel(value));
  }, [value]);
  return label;
}
`;
    expect(runConsumer(source).diagnostics).toHaveLength(1);

    fs.writeFileSync(
      helperPath,
      `export const deriveLabel = (value) => readExternal(value);\n`,
      "utf8",
    );
    expect(runConsumer(source).diagnostics).toEqual([]);
  });

  it("rejects namespace, bare-package, unresolved, and declaration-only imports", () => {
    writeFile("src/helpers.ts", `export const deriveLabel = (value) => value.trim();\n`);
    writeFile("src/some-package.ts", `export const deriveLabel = (value) => value.trim();\n`);
    const absoluteHelperPath = writeFile(
      "src/absolute.ts",
      `export const deriveLabel = (value) => value.trim();\n`,
    );
    writeFile(
      "src/types.d.ts",
      `export declare const deriveFromTypes: (value: string) => string;\n`,
    );
    writeFile("src/type-barrel.ts", `export type { deriveLabel as derive } from "./helpers";\n`);
    writeFile("src/namespace-barrel.ts", `export * as derive from "./helpers";\n`);
    writeFile("src/broken.ts", `export const deriveBroken = (value) => <<< value;\n`);
    const cases = [
      `
import * as helpers from "./helpers";
const derive = helpers.deriveLabel;
`,
      `
import { deriveLabel as derive } from "some-package";
`,
      `
import type { deriveLabel as derive } from "./helpers";
`,
      `
import { derive } from "./type-barrel";
`,
      `
import { derive } from "./namespace-barrel";
`,
      `
import { deriveLabel as derive } from ${JSON.stringify(absoluteHelperPath)};
`,
      `
import { deriveLabel as derive } from "./missing";
`,
      `
import { deriveFromTypes as derive } from "./types";
`,
      `
import { deriveBroken as derive } from "./broken";
`,
      `
const derive = (value) => import("./helpers").then((helpers) => helpers.deriveLabel(value));
`,
    ];
    for (const importSource of cases) {
      const result = runConsumer(`
${importSource}
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(derive(value));
  }, [value]);
  return label;
}
`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });
});
