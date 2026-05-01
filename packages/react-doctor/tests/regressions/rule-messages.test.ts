/**
 * Regression tests for rule diagnostic-message accuracy. Several closed
 * issues stemmed from a rule firing on the right code but printing the
 * wrong (or generic) suggestion, sending users down the wrong fix path.
 *
 * Covered closed issues:
 *   #19 + #95 — `no-derived-state-effect` must produce TWO different
 *                messages: one for "state reset to a constant on prop
 *                change" (advise a key prop) and one for "true derived
 *                state" (advise computing during render).
 *   #83 + #126 — `nextjs-no-client-side-redirect` must adapt to the
 *                router type: Pages Router users should NOT be told to
 *                use `next/navigation` (which they don't have access to);
 *                App Router users SHOULD see that suggestion.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "../../src/utils/run-oxlint.js";
import { setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rule-messages-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("issue #19 + #95: noDerivedStateEffect dual-message behavior", () => {
  it("differentiates 'state reset' (key prop) from 'true derivation' (compute during render)", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-19-95", {
      files: {
        "src/components.tsx": `import { useEffect, useState } from "react";

// State RESET on prop change — should suggest a key prop.
export const Modal = ({ visible }: { visible: boolean }) => {
  const [inputValue, setInputValue] = useState("");
  useEffect(() => {
    setInputValue("");
  }, [visible]);
  return <input value={inputValue} onChange={(e) => setInputValue(e.target.value)} />;
};

// TRUE derived state — should suggest computing during render.
export const FullName = ({ firstName, lastName }: { firstName: string; lastName: string }) => {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(firstName + " " + lastName);
  }, [firstName, lastName]);
  return <div>{fullName}</div>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      hasTypeScript: true,
      framework: "unknown",
      hasReactCompiler: false,
      hasTanStackQuery: false,
    });

    const messages = diagnostics
      .filter((diagnostic) => diagnostic.rule === "no-derived-state-effect")
      .map((diagnostic) => diagnostic.message);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("State reset in useEffect — use a key prop"),
        expect.stringContaining("Derived state in useEffect — compute during render"),
      ]),
    );
  });
});

describe("issue #83 + #126: nextjs-no-client-side-redirect adapts to router type", () => {
  const setupNextProject = (): string =>
    setupReactProject(tempRoot, "issue-83-126", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/pages/_app.tsx": `import { useEffect } from "react";
declare const router: { replace: (path: string) => void };
export const PagesGuard = () => {
  useEffect(() => {
    router.replace("/login");
  }, []);
  return null;
};
`,
        "src/app/guard.tsx": `"use client";
import { useEffect } from "react";
declare const router: { replace: (path: string) => void };
export const AppGuard = () => {
  useEffect(() => {
    router.replace("/login");
  }, []);
  return null;
};
`,
      },
    });

  it("Pages Router message references getServerSideProps, NOT next/navigation", async () => {
    const projectDir = setupNextProject();
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      hasTypeScript: true,
      framework: "nextjs",
      hasReactCompiler: false,
      hasTanStackQuery: false,
    });

    const pagesIssue = diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "nextjs-no-client-side-redirect" &&
        diagnostic.filePath.includes("pages/_app"),
    );
    expect(pagesIssue, "expected a diagnostic on pages/_app.tsx").toBeDefined();
    expect(pagesIssue?.message).toContain("getServerSideProps");
    expect(pagesIssue?.message).not.toContain("next/navigation");
  });

  it("App Router message recommends next/navigation, NOT getServerSideProps", async () => {
    const projectDir = setupNextProject();
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      hasTypeScript: true,
      framework: "nextjs",
      hasReactCompiler: false,
      hasTanStackQuery: false,
    });

    const appIssue = diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "nextjs-no-client-side-redirect" &&
        diagnostic.filePath.includes("app/guard"),
    );
    expect(appIssue, "expected a diagnostic on app/guard.tsx").toBeDefined();
    expect(appIssue?.message).toContain("next/navigation");
    expect(appIssue?.message).not.toContain("getServerSideProps");
  });
});
