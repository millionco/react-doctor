import { describe, expect, it } from "vite-plus/test";
import { classifySecretFileExposure } from "./classify-secret-file-exposure.js";

describe("classifySecretFileExposure", () => {
  it("classifies Next proxy entry files as server files", () => {
    expect(classifySecretFileExposure("/repo/proxy.mjs", { framework: "nextjs" })).toBe("server");
    expect(classifySecretFileExposure("/repo/src/proxy.mts", { framework: "nextjs" })).toBe(
      "server",
    );
  });

  it("does not classify proxy entry filenames as server files outside Next", () => {
    expect(classifySecretFileExposure("/repo/proxy.mjs", { framework: "vite" })).toBe("unknown");
  });
});
