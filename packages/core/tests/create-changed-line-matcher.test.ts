import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { ChangedFileLineRanges, Diagnostic } from "../src/types/index.js";
import { createChangedLineMatcher } from "../src/utils/create-changed-line-matcher.js";

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "contextual-scope-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

interface MatchInput {
  source: string;
  anchor: string;
  rule?: string;
  plugin?: string;
  ranges?: ChangedFileLineRanges["ranges"];
  deletionLines?: number[];
  contextual?: boolean;
  file?: string;
  contextRanges?: Diagnostic["contextRanges"];
}

const match = ({
  source,
  anchor,
  rule = "rerender-lazy-state-init",
  plugin = "react-doctor",
  ranges = [],
  deletionLines,
  contextual = true,
  file = "app.tsx",
  contextRanges,
}: MatchInput): boolean => {
  fs.writeFileSync(path.join(directory, file), source);
  const position = source.indexOf(anchor);
  expect(position).toBeGreaterThanOrEqual(0);
  const prefix = source.slice(0, position);
  const diagnostic: Diagnostic = {
    filePath: path.join(directory, file),
    plugin,
    rule,
    severity: "warning",
    message: "Finding",
    help: "",
    category: "Performance",
    contextRanges,
    line: prefix.split("\n").length,
    column: prefix.length - prefix.lastIndexOf("\n"),
    offset: Buffer.byteLength(prefix),
  };
  return createChangedLineMatcher({
    directory,
    changedLineRanges: [{ file, ranges, ...(deletionLines ? { deletionLines } : {}) }],
    contextual,
  })(diagnostic);
};

const FUNCTION_SOURCE = [
  'const label = "é😀";',
  "export const App = () => {",
  "  const [value] = useState(expensive());",
  "  const handler = () => {",
  "    return nested();",
  "  };",
  "  return <button>{label}{value}</button>;",
  "};",
  "export const Other = () => {",
  "  return <span />;",
  "};",
].join("\n");

const JSX_SOURCE = [
  "export const App = () => (",
  "  <section>",
  '    <button className="primary">',
  "      Save",
  "      <span>",
  "        Child",
  "      </span>",
  "    </button>",
  "    <button>Other</button>",
  "  </section>",
  ");",
].join("\n");

describe("contextual diff scope", () => {
  it.each<[number, boolean]>([
    [7, true],
    [5, false],
    [10, false],
    [1, false],
  ])("matches function-owned edits on line %s: %s", (changedLine, expected) => {
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "expensive()",
        ranges: [[changedLine, changedLine]],
      }),
    ).toBe(expected);
  });

  it("does not expand a nested callback finding to the component", () => {
    expect(match({ source: FUNCTION_SOURCE, anchor: "nested()", ranges: [[7, 7]] })).toBe(false);
  });

  it("handles a diff spanning the nested callback and the owning body", () => {
    expect(match({ source: FUNCTION_SOURCE, anchor: "expensive()", ranges: [[5, 7]] })).toBe(true);
  });

  it("preserves exact-line filtering when contextual mode is off", () => {
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "expensive()",
        ranges: [[7, 7]],
        contextual: false,
      }),
    ).toBe(false);
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "expensive()",
        ranges: [[3, 3]],
        contextual: false,
      }),
    ).toBe(true);
  });

  it.each<[number, boolean]>([
    [4, true],
    [6, false],
    [9, false],
    [2, false],
  ])("matches element-owned edits on line %s: %s", (changedLine, expected) => {
    expect(
      match({
        source: JSX_SOURCE,
        anchor: "button className",
        rule: "button-has-type",
        ranges: [[changedLine, changedLine]],
      }),
    ).toBe(expected);
  });

  it("handles self-closing elements and attribute-only edits", () => {
    expect(
      match({
        source: '<img\n loading="lazy"\n fetchPriority="high"\n alt="Photo"\n />',
        anchor: "img",
        rule: "no-img-lazy-with-high-fetchpriority",
        ranges: [[4, 4]],
      }),
    ).toBe(true);
  });

  it.each([2, 6, 7])("counts a deletion inside the function after line %s", (deletionLine) => {
    expect(
      match({ source: FUNCTION_SOURCE, anchor: "expensive()", deletionLines: [deletionLine] }),
    ).toBe(true);
  });

  it.each([0, 1, 4, 5, 8, 11])(
    "excludes a deletion outside the owner or in a nested function: %s",
    (deletionLine) => {
      expect(
        match({ source: FUNCTION_SOURCE, anchor: "expensive()", deletionLines: [deletionLine] }),
      ).toBe(false);
    },
  );

  it("counts deletion-only edits for elements", () => {
    expect(
      match({
        source: JSX_SOURCE,
        anchor: "button className",
        rule: "button-has-type",
        deletionLines: [3],
      }),
    ).toBe(true);
  });

  it("supports file rules with no added lines", () => {
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "label",
        rule: "only-export-components",
        deletionLines: [8],
      }),
    ).toBe(true);
    expect(match({ source: FUNCTION_SOURCE, anchor: "label", rule: "nextjs-no-head-import" })).toBe(
      true,
    );
  });

  it.each([
    ["unknown-rule", "react-doctor"],
    ["rerender-lazy-state-init", "third-party"],
    ["no-array-index-key", "react-doctor"],
  ])("keeps line scope for %s from %s", (rule, plugin) => {
    expect(
      match({ source: FUNCTION_SOURCE, anchor: "expensive()", rule, plugin, ranges: [[7, 7]] }),
    ).toBe(false);
  });

  it("falls back to line scope for invalid syntax", () => {
    const source = "const App = () => {\n expensive();\n return <div>\n}";
    expect(match({ source, anchor: "expensive()", ranges: [[3, 3]] })).toBe(false);
    expect(match({ source, anchor: "expensive()", ranges: [[2, 2]] })).toBe(true);
  });

  it("falls back to line scope for unsupported source formats", () => {
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "expensive()",
        file: "app.astro",
        ranges: [[7, 7]],
      }),
    ).toBe(false);
  });

  it("does not assign a module-level finding to a function", () => {
    expect(match({ source: FUNCTION_SOURCE, anchor: "label", ranges: [[7, 7]] })).toBe(false);
  });
  it("keeps exact-line findings when the source file cannot be read", () => {
    const diagnostic: Diagnostic = {
      filePath: "missing.tsx",
      plugin: "react-doctor",
      rule: "rerender-lazy-state-init",
      severity: "warning",
      message: "Finding",
      help: "",
      category: "Performance",
      line: 2,
      column: 1,
    };
    const matcher = createChangedLineMatcher({
      directory,
      contextual: true,
      changedLineRanges: [{ file: "missing.tsx", ranges: [[3, 3]] }],
    });
    expect(matcher(diagnostic)).toBe(false);
    expect(matcher({ ...diagnostic, line: 3 })).toBe(true);
  });

  it("does not report findings from files outside the change set", () => {
    const diagnostic: Diagnostic = {
      filePath: "untouched.tsx",
      plugin: "react-doctor",
      rule: "only-export-components",
      severity: "warning",
      message: "Finding",
      help: "",
      category: "Maintainability",
      line: 2,
      column: 1,
    };
    expect(
      createChangedLineMatcher({ directory, contextual: true, changedLineRanges: [] })(diagnostic),
    ).toBe(false);
  });
});

describe("explicit contextual ownership", () => {
  const source = [
    'const heading = "é😀";',
    "export const App = ({ value }) => {",
    "  const callback = () => {",
    "    console.log(value);",
    '    console.log("editing here");',
    "  };",
    "  useEffect(callback, []);",
    "  useEffect(() => {",
    '    console.log("unrelated effect");',
    "  }, []);",
    "  return <div />;",
    "};",
  ].join("\n");
  const contextRanges = [
    {
      offset: Buffer.byteLength(
        source.slice(0, source.indexOf("() => {", source.indexOf("callback"))),
      ),
      length: Buffer.byteLength(
        source.slice(
          source.indexOf("() => {", source.indexOf("callback")),
          source.indexOf("  };", source.indexOf("callback")) + 3,
        ),
      ),
    },
    {
      offset: Buffer.byteLength(source.slice(0, source.indexOf("useEffect(callback"))),
      length: Buffer.byteLength("useEffect(callback, [])"),
    },
  ];

  it.each<[number, boolean]>([
    [4, true],
    [5, true],
    [9, false],
    [11, false],
    [1, false],
  ])("matches only explicit owners for an edit on line %s", (changedLine, expected) => {
    expect(
      match({
        source,
        anchor: "[]",
        rule: "exhaustive-deps",
        contextRanges,
        ranges: [[changedLine, changedLine]],
      }),
    ).toBe(expected);
  });

  it("includes a deletion within an explicit owner", () => {
    expect(
      match({ source, anchor: "[]", rule: "exhaustive-deps", contextRanges, deletionLines: [4] }),
    ).toBe(true);
  });

  it("keeps line mode unchanged", () => {
    expect(
      match({
        source,
        anchor: "[]",
        rule: "exhaustive-deps",
        contextRanges,
        ranges: [[5, 5]],
        contextual: false,
      }),
    ).toBe(false);
  });

  it.each([
    [{ offset: -1, length: 10 }],
    [{ offset: 0, length: source.length * 2 }],
    [{ offset: 0, length: 0 }],
  ])("rejects invalid ownership ranges: %j", (...ranges) => {
    expect(
      match({
        source,
        anchor: "[]",
        rule: "exhaustive-deps",
        contextRanges: ranges,
        ranges: [[5, 5]],
      }),
    ).toBe(false);
    expect(
      match({
        source,
        anchor: "[]",
        rule: "exhaustive-deps",
        contextRanges: ranges,
        ranges: [[7, 7]],
      }),
    ).toBe(true);
  });

  it("keeps unknown rules on line scope even with ownership metadata", () => {
    expect(
      match({ source, anchor: "[]", rule: "unknown-rule", contextRanges, ranges: [[5, 5]] }),
    ).toBe(false);
  });
});

describe("expanded shorthand coverage", () => {
  it("uses function ownership for hook ordering", () => {
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "expensive()",
        rule: "rules-of-hooks",
        ranges: [[7, 7]],
      }),
    ).toBe(true);
    expect(
      match({
        source: FUNCTION_SOURCE,
        anchor: "expensive()",
        rule: "rules-of-hooks",
        ranges: [[10, 10]],
      }),
    ).toBe(false);
  });

  it.each(["alt-text", "click-events-have-key-events"])("uses element ownership for %s", (rule) => {
    expect(match({ source: JSX_SOURCE, anchor: "button className", rule, ranges: [[4, 4]] })).toBe(
      true,
    );
    expect(match({ source: JSX_SOURCE, anchor: "button className", rule, ranges: [[9, 9]] })).toBe(
      false,
    );
  });
});
