import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const classifierMocks = vi.hoisted(() => ({
  classifyPackagePlatform: vi.fn(() => "web"),
}));

vi.mock("./utils/classify-package-platform.js", () => classifierMocks);

import { collectCrossFileDependencyProbes } from "./cross-file-dependencies.js";

beforeEach(() => {
  classifierMocks.classifyPackagePlatform.mockClear();
});

describe("collectCrossFileDependencyProbes collector deduplication", () => {
  it("runs a collector shared by multiple rules once", () => {
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: "/project/src/App.tsx",
      sourceText: "export const App = () => null;\n",
      ruleIds: ["no-dynamic-import-path", "no-full-lodash-import", "prefer-dynamic-import"],
    });

    expect(trace).not.toBeNull();
    expect(classifierMocks.classifyPackagePlatform).toHaveBeenCalledTimes(1);
  });
});
