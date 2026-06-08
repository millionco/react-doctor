/**
 * Regression tests for closed issues that touch CLI flag exposure, output
 * formatting (scoring banner), and the explicit "skipped checks" surface
 * that came from the silent-failure issues.
 *
 * Covered closed issues:
 *   #43 — silent global `npm install -g` removed and must not return
 *   #50 — `--lint` exists as a positive flag so it can override a config
 *         that disables it
 *   #92 — `share: false` config option exists in the schema and is read
 *         by the scan banner
 *   #135 — lint failures surface in `skippedChecks`, never silently
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { inspect } from "../../src/inspect.js";
import type { InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import {
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../../src/cli/utils/is-ci-environment.js";
import { NON_INTERACTIVE_ENVIRONMENT_VARIABLES } from "../../src/cli/utils/is-non-interactive-environment.js";
import { resolveCliInspectOptions } from "../../src/cli/utils/resolve-cli-inspect-options.js";
import { setupReactProject, writeFile, writeJson } from "./_helpers.js";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..", "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cli-and-output-"));
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");

interface EnvironmentVariableValues {
  [environmentVariableName: string]: string | undefined;
}

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupMinimalReactProject = (caseId: string): string =>
  setupReactProject(tempRoot, caseId, {
    files: { "src/App.tsx": `export const App = () => null;\n` },
  });

const stripAnsi = (text: string): string => text.replace(ANSI_ESCAPE_PATTERN, "");

const setupCategoryFilterProject = (caseId: string): string =>
  setupReactProject(tempRoot, caseId, {
    files: {
      "src/App.tsx": `import { memo } from "react";

const MemoChild = memo((props: { payload: { label: string } }) => {
  return <span>{props.payload.label}</span>;
});

export const App = () => (
  <>
    <div dangerouslySetInnerHTML={{ __html: "<strong>Unsafe</strong>" }} />
    <MemoChild payload={{ label: "slow" }} />
  </>
);
`,
    },
  });

const listDiagnosticCategories = (result: InspectResult): string[] => [
  ...new Set(result.diagnostics.map((diagnostic) => diagnostic.category)),
];

const withAutomatedEnvironmentVariables = async <Value>(
  overrides: EnvironmentVariableValues,
  callback: () => Promise<Value>,
): Promise<Value> => {
  const savedEnvironment: EnvironmentVariableValues = {};
  const environmentVariableNames = [
    ...NON_INTERACTIVE_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  ];
  for (const environmentVariableName of environmentVariableNames) {
    savedEnvironment[environmentVariableName] = process.env[environmentVariableName];
    delete process.env[environmentVariableName];
  }
  for (const [environmentVariableName, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[environmentVariableName];
    } else {
      process.env[environmentVariableName] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const environmentVariableName of environmentVariableNames) {
      const previousValue = savedEnvironment[environmentVariableName];
      if (previousValue === undefined) {
        delete process.env[environmentVariableName];
      } else {
        process.env[environmentVariableName] = previousValue;
      }
    }
  }
};

// Capture every line `inspect()` writes to console while it runs. We use
// real I/O (logger / spinner / console.log) rather than scrub source
// text — testing observable behavior survives refactors that move
// strings around.
const captureScanOutput = async (
  projectDir: string,
  options: Parameters<typeof inspect>[1],
): Promise<{ result: InspectResult; stdout: string; stderr: string }> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => stdout.push(args.join(" "));
  console.info = (...args: unknown[]) => stdout.push(args.join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.join(" "));
  console.warn = (...args: unknown[]) => stderr.push(args.join(" "));
  try {
    const result = await inspect(projectDir, { deadCode: false, ...options });
    return { result, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.error = originalError;
    console.warn = originalWarn;
  }
};

describe("issue #50: CLI flags can re-enable lint that config disabled", () => {
  it("inspect(directory, { lint: true }) overrides a `lint: false` config", async () => {
    const projectDir = setupMinimalReactProject("issue-50-lint");
    writeJson(path.join(projectDir, "doctor.config.json"), {
      lint: false,
    });
    // Pass lint:true explicitly — the resolved options must include lint=true
    // even though the config said false.
    const { result } = await captureScanOutput(projectDir, {
      lint: true,
      noScore: true,
      silent: true,
    });
    // If lint had stayed false we'd see it in skippedChecks (or no lint
    // diagnostics regardless of the source). The scan must succeed and
    // not have lint in skippedChecks (which would mean it ran and failed).
    expect(result.skippedChecks).not.toContain("lint");
  });

  it("inspect(directory, { lint: false }) overrides a `lint: true` config", async () => {
    const projectDir = setupMinimalReactProject("issue-50-no-lint");
    writeJson(path.join(projectDir, "doctor.config.json"), { lint: true });
    const { result } = await captureScanOutput(projectDir, {
      lint: false,
      noScore: true,
      silent: true,
    });
    expect(result.diagnostics.filter((d) => d.plugin === "react-doctor")).toHaveLength(0);
  });
});

describe("issue #92: share: false config suppresses the share link in scan output", () => {
  it("ReactDoctorConfig type accepts `share: false`", () => {
    // HACK: pure type assertion. If `share` is removed from the type,
    // this file stops type-checking and the suite refuses to run.
    const config: ReactDoctorConfig = { share: false };
    expect(config.share).toBe(false);
  });

  it("the share URL appears in stdout by default and is suppressed when share=false", async () => {
    const projectDir = setupMinimalReactProject("issue-92-default");
    writeFile(
      path.join(projectDir, "src", "App.tsx"),
      `import { useState, useEffect } from "react";
export const App = ({ name }: { name: string }) => {
  const [n, setN] = useState("");
  useEffect(() => { setN(name); }, [name]);
  return <div>{n}</div>;
};
`,
    );
    const defaultRun = await captureScanOutput(projectDir, { noScore: false, warnings: true });
    expect(defaultRun.stdout).toContain("Share:");

    const projectDir2 = setupMinimalReactProject("issue-92-disabled");
    writeFile(
      path.join(projectDir2, "src", "App.tsx"),
      `import { useState, useEffect } from "react";
export const App = ({ name }: { name: string }) => {
  const [n, setN] = useState("");
  useEffect(() => { setN(name); }, [name]);
  return <div>{n}</div>;
};
`,
    );
    writeJson(path.join(projectDir2, "doctor.config.json"), { share: false });
    const disabledRun = await captureScanOutput(projectDir2, { noScore: false });
    expect(disabledRun.stdout).not.toContain("Share your results");
  });
});

describe("default CLI issue output", () => {
  it("groups default findings by category and keeps the score summary after issues", async () => {
    const projectDir = setupReactProject(tempRoot, "default-output-category-list", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const onAdd = (nextItem: string) => {
    items.push(nextItem);
    items.sort();
  };

  return <button onClick={() => onAdd("x")}>{items.length}</button>;
};
`,
      },
    });

    const localRun = await withAutomatedEnvironmentVariables({}, () =>
      captureScanOutput(projectDir, {
        lint: true,
        noScore: true,
        warnings: true,
      }),
    );
    const normalizedStdout = stripAnsi(localRun.stdout);

    expect(normalizedStdout).toContain("Bugs");
    expect(normalizedStdout).toMatch(/\d+ warnings?/);
    expect(normalizedStdout).toContain("Docs:");
    expect(normalizedStdout).toContain("Learn more about fixing issues");
    expect(normalizedStdout).not.toContain("Agent guidance");
  });

  it("prints agent guidance in automated environments", async () => {
    const projectDir = setupReactProject(tempRoot, "automated-output-agent-guidance", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const onAdd = (nextItem: string) => {
    items.push(nextItem);
  };

  return <button onClick={() => onAdd("x")}>{items.length}</button>;
};
`,
      },
    });

    const automatedRun = await withAutomatedEnvironmentVariables({ CURSOR_AGENT: "1" }, () =>
      captureScanOutput(projectDir, {
        lint: true,
        noScore: true,
        warnings: true,
      }),
    );
    const normalizedStdout = stripAnsi(automatedRun.stdout);

    expect(normalizedStdout).toContain("Agent guidance");
    expect(normalizedStdout).toContain(
      "  - Treat React Doctor diagnostics as starting hypotheses.",
    );
    expect(normalizedStdout).toContain("Confidence requires code context.");
    expect(normalizedStdout).toContain(
      "Fix the underlying code instead of changing react-doctor config",
    );
    expect(normalizedStdout).toContain("race conditions, security-sensitive flows");
    expect(normalizedStdout).toContain("theoretical issues without real impact");
    expect(normalizedStdout).toContain("npx react-doctor@latest --verbose --diff");
    expect(normalizedStdout).toContain(
      "  - Split unrelated, broad, or behavior-changing work into separate PRs/branches",
    );
    expect(normalizedStdout).toContain("  - When available, spawn subagents or isolated worktrees");
    expect(normalizedStdout).toContain(
      "  - For confirmed issues that cannot be fixed now, create GitHub issues",
    );
    expect(normalizedStdout).toContain("  - If a fix needs an API, UX, or architecture decision");
    expect(normalizedStdout.indexOf("Agent guidance")).toBeLessThan(
      normalizedStdout.indexOf("React Doctor"),
    );
  });

  it("does not print agent guidance in PR comment output", async () => {
    const projectDir = setupReactProject(tempRoot, "pr-comment-output-agent-guidance", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const onAdd = (nextItem: string) => {
    items.push(nextItem);
  };

  return <button onClick={() => onAdd("x")}>{items.length}</button>;
};
`,
      },
    });

    const automatedRun = await withAutomatedEnvironmentVariables({ GITHUB_ACTIONS: "true" }, () =>
      captureScanOutput(projectDir, {
        lint: true,
        noScore: true,
        warnings: true,
        outputSurface: "prComment",
      }),
    );

    expect(stripAnsi(automatedRun.stdout)).not.toContain("Agent guidance");
  });
});

describe("CLI category filtering", () => {
  it("lists only one category in default output without mutating the scan result", async () => {
    const projectDir = setupCategoryFilterProject("category-filter-security");
    const scanOptions = resolveCliInspectOptions({ category: "security" }, null);

    const securityRun = await withAutomatedEnvironmentVariables({}, () =>
      captureScanOutput(projectDir, {
        ...scanOptions,
        noScore: true,
        warnings: true,
      }),
    );
    const normalizedStdout = stripAnsi(securityRun.stdout);

    const resultCategories = listDiagnosticCategories(securityRun.result);
    expect(resultCategories).toContain("Performance");
    expect(resultCategories).toContain("Security");
    expect(normalizedStdout).toContain("Security");
    expect(normalizedStdout).not.toContain("Performance");
  });

  it("supports repeated category values in verbose output", async () => {
    const projectDir = setupCategoryFilterProject("category-filter-multiple");
    const scanOptions = resolveCliInspectOptions(
      { category: ["security", "performance"], verbose: true },
      null,
    );

    const categoryRun = await withAutomatedEnvironmentVariables({}, () =>
      captureScanOutput(projectDir, {
        ...scanOptions,
        noScore: true,
        warnings: true,
      }),
    );
    const categories = listDiagnosticCategories(categoryRun.result).toSorted();
    const normalizedStdout = stripAnsi(categoryRun.stdout);

    expect(categories).toContain("Performance");
    expect(categories).toContain("Security");
    expect(normalizedStdout).toContain("Security");
    expect(normalizedStdout).toContain("Performance");
    expect(normalizedStdout).not.toContain("Accessibility");
  });

  it("keeps existing config excludes in effect", async () => {
    const projectDir = setupCategoryFilterProject("category-filter-config-exclude");
    writeJson(path.join(projectDir, "doctor.config.json"), {
      surfaces: { cli: { excludeCategories: ["Security"] } },
    });
    const scanOptions = resolveCliInspectOptions({ category: "Security" }, null);

    const excludedRun = await withAutomatedEnvironmentVariables({}, () =>
      captureScanOutput(projectDir, {
        ...scanOptions,
        noScore: true,
        warnings: true,
      }),
    );

    const resultCategories = listDiagnosticCategories(excludedRun.result);
    expect(resultCategories).toContain("Performance");
    expect(resultCategories).toContain("Security");
    expect(stripAnsi(excludedRun.stdout)).toContain("No issues found in category Security");
  });

  it("keeps silent inspect results complete so CLI JSON can filter at report time", async () => {
    const projectDir = setupCategoryFilterProject("category-filter-json");
    const scanOptions = resolveCliInspectOptions({ category: "performance", json: true }, null);

    const jsonRun = await captureScanOutput(projectDir, {
      ...scanOptions,
      noScore: true,
      warnings: true,
    });

    const resultCategories = listDiagnosticCategories(jsonRun.result);
    expect(resultCategories).toContain("Performance");
    expect(resultCategories).toContain("Security");
    expect(jsonRun.stdout).toBe("");
  });
});

describe("issue #135: lint failures surface in skippedChecks", () => {
  it("inspect() returns a `skippedChecks` array on the result", async () => {
    const projectDir = setupMinimalReactProject("issue-135");
    const { result } = await captureScanOutput(projectDir, {
      lint: false,
      noScore: true,
      silent: true,
    });
    // Type contract: skippedChecks always exists as an array.
    expect(Array.isArray(result.skippedChecks)).toBe(true);
  });
});

describe("issue #43: no silent global npm install", () => {
  it("source tree contains no `npm install -g` invocation", () => {
    // HACK: walk the source tree directly instead of shelling out to `rg`,
    // so the test works on machines without ripgrep installed.
    const srcRoot = path.join(PACKAGE_ROOT, "src");
    const offendingMatches: string[] = [];
    const stack: string[] = [srcRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
        const content = fs.readFileSync(entryPath, "utf8");
        if (content.includes("npm install -g")) {
          offendingMatches.push(path.relative(PACKAGE_ROOT, entryPath));
        }
      }
    }
    expect(offendingMatches).toEqual([]);
  });
});
