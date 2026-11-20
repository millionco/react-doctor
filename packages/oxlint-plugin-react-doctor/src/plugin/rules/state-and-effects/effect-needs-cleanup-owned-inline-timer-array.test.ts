import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const SOURCE = `
import { useEffect, useRef } from "react";

export function useTicks(announce: (value: string) => void) {
  const queued = useRef(new Set<string>());
  useEffect(() => {
    const labels = ["one", "two"];
    const jobs: ReturnType<typeof setTimeout>[] = [];
    labels.forEach(value => {
      queued.current.add(value);
      const job = setTimeout(() => announce(value), 50);
      jobs.push(job);
    });
    return () => { jobs.forEach(job => clearTimeout(job)); };
  }, [announce]);
}
`;

const makeViteConfig = (alias: string) => `
import { defineConfig } from "vite";
export default defineConfig({ resolve: { alias: { "${alias}": "./module.ts" } } });
`;

const pinned = (name: string, version: string) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
  integrity: "sha512-YQ==",
});

const inProject = (run: (root: string, sourcePath: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), "react-doctor-timer-arrays-"));
  const sourcePath = join(root, "Consumer.tsx");
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19.2.6" },
        devDependencies: { vite: "^8.0.11" },
        scripts: { build: "vite build" },
      }),
    );
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/react": pinned("react", "19.2.6"),
          "node_modules/vite": pinned("vite", "8.0.11"),
        },
      }),
    );
    writeFileSync(join(root, "vite.config.ts"), makeViteConfig("@widgets"));
    run(root, sourcePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const diagnostics = (source: string, filename?: string) => {
  const result = runRule(effectNeedsCleanup, source, filename ? { filename } : {});
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("inline private timer arrays", () => {
  it("recognizes cleanup that drains the exact array of retained timeout handles", () => {
    const source = SOURCE.replace("      queued.current.add(value);\n", "");
    inProject((_root, filename) => {
      expect(diagnostics(source, filename)).toEqual([]);
    });
  });

  it("recognizes native Set bookkeeping under the locked React route", () => {
    inProject((_root, filename) => {
      expect(diagnostics(SOURCE, filename)).toEqual([]);
    });
  });

  it("retains the warning when Vite remaps the React binding", () => {
    inProject((root, filename) => {
      expect(diagnostics(SOURCE, filename)).toEqual([]);
      writeFileSync(join(root, "vite.config.ts"), makeViteConfig("react"));
      expect(diagnostics(SOURCE, filename)).toHaveLength(1);
      expect(
        diagnostics(SOURCE.replace("      queued.current.add(value);\n", ""), filename),
      ).toHaveLength(1);
    });
  });

  it("retains the warning for a mismatched package declaration", () => {
    inProject((root, filename) => {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          dependencies: { react: "npm:replacement-react@19.2.6" },
          devDependencies: { vite: "^8.0.11" },
          scripts: { build: "vite build" },
        }),
      );
      expect(diagnostics(SOURCE, filename)).toHaveLength(1);
    });
  });

  it.each([
    (source: string) =>
      source.replace(
        "labels.forEach(value => {",
        "labels.forEach(async value => { await Promise.resolve();",
      ),
    (source: string) =>
      source.replace("queued.current.add(value);", "if (value === 'two') throw Error(value);"),
    (source: string) =>
      source.replace("() => announce(value)", "() => { setTimeout(() => announce(value), 50); }"),
    (source: string) => source.replace("clearTimeout(job)", "job === jobs[0] && clearTimeout(job)"),
    (source: string) =>
      "const { defaultView: host } = document; if (host) host.clearTimeout = () => {};\n" + source,
  ])("keeps warnings when installation or cancellation is incomplete (%#)", (transform) => {
    inProject((_root, filename) => {
      expect(diagnostics(transform(SOURCE), filename)).toHaveLength(1);
    });
  });

  it("retains the warning for a nested timer started by a same-file helper", () => {
    const source = SOURCE.replace(
      "  useEffect(() => {",
      "  const scheduleNext = (value: string) => { setTimeout(() => announce(value), 50); };\n" +
        "  useEffect(() => {",
    ).replace(
      "() => announce(value), 50);\n      jobs.push",
      "() => scheduleNext(value), 50);\n      jobs.push",
    );
    inProject((_root, filename) => {
      expect(diagnostics(source, filename)).toHaveLength(1);
    });
  });

  it("tracks provider config and lock data for the lint sidecar cache", () => {
    inProject((root, filename) => {
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: SOURCE,
        ruleIds: ["effect-needs-cleanup"],
      });
      expect(trace?.contentPaths).toContain(join(root, "package.json"));
      expect(trace?.contentPaths).toContain(join(root, "package-lock.json"));
      expect(trace?.contentPaths).toContain(join(root, "vite.config.ts"));
      expect(trace?.existencePaths).toContain(join(root, "vite.config.mjs"));
    });
  });
});
