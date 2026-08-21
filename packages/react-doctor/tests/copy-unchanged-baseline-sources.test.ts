import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { copyUnchangedBaselineSources } from "../src/cli/utils/copy-unchanged-baseline-sources.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("copyUnchangedBaselineSources", () => {
  it("copies only unchanged tracked source files", async () => {
    const directory = createTemporaryDirectory("react-doctor-baseline-source-");
    const tempDirectory = createTemporaryDirectory("react-doctor-baseline-target-");
    fs.mkdirSync(path.join(directory, "src"), { recursive: true });
    fs.writeFileSync(path.join(directory, "src", "unchanged.tsx"), "unchanged");
    fs.writeFileSync(path.join(directory, "src", "changed.tsx"), "head");
    fs.writeFileSync(path.join(directory, "src", "untracked.tsx"), "untracked");

    const didCopyComplete = await copyUnchangedBaselineSources({
      directory,
      sourceFiles: ["src/unchanged.tsx", "src/changed.tsx", "src/untracked.tsx"],
      baseMaterializedFiles: [],
      headChangedFiles: ["src/changed.tsx"],
      untrackedFiles: ["src/untracked.tsx"],
      tempDirectory,
      deadlineEpochMs: null,
    });

    expect(didCopyComplete).toBe(true);
    expect(fs.readFileSync(path.join(tempDirectory, "src", "unchanged.tsx"), "utf-8")).toBe(
      "unchanged",
    );
    expect(fs.existsSync(path.join(tempDirectory, "src", "changed.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(tempDirectory, "src", "untracked.tsx"))).toBe(false);
  });

  it("stops copying after the scan deadline", async () => {
    const directory = createTemporaryDirectory("react-doctor-baseline-deadline-source-");
    const tempDirectory = createTemporaryDirectory("react-doctor-baseline-deadline-target-");
    fs.writeFileSync(path.join(directory, "component.tsx"), "component");

    const didCopyComplete = await copyUnchangedBaselineSources({
      directory,
      sourceFiles: ["component.tsx"],
      baseMaterializedFiles: [],
      headChangedFiles: [],
      untrackedFiles: [],
      tempDirectory,
      deadlineEpochMs: 0,
    });

    expect(didCopyComplete).toBe(false);
    expect(fs.existsSync(path.join(tempDirectory, "component.tsx"))).toBe(false);
  });
});
