import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-diagnose-api-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("diagnose() programmatic API", () => {
  // Regression: pre-fix the programmatic `diagnose()` entry forgot to
  // forward `reactMajorVersion` to `runOxlint`. After the directional
  // version-gating change, that meant every "prefer-newer-api" rule
  // (today: `prefer-use-effect-event`) was silently skipped for all
  // programmatic API consumers, even on React 19+ projects. The CLI
  // entry (`scan.ts`) was unaffected because it always passed the
  // version explicitly.
  it("emits prefer-use-effect-event diagnostics on a React 19 project (the prefer-newer-api version-gated rule fires)", async () => {
    const projectDir = setupReactProject(tempRoot, "diagnose-prefer-use-effect-event-fires", {
      files: {
        "src/Debounced.tsx": `import { useEffect, useState } from "react";

export const Debounced = ({ onChange }: { onChange: (value: string) => void }) => {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return <input value={text} onChange={(event) => setText(event.target.value)} />;
};
`,
      },
    });

    const result = await diagnose(projectDir, { lint: true, deadCode: false });
    const preferUseEffectEventHits = result.diagnostics.filter(
      (diagnostic) => diagnostic.rule === "prefer-use-effect-event",
    );
    expect(preferUseEffectEventHits.length).toBeGreaterThanOrEqual(1);
  });

  it("STILL emits prefer-use-effect-event when the React version cannot be resolved (assume latest)", async () => {
    // When the React major can't be parsed (custom resolver, git URL,
    // workspace:* without a resolved manifest) we optimistically assume
    // the latest React major and apply every rule, including the
    // `prefer-newer-api` ones. Hiding the suggestion would silently
    // degrade the scan whenever React resolves through an unusual path.
    const projectDir = setupReactProject(tempRoot, "diagnose-prefer-use-effect-event-fallback", {
      reactVersion: "github:facebook/react",
      files: {
        "src/Debounced.tsx": `import { useEffect, useState } from "react";

export const Debounced = ({ onChange }: { onChange: (value: string) => void }) => {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return <input value={text} onChange={(event) => setText(event.target.value)} />;
};
`,
      },
    });

    const result = await diagnose(projectDir, { lint: true, deadCode: false });
    const preferUseEffectEventHits = result.diagnostics.filter(
      (diagnostic) => diagnostic.rule === "prefer-use-effect-event",
    );
    expect(preferUseEffectEventHits.length).toBeGreaterThanOrEqual(1);
  });

  // Regression: external review pipelines (e.g. the Vercel AI Code
  // Review sandbox) call `diagnose()` on the cloned repo root. Some
  // repos place their app code under `apps/web` (or similar) with NO
  // root `package.json`, which previously crashed the runner with
  // `No package.json found in <repo>`. We now fall back to the first
  // nested package.json that has a React dependency.
  it("falls back to a nested React subproject when the requested directory has no root package.json", async () => {
    const wrapperDir = path.join(tempRoot, "diagnose-no-root-package");
    fs.mkdirSync(wrapperDir, { recursive: true });
    setupReactProject(wrapperDir, "web");

    const result = await diagnose(wrapperDir, { lint: false, deadCode: false });
    expect(result.project.rootDirectory).toBe(path.join(wrapperDir, "web"));
    expect(result.project.reactVersion).toBe("^19.0.0");
  });

  it("throws a clear error when the directory has no root package.json and no nested React project", async () => {
    const emptyDir = path.join(tempRoot, "diagnose-no-react-anywhere");
    fs.mkdirSync(emptyDir, { recursive: true });

    await expect(diagnose(emptyDir, { lint: false, deadCode: false })).rejects.toThrow(
      "No React project found in",
    );
  });
});
