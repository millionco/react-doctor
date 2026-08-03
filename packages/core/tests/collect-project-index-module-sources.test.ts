import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { collectProjectIndexModuleSources } from "../src/utils/collect-project-index-module-sources.js";

const temporaryDirectories: string[] = [];

const createFixture = (files: Readonly<Record<string, string>>) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "project-index-sources-"));
  temporaryDirectories.push(temporaryDirectory);
  for (const [relativePath, sourceText] of Object.entries(files)) {
    const absolutePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, sourceText);
  }
  return temporaryDirectory;
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("collectProjectIndexModuleSources", () => {
  it("collects only module sources that can trigger a project index", async () => {
    const rootDirectory = createFixture({
      "image.tsx": `import { ImageResponse } from "next/og";`,
      "video.tsx": `import { Composition } from 'remotion';`,
      "ordinary.tsx": `import { Image } from "next/image";`,
    });

    await expect(
      collectProjectIndexModuleSources({
        rootDirectory,
        candidateFiles: ["image.tsx", "video.tsx", "ordinary.tsx"],
      }),
    ).resolves.toEqual({ moduleSources: ["next/og", "remotion"], didComplete: true });
  });

  it("returns an empty complete result for ordinary source files", async () => {
    const rootDirectory = createFixture({
      "component.tsx": `export const Component = () => <img src="/photo.png" alt="" />;`,
    });

    await expect(
      collectProjectIndexModuleSources({ rootDirectory, candidateFiles: ["component.tsx"] }),
    ).resolves.toEqual({ moduleSources: [], didComplete: true });
  });

  it("stops reading candidates when the scan deadline has elapsed", async () => {
    const rootDirectory = createFixture({
      "image.tsx": `import { ImageResponse } from "next/og";`,
    });

    await expect(
      collectProjectIndexModuleSources({
        rootDirectory,
        candidateFiles: ["image.tsx"],
        deadlineEpochMs: Date.now(),
      }),
    ).resolves.toEqual({ moduleSources: [], didComplete: false });
  });
});
