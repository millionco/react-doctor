import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "./cross-file-dependencies.js";
import { resetFilesystemCaches } from "./utils/reset-filesystem-caches.js";
import fixture from "./rules/state-and-effects/native-iframe-readiness.fixtures.json";

interface ReadinessProbeCase {
  readonly name: string;
  readonly absent?: string;
  readonly remappedSdk?: boolean;
}

const cases: readonly ReadinessProbeCase[] = [
  { name: "all immediate native bridge files present" },
  { name: "hook absent", absent: "channel/index.ts" },
  { name: "iframe bridge absent", absent: "Frame.tsx" },
  { name: "local SDK candidate absent", remappedSdk: true },
];

describe("native readiness dependency capture", () => {
  it.each(cases)(
    "$name records the actual and negative source probes",
    ({ absent, remappedSdk }) => {
      const directory = mkdtempSync(join(tmpdir(), "native-readiness-probes-"));
      try {
        for (const [relativePath, contents] of Object.entries(fixture.files)) {
          const filename = join(directory, relativePath);
          mkdirSync(dirname(filename), { recursive: true });
          writeFileSync(filename, contents);
        }
        if (absent) unlinkSync(join(directory, absent));
        if (remappedSdk)
          writeFileSync(
            join(directory, "tsconfig.json"),
            JSON.stringify({
              compilerOptions: {
                baseUrl: ".",
                paths: { "@sanity/ui": ["./local-ui"] },
              },
            }),
          );
        resetFilesystemCaches();
        const filename = join(directory, "Panel.tsx");
        const probes = collectCrossFileDependencyProbes({
          absoluteFilePath: filename,
          sourceText: readFileSync(filename, "utf8"),
          ruleIds: ["no-reset-all-state-on-prop-change"],
        });
        expect(probes).not.toBeNull();
        expect(probes?.existencePaths.has(join(directory, "channel.ts"))).toBe(true);
        if (absent === "channel/index.ts") {
          expect(probes?.existencePaths.has(join(directory, absent))).toBe(true);
        } else {
          expect(probes?.contentPaths.has(join(directory, "channel/index.ts"))).toBe(true);
          if (absent === "Frame.tsx")
            expect(probes?.existencePaths.has(join(directory, absent))).toBe(true);
          else expect(probes?.contentPaths.has(join(directory, "Frame.tsx"))).toBe(true);
        }
        if (remappedSdk) {
          expect(probes?.contentPaths.has(join(directory, "tsconfig.json"))).toBe(true);
          expect(probes?.existencePaths.has(join(directory, "local-ui.ts"))).toBe(true);
        }
      } finally {
        resetFilesystemCaches();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
