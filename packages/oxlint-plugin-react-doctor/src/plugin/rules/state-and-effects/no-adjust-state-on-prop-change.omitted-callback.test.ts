import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const PANEL =
  'import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";\nexport default function Panel({ scope, onRun }: { scope: string; onRun?: () => void }) {\n  const [attempt, setAttempt] = useState<{ scope: string } | null>(null);\n  const attemptRef = useRef<{ scope: string } | null>(null);\n  const previous = useRef(scope);\n  const activate = useCallback(() => {\n    if (!onRun) return;\n    const next = { scope };\n    attemptRef.current = next;\n    setAttempt(next);\n    onRun();\n  }, [onRun]);\n  \n  useEffect(() => {\n    if (previous.current === scope) return;\n    previous.current = scope;\n    const captured = attemptRef.current;\n    attemptRef.current = null;\n    setAttempt(cur => cur === captured ? null : cur);\n  }, [scope]);\n  return <><button onClick={activate}>Activate</button><span>{attempt ? "Active" : "Idle"}</span></>;\n}\n';
let project: string;
let filename: string;
const place = (relative: string, text: string): string => {
  const target = join(project, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
};
const placePage = (attributes = "") =>
  place(
    "app/page.tsx",
    `import Panel from "../components/Panel";
export default function Page() { return <Panel scope="one" ${attributes} />; }`,
  );
const check = (source: string, upstream = false) => {
  place("components/Panel.tsx", source);
  return runRule(noAdjustStateOnPropChange, source, {
    filename,
    ...(upstream ? { settings: { "react-doctor": { portedRuleMode: "upstream" } } } : {}),
  });
};
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "rd-private-activation-reset-"));
  place(
    "package.json",
    JSON.stringify({
      private: true,
      scripts: { build: "next build" },
      dependencies: { next: "15.1.0", react: "19.2.0", "react-dom": "19.2.0" },
    }),
  );
  place("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "preserve" } }));
  filename = place("components/Panel.tsx", PANEL);
  resetManifestCaches();
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  resetManifestCaches();
});

describe("no-adjust-state-on-prop-change private activation", () => {
  it("leaves the unreachable reset quiet only in curated mode", () => {
    placePage();
    const curated = check(PANEL);
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toEqual([]);
    const upstream = check(PANEL, true);
    expect(upstream.parseErrors).toEqual([]);
    expect(upstream.diagnostics.length).toBeGreaterThan(0);
  });
  it.each(["onRun={() => {}}", "{...{ onRun: () => {} }}"])(
    "retains the reset when the caller supplies activation: %s",
    (attributes) => {
      placePage(attributes);
      expect(check(PANEL).diagnostics.length).toBeGreaterThan(0);
    },
  );
  it("retains an independently rearmed layout writer", () => {
    placePage();
    const source = PANEL.replace(
      "  useEffect(() => {",
      `  useLayoutEffect(() => {
      const next = { scope }; attemptRef.current = next; setAttempt(next);
    }, [scope]);
    useEffect(() => {`,
    );
    expect(check(source).diagnostics.length).toBeGreaterThan(0);
  });
  it("retains a destructuring write through the ref", () => {
    placePage();
    const source = PANEL.replace(
      "  useEffect(() => {",
      "  [attemptRef.current] = [{ scope }]; useEffect(() => {",
    );
    expect(check(source).diagnostics.length).toBeGreaterThan(0);
  });
  it("retains a destructuring reassignment of the activation prop", () => {
    placePage();
    const source = PANEL.replace(
      "  useEffect(() => {",
      "  [onRun] = [() => {}]; useEffect(() => {",
    );
    expect(check(source).diagnostics.length).toBeGreaterThan(0);
  });
  it("retains the namespace import outside the named-import certificate", () => {
    placePage();
    const source = PANEL.replace(
      'import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";',
      'import * as React from "react";',
    ).replace(/\b(useCallback|useEffect|useLayoutEffect|useRef|useState)\(/g, "React.$1(");
    expect(check(source).diagnostics.length).toBeGreaterThan(0);
  });
  it("records incoming caller content and directory probes", () => {
    const consumer = placePage();
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: PANEL,
      ruleIds: ["no-adjust-state-on-prop-change"],
    });
    expect(trace?.contentPaths.has(consumer)).toBe(true);
    expect(trace?.directoryPaths.has(dirname(consumer))).toBe(true);
  });
});
