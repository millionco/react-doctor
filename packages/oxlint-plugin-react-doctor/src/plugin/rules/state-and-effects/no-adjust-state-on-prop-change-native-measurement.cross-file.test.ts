import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const fixtures = fileURLToPath(
  new URL("../../../../test-fixtures/native-measurement/", import.meta.url),
);
const ruleId = "no-adjust-state-on-prop-change";
const sourcePath = path.join("src", "useMeasuredStrip.ts");
const shadowPath = path.join("src", "Rail.ts");
let projectDirectory: string;

const overlay = (variant: string): void => {
  fs.cpSync(path.join(fixtures, variant), projectDirectory, { recursive: true });
};

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "native-measurement-project-"));
  __clearParseSourceFileCacheForTests();
  resetManifestCaches();
  overlay("measured-native");
});

afterEach(() => {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
});

const readFocal = () => {
  const filename = path.join(projectDirectory, sourcePath);
  return { filename, source: fs.readFileSync(filename, "utf8") };
};

const markerLine = (marker: string): number => {
  const { source } = readFocal();
  const index = source.split("\n").findIndex((line) => line.includes(marker));
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
};

const diagnose = (profile: "curated" | "upstream") => {
  const { filename, source } = readFocal();
  const result = runRule(noAdjustStateOnPropChange, source, {
    filename,
    includeLocations: true,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        portedRuleMode: profile,
        reactMajorVersion: 18,
        rootDirectory: projectDirectory,
      },
    },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.line);
};

describe.each(["curated", "upstream"] as const)("native measurement adjustment (%s)", (profile) => {
  it("recognizes measurement changes with native element attachments", () => {
    expect(diagnose(profile)).toEqual([]);
  });

  it("reports an independent prop adjustment", () => {
    overlay("genuine-prop-adjustment");
    expect(diagnose(profile)).toEqual([markerLine("TARGET_GENUINE_PROP_RESET")]);
  });

  it.each([
    "shadow-observer",
    "package-exports-alternate-consumer",
    "webpack-external-panel",
    "webpack-panel-loader",
    "webpack-local-config-require",
    "build-replaces-entry",
    "postbuild-replaces-entry",
    "prebuild-replaces-rail",
  ] as const)("keeps the warning with a changed provider in %s", (variant) => {
    overlay(variant);
    expect(diagnose(profile)).toEqual([markerLine("TARGET_MEASURED_RESET")]);
  });

  it("keeps the warning when the selected config resolves to another directory", (context) => {
    const selected = path.join(projectDirectory, "webpack.build.cjs");
    const movedDirectory = path.join(projectDirectory, "other-config");
    fs.mkdirSync(movedDirectory);
    const moved = path.join(movedDirectory, "webpack.build.cjs");
    fs.renameSync(selected, moved);
    try {
      fs.symlinkSync(moved, selected, "file");
    } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }
    expect(diagnose(profile)).toEqual([markerLine("TARGET_MEASURED_RESET")]);
  });

  it("rechecks an unchanged hook when another module resolution candidate appears", () => {
    const before = readFocal();
    const collect = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: before.filename,
        sourceText: before.source,
        ruleIds: [ruleId],
      });
    expect(collect()).toBeNull();
    expect(diagnose(profile)).toEqual([]);
    overlay("higher-priority-panel-shadow");
    expect(readFocal()).toEqual(before);
    expect(collect()).toBeNull();
    expect(diagnose(profile)).toEqual([markerLine("TARGET_MEASURED_RESET")]);
    fs.unlinkSync(path.join(projectDirectory, shadowPath));
    expect(diagnose(profile)).toEqual([]);
  });
});
