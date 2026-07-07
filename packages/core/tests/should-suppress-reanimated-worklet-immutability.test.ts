import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "../src/types/index.js";
import { shouldSuppressReanimatedWorkletImmutability } from "../src/runners/oxlint/should-suppress-reanimated-worklet-immutability.js";

let temporaryRoot: string;

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reanimated-worklet-"));
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const reanimatedProject = { hasReanimated: true } as ProjectInfo;
const plainProject = { hasReanimated: false } as ProjectInfo;

const writeFixture = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryRoot, relativePath);
  fs.writeFileSync(absolutePath, contents);
  return relativePath;
};

const diagnosticAt = (filename: string, contents: string, needle: string) => ({
  code: "react-hooks-js(immutability)",
  filename,
  labels: [{ span: { offset: Buffer.byteLength(contents.slice(0, contents.indexOf(needle))) } }],
});

describe("shouldSuppressReanimatedWorkletImmutability", () => {
  it("suppresses .value writes inside a useAnimatedStyle callback", () => {
    const contents = `import { useAnimatedStyle } from "react-native-reanimated";
export const useStyle = (offset) => {
  return useAnimatedStyle(() => {
    offset.value = offset.value + 1;
    return { transform: [{ translateX: offset.value }] };
  });
};
`;
    const filename = writeFixture("animated-style.ts", contents);
    expect(
      shouldSuppressReanimatedWorkletImmutability(
        diagnosticAt(filename, contents, "offset.value ="),
        reanimatedProject,
        temporaryRoot,
      ),
    ).toBe(true);
  });

  it("suppresses writes inside an explicit 'worklet' directive function", () => {
    const contents = `export const jump = (offset) => {
  const move = () => {
    "worklet";
    offset.value = 10;
  };
  return move;
};
`;
    const filename = writeFixture("worklet-directive.ts", contents);
    expect(
      shouldSuppressReanimatedWorkletImmutability(
        diagnosticAt(filename, contents, "offset.value ="),
        reanimatedProject,
        temporaryRoot,
      ),
    ).toBe(true);
  });

  it("suppresses writes inside Gesture callback chains", () => {
    const contents = `import { Gesture } from "react-native-gesture-handler";
export const buildPan = (translation) =>
  Gesture.Pan().onUpdate((event) => {
    translation.value = event.translationX;
  });
`;
    const filename = writeFixture("gesture.ts", contents);
    expect(
      shouldSuppressReanimatedWorkletImmutability(
        diagnosticAt(filename, contents, "translation.value ="),
        reanimatedProject,
        temporaryRoot,
      ),
    ).toBe(true);
  });

  it("keeps firing for writes in plain render code", () => {
    const contents = `export const Component = ({ shared }) => {
  shared.value = 1;
  return null;
};
`;
    const filename = writeFixture("render-write.tsx", contents);
    expect(
      shouldSuppressReanimatedWorkletImmutability(
        diagnosticAt(filename, contents, "shared.value ="),
        reanimatedProject,
        temporaryRoot,
      ),
    ).toBe(false);
  });

  it("never suppresses when the project has no Reanimated dependency", () => {
    const contents = `import { useAnimatedStyle } from "react-native-reanimated";
export const useStyle = (offset) =>
  useAnimatedStyle(() => {
    offset.value = 1;
    return {};
  });
`;
    const filename = writeFixture("no-reanimated.ts", contents);
    expect(
      shouldSuppressReanimatedWorkletImmutability(
        diagnosticAt(filename, contents, "offset.value ="),
        plainProject,
        temporaryRoot,
      ),
    ).toBe(false);
  });

  it("ignores non-immutability diagnostics", () => {
    const contents = `export const noop = () => {};\n`;
    const filename = writeFixture("other-rule.ts", contents);
    expect(
      shouldSuppressReanimatedWorkletImmutability(
        { code: "react-hooks-js(refs)", filename, labels: [{ span: { offset: 0 } }] },
        reanimatedProject,
        temporaryRoot,
      ),
    ).toBe(false);
  });
});
