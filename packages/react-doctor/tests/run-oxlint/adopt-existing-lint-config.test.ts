import { describe, expect, it } from "vite-plus/test";
import { runOxlint } from "../../src/core/runners/run-oxlint.js";
import { buildTestProject } from "../regressions/_helpers.js";
import { USER_OXLINT_CONFIG_BROKEN_DIRECTORY, USER_OXLINT_CONFIG_DIRECTORY } from "./_helpers.js";

describe("runOxlint", () => {
  describe("adoptExistingLintConfig", () => {
    const buildAdoptionOptions = (overrides: Partial<Parameters<typeof runOxlint>[0]> = {}) => ({
      rootDirectory: USER_OXLINT_CONFIG_DIRECTORY,
      project: buildTestProject({
        rootDirectory: USER_OXLINT_CONFIG_DIRECTORY,
      }),
      ...overrides,
    });

    it("merges rules from the user's .oxlintrc.json into the scan by default", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions());

      const debuggerIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-debugger");
      const emptyBlockIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-empty");

      expect(debuggerIssues.length).toBeGreaterThan(0);
      expect(debuggerIssues[0].severity).toBe("error");
      expect(emptyBlockIssues.length).toBeGreaterThan(0);
      expect(emptyBlockIssues[0].severity).toBe("warning");
    });

    it("reports adopted-rule diagnostics from plain .ts files (not just .tsx / .jsx)", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions());

      const debuggerIssuesInTs = diagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "no-debugger" && diagnostic.filePath.endsWith("util.ts"),
      );
      expect(debuggerIssuesInTs.length).toBeGreaterThan(0);
    });

    it("skips the user's .oxlintrc.json when adoptExistingLintConfig is false", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions({ adoptExistingLintConfig: false }));

      const debuggerIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-debugger");
      const emptyBlockIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-empty");

      expect(debuggerIssues).toHaveLength(0);
      expect(emptyBlockIssues).toHaveLength(0);
    });

    it("skips the user's .oxlintrc.json when customRulesOnly is true", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions({ customRulesOnly: true }));

      const debuggerIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-debugger");
      expect(debuggerIssues).toHaveLength(0);
    });

    it("falls back to a curated-rules-only scan when the user's config breaks oxlint", async () => {
      const stderrChunks: string[] = [];
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      // HACK: capture stderr so we can assert the silent-retry contract —
      // a previous build wrote a "could not adopt existing lint config"
      // warning here, which users mistook for react-doctor crashing.
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as typeof process.stderr.write;

      let didResolve = false;
      try {
        await runOxlint({
          rootDirectory: USER_OXLINT_CONFIG_BROKEN_DIRECTORY,
          project: buildTestProject({
            rootDirectory: USER_OXLINT_CONFIG_BROKEN_DIRECTORY,
            hasTypeScript: false,
          }),
        });
        didResolve = true;
      } finally {
        process.stderr.write = originalStderrWrite;
      }

      // Resolving (instead of throwing) is the whole point — pre-fix,
      // a broken `extends` aborted the entire lint pass and the
      // user's score collapsed onto zero diagnostics with no obvious
      // reason in the output.
      expect(didResolve).toBe(true);

      const stderrOutput = stderrChunks.join("");
      expect(stderrOutput).not.toContain("could not adopt existing lint config");
      expect(stderrOutput).not.toContain("retrying without extends");
    });
  });
});
