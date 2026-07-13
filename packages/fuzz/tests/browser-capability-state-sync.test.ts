import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  getBrowserCapabilityStateSyncDecision,
  shouldSuppressBrowserCapabilityStateSync,
} from "../../core/src/runners/oxlint/should-suppress-browser-capability-state-sync.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  DEFAULT_FUZZ_SEED,
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
  FUZZ_SEED_MULTIPLIER,
} from "../src/constants.js";
import { createSeededRandom } from "../src/seeded-random.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const TARGET_RULE_ID = "react-hooks-js/set-state-in-effect";
const isFuzzEnabled = process.env.REACT_DOCTOR_FUZZ === "1";
const ruleFilter = process.env.FUZZ_RULE;
const isTargetSelected = ruleFilter === undefined || TARGET_RULE_ID.includes(ruleFilter);
const readPositiveInteger = (rawValue: string | undefined, fallback: number): number => {
  if (rawValue === undefined) return fallback;
  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Expected a positive integer, got ${JSON.stringify(rawValue)}`);
  }
  return parsedValue;
};
const iterationCount = readPositiveInteger(process.env.FUZZ_ITERATIONS, DEFAULT_FUZZ_ITERATIONS);
const baseSeed = readPositiveInteger(process.env.FUZZ_SEED, DEFAULT_FUZZ_SEED);
const fuzzTimeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterationCount * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-capability-fuzz-"));
const filename = "component.tsx";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const regressionSeedName =
  "regressions/react-hooks--set-state-in-effect--browser-media-capability.tsx";

const validProgramFactories = [
  (prologue: string) => `import { useEffect } from "react";
const video = document.createElement("video");
const Component = ({ videoKey, videoMime }: { videoKey: string; videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [videoKey, videoMime]);
};
`,
  (prologue: string) => `import { useEffect } from "react";
const Component = ({ videoMime }: { videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    const video = document.createElement("video");
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [videoMime]);
};
`,
  (prologue: string) => `import { useEffect } from "react";
const video = document.createElement("video");
const Component = ({ videoMime }: { videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video ? video.canPlayType(videoMime) : "");
  }, [videoMime]);
};
`,
];

const reportableProgramFactories = [
  (prologue: string) => `useEffect(() => {
  ${prologue}
  setPlayableVideoKey(videoKey);
}, [videoKey]);
`,
  (prologue: string) => `useEffect(() => {
  ${prologue}
  setPlayableVideoKey(codec.canPlayType(videoMime));
}, [codec, videoMime]);
`,
  (prologue: string) => `const Component = ({ document }) => {
  useEffect(() => {
    ${prologue}
    const video = document.createElement("video");
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [document, videoMime]);
};
`,
  (prologue: string) => `useEffect(() => {
  ${prologue}
  const video = document.createElement("video");
  video.canPlayType(videoMime);
  setPlayableVideoKey("loading");
}, [videoMime]);
`,
  (prologue: string) => `useEffect(() => {
  ${prologue}
  const video = document.createElement("video");
  if (video.canPlayType(videoMime) !== "") {
    setPlayableVideoKey((currentKey) => currentKey + 1);
  }
}, [videoMime]);
`,
  (prologue: string) => `useEffect(() => {
  ${prologue}
  for (const document of documents) {
    const video = document.createElement("video");
    setPlayableVideoKey(video.canPlayType(videoMime));
  }
}, [documents, videoMime]);
`,
  (prologue: string) => `const video = document.createElement("video");
useEffect(() => {
  ${prologue}
  setPlayableVideoKey({ support: video.canPlayType(videoMime) });
}, [videoMime]);
`,
  (prologue: string) => `const video = document.createElement("video");
useEffect(() => {
  ${prologue}
  setPlayableVideoKey((currentState) => ({
    ...currentState,
    support: video.canPlayType(videoMime),
  }));
}, [videoMime]);
`,
  (prologue: string) => `import document from "./userland-document";
const video = document.createElement("video");
useEffect(() => {
  ${prologue}
  setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
}, [videoKey, videoMime]);
`,
  (prologue: string) => `const video = document.createElement("video");
const Component = ({ initial = {}, videoMime }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? initial : null);
  }, [initial, videoMime]);
};
`,
  (prologue: string) => `const video = document.createElement("video");
const Component = (...values) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType("video/mp4") !== "" ? values : null);
  }, [values]);
};
`,
  (prologue: string) => `const video = document.createElement("video");
useEffect(() => {
  ${prologue}
  setPlayableVideoKey(video.canPlayType(getAlternatingMime()));
}, [getAlternatingMime]);
`,
  (prologue: string) => `const video = document.createElement("video");
const alias = video;
alias.canPlayType = () => "probably";
const Component = ({ videoMime }: { videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [videoMime]);
};
`,
  (prologue: string) => `const video = document.createElement("video");
mutate(video);
const Component = ({ videoMime }: { videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [videoMime]);
};
`,
  (prologue: string) => `document.createElement = () => ({ canPlayType: () => "probably" });
const video = document.createElement("video");
const Component = ({ videoMime }: { videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [videoMime]);
};
`,
  (prologue: string) => `HTMLMediaElement.prototype.canPlayType = () => "probably";
const video = document.createElement("video");
const Component = ({ videoMime }: { videoMime: string }) => {
  useEffect(() => {
    ${prologue}
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [videoMime]);
};
`,
].map(
  (createProgramBody) => (prologue: string) =>
    `import { useEffect } from "react";\n${createProgramBody(prologue)}`,
);

const buildDiagnostic = (sourceText: string) => ({
  code: "react-hooks-js(set-state-in-effect)",
  filename,
  labels: [
    {
      span: {
        offset: Buffer.byteLength(sourceText.slice(0, sourceText.indexOf("setPlayableVideoKey("))),
      },
    },
  ],
});

const shouldSuppress = (sourceText: string): boolean => {
  fs.writeFileSync(path.join(temporaryRoot, filename), sourceText);
  return shouldSuppressBrowserCapabilityStateSync(buildDiagnostic(sourceText), temporaryRoot);
};

const getDecision = (sourceText: string): string => {
  fs.writeFileSync(path.join(temporaryRoot, filename), sourceText);
  return getBrowserCapabilityStateSyncDecision(buildDiagnostic(sourceText), temporaryRoot);
};

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe.skipIf(!isFuzzEnabled || !isTargetSelected)("browser capability state sync fuzz", () => {
  it("loads the permanent regression seed through the core post-filter", () => {
    const regressionSeed = loadFuzzCorpus(path.join(packageRoot, "corpus")).find(
      (entry) => entry.relativePath === regressionSeedName,
    );
    if (!regressionSeed) throw new Error(`Missing fuzz seed ${regressionSeedName}`);
    expect(shouldSuppress(regressionSeed.code)).toBe(true);
  });

  it("reaches state-selection analysis for every reportable factory", () => {
    for (const createReportableProgram of reportableProgramFactories) {
      expect(getDecision(createReportableProgram(""))).toBe("unproven-state-selection");
    }
  });

  it(
    "keeps suppression and reportable paths live",
    () => {
      let suppressedProgramCount = 0;
      let reportableProgramCount = 0;
      for (let iteration = 0; iteration < iterationCount; iteration += 1) {
        const random = createSeededRandom((baseSeed * FUZZ_SEED_MULTIPLIER + iteration) >>> 0);
        const prologue = random.pick(["", "void 0;", "const marker = true;"]);
        const validProgram = random.pick(validProgramFactories)(prologue);
        const reportableProgram = random.pick(reportableProgramFactories)(prologue);
        if (shouldSuppress(validProgram)) suppressedProgramCount += 1;
        if (getDecision(reportableProgram) === "unproven-state-selection") {
          reportableProgramCount += 1;
        }
      }
      expect(suppressedProgramCount).toBe(iterationCount);
      expect(reportableProgramCount).toBe(iterationCount);
      console.info(
        `fuzz stats: ${TARGET_RULE_ID} executed=${iterationCount + iterationCount} suppressed=${suppressedProgramCount} reportable=${reportableProgramCount}`,
      );
    },
    fuzzTimeoutMs,
  );
});
