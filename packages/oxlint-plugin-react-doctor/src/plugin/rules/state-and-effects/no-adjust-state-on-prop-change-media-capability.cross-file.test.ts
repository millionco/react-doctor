import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearTsconfigAliasCacheForTests } from "../../utils/resolve-tsconfig-alias.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "media-capability-helper-"));
  __clearParseSourceFileCacheForTests();
  __clearTsconfigAliasCacheForTests();
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

const runConsumer = (source: string): ReturnType<typeof runRule> => {
  const consumerPath = writeFile("src/AnimatedBackground.tsx", source);
  return runRule(noAdjustStateOnPropChange, source, { filename: consumerPath });
};

describe("no-adjust-state-on-prop-change — imported media capability helpers", () => {
  it("stays silent for a browser capability helper", () => {
    writeFile(
      "src/media.ts",
      `export const isPlayableVideoType = (mime) =>
        document.createElement("video").canPlayType(mime) !== "";`,
    );
    const result = runConsumer(`
import { isPlayableVideoType } from "./media";
function AnimatedBackground({ src, mime }) {
  const [videoSupport, setVideoSupport] = useState(null);
  useEffect(() => {
    if (!src || !mime) {
      setVideoSupport(null);
      return;
    }
    const isPlayable = isPlayableVideoType(mime);
    setVideoSupport({ src, isPlayable });
  }, [src, mime]);
  return videoSupport;
}
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports an unrelated reset beside an imported capability query", () => {
    writeFile(
      "src/media.ts",
      `export const isPlayableVideoType = (mime) =>
        document.createElement("video").canPlayType(mime) !== "";`,
    );
    const result = runConsumer(`
import { isPlayableVideoType } from "./media";
function Editor({ documentId, mime }) {
  const [draft, setDraft] = useState(null);
  const [isPlayable, setIsPlayable] = useState(false);
  useEffect(() => {
    setDraft(null);
    setIsPlayable(isPlayableVideoType(mime));
  }, [documentId, mime]);
  return draft ?? isPlayable;
}
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust an imported helper with a shadowed document binding", () => {
    writeFile(
      "src/media.ts",
      `const document = { createElement: () => ({ canPlayType: () => "probably" }) };
       export const isPlayableVideoType = (mime) =>
         document.createElement("video").canPlayType(mime) !== "";`,
    );
    const result = runConsumer(`
import { isPlayableVideoType } from "./media";
function Capability({ mime }) {
  const [isPlayable, setIsPlayable] = useState(false);
  useEffect(() => {
    setIsPlayable(false);
    isPlayableVideoType(mime);
  }, [mime]);
  return isPlayable;
}
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not count browser work inside an uncalled nested function", () => {
    writeFile(
      "src/media.ts",
      `export const formatMime = (mime) => {
        const probe = () => document.createElement("video").canPlayType(mime);
        return mime.trim();
      };`,
    );
    const result = runConsumer(`
import { formatMime } from "./media";
function Capability({ mime }) {
  const [normalizedMime, setNormalizedMime] = useState("");
  useEffect(() => {
    setNormalizedMime("");
    formatMime(mime);
  }, [mime]);
  return normalizedMime;
}
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a function-declaration capability helper", () => {
    writeFile(
      "src/AnimatedBackground.utils.ts",
      `export function canPlayVideoMime(normalizedMime) {
        if (typeof document === "undefined") return false;
        const video = document.createElement("video");
        const result = video.canPlayType(normalizedMime);
        return result === "maybe" || result === "probably";
      }`,
    );
    const result = runConsumer(`
import { canPlayVideoMime } from "./AnimatedBackground.utils";
function AnimatedBackground({ src, normalizedMime }) {
  const [isVideoPlayable, setIsVideoPlayable] = useState(false);
  useEffect(() => {
    if (!src || !normalizedMime) {
      setIsVideoPlayable(false);
      return;
    }
    setIsVideoPlayable(canPlayVideoMime(normalizedMime));
  }, [src, normalizedMime]);
  return isVideoPlayable;
}
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
