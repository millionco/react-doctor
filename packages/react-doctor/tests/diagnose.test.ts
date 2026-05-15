import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { AmbiguousProjectError, diagnose } from "../src/index.js";
import { clearConfigCache } from "../src/core/load-config.js";
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

  it("falls back to a deeply nested React subproject when the requested directory has no root package.json", async () => {
    const wrapperDir = path.join(tempRoot, "diagnose-no-root-package-deep");
    fs.mkdirSync(wrapperDir, { recursive: true });
    setupReactProject(wrapperDir, "apps/web");

    const result = await diagnose(wrapperDir, { lint: false, deadCode: false });
    expect(result.project.rootDirectory).toBe(path.join(wrapperDir, "apps", "web"));
    expect(result.project.reactVersion).toBe("^19.0.0");
  });

  it("throws a clear error when the directory has no root package.json and no nested React project", async () => {
    const emptyDir = path.join(tempRoot, "diagnose-no-react-anywhere");
    fs.mkdirSync(emptyDir, { recursive: true });

    await expect(diagnose(emptyDir, { lint: false, deadCode: false })).rejects.toThrow(
      "No React project found in",
    );
  });

  // Regression: when the requested directory has no root package.json AND
  // there are multiple nested React projects, `diagnose()` previously
  // silently picked whichever one `readdirSync` returned first. That's a
  // footgun for monorepo callers (e.g. apps/web vs apps/admin). The
  // single-result programmatic API now surfaces ambiguity via a typed
  // error so the caller can disambiguate explicitly.
  it("throws AmbiguousProjectError when there are multiple nested React subprojects and no root package.json", async () => {
    const wrapperDir = path.join(tempRoot, "diagnose-ambiguous-nested");
    fs.mkdirSync(wrapperDir, { recursive: true });
    setupReactProject(wrapperDir, "web");
    setupReactProject(wrapperDir, "admin");

    await expect(diagnose(wrapperDir, { lint: false, deadCode: false })).rejects.toBeInstanceOf(
      AmbiguousProjectError,
    );

    const rejection = await diagnose(wrapperDir, { lint: false, deadCode: false }).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(AmbiguousProjectError);
    const ambiguousError = rejection as AmbiguousProjectError;
    expect(ambiguousError.directory).toBe(wrapperDir);
    expect(ambiguousError.candidates.toSorted()).toEqual(["admin", "web"]);
  });

  describe("react-doctor.config.json rootDir redirect", () => {
    beforeEach(() => {
      clearConfigCache();
    });

    it("redirects diagnose() to config.rootDir resolved relative to the config file location", async () => {
      const wrapperDir = path.join(tempRoot, "diagnose-rootdir-redirect");
      fs.mkdirSync(wrapperDir, { recursive: true });
      setupReactProject(wrapperDir, "web");
      setupReactProject(wrapperDir, "admin");
      fs.writeFileSync(
        path.join(wrapperDir, "react-doctor.config.json"),
        JSON.stringify({ rootDir: "web" }),
      );

      const result = await diagnose(wrapperDir, { lint: false, deadCode: false });
      expect(result.project.rootDirectory).toBe(path.join(wrapperDir, "web"));
    });

    it("disambiguates a wrapper that would otherwise throw AmbiguousProjectError", async () => {
      const wrapperDir = path.join(tempRoot, "diagnose-rootdir-disambiguates");
      fs.mkdirSync(wrapperDir, { recursive: true });
      setupReactProject(wrapperDir, "web");
      setupReactProject(wrapperDir, "admin");
      fs.writeFileSync(
        path.join(wrapperDir, "react-doctor.config.json"),
        JSON.stringify({ rootDir: "admin" }),
      );

      const result = await diagnose(wrapperDir, { lint: false, deadCode: false });
      expect(result.project.rootDirectory).toBe(path.join(wrapperDir, "admin"));
    });

    it("resolves rootDir against the ancestor config file location, not the requested directory", async () => {
      const repoRoot = path.join(tempRoot, "diagnose-rootdir-ancestor");
      const childDir = path.join(repoRoot, "packages", "ui");
      fs.mkdirSync(childDir, { recursive: true });
      setupReactProject(repoRoot, "apps/web");
      fs.writeFileSync(
        path.join(repoRoot, "react-doctor.config.json"),
        JSON.stringify({ rootDir: "apps/web" }),
      );

      const result = await diagnose(childDir, { lint: false, deadCode: false });
      expect(result.project.rootDirectory).toBe(path.join(repoRoot, "apps", "web"));
    });

    it("ignores rootDir that does not exist and falls back to the requested directory", async () => {
      const wrapperDir = path.join(tempRoot, "diagnose-rootdir-missing");
      fs.mkdirSync(wrapperDir, { recursive: true });
      setupReactProject(wrapperDir, "web");
      fs.writeFileSync(
        path.join(wrapperDir, "react-doctor.config.json"),
        JSON.stringify({ rootDir: "does-not-exist" }),
      );

      const result = await diagnose(wrapperDir, { lint: false, deadCode: false });
      expect(result.project.rootDirectory).toBe(path.join(wrapperDir, "web"));
    });

    it("honors an absolute rootDir path", async () => {
      const wrapperDir = path.join(tempRoot, "diagnose-rootdir-absolute");
      fs.mkdirSync(wrapperDir, { recursive: true });
      const targetDir = setupReactProject(wrapperDir, "web");
      fs.writeFileSync(
        path.join(wrapperDir, "react-doctor.config.json"),
        JSON.stringify({ rootDir: targetDir }),
      );

      const result = await diagnose(wrapperDir, { lint: false, deadCode: false });
      expect(result.project.rootDirectory).toBe(targetDir);
    });
  });
});
