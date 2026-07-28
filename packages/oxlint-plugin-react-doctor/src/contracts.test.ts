import * as fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { FRAMEWORK_TOKENS, MOTION_LIBRARY_PACKAGES } from "./contracts.js";
import {
  FRAMEWORK_TOKENS as LEGACY_FRAMEWORK_TOKENS,
  MOTION_LIBRARY_PACKAGES as LEGACY_MOTION_LIBRARY_PACKAGES,
} from "./index.js";

describe("shared vocabulary entry", () => {
  it("exposes the shared runtime vocabulary", () => {
    expect(FRAMEWORK_TOKENS).toContain("react-native");
    expect(FRAMEWORK_TOKENS).toContain("unknown");
    expect(MOTION_LIBRARY_PACKAGES).toEqual(new Set(["framer-motion", "motion"]));
    expect(LEGACY_FRAMEWORK_TOKENS).toBe(FRAMEWORK_TOKENS);
    expect(LEGACY_MOTION_LIBRARY_PACKAGES).toBe(MOTION_LIBRARY_PACKAGES);
  });

  it("depends only on side-effect-free modules", () => {
    const source = fs.readFileSync(new URL("./contracts.ts", import.meta.url), "utf8");
    const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "./plugin/constants/motion-library-packages.js",
      "./plugin/utils/capability.js",
      "./types.js",
    ]);
  });
});
