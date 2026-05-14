/**
 * Regression tests for inline suppression support — closed issue #72.
 *
 * Three documented forms must all work:
 *   (a) `// react-doctor-disable-line <rule-id>` on the diagnostic's line
 *   (b) `// react-doctor-disable-next-line <rule-id>` on the line above
 *   (c) the bare comment with no rule id, which suppresses every
 *       diagnostic on the targeted line
 *
 * Multiple rule ids may be comma- or whitespace-separated, and the
 * suppression must NOT leak to neighboring lines.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { Diagnostic } from "../../src/types/diagnostic.js";
import { filterInlineSuppressions } from "../../src/core/diagnostics/filter-diagnostics.js";
import { createNodeReadFileLinesSync } from "../../src/core/read-file-lines-node.js";
import { buildDiagnostic, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-inline-suppression-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// HACK: each test allocates its own per-test directory so they can run
// in parallel without racing on the same `src/app.tsx` file.
// NOTE: filename case must match `buildDiagnostic`'s default `filePath:
// "src/app.tsx"` — Linux CI is case-sensitive and resolving a diagnostic
// with a mismatched case returns `null`, so no suppression is applied.
const runFilter = (
  caseId: string,
  fileContents: string,
  diagnostics: Diagnostic[],
): Diagnostic[] => {
  const projectDir = path.join(tempRoot, caseId);
  writeFile(path.join(projectDir, "src", "app.tsx"), fileContents);
  return filterInlineSuppressions(diagnostics, projectDir, createNodeReadFileLinesSync(projectDir));
};

const baseDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic =>
  buildDiagnostic({ rule: "no-derived-state-effect", ...overrides });

describe("issue #72: inline suppressions — variants", () => {
  it("disable-line suppresses a diagnostic on the SAME line", () => {
    const filtered = runFilter(
      "disable-line-same",
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\n`,
      [baseDiagnostic({ line: 1 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("disable-next-line suppresses a diagnostic on the line BELOW", () => {
    const filtered = runFilter(
      "disable-next-line",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
      [baseDiagnostic({ line: 2 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("comma-separated rule list suppresses only the listed rules", () => {
    const filtered = runFilter(
      "comma-list",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect, react-doctor/no-fetch-in-effect\nconst x = 1;\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 2 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 2 }),
        baseDiagnostic({ rule: "no-cascading-set-state", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-cascading-set-state");
  });

  it("whitespace-separated rule list also works", () => {
    const filtered = runFilter(
      "ws-list",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect react-doctor/no-fetch-in-effect\nconst x = 1;\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 2 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("a bare disable comment (no rule id) suppresses EVERY diagnostic on that line", () => {
    const filtered = runFilter("bare-comment", `const x = 1; // react-doctor-disable-line\n`, [
      baseDiagnostic({ rule: "no-derived-state-effect", line: 1 }),
      baseDiagnostic({ rule: "no-fetch-in-effect", line: 1 }),
    ]);
    expect(filtered).toHaveLength(0);
  });
});

describe("issue #144: inline suppressions — block comment forms", () => {
  it("plain block disable-next-line suppresses the line BELOW", () => {
    const filtered = runFilter(
      "block-disable-next-line",
      `/* react-doctor-disable-next-line react-doctor/no-derived-state-effect */\nconst x = 1;\n`,
      [baseDiagnostic({ line: 2 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("plain block disable-line suppresses the SAME line", () => {
    const filtered = runFilter(
      "block-disable-line",
      `const x = 1; /* react-doctor-disable-line react-doctor/no-derived-state-effect */\n`,
      [baseDiagnostic({ line: 1 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("JSX-style block disable-next-line `{/* … */}` works for tsx files", () => {
    const filtered = runFilter(
      "jsx-block-disable-next-line",
      `{/* react-doctor-disable-next-line react/no-danger */}\n<div dangerouslySetInnerHTML={{ __html }} />\n`,
      [baseDiagnostic({ plugin: "react", rule: "no-danger", line: 2 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("JSX-style block disable-line `{/* … */}` works for tsx files", () => {
    const filtered = runFilter(
      "jsx-block-disable-line",
      `<div dangerouslySetInnerHTML={{ __html }} /> {/* react-doctor-disable-line react/no-danger */}\n`,
      [baseDiagnostic({ plugin: "react", rule: "no-danger", line: 1 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("block bare disable-next-line `{/* … */}` (no rule id) suppresses EVERY diagnostic on the next line", () => {
    const filtered = runFilter(
      "jsx-block-bare",
      `{/* react-doctor-disable-next-line */}\n<div dangerouslySetInnerHTML={{ __html }} />\n`,
      [
        baseDiagnostic({ plugin: "react", rule: "no-danger", line: 2 }),
        baseDiagnostic({ plugin: "react-doctor", rule: "no-derived-state-effect", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("block comma-separated rule list inside `{/* … */}` suppresses only listed rules", () => {
    const filtered = runFilter(
      "jsx-block-comma",
      `{/* react-doctor-disable-next-line react-doctor/no-derived-state-effect, react-doctor/no-fetch-in-effect */}\nconst x = 1;\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 2 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 2 }),
        baseDiagnostic({ rule: "no-cascading-set-state", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-cascading-set-state");
  });
});

describe("issue #158: disable-next-line covers multi-line JSX opening tags", () => {
  it("suppresses an attribute-line diagnostic when the comment sits above the JSX opener", () => {
    const filtered = runFilter(
      "jsx-multiline-opener-line-comment",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `<li\n` +
        `  key={"x"}\n` +
        `  role="button"\n` +
        `>\n` +
        `</li>\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("works with the JSX block-comment form `{/* … */}` above the opener", () => {
    const filtered = runFilter(
      "jsx-multiline-opener-block-comment",
      `<>\n` +
        `  {/* react-doctor-disable-next-line react-doctor/no-derived-state-effect */}\n` +
        `  <li\n` +
        `    key={"x"}\n` +
        `  >\n` +
        `  </li>\n` +
        `</>\n`,
      [baseDiagnostic({ line: 4 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("does NOT extend coverage to children inside the element body (only to the opening tag)", () => {
    const filtered = runFilter(
      "jsx-multiline-opener-children-not-covered",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `<li\n` +
        `  key={"x"}\n` +
        `>\n` +
        `  text\n` +
        `</li>\n`,
      [baseDiagnostic({ line: 5 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("ignores `>` characters inside `{...}` expressions when finding the opener's close", () => {
    const filtered = runFilter(
      "jsx-multiline-opener-with-expression",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `<Banner\n` +
        `  show={count > 0}\n` +
        `  onClick={() => doStuff()}\n` +
        `/>\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("still suppresses when the comment sits inside the opener attributes (issue #144 form)", () => {
    const filtered = runFilter(
      "jsx-comment-inside-opener",
      `<li\n` +
        `  {/* react-doctor-disable-next-line react-doctor/no-derived-state-effect */}\n` +
        `  key={"x"}\n` +
        `>\n` +
        `</li>\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("does NOT suppress when the `<Tag` lives in a `//` line comment above the diagnostic", () => {
    const filtered = runFilter(
      "jsx-fake-opener-line-comment",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `// docs example: <Foo bar={x} />\n` +
        `if (x > 1) doStuff();\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("recognizes generic-typed JSX components (`<List<Item>`) so attribute-line diagnostics still suppress", () => {
    const filtered = runFilter(
      "jsx-multiline-generic-component",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `<List<Item>\n` +
        `  data={items}\n` +
        `/>\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(0);
  });
});

describe("issue #159: stacked disable-next-line comments", () => {
  it("two stacked single-rule comments suppress two co-firing rules on the next line", () => {
    const filtered = runFilter(
      "stacked-two-rules",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\n` +
        `const x = 1;\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 3 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 3 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("three stacked single-rule comments all apply", () => {
    const filtered = runFilter(
      "stacked-three-rules",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\n` +
        `// react-doctor-disable-next-line react-doctor/no-cascading-set-state\n` +
        `useEffect(() => {});\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 4 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 4 }),
        baseDiagnostic({ rule: "no-cascading-set-state", line: 4 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("a code line between stacked comments breaks the chain", () => {
    const filtered = runFilter(
      "stacked-broken-chain",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `const intervening = 1;\n` +
        `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\n` +
        `const x = 1;\n`,
      [baseDiagnostic({ rule: "no-derived-state-effect", line: 4 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("issue repro: stacked single-rule disables both apply on a useState line", () => {
    const filtered = runFilter(
      "stacked-issue-repro",
      `// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers -- read in render via useDebounce\n` +
        `// react-doctor-disable-next-line react-doctor/no-derived-useState -- searchQuery is the initial value; user can type before debounce commits\n` +
        `const [localSearch, setLocalSearch] = useState(searchQuery);\n`,
      [
        baseDiagnostic({ rule: "rerender-state-only-in-handlers", line: 3 }),
        baseDiagnostic({ rule: "no-derived-useState", line: 3 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("equivalent comma-separated form (referenced in #159) also suppresses both rules", () => {
    const filtered = runFilter(
      "stacked-issue-repro-comma",
      `// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers, react-doctor/no-derived-useState -- searchQuery initial; read in render via useDebounce\n` +
        `const [localSearch, setLocalSearch] = useState(searchQuery);\n`,
      [
        baseDiagnostic({ rule: "rerender-state-only-in-handlers", line: 2 }),
        baseDiagnostic({ rule: "no-derived-useState", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });
});

describe("issue #72: inline suppressions — boundary safety", () => {
  it("disable-line on line N does NOT suppress diagnostics on line N+1", () => {
    const filtered = runFilter(
      "boundary-line",
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\nconst y = 2;\n`,
      [baseDiagnostic({ line: 2 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("disable-next-line on line N does NOT suppress diagnostics on line N+2", () => {
    const filtered = runFilter(
      "boundary-next-line",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\nconst y = 2;\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("does not suppress a different rule on the same line when a specific rule is listed", () => {
    const filtered = runFilter(
      "boundary-rule-mismatch",
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\n`,
      [baseDiagnostic({ rule: "no-fetch-in-effect", line: 1 })],
    );
    expect(filtered).toHaveLength(1);
  });
});
