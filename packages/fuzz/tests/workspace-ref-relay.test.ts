import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { noDirectStateMutation } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-direct-state-mutation.js";
import fixtures from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-direct-state-mutation.workspace-fixtures.json";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

interface WorkspaceRelayFuzzPhase {
  readonly providerSource: string;
  readonly verdict: "pass" | "fail";
}

describe("workspace callback ref deterministic fuzz regressions", () => {
  it("replays native relay and manufactured data verdicts with the real consumer root", () => {
    const workspace = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "workspace-relay-fuzz-")),
    );
    try {
      resetFilesystemCaches();
      for (const [relativePath, contents] of Object.entries(fixtures.baseFiles)) {
        const filename = path.join(workspace, relativePath);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, contents);
      }
      const consumerRoot = path.join(workspace, "packages/ui");
      const sourcePath = path.join(consumerRoot, "src/panel.tsx");
      const source = fs.readFileSync(sourcePath, "utf8");
      const providerRelativePath = "packages/ref-kit/src/relay.ts";
      const originalProvider = fixtures.baseFiles[providerRelativePath];
      const unsafeProvider = fixtures.cases.find(
        (fixture) => fixture.name === "provider-changes-element-value",
      )?.updates[providerRelativePath];
      if (typeof unsafeProvider !== "string") {
        throw new Error("Missing manufactured data regression provider");
      }
      const phases: ReadonlyArray<WorkspaceRelayFuzzPhase> = [
        { providerSource: originalProvider, verdict: "pass" },
        { providerSource: unsafeProvider, verdict: "fail" },
        { providerSource: originalProvider, verdict: "pass" },
      ];
      for (const phase of phases) {
        resetFilesystemCaches();
        fs.writeFileSync(path.join(workspace, providerRelativePath), phase.providerSource);
        const result = fuzzRuleWithStats(noDirectStateMutation.id, noDirectStateMutation, {
          iterations: 0,
          settings: { "react-doctor": { rootDirectory: consumerRoot } },
          corpus: [
            {
              relativePath: "regressions/no-direct-state-mutation--workspace-ref-relay.tsx",
              sourcePath,
              code: source,
              ruleIds: [noDirectStateMutation.id],
              verdict: phase.verdict,
            },
          ],
        });
        expect(result.findings).toEqual([]);
        expect(result.stats.executedProgramCount).toBe(1);
        expect(result.stats.skippedParseErrorCount).toBe(0);
        if (phase.verdict === "pass") {
          expect(result.stats.firedProgramCount).toBe(0);
        } else {
          expect(result.stats.firedProgramCount).toBeGreaterThan(0);
        }
      }
    } finally {
      resetFilesystemCaches();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each(["erased-relay-hook", "inert-relay-provider-key", "erased-export-useState"])(
    "replays %s with the required workspace settings",
    (slug) => {
      const workspace = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "workspace-relay-types-")),
      );
      try {
        resetFilesystemCaches();
        for (const [relativePath, contents] of Object.entries(fixtures.baseFiles)) {
          const filename = path.join(workspace, relativePath);
          fs.mkdirSync(path.dirname(filename), { recursive: true });
          fs.writeFileSync(filename, contents);
        }
        const consumerRoot = path.join(workspace, "packages/ui");
        const sourcePath = path.join(consumerRoot, "src/panel.tsx");
        const corpusPath = fileURLToPath(
          new URL(
            `../corpus/regressions/no-direct-state-mutation--review-${slug}.tsx`,
            import.meta.url,
          ),
        );
        const code = fs.readFileSync(corpusPath, "utf8");
        fs.writeFileSync(sourcePath, code);
        const result = fuzzRuleWithStats(noDirectStateMutation.id, noDirectStateMutation, {
          iterations: 0,
          settings: { "react-doctor": { rootDirectory: consumerRoot } },
          corpus: [
            {
              relativePath: `regressions/${slug}.tsx`,
              sourcePath,
              code,
              ruleIds: [noDirectStateMutation.id],
              verdict: "pass",
            },
          ],
        });
        expect(result.findings).toEqual([]);
        expect(result.stats.executedProgramCount).toBe(1);
        expect(result.stats.skippedParseErrorCount).toBe(0);
        expect(result.stats.firedProgramCount).toBe(0);
      } finally {
        resetFilesystemCaches();
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    },
  );
});
