import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { rulesOfHooks } from "../../oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/rules-of-hooks.js";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

interface ClientFactoryFuzzPhase {
  readonly provider: string;
  readonly verdict: "pass" | "fail";
}

const seedRelativePath = "corpus/regressions/rules-of-hooks--ssr-cookie-client-factory.tsx";
const providerRelativePath = "fixtures/ssr-cookie-client/client.ts";

it("replays the real imported cookie factory and preserves genuine imported Hook reports", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL(`../${seedRelativePath}`, import.meta.url)),
    "utf8",
  );
  const provider = fs.readFileSync(
    fileURLToPath(new URL(`../${providerRelativePath}`, import.meta.url)),
    "utf8",
  );
  const genuineHook = `
import { useState } from "react";
export default function useRequestState(initial) {
  const [value] = useState(initial);
  return value;
}
`;
  const phases: readonly ClientFactoryFuzzPhase[] = [
    { provider, verdict: "pass" },
    { provider: genuineHook, verdict: "fail" },
    { provider, verdict: "pass" },
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-client-fuzz-"));
  try {
    const sourcePath = path.join(directory, seedRelativePath);
    const providerPath = path.join(directory, providerRelativePath);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(providerPath), { recursive: true });
    fs.writeFileSync(sourcePath, source);
    for (const phase of phases) {
      resetFilesystemCaches();
      fs.writeFileSync(providerPath, phase.provider);
      const result = fuzzRuleWithStats(rulesOfHooks.id, rulesOfHooks, {
        iterations: 0,
        corpus: [
          {
            relativePath: "regressions/rules-of-hooks--ssr-cookie-client-factory.tsx",
            sourcePath,
            code: source,
            ruleIds: [rulesOfHooks.id],
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
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
