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
});
