import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkReducedMotion } from "../src/check-reduced-motion.js";

describe("checkReducedMotion", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "check-reduced-motion-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeNestedFile = (relativePath: string, contents: string): void => {
    const filePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  const writePackageJsonWithMotionLibrary = (): void => {
    writeNestedFile(
      "package.json",
      JSON.stringify({ name: "app", dependencies: { "framer-motion": "^11.0.0" } }),
    );
  };

  // Issue: `git grep` exits 128 outside a repository, and the old code
  // conflated that failure with "no match" — a non-git tree with a motion
  // library was ALWAYS flagged, so the same tree produced different
  // diagnostic sets depending on git availability.
  it("finds reduced-motion handling via the filesystem when the tree is not a git repository", () => {
    writePackageJsonWithMotionLibrary();
    writeNestedFile("src/app.tsx", "const reduced = useReducedMotion();\n");

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });

  it("reports the diagnostic when a non-git tree has no reduced-motion handling", () => {
    writePackageJsonWithMotionLibrary();
    writeNestedFile("src/app.tsx", "export const App = () => null;\n");

    const diagnostics = checkReducedMotion(temporaryDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.rule).toBe("require-reduced-motion");
  });

  it("ignores reduced-motion handling that only lives in ignored directories", () => {
    writePackageJsonWithMotionLibrary();
    writeNestedFile("dist/bundle.js", "matchMedia('(prefers-reduced-motion: reduce)');\n");

    expect(checkReducedMotion(temporaryDirectory)).toHaveLength(1);
  });

  it("returns no diagnostics when the project has no motion library", () => {
    writeNestedFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));

    expect(checkReducedMotion(temporaryDirectory)).toEqual([]);
  });
});
