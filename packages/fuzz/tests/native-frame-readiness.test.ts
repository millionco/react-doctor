import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noResetAllStateOnPropChange } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-reset-all-state-on-prop-change.js";
import fixture from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/native-iframe-readiness.fixtures.json";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

interface NativeReadinessFuzzPhase {
  readonly hook: string;
  readonly frame?: string;
  readonly verdict: "pass" | "fail";
}

const seedRelativePath =
  "corpus/regressions/no-reset-all-state-on-prop-change--native-frame-readiness.tsx";
const hookRelativePath = "channel/index.ts";

it("replays native-frame readiness and preserves the source-identity boundary across resets", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL(`../${seedRelativePath}`, import.meta.url)),
    "utf8",
  );
  const hook = fixture.files[hookRelativePath];
  const reversedSourceGuard = hook.replace(
    "event.source!==frame?.contentWindow",
    "event.source===frame?.contentWindow",
  );
  expect(reversedSourceGuard).not.toBe(hook);
  const frame = fixture.files["Frame.tsx"];
  const customElementFrame = frame
    .replace("<Surface ", "<frame-shell ")
    .replace("</Surface>", "</frame-shell>");
  const phases: readonly NativeReadinessFuzzPhase[] = [
    { hook, verdict: "pass" },
    { hook: reversedSourceGuard, verdict: "fail" },
    { hook, verdict: "pass" },
    { hook, frame: customElementFrame, verdict: "fail" },
    { hook, verdict: "pass" },
    ...[
      "svg",
      "math",
      "template",
      "img",
      "noembed",
      "noframes",
      "plaintext",
      "xmp",
    ].flatMap<NativeReadinessFuzzPhase>((tagName) => [
      {
        hook,
        frame: frame.replace("<Surface ", `<${tagName} `).replace("</Surface>", `</${tagName}>`),
        verdict: "fail",
      },
      { hook, verdict: "pass" },
    ]),
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-frame-readiness-fuzz-"));
  try {
    for (const [relativePath, contents] of Object.entries(fixture.files)) {
      if (relativePath === "Panel.tsx") continue;
      const filename = path.join(directory, relativePath);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
    }
    const sourcePath = path.join(directory, "Panel.tsx");
    const hookPath = path.join(directory, hookRelativePath);
    fs.writeFileSync(sourcePath, source);
    for (const phase of phases) {
      fs.writeFileSync(hookPath, phase.hook);
      fs.writeFileSync(path.join(directory, "Frame.tsx"), phase.frame ?? frame);
      resetFilesystemCaches();
      const result = fuzzRuleWithStats(
        noResetAllStateOnPropChange.id,
        noResetAllStateOnPropChange,
        {
          iterations: 0,
          corpus: [
            {
              relativePath:
                "regressions/no-reset-all-state-on-prop-change--native-frame-readiness.tsx",
              sourcePath,
              code: source,
              ruleIds: [noResetAllStateOnPropChange.id],
              verdict: phase.verdict,
            },
          ],
        },
      );
      expect(result.findings).toEqual([]);
      expect(result.stats.executedProgramCount).toBe(1);
      expect(result.stats.skippedParseErrorCount).toBe(0);
      if (phase.verdict === "pass") expect(result.stats.firedProgramCount).toBe(0);
      else expect(result.stats.firedProgramCount).toBeGreaterThan(0);
      expect(fs.readFileSync(sourcePath, "utf8")).toBe(source);
    }
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
