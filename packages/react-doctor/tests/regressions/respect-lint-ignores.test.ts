/**
 * Regression tests for the `respectInlineDisables` config option.
 *
 * By default, react-doctor honors the project's existing lint ignores:
 *   - `.eslintignore` / `.oxlintignore` files (file-level skip)
 *   - `// eslint-disable*` and `// oxlint-disable*` source comments
 *     (line / next-line / file suppression)
 *
 * Setting `respectInlineDisables: false` flips into audit mode, which
 * neutralizes those suppressions before linting so every diagnostic is
 * reported regardless of historical hide-comments.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  clearIgnorePatternsCache,
  collectIgnorePatterns,
} from "../../src/core/collect-ignore-patterns.js";
import { runOxlint } from "../../src/core/run-oxlint.js";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-respect-lint-ignores-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupCase = (caseId: string, files: Record<string, string>): string =>
  setupReactProject(tempRoot, caseId, { files });

// A snippet that reliably triggers `react-doctor/no-derived-state-effect`,
// so we can assert presence/absence of that diagnostic per case.
const DERIVED_STATE_SOURCE = `import { useEffect, useState } from "react";

export const FullName = ({ first, last }: { first: string; last: string }) => {
  const [full, setFull] = useState("");
  useEffect(() => {
    setFull(first + " " + last);
  }, [first, last]);
  return <div>{full}</div>;
};
`;

describe("default behavior: respect existing eslint/oxlint suppressions", () => {
  it("a `// oxlint-disable-next-line` comment on the offending line silences the diagnostic", async () => {
    const projectDir = setupCase("oxlint-disable-next-line", {
      "src/component.tsx": `import { useEffect, useState } from "react";

export const FullName = ({ first, last }: { first: string; last: string }) => {
  const [full, setFull] = useState("");
  // oxlint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    setFull(first + " " + last);
  }, [first, last]);
  return <div>{full}</div>;
};
`,
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    const derivedStateHits = diagnostics.filter((d) => d.rule === "no-derived-state-effect");
    expect(derivedStateHits).toHaveLength(0);
  });

  it("a `// eslint-disable-next-line` comment also silences the diagnostic (oxlint reads both)", async () => {
    const projectDir = setupCase("eslint-disable-next-line", {
      "src/component.tsx": `import { useEffect, useState } from "react";

export const FullName = ({ first, last }: { first: string; last: string }) => {
  const [full, setFull] = useState("");
  // eslint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    setFull(first + " " + last);
  }, [first, last]);
  return <div>{full}</div>;
};
`,
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(diagnostics.filter((d) => d.rule === "no-derived-state-effect")).toHaveLength(0);
  });

  it("an `.oxlintignore` file skips the listed source file entirely", async () => {
    const projectDir = setupCase("oxlintignore", {
      "src/skipped.tsx": DERIVED_STATE_SOURCE,
      ".oxlintignore": "src/skipped.tsx\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/skipped.tsx"],
    });

    expect(diagnostics).toEqual([]);
  });

  it("an `.eslintignore` file skips the listed source file entirely (oxlint default)", async () => {
    const projectDir = setupCase("eslintignore", {
      "src/skipped.tsx": DERIVED_STATE_SOURCE,
      ".eslintignore": "src/skipped.tsx\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/skipped.tsx"],
    });

    expect(diagnostics).toEqual([]);
  });
});

describe("default behavior: respect additional ignore-file sources", () => {
  it("an `.prettierignore` file skips listed source files (same gitignore syntax)", async () => {
    const projectDir = setupCase("prettierignore", {
      "src/skipped.tsx": DERIVED_STATE_SOURCE,
      ".prettierignore": "src/skipped.tsx\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/skipped.tsx"],
    });

    expect(diagnostics).toEqual([]);
  });

  it("respects `.eslintignore` AND `.oxlintignore` simultaneously (regression: --ignore-path used to clobber the eslintignore default)", async () => {
    const projectDir = setupCase("both-ignore-files", {
      "src/from-eslintignore.tsx": DERIVED_STATE_SOURCE,
      "src/from-oxlintignore.tsx": DERIVED_STATE_SOURCE,
      "src/normal.tsx": DERIVED_STATE_SOURCE,
      ".eslintignore": "src/from-eslintignore.tsx\n",
      ".oxlintignore": "src/from-oxlintignore.tsx\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/from-eslintignore.tsx", "src/from-oxlintignore.tsx", "src/normal.tsx"],
    });

    const filesWithIssues = new Set(diagnostics.map((d) => d.filePath));
    // Only the non-ignored file should produce diagnostics.
    expect(filesWithIssues.has("src/from-eslintignore.tsx")).toBe(false);
    expect(filesWithIssues.has("src/from-oxlintignore.tsx")).toBe(false);
    expect(filesWithIssues.has("src/normal.tsx")).toBe(true);
  });

  it("respects `.gitattributes` linguist-vendored / linguist-generated path specs", async () => {
    const projectDir = setupCase("gitattributes-linguist", {
      "src/vendored.tsx": DERIVED_STATE_SOURCE,
      "src/generated.tsx": DERIVED_STATE_SOURCE,
      "src/normal.tsx": DERIVED_STATE_SOURCE,
      ".gitattributes":
        "src/vendored.tsx linguist-vendored\nsrc/generated.tsx linguist-generated=true\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/vendored.tsx", "src/generated.tsx", "src/normal.tsx"],
    });

    const filesWithIssues = new Set(diagnostics.map((d) => d.filePath));
    expect(filesWithIssues.has("src/vendored.tsx")).toBe(false);
    expect(filesWithIssues.has("src/generated.tsx")).toBe(false);
    expect(filesWithIssues.has("src/normal.tsx")).toBe(true);
  });

  it("does NOT skip files marked `linguist-vendored=false` (explicit opt-in to linting)", async () => {
    const projectDir = setupCase("gitattributes-opt-in", {
      "src/please-lint-me.tsx": DERIVED_STATE_SOURCE,
      ".gitattributes": "src/please-lint-me.tsx linguist-vendored=false\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/please-lint-me.tsx"],
    });

    const filesWithIssues = new Set(diagnostics.map((d) => d.filePath));
    expect(filesWithIssues.has("src/please-lint-me.tsx")).toBe(true);
  });

  it("dedups when the same path appears in `.oxlintignore` AND `.prettierignore`", async () => {
    // No way to observe duplication directly via runOxlint output, so
    // this test exercises the collector in isolation.
    const projectDir = setupCase("dedup-ignores", {
      ".oxlintignore": "dist/**\n",
      ".prettierignore": "dist/**\nbuild/**\n",
    });
    clearIgnorePatternsCache();
    const patterns = collectIgnorePatterns(projectDir);
    expect(patterns).toEqual(["dist/**", "build/**"]);
  });
});

describe("audit mode: respectInlineDisables=false neutralizes suppressions", () => {
  it("re-flags a diagnostic that was suppressed by `// oxlint-disable-next-line`", async () => {
    const projectDir = setupCase("audit-oxlint-disable", {
      "src/component.tsx": `import { useEffect, useState } from "react";

export const FullName = ({ first, last }: { first: string; last: string }) => {
  const [full, setFull] = useState("");
  // oxlint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    setFull(first + " " + last);
  }, [first, last]);
  return <div>{full}</div>;
};
`,
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      respectInlineDisables: false,
    });

    expect(
      diagnostics.some((d) => d.rule === "no-derived-state-effect"),
      "expected no-derived-state-effect to fire even though the line is disabled",
    ).toBe(true);

    // The on-disk file must be restored to its original contents after the run.
    const restored = fs.readFileSync(path.join(projectDir, "src/component.tsx"), "utf8");
    expect(restored).toContain("// oxlint-disable-next-line");
  });

  it("re-flags a diagnostic that was suppressed by `// eslint-disable-next-line`", async () => {
    const projectDir = setupCase("audit-eslint-disable", {
      "src/component.tsx": `import { useEffect, useState } from "react";

export const FullName = ({ first, last }: { first: string; last: string }) => {
  const [full, setFull] = useState("");
  // eslint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    setFull(first + " " + last);
  }, [first, last]);
  return <div>{full}</div>;
};
`,
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      respectInlineDisables: false,
    });

    expect(diagnostics.some((d) => d.rule === "no-derived-state-effect")).toBe(true);

    const restored = fs.readFileSync(path.join(projectDir, "src/component.tsx"), "utf8");
    expect(restored).toContain("// eslint-disable-next-line");
  });

  it("audit mode does NOT bypass `.oxlintignore` (file-level skip is intentional, not a 'suppression')", async () => {
    // Audit mode is about prior INLINE suppressions. File-level
    // ignores are typically used for vendored / generated code that
    // really shouldn't be linted at all, even in audit runs.
    const projectDir = setupCase("audit-oxlintignore", {
      "src/skipped.tsx": DERIVED_STATE_SOURCE,
      ".oxlintignore": "src/skipped.tsx\n",
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      includePaths: ["src/skipped.tsx"],
      respectInlineDisables: false,
    });

    expect(diagnostics).toEqual([]);
  });
});
