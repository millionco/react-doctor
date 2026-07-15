import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoImgElement } from "./nextjs-no-img-element.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nextjs-img-renderer-"));
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFixtureFile = (relativePath: string, sourceText: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, sourceText, "utf8");
  return absolutePath;
};

describe("nextjs-no-img-element — generated-image consumers", () => {
  it("does not prescribe next/image for a helper consumed only by ImageResponse", () => {
    const helperPath = writeFixtureFile(
      "lib/card.tsx",
      `
        export const cardLayout = (source: string) => (
          <div><img src={source} alt="" width={10} height={10} /></div>
        );
      `,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";

        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );

    const result = runRule(nextjsNoImgElement, fs.readFileSync(helperPath, "utf8"), {
      filename: helperPath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
