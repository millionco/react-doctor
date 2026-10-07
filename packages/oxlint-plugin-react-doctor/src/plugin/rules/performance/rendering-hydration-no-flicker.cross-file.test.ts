import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { renderingHydrationNoFlicker } from "./rendering-hydration-no-flicker.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hydration-media-flicker-"));
  __clearParseSourceFileCacheForTests();
  resetTsconfigAliasCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

describe("rendering-hydration-no-flicker — imported media capability", () => {
  it("reports a rendered branch replaced by a passive capability effect", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayBackgroundVideoMime = (mime) =>
        document.createElement("video").canPlayType(mime) !== "";`,
    );
    const source = `
      import { useEffect, useState } from "react";
      import { canPlayBackgroundVideoMime } from "./video-background-mime";
      const Background = ({ mime, src }) => {
        const [isPlayableVideo, setIsPlayableVideo] = useState(false);
        useEffect(() => {
          setIsPlayableVideo(canPlayBackgroundVideoMime(mime));
        }, [mime]);
        return isPlayableVideo ? <video src={src} /> : <img src={src} alt="" />;
      };
    `;
    const filename = writeFile("src/background.tsx", source);
    const result = runRule(renderingHydrationNoFlicker, source, { filename });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a media helper with a shadowed document binding", () => {
    writeFile(
      "src/video-background-mime.ts",
      `const document = { createElement: () => ({ canPlayType: () => "probably" }) };
      export const canPlayBackgroundVideoMime = (mime) =>
        document.createElement("video").canPlayType(mime) !== "";`,
    );
    const source = `
      import { useEffect, useState } from "react";
      import { canPlayBackgroundVideoMime } from "./video-background-mime";
      const Background = ({ mime }) => {
        const [isPlayableVideo, setIsPlayableVideo] = useState(false);
        useEffect(() => {
          setIsPlayableVideo(canPlayBackgroundVideoMime(mime));
        }, [mime]);
        return <output>{String(isPlayableVideo)}</output>;
      };
    `;
    const filename = writeFile("src/background.tsx", source);
    const result = runRule(renderingHydrationNoFlicker, source, { filename });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
