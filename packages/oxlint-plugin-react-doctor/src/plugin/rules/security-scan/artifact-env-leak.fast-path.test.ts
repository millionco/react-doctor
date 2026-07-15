import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";

const { maskSourceCommentsMock } = vi.hoisted(() => ({
  maskSourceCommentsMock: vi.fn((_relativePath: string, content: string) => content),
}));

vi.mock("./utils/mask-source-comments.js", () => ({
  maskSourceComments: maskSourceCommentsMock,
}));

import { artifactEnvLeak } from "./artifact-env-leak.js";

describe("security-scan/artifact-env-leak — parse fast path", () => {
  beforeEach(() => {
    maskSourceCommentsMock.mockClear();
  });

  it("does not parse an artifact without a raw env-leak candidate", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/assets/client.js",
      content: `export const safeValue = "safe";`,
      isGeneratedBundle: true,
    });

    expect(findings).toHaveLength(0);
    expect(maskSourceCommentsMock).not.toHaveBeenCalled();
  });

  it("parses an artifact only after the raw scan finds a candidate", () => {
    runScanRule(artifactEnvLeak, {
      relativePath: "dist/assets/client.js",
      content: `export const databaseUrl = process.env.DATABASE_URL;`,
      isGeneratedBundle: true,
    });

    expect(maskSourceCommentsMock).toHaveBeenCalledOnce();
  });
});
