import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  createControlledStatePackageFixture,
  CONTROLLED_STATE_COMMONJS_HOOK,
  CONTROLLED_STATE_COMMONJS_ENTRY,
} from "../../oxlint-plugin-react-doctor/src/test-utils/create-controlled-state-package-fixture.js";
import type { ControlledPackageFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/create-controlled-state-package-fixture.js";
import { noImpureStateUpdater } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-impure-state-updater.js";
import { resetManifestCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/read-nearest-package-manifest.js";
import { resetModuleResolutionCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/resolve-relative-import-path.js";
import { resetCrossFileExportCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/resolve-cross-file-function-export.js";
import { resetTsconfigAliasCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/resolve-tsconfig-alias.js";
import { __clearParseSourceFileCacheForTests } from "../../oxlint-plugin-react-doctor/src/plugin/utils/parse-source-file.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import type { FuzzCorpusEntry } from "../src/load-fuzz-corpus.js";

describe("installed controlled setter fuzz context", () => {
  it("replays valid controls and mutates a proven imported native setter", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-controlled-setter-fuzz-"));
    try {
      createControlledStatePackageFixture(directory);
      resetManifestCaches();
      resetModuleResolutionCaches();
      resetCrossFileExportCaches();
      resetTsconfigAliasCaches();
      __clearParseSourceFileCacheForTests();
      const corpus: FuzzCorpusEntry[] = loadFuzzCorpus(
        path.resolve(import.meta.dirname, "../corpus/regressions/imported-controlled-setter"),
      ).map((entry) => {
        const entryDirectory = path.join(directory, path.basename(entry.relativePath));
        const fixture: ControlledPackageFixture = {};
        if (entry.relativePath.endsWith("--imported-setter-default-export.tsx")) {
          fixture.commonjsHook =
            CONTROLLED_STATE_COMMONJS_HOOK +
            ` Object.defineProperty(exports, "default", { value: () => [0, callback => callback(0)] });`;
        } else if (entry.relativePath.endsWith("--imported-setter-dependency-alias.tsx")) {
          fixture.packageOverrides = { dependencies: { react: "npm:other-provider@1.0.0" } };
        } else if (entry.relativePath.endsWith("--imported-setter-dead-entry.tsx")) {
          fixture.commonjsEntry = CONTROLLED_STATE_COMMONJS_ENTRY.replace(
            'const stateHook = projectDefault(require("./bound-state"));',
            'if (false) { var stateHook = projectDefault(require("./bound-state")); }',
          );
        } else if (entry.relativePath.endsWith("--imported-setter-dead-helper.tsx")) {
          fixture.commonjsHook = CONTROLLED_STATE_COMMONJS_HOOK.replace(
            "const controlledState =",
            "if (false) { var controlledState =",
          ).replace("}; exports.default =", "}; } exports.default =");
        }
        createControlledStatePackageFixture(entryDirectory, fixture);
        return {
          ...entry,
          relativePath: `regressions/imported-controlled-setter/${entry.relativePath}`,
          sourcePath: path.join(entryDirectory, "panel.tsx"),
        };
      });
      const targetPath = "targets/no-impure-state-updater--imported-setter-installed.tsx";
      const priorityCorpusEntry: FuzzCorpusEntry = {
        relativePath: targetPath,
        code: fs.readFileSync(path.resolve(import.meta.dirname, "../corpus", targetPath), "utf8"),
        sourcePath: path.join(directory, "panel.tsx"),
        ruleIds: ["no-impure-state-updater"],
        verdict: "fail",
      };
      corpus.push(priorityCorpusEntry);
      expect(corpus).toHaveLength(10);
      const result = fuzzRuleWithStats("no-impure-state-updater", noImpureStateUpdater, {
        seed: 42,
        iterations: 500,
        corpus,
        priorityCorpusEntry,
      });
      expect(result.findings).toEqual([]);
      expect(result.stats.executedProgramCount).toBeGreaterThan(corpus.length);
      expect(result.stats.firedProgramCount).toBeGreaterThan(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
