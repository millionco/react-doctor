import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import { materializeSourceTree } from "@react-doctor/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

describe("materializeSourceTree", () => {
  let directory: string;
  let tempDirectory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-root-"));
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-snapshot-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("reports absent and unsafe files instead of silently losing them", async () => {
    const tree = await Effect.runPromise(
      materializeSourceTree({
        directory,
        files: ["src/present.ts", "src/absent.ts", "../escape.ts"],
        tempDirectory,
        readContent: (filePath) =>
          Effect.succeed(filePath === "src/absent.ts" ? null : "export const value = 1;\n"),
      }),
    );

    expect(tree.materializedFiles).toEqual(["src/present.ts"]);
    expect(tree.unmaterializedFiles).toEqual(["src/absent.ts", "../escape.ts"]);
    expect(fs.existsSync(path.join(tempDirectory, "src/present.ts"))).toBe(true);
    expect(fs.existsSync(path.resolve(tempDirectory, "..", "escape.ts"))).toBe(false);
  });

  it("copies project-config files for each requested subdirectory", async () => {
    // The source and the snapshot need different parents. As siblings, a `..`
    // subdirectory resolves to the same path from both, so the escape assertion
    // would hold whether or not the containment guard exists.
    const sourceParent = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-parent-"));
    const snapshotParent = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-snapshot-parent-"));
    const sourceDirectory = path.join(sourceParent, "repo");
    const snapshotDirectory = path.join(snapshotParent, "snapshot");
    fs.mkdirSync(path.join(sourceDirectory, "packages/app/src"), { recursive: true });
    fs.mkdirSync(snapshotDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, "package.json"), '{"name":"root"}\n');
    fs.writeFileSync(
      path.join(sourceDirectory, "packages/app/package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.mkdirSync(path.join(sourceDirectory, ".oxlintrc.json"));
    // The escape source exists and is readable, so only the containment guard
    // can keep it out of the snapshot.
    fs.mkdirSync(path.join(sourceParent, "escape"), { recursive: true });
    fs.writeFileSync(path.join(sourceParent, "escape/package.json"), '{"name":"escaped"}\n');

    try {
      await Effect.runPromise(
        materializeSourceTree({
          directory: sourceDirectory,
          files: ["packages/app/src/app.tsx"],
          tempDirectory: snapshotDirectory,
          readContent: () => Effect.succeed("export const App = () => null;\n"),
          configSubdirectories: ["packages/app", "../escape"],
        }),
      );

      expect(fs.readFileSync(path.join(snapshotDirectory, "package.json"), "utf8")).toContain(
        "root",
      );
      expect(
        fs.readFileSync(path.join(snapshotDirectory, "packages/app/package.json"), "utf8"),
      ).toContain('"react"');
      expect(fs.existsSync(path.join(snapshotDirectory, ".oxlintrc.json"))).toBe(false);
      expect(fs.existsSync(path.join(snapshotParent, "escape/package.json"))).toBe(false);
    } finally {
      fs.rmSync(sourceParent, { recursive: true, force: true });
      fs.rmSync(snapshotParent, { recursive: true, force: true });
    }
  });
});
