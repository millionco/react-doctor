import { describe, expect, it } from "vite-plus/test";
import { parseThreeRelease } from "@react-doctor/core";

describe("parseThreeRelease", () => {
  it("parses Three.js release numbers from supported semver ranges", () => {
    expect(parseThreeRelease("^0.146.0")).toBe(146);
    expect(parseThreeRelease("~0.180.1")).toBe(180);
    expect(parseThreeRelease(">=0.146 <0.190")).toBe(146);
    expect(parseThreeRelease("0.146.x || 0.180.x")).toBe(146);
    expect(parseThreeRelease("npm:three@^0.150.0")).toBe(150);
  });

  it("keeps unknown and pre-release-number specs unclassified", () => {
    expect(parseThreeRelease(null)).toBeNull();
    expect(parseThreeRelease(undefined)).toBeNull();
    expect(parseThreeRelease("latest")).toBeNull();
    expect(parseThreeRelease("workspace:*")).toBeNull();
    expect(parseThreeRelease("catalog:146")).toBeNull();
    expect(parseThreeRelease("catalog:three146")).toBeNull();
    expect(parseThreeRelease("git+https://github.com/acme/three.git#v0.180.0")).toBeNull();
    expect(parseThreeRelease("acme/three#v0.180.0")).toBeNull();
    expect(parseThreeRelease("*")).toBeNull();
    expect(parseThreeRelease("0.0.0")).toBeNull();
  });

  it("treats a future stable major as newer than the release ladder", () => {
    expect(parseThreeRelease("^1.0.0")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
